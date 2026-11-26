package family.hardy.home.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import androidx.core.content.FileProvider
import family.hardy.home.model.*
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Client projections only. All resource authorization and mutations stay on the service. */
internal class WorkspaceRepositorySupport(
    private val context: Context,
    private val identity: DeviceIdentityStore,
    private val state: MutableStateFlow<HouseholdUiState>,
    private val scope: CoroutineScope,
    private val send: (String, JSONObject?) -> Unit,
) {
    private val transport = SignedHouseholdTransport(identity)
    private val library = HouseholdLibraryApi(transport)
    private val media = ClientAttachmentStore(context)
    private var searchJob: Job? = null
    private val workspaceLock = Any()
    private var workspaceRead = 0L
    private val thumbnailLoad = Mutex()
    private val thumbnails = LruCache<ArtifactCard, Bitmap>(12)

    init { state.update { it.copy(attachments = media.ui()) } }

    fun setMode(mode: InteractionMode) {
        if (state.value.sending) return
        if (state.value.currentProfile.role == "child" && mode != InteractionMode.Conversation) return
        if (mode == InteractionMode.Diagnostic && HouseholdCapability.ViewDiagnostics !in state.value.capabilities) return
        state.update { it.copy(interactionMode = mode) }
    }
    fun setTab(tab: WorkspaceTab) {
        if (tab != WorkspaceTab.Chat && tab.wire !in state.value.availableViews) return
        state.update { it.copy(workspaceTab = tab, libraryNotice = null) }
        loadTab()
    }
    fun setLibraryQuery(value: String) {
        state.update { it.copy(libraryQuery = value) }; searchJob?.cancel()
        searchJob = scope.launch { delay(250); loadTabNow() }
    }
    fun setLibraryScope(value: String) {
        if (value !in listOf("household", "personal")) return
        state.update { it.copy(libraryScope = value, wikiPage = null) }; loadTab()
    }
    fun loadTab() { scope.launch { loadTabNow() } }
    private suspend fun loadTabNow() {
        val current = state.value
        if (current.workspaceTab == WorkspaceTab.Chat) return
        state.update { it.copy(libraryLoading = true, libraryNotice = null) }
        runCatching {
            when (current.workspaceTab) {
                WorkspaceTab.Contacts -> {
                    val values = library.contacts(current.libraryQuery)
                    state.update { if (it.workspaceTab == current.workspaceTab && it.libraryQuery == current.libraryQuery) it.copy(contacts = values) else it }
                }
                WorkspaceTab.Lists -> {
                    val (values, updated) = library.lists(current.libraryScope)
                    state.update { if (it.libraryScope == current.libraryScope) it.copy(listEntries = values, libraryUpdatedAt = updated) else it }
                }
                WorkspaceTab.Wiki -> {
                    val values = library.wiki(current.libraryScope, current.libraryQuery)
                    state.update { if (it.libraryScope == current.libraryScope && it.libraryQuery == current.libraryQuery) it.copy(wikiCards = values) else it }
                }
                WorkspaceTab.Receipts -> { val values = library.reviews(); state.update { it.copy(receiptReviews = values) } }
                else -> Unit
            }
        }.onFailure { error -> state.update { it.copy(libraryNotice = friendlyClientError(error, "This view is unavailable right now")) } }
        state.update { it.copy(libraryLoading = false) }
    }
    suspend fun refreshWorkspace(conversationId: String) {
        val read = synchronized(workspaceLock) {
            val current = state.value
            if (current.selectedConversationId != conversationId || current.connectionMode == ConnectionMode.Error) return
            ++workspaceRead
        }
        runCatching {
            val result = library.workspace(conversationId)
            val task = result.optJSONObject("task") ?: JSONObject()
            val progress = task.opt("progress")
            val progressObject = progress as? JSONObject
            val question = task.optJSONObject("question")?.let { value ->
                if (value.optString("id").isBlank()) null else TaskQuestion(value.getString("id"), value.optString("text"), value.optString("kind", "clarification"), value.optJSONObject("approval") != null)
            }
            val steps = (progressObject?.optJSONArray("steps") ?: task.optJSONArray("steps")).objectsSafe().map { TaskStep(it.optString("step", it.optString("text")), it.optString("status")) }
            val workspace = TaskWorkspace(task.optString("mode", "conversation"), task.optString("phase"), task.optString("status"),
                task.optString("goalId").takeIf(String::isNotBlank), task.optString("objective"),
                if (progress is String) progress else progressObject?.let { it.optString("summary", it.optString("markdown")) }.orEmpty(), steps, question,
                task.optInt("checkpointRevision", -1).takeIf { it >= 0 }, task.optString("runId").takeIf(String::isNotBlank),
                activity = ConversationActivity.entries.firstOrNull { it.wire == task.optString("activity") }
                    ?: ConversationActivity.Idle)
            val artifacts = result.optJSONArray("artifacts").objectsSafe().map { artifact -> ArtifactCard(artifact.getString("id"), artifact.optString("filename", "Saved output"),
                artifact.optString("mimeType"), artifact.optString("audience", "private"), artifact.optString("kind"), artifact.optLong("byteLength"), conversationId = conversationId) }
            val views = result.optJSONArray("availableViews").stringsSafe().toSet()
            updateWorkspaceRead(conversationId, read) { previous ->
                previous.copy(taskWorkspace = workspace, artifacts = artifacts,
                    availableViews = views, replyingToQuestionId = when {
                        question == null -> null
                        previous.taskWorkspace.question?.id != question.id && previous.focus == null -> question.id
                        else -> previous.replyingToQuestionId
                    })
            }
        }.onFailure { error ->
            updateWorkspaceRead(conversationId, read) {
                it.copy(taskWorkspace = it.taskWorkspace.copy(activity = ConversationActivity.Idle),
                    statusNotice = friendlyClientError(error, "Could not refresh this task"))
            }
        }
    }

    private fun updateWorkspaceRead(conversationId: String, read: Long, update: (HouseholdUiState) -> HouseholdUiState) {
        synchronized(workspaceLock) {
            if (workspaceRead != read) return
            state.update {
                if (it.selectedConversationId == conversationId && it.connectionMode != ConnectionMode.Error) update(it) else it
            }
        }
    }

    fun updateConversation(reset: Boolean = false, update: (HouseholdUiState) -> HouseholdUiState) {
        synchronized(workspaceLock) {
            val previousId = state.value.selectedConversationId
            state.update { previous ->
                val next = update(previous)
                when {
                    reset || next.selectedConversationId != previous.selectedConversationId ->
                        next.copy(taskWorkspace = TaskWorkspace(), artifacts = emptyList(), focus = null, replyingToQuestionId = null, preview = null)
                    next.connectionMode == ConnectionMode.Error ->
                        next.copy(taskWorkspace = next.taskWorkspace.copy(activity = ConversationActivity.Idle), artifacts = emptyList(), preview = null)
                    else -> next
                }
            }
            if (reset || state.value.selectedConversationId != previousId || state.value.connectionMode == ConnectionMode.Error) {
                workspaceRead++
                thumbnails.evictAll()
            }
        }
    }
    fun addAttachment(uri: Uri, mimeType: String?) {
        state.update { it.copy(statusNotice = "Saving attachment…") }
        scope.launch {
            runCatching { media.add(uri, mimeType) }.onSuccess { state.update { it.copy(attachments = media.ui(), statusNotice = "Attachment ready") } }
                .onFailure { error -> state.update { it.copy(statusNotice = friendlyClientError(error, "Could not add this attachment")) } }
        }
    }
    fun removeAttachment(id: String) { media.remove(id); state.update { it.copy(attachments = media.ui()) } }
    suspend fun messageMetadata(conversationId: String, ids: Set<String>, override: JSONObject? = null, current: HouseholdUiState = state.value): JSONObject {
        val selected = state.value.conversations.firstOrNull { it.id == conversationId }
        val artifactIds = media.upload(ids, conversationId, if (selected?.isShared == true) "household" else "private", transport) { notice -> state.update { it.copy(statusNotice = notice) } }
        return JSONObject().put("mode", current.interactionMode.wire).apply {
            if (artifactIds.isNotEmpty()) put("artifactIds", JSONArray(artifactIds))
            current.replyingToQuestionId?.let { put("replyToQuestionId", it) }
            current.focus?.let { value -> put("focus", JSONObject().put("kind", value.kind).put("id", value.id).apply {
                value.revision?.let { put("revision", it) }; value.scope?.let { put("scope", it) }
            }) }
            override?.keys()?.forEach { key -> put(key, override.get(key)) }
        }
    }
    fun clearAcceptedRemote(conversationId: String, artifactIds: Set<String>) {
        media.clearAcceptedRemote(conversationId, artifactIds); state.update { it.copy(attachments = media.ui()) }
    }
    fun acceptedAttachmentIds(): Set<String> = media.load().map { it.id }.toSet()
    fun clearAcceptedAttachments(ids: Set<String>) { media.clear(ids); state.update { it.copy(attachments = media.ui(), focus = null) } }
    fun openContact(id: String) = scope.launch {
        runCatching { library.contact(id) }.onSuccess { detail -> state.update { it.copy(contactDetail = detail) } }
            .onFailure { error -> state.update { it.copy(libraryNotice = friendlyClientError(error, "Could not open this card")) } }
    }.let { Unit }
    fun closeContact() { state.update { it.copy(contactDetail = null) } }
    fun openWiki(id: String) = scope.launch {
        val selectedScope = state.value.libraryScope
        runCatching { library.wikiPage(selectedScope, id) }.onSuccess { page -> state.update { it.copy(wikiPage = page) } }
            .onFailure { error -> state.update { it.copy(libraryNotice = friendlyClientError(error, "Could not open this page")) } }
    }.let { Unit }
    fun closeWiki() { state.update { it.copy(wikiPage = null) } }
    fun discuss(focus: ConversationFocus, prompt: String) {
        if (state.value.sending) return
        val selected = state.value.conversations.firstOrNull { it.id == state.value.selectedConversationId }
        if (selected?.canWrite == false) {
            state.update { it.copy(libraryNotice = "Open your own conversation before discussing this item") }; return
        }
        val sharedConversation = selected?.isShared == true
        if (sharedConversation && focus.scope == "personal") {
            state.update { it.copy(libraryNotice = "Open a private conversation before discussing a personal item") }
            return
        }
        state.update { it.copy(workspaceTab = WorkspaceTab.Chat, focus = focus, draft = prompt, interactionMode = InteractionMode.Task,
            contactDetail = null, wikiPage = null, replyingToQuestionId = null, statusNotice = "${focus.label.ifBlank { "Item" }} selected for this conversation") }
    }
    fun clearFocus() { if (!state.value.sending) state.update { it.copy(focus = null) } }
    fun answerApproval(approved: Boolean) {
        val question = state.value.taskWorkspace.question ?: return
        if (!question.approval) return
        send(if (approved) "Approve this action." else "Do not carry out this action.", JSONObject().put("replyToQuestionId", question.id)
            .put("approval", JSONObject().put("questionId", question.id).put("decision", if (approved) "approve" else "reject")))
    }
    suspend fun loadArtifactThumbnail(artifact: ArtifactCard): Bitmap? = withContext(Dispatchers.IO) {
        // Serialize and recheck the in-memory cache after waiting so repeated mentions share one download.
        thumbnailLoad.withLock {
            val conversation = artifact.conversationId ?: return@withLock null
            val device = identity.deviceId ?: return@withLock null
            fun current(): Boolean {
                val snapshot = state.value
                return identity.deviceId == device && snapshot.selectedConversationId == conversation &&
                    snapshot.connectionMode != ConnectionMode.Error && artifact in snapshot.artifacts
            }
            val maximumBytes = 8 * 1024 * 1024
            if (!artifact.isConversationImage(conversation) || artifact.byteLength !in 1L..maximumBytes.toLong() || !current()) return@withLock null
            thumbnails.get(artifact)?.let { return@withLock it }
            try {
                val response = transport.request("GET", artifactPath(conversation, artifact), maximumBytes = maximumBytes).requireSuccess()
                if (response.mimeType != artifact.mimeType || response.bytes.size.toLong() != artifact.byteLength) return@withLock null
                val bitmap = decodeRaster(response.bytes, maximumEdge = 384) ?: return@withLock null
                synchronized(workspaceLock) {
                    if (current()) bitmap.also { thumbnails.put(artifact, it) } else null
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // The chat keeps an open-preview action when an automatic download fails.
                null
            }
        }
    }

    fun openArtifact(artifact: ArtifactCard) = scope.launch {
        val conversation = state.value.selectedConversationId
        val device = identity.deviceId ?: return@launch
        if (artifact.conversationId != null && artifact.conversationId != conversation) return@launch
        fun current(snapshot: HouseholdUiState) = identity.deviceId == device && snapshot.connectionMode != ConnectionMode.Error &&
            (artifact.contactId != null || snapshot.selectedConversationId == conversation)
        state.update { it.copy(statusNotice = "Opening ${artifact.filename}…") }
        runCatching {
            val response = transport.request("GET", artifactPath(conversation, artifact), maximumBytes = 26 * 1024 * 1024).requireSuccess()
            val mime = artifact.mimeType.ifBlank { response.mimeType }
            val directory = File(context.cacheDir, "shared").apply { mkdirs() }
            directory.listFiles()?.sortedByDescending(File::lastModified)?.forEachIndexed { index, cached ->
                if (index >= 7 || System.currentTimeMillis() - cached.lastModified() > 30 * 60 * 1000) cached.delete()
            }
            val suffix = when (mime) { "application/pdf" -> ".pdf"; "text/csv" -> ".csv"; "image/png" -> ".png"; "image/jpeg" -> ".jpg"; "image/webp" -> ".webp"; else -> ".txt" }
            val file = File(directory, "view-${UUID.randomUUID()}$suffix").apply { writeBytes(response.bytes) }
            val bitmap = if (mime in rasterArtifactMimeTypes) decodeRaster(response.bytes, maximumEdge = 1600) else null
            val text = if (mime.startsWith("text/") || mime in setOf("application/json", "image/svg+xml")) response.bytes.toString(Charsets.UTF_8).take(200_000) else null
            MediaPreview(artifact.filename, mime, bitmap, text, FileProvider.getUriForFile(context, "${context.packageName}.files", file).toString())
        }.onSuccess { preview -> state.update { if (current(it)) it.copy(preview = preview, statusNotice = null) else it } }
            .onFailure { error -> state.update { if (current(it)) it.copy(statusNotice = friendlyClientError(error, "Could not open this output")) else it } }
    }.let { Unit }
    fun closePreview() { state.update { it.copy(preview = null) } }
    fun clearPrivateState() {
        synchronized(workspaceLock) { thumbnails.evictAll() }
        media.clear(); File(context.cacheDir, "shared").listFiles()?.forEach(File::delete)
        File(context.cacheDir, "capture").listFiles()?.forEach(File::delete)
        state.update { it.copy(contacts = emptyList(), contactDetail = null, listEntries = emptyList(), wikiCards = emptyList(), wikiPage = null,
            receiptReviews = emptyList(), attachments = emptyList(), artifacts = emptyList(), preview = null, taskWorkspace = TaskWorkspace(), availableViews = emptySet(), focus = null) }
    }
    private fun artifactPath(conversation: String, artifact: ArtifactCard): String =
        if (artifact.contactId != null) "/v1/contacts/${encode(artifact.contactId)}/sources/${encode(artifact.id)}/content"
        else "/v1/conversations/${encode(conversation)}/artifacts/${encode(artifact.id)}/content"

    private fun encode(value: String) = SignedHouseholdTransport.encode(value)
}

private fun decodeRaster(bytes: ByteArray, maximumEdge: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val edge = maxOf(bounds.outWidth, bounds.outHeight)
    var sample = 1
    while (edge.toLong() > maximumEdge.toLong() * sample) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
}

internal fun friendlyClientError(error: Throwable, fallback: String): String {
    val code = (error as? HouseholdRequestException)?.code ?: error.message.orEmpty()
    return when (code) {
        "attachment_type_not_supported" -> "Choose a photo or a PDF document"
        "attachment_too_large", "body_too_large" -> "This attachment exceeds the 25 MB limit"
        "attachment_limit" -> "Send these attachments before adding more"
        "attachment_empty", "attachment_draft_changed" -> "This attachment is no longer available; choose it again"
        "focus_revision_conflict", "contact_revision_conflict" -> "This card changed. Refresh it before continuing"
        "google_not_configured", "dependency_failed", "provider_unavailable" -> "This connection is not available yet"
        "receipt_project_not_authorized", "receipt_project_not_found" -> "Receipt projects still need to be set up"
        "scheduled_authorization_not_configured" -> "Automatic scheduled work is not enabled yet"
        "device_not_enrolled", "device_revoked", "invalid_or_expired_invitation" -> "This device needs a new invitation"
        else -> fallback
    }
}
