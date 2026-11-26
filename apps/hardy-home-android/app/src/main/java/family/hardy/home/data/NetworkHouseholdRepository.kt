package family.hardy.home.data

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Build
import family.hardy.home.api.generated.ApiResponse
import family.hardy.home.api.generated.GeneratedHouseholdApiClient
import family.hardy.home.model.ChatMessage
import family.hardy.home.model.ConnectionMode
import family.hardy.home.model.ConversationSummary
import family.hardy.home.model.DiagnosticsSummary
import family.hardy.home.model.HouseholdCapability
import family.hardy.home.model.HouseholdUiState
import family.hardy.home.model.WorkspaceTab
import family.hardy.home.model.MessageRole
import family.hardy.home.model.PersonStatus
import family.hardy.home.model.PersonSummary
import family.hardy.home.model.PromptPreset
import kotlinx.coroutines.CancellationException
import java.io.File
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private data class PendingSubmission(val id: String, val conversationId: String, val body: String, val path: String, val phase: String = "pending", val receipt: String? = null)

class NetworkHouseholdRepository(context: Context) : HouseholdRepository {
    private val appContext = context.applicationContext
    private val identity = DeviceIdentityStore(appContext)
    private val pendingPreferences = appContext.getSharedPreferences("hardy_home_pending", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var eventsJob: Job? = null
    @Volatile private var eventsConnection: java.net.HttpURLConnection? = null

    private val placeholder = PersonSummary(
        id = "alex",
        displayName = "Alex",
        initials = "AH",
        color = 0xFF3559E0,
        status = PersonStatus.Offline,
        statusDetail = "Connect this phone",
    )
    private val _state = MutableStateFlow(
        HouseholdUiState(
            currentProfile = placeholder,
            capabilities = emptySet(),
            people = listOf(placeholder),
            conversations = emptyList(),
            presets = emptyList(),
            selectedConversationId = "",
            selectedPresetId = null,
            messages = emptyList(),
            draft = "",
            maxActiveRuns = 2,
            diagnostics = DiagnosticsSummary("Not connected", "Hidden", "Hidden", "Hidden"),
            connectionMode = if (identity.isEnrolled) ConnectionMode.Connecting else ConnectionMode.NeedsEnrollment,
            serverUrl = identity.serverUrl,
        ),
    )
    override val state: StateFlow<HouseholdUiState> = _state.asStateFlow()

    private val transport = SignedHouseholdTransport(identity)
    private val workspace = WorkspaceRepositorySupport(appContext, identity, _state, scope, ::sendText)
    private val pendingLock = Any()
    private val receiptStates = linkedMapOf<String,String>()

    init {
        if (identity.isEnrolled) refresh()
    }

    private fun client(authenticated: Boolean = true): GeneratedHouseholdApiClient =
        GeneratedHouseholdApiClient(identity.serverUrl, if (authenticated) identity else null)

    override fun setServerUrl(value: String) {
        _state.update { it.copy(serverUrl = value, statusNotice = null) }
    }

    override fun setEnrollmentCode(value: String) {
        _state.update { it.copy(enrollmentCode = value.uppercase(), statusNotice = null) }
    }

    override fun enroll() {
        val serverUrl = _state.value.serverUrl.trim().trimEnd('/')
        val code = _state.value.enrollmentCode.trim()
        if (!(serverUrl.startsWith("https://") || serverUrl.startsWith("http://")) || code.length < 8) {
            _state.update { it.copy(statusNotice = "Enter the server address and complete enrollment code") }
            return
        }
        _state.update { it.copy(connectionMode = ConnectionMode.Connecting, statusNotice = "Enrolling this phone…") }
        scope.launch {
            runCatching {
                identity.serverUrl = serverUrl
                val request = JSONObject()
                    .put("code", code)
                    .put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
                    .put("publicKeyDerBase64", identity.publicKeyDerBase64())
                    .toString()
                val response = client(authenticated = false).claimEnrollment(request).requireSuccess(201)
                val result = JSONObject(response.body)
                identity.completeEnrollment(result.getString("deviceId"), serverUrl)
            }.onSuccess {
                _state.update { it.copy(enrollmentCode = "", statusNotice = "Phone enrolled") }
                refreshNow()
            }.onFailure { error ->
                _state.update {
                    it.copy(
                        connectionMode = ConnectionMode.NeedsEnrollment,
                        statusNotice = error.userMessage("Enrollment failed"),
                    )
                }
            }
        }
    }

    override fun refresh() {
        scope.launch { refreshNow() }
    }

    private suspend fun refreshNow() {
        if (!identity.isEnrolled) {
            _state.update { it.copy(connectionMode = ConnectionMode.NeedsEnrollment) }
            return
        }
        _state.update { it.copy(connectionMode = ConnectionMode.Connecting) }
        runCatching {
            val api = client()
            val profileJson = JSONObject(api.getCurrentProfile().requireSuccess().body).getJSONObject("profile")
            val statusJson = JSONObject(api.getHouseholdStatus().requireSuccess().body)
            val presetsJson = JSONObject(api.listPresets().requireSuccess().body).getJSONArray("presets")
            val conversationsJson = JSONObject(api.listConversations().requireSuccess().body).getJSONArray("conversations")
            val currentProfile = profileJson.toPerson()
            val capabilities = profileJson.getJSONArray("capabilities").strings()
                .mapNotNull(::capability)
                .toSet()
            val people = statusJson.getJSONArray("profiles").objects().map { it.toPerson() }
            val presets = presetsJson.objects().map {
                PromptPreset(it.getString("id"), it.getString("label"), it.getString("description"))
            }
            val conversations = conversationsJson.objects().map { it.toConversation(currentProfile.id) }
            val diagnostics = if (HouseholdCapability.ViewDiagnostics in capabilities) {
                parseDiagnostics(api.getDiagnostics().requireSuccess().body)
            } else {
                DiagnosticsSummary("Connected", "Restricted", "Restricted", "Restricted")
            }
            workspace.updateConversation {
                val selectedId = it.selectedConversationId.takeIf { selected ->
                    conversations.any { conversation -> conversation.id == selected }
                } ?: conversations.firstOrNull()?.id.orEmpty()
                it.copy(
                    currentProfile = currentProfile,
                    interactionMode = if (currentProfile.role == "child") family.hardy.home.model.InteractionMode.Conversation else it.interactionMode,
                    capabilities = capabilities,
                    people = people,
                    conversations = conversations,
                    presets = presets,
                    selectedConversationId = selectedId,
                    messages = if (selectedId == it.selectedConversationId) it.messages else emptyList(),
                    maxActiveRuns = statusJson.getInt("maxActiveRuns"),
                    diagnostics = diagnostics,
                    connectionMode = ConnectionMode.Connected,
                    statusNotice = null,
                )
            }
            val selectedId = _state.value.selectedConversationId
            if (selectedId.isNotEmpty()) {
                loadMessagesNow(selectedId)
                workspace.refreshWorkspace(selectedId)
            }
            workspace.loadTab()
            restoreDeliveryNotices()
            retryPending()
            startEvents()
        }.onFailure { error ->
            if (error is HouseholdRequestException && error.status == 401) {
                // A rejected request does not establish that the phone key is gone.
                workspace.updateConversation {
                    it.copy(
                        capabilities = emptySet(),
                        preview = null,
                        connectionMode = ConnectionMode.Error,
                        statusNotice = "Phone sign-in failed. Your enrollment is saved. Retry the connection.",
                    )
                }
                return
            }
            workspace.updateConversation {
                it.copy(
                    connectionMode = ConnectionMode.Error,
                    statusNotice = error.userMessage("Cannot reach Hardy Home"),
                )
            }
        }
    }

    internal fun connectionsOwner(): Boolean = _state.value.currentProfile.role == "admin" &&
        HouseholdCapability.ManageAccess in _state.value.capabilities && identity.isEnrolled

    internal fun connectionRedirect(): String {
        val base = java.net.URI(identity.serverUrl)
        val host = base.host.orEmpty().lowercase()
        val local = host == "localhost" || host.endsWith(".localhost") || host.contains(':') ||
            host.matches(Regex("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) || !host.contains('.')
        return if (local) "http://localhost:8787/oauth2/callback"
            else identity.serverUrl.trimEnd('/') + "/v1/connections/google/callback"
    }

    internal suspend fun connectionRequest(method: String, suffix: String, body: JSONObject?): JSONObject {
        check(connectionsOwner()) { "owner_required" }
        return transport.connectionRequest(method, "/v1/connections" + suffix, body).requireSuccess().json()
    }

    internal fun receiptOwner(): String? {
        val state = _state.value
        return state.currentProfile.id.takeIf {
            identity.isEnrolled && state.connectionMode == ConnectionMode.Connected &&
                HouseholdCapability.Chat in state.capabilities && it in setOf("alex", "natasha")
        }
    }

    internal suspend fun uploadReceipt(id: String, file: File): JSONObject {
        require(file.length() in 3..(25L * 1024 * 1024))
        return transport.uploadReceipt(id, file.readBytes()).requireSuccess().json()
    }

    internal suspend fun receiptRequest(method: String, suffix: String, body: JSONObject?) =
        transport.receiptRequest(method, suffix, body).requireSuccess().json()

    internal suspend fun receiptPreview(id: String): android.graphics.Bitmap? = kotlinx.coroutines.withContext(Dispatchers.IO) {
        val bytes = transport.receiptRequest("GET", "/" + SignedHouseholdTransport.encode(id) + "/photo", null)
            .requireSuccess().bytes
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@withContext null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1200) sample *= 2
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    internal fun dictationTarget(): DictationTarget? = dictationTarget(_state.value)

    private fun dictationTarget(state: HouseholdUiState): DictationTarget? {
        if (!identity.isEnrolled || state.sending || state.workspaceTab != WorkspaceTab.Chat ||
            HouseholdCapability.VoiceInput !in state.capabilities || HouseholdCapability.Chat !in state.capabilities ||
            state.conversations.firstOrNull { it.id == state.selectedConversationId }?.canWrite == false) return null
        return DictationTarget(state.currentProfile.id, state.selectedConversationId)
    }

    internal suspend fun transcribeDictation(file: File): String = kotlinx.coroutines.withContext(Dispatchers.IO) {
        require(file.length() in 12..(12L * 1024 * 1024))
        transport.transcribeDictation(file.readBytes()).requireSuccess().json().getString("text")
    }

    internal fun appendDictation(target: DictationTarget, text: String): Boolean {
        while (true) {
            val previous = _state.value
            if (dictationTarget(previous) != target) return false
            val draft = if (previous.draft.isBlank()) text else previous.draft.trimEnd() + "\n\n" + text
            if (_state.compareAndSet(previous, previous.copy(draft = draft))) return true
        }
    }

    override fun setDraft(value: String) {
        if (_state.value.sending) return
        _state.update { it.copy(draft = value, statusNotice = null) }
    }

    override fun selectConversation(conversationId: String) {
        if (_state.value.sending) return
        if (_state.value.conversations.none { it.id == conversationId }) return
        workspace.updateConversation(reset = true) {
            it.copy(
                selectedConversationId = conversationId,
                messages = emptyList(),
                drawerOpen = false,
                diagnosticsVisible = false,
                statusNotice = "Loading conversation…",
            )
        }
        scope.launch {
            runCatching { loadMessagesNow(conversationId); workspace.refreshWorkspace(conversationId) }
                .onFailure { error -> _state.update { it.copy(statusNotice = error.userMessage("Could not load conversation")) } }
        }
    }

    private suspend fun loadMessagesNow(conversationId: String) {
        val response = client().listMessages(conversationId).requireSuccess()
        val messages = JSONObject(response.body).getJSONArray("messages").objects().mapNotNull { item ->
            when (item.getString("role")) {
                "user" -> MessageRole.User
                "assistant" -> MessageRole.Assistant
                else -> null
            }?.let { role ->
                ChatMessage(
                    id = item.getString("id"),
                    role = role,
                    text = item.getString("text"),
                    timeLabel = displayTime(item.optString("createdAt")),
                )
            }
        }
        _state.update {
            if (it.selectedConversationId == conversationId) it.copy(messages = messages, statusNotice = null) else it
        }
    }

    override fun selectPreset(presetId: String) {
        if (_state.value.sending) return
        if (_state.value.presets.none { it.id == presetId }) return
        _state.update {
            it.copy(
                selectedPresetId = presetId,
                drawerOpen = false,
                diagnosticsVisible = false,
                statusNotice = "Preset selected for the next conversation",
            )
        }
    }

    override fun createConversation() {
        if (_state.value.sending) return
        scope.launch {
            runCatching { createConversationNow() }
                .onFailure { error -> _state.update { it.copy(statusNotice = error.userMessage("Could not create conversation")) } }
        }
    }

    override fun createSharedConversation() {
        if (_state.value.sending || _state.value.currentProfile.role == "child") return
        scope.launch {
            runCatching { createConversationNow("household") }
                .onFailure { error -> _state.update { it.copy(statusNotice = friendlyClientError(error, "Could not create a shared conversation")) } }
        }
    }

    override suspend fun updateConversationMetadata(id: String, title: String, tags: List<String>): String? {
        val request = JSONObject().put("title", title).put("tags", JSONArray(tags)).toString()
        return try {
            val response = client().updateConversationMetadata(id, request).requireSuccess()
            val updated = JSONObject(response.body).getJSONObject("conversation").toConversation()
            _state.update { state ->
                state.copy(conversations = state.conversations.map {
                    if (it.id == id) updated else it
                })
            }
            null
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            error.userMessage("Could not save the conversation name and tags")
        }
    }

    private suspend fun createConversationNow(audience: String = "private"): String {
        val preset = _state.value.selectedPresetId
        val title = _state.value.presets.firstOrNull { it.id == preset }?.label ?: "New conversation"
        val request = JSONObject().put("title", title).put("presetId", preset).put("audience", audience).toString()
        val response = client().createConversation(request).requireSuccess(201)
        val conversation = JSONObject(response.body).getJSONObject("conversation").toConversation()
        workspace.updateConversation(reset = true) {
            it.copy(
                conversations = listOf(conversation) + it.conversations.filterNot { item -> item.id == conversation.id },
                selectedConversationId = conversation.id,
                messages = emptyList(),
                drawerOpen = false,
                statusNotice = if (audience == "household") "New shared household conversation" else "New private conversation",
            )
        }
        workspace.refreshWorkspace(conversation.id)
        return conversation.id
    }

    override fun sendDraft() {
        val current = _state.value
        if (current.sending || HouseholdCapability.Chat !in current.capabilities) return
        if(current.conversations.firstOrNull { it.id == current.selectedConversationId }?.canWrite == false){
            _state.update { it.copy(statusNotice = "This shared conversation is read-only. Start your own conversation to ask Jarvis") };return
        }
        val text = current.draft.trim().ifEmpty { if (current.attachments.isNotEmpty()) "Please review these attachments." else "" }
        if (text.isEmpty()) return
        sendText(text, null)
    }

    private fun sendText(text: String, metadata: JSONObject?) {
        if (_state.value.sending) return
        val current = _state.value
        val approvalOnly = metadata?.has("approval") == true
        val attachmentIds = if (approvalOnly) emptySet() else workspace.acceptedAttachmentIds()
        val selectedConversation = _state.value.selectedConversationId
        _state.update { it.copy(sending = true, statusNotice = "Preparing message…") }
        scope.launch {
            var saved = false
            runCatching {
                val conversationId = selectedConversation.ifEmpty { createConversationNow() }
                val id = UUID.randomUUID().toString()
                val request = if (approvalOnly) JSONObject(metadata.toString()).put("mode", "task") else workspace.messageMetadata(conversationId, attachmentIds, metadata, current)
                val body = request.put("text", text).put("submissionId", id).toString()
                val pending = PendingSubmission(id, conversationId, body, "/v1/conversations/${SignedHouseholdTransport.encode(conversationId)}/messages")
                addPending(pending)
                saved = true
                if (!approvalOnly) workspace.clearAcceptedAttachments(attachmentIds)
                _state.update { it.copy(draft = if (metadata == null) "" else it.draft, replyingToQuestionId = null, statusNotice = "Sending…") }
                submitPending(pending)
                loadMessagesNow(conversationId)
                workspace.refreshWorkspace(conversationId)
            }.onFailure { error ->
                val rejected = error is HouseholdRequestException && error.status in listOf(400,401,403,404,409,410,422)
                _state.update { it.copy(draft = if (rejected && metadata == null && it.draft.isBlank()) text else it.draft,
                    statusNotice = friendlyClientError(error, if (rejected) "The request was not accepted. Review your draft and try again" else if (saved) "Message saved on this phone; refresh to retry" else "Could not prepare this message; your draft is still here")) }
            }
            _state.update { it.copy(sending = false) }
        }
    }

    private suspend fun submitPending(pending: PendingSubmission) {
        val response = transport.request("POST", pending.path, pending.body)
        if (response.status in listOf(400, 401, 403, 404, 409, 410, 422)) {
            if (pending.phase == "accepted") recordUnconfirmed(pending)
            else removePending(pending.id)
            response.requireSuccess()
        }
        response.requireSuccess()
        val envelope=runCatching { response.json() }.getOrNull()
        val receipt=envelope?.optJSONObject("receipt")?:envelope?.optJSONObject("result")?.optJSONObject("receipt")
        if(receipt!=null){
            if(!recordReceipt(receipt,pending))throw IllegalStateException("delivery_receipt_invalid")
        }else removePending(pending.id)
        val artifactIds = runCatching { JSONObject(pending.body).optJSONArray("artifactIds").stringsSafe().toSet() }.getOrDefault(emptySet())
        if (artifactIds.isNotEmpty()) workspace.clearAcceptedRemote(pending.conversationId, artifactIds)
        _state.update { it.copy(statusNotice = "Received by Jarvis",
            interactionMode = if (pending.path.endsWith("/messages")) family.hardy.home.model.InteractionMode.Conversation else it.interactionMode) }
    }

    private suspend fun retryPending() {
        for (pending in loadPending().filter { it.phase in setOf("pending", "accepted") }) {
            if(loadPending().none { it.id==pending.id&&it.phase in setOf("pending","accepted") })continue
            runCatching { submitPending(pending) }.onFailure { error ->
                _state.update { it.copy(statusNotice = friendlyClientError(error, "A saved request still needs attention; refresh to retry")) }
                return
            }
        }
    }

    private fun loadPending(): List<PendingSubmission> = synchronized(pendingLock) {
        runCatching {
            JSONArray(pendingPreferences.getString("submissions", "[]")).objects().map {
                val id = it.getString("id"); val conversationId = it.getString("conversationId")
                // Older text-only drafts remain retryable through the same message identity.
                val body = it.optString("body").ifBlank { JSONObject().put("text", it.getString("text")).put("submissionId", id).put("mode", "task").toString() }
                val path = it.optString("path").ifBlank { "/v1/conversations/${SignedHouseholdTransport.encode(conversationId)}/messages" }
                require(path == "/v1/conversations/${SignedHouseholdTransport.encode(conversationId)}/messages" || path == "/v1/conversations/${SignedHouseholdTransport.encode(conversationId)}/goal" || path == "/v1/conversations/${SignedHouseholdTransport.encode(conversationId)}/cancel")
                PendingSubmission(id, conversationId, body, path, it.optString("phase", "pending"), it.optJSONObject("receipt")?.toString())
            }
        }.getOrDefault(emptyList())
    }

    private fun addPending(value: PendingSubmission) = synchronized(pendingLock) { savePending(loadPending().filterNot { it.id == value.id } + value) }
    private fun removePending(id: String) = synchronized(pendingLock) { savePending(loadPending().filterNot { it.id == id }) }
    @SuppressLint("ApplySharedPref")
    private fun savePending(values: List<PendingSubmission>) {
        val json = JSONArray()
        // Accepted bodies are a bounded delivery cache, never a second task/work queue.
        val retained=values.filter { it.phase !in setOf("accepted","attention") } + values.filter { it.phase=="accepted" }.takeLast(32) + values.filter { it.phase=="attention" }.takeLast(16)
        retained.forEach { json.put(JSONObject().put("id", it.id).put("conversationId", it.conversationId).put("body", it.body).put("path", it.path)
            .put("phase", it.phase).apply { it.receipt?.let { value -> put("receipt",JSONObject(value)) } }) }
        check(pendingPreferences.edit().putString("submissions", json.toString()).commit()) { "request_draft_not_saved" }
    }

    private fun restoreDeliveryNotices() {
        loadPending().forEach { pending ->
            if(pending.phase=="attention"&&pending.receipt==null)recordUnconfirmed(pending)
            else pending.receipt?.let { runCatching { recordReceipt(JSONObject(it),pending) } }
        }
    }

    private fun recordUnconfirmed(pending: PendingSubmission) {
        if(_state.value.conversations.none { it.id==pending.conversationId })return
        if(synchronized(pendingLock){receiptStates[pending.id] in setOf("running","waiting_for_user","complete","cancelled")}){removePending(pending.id);return}
        addPending(pending.copy(body="{}",phase="attention",receipt=null))
        val notice=family.hardy.home.model.DeliveryNotice(pending.id,pending.conversationId,"unconfirmed","Request status needs review",
            "The receipt could not be refreshed. Jarvis may have received this request. Check its progress before sending it again.")
        _state.update { it.copy(deliveryNotices=(it.deliveryNotices.filterNot { value -> value.id==notice.id }+notice).takeLast(24)) }
    }

    private fun recordReceipt(receipt:JSONObject,original:PendingSubmission?=null):Boolean {
        val current=_state.value
        if(HouseholdCapability.Chat !in current.capabilities || receipt.optString("profileId")!=current.currentProfile.id)return false
        val id=receipt.optString("submissionId");val conversationId=receipt.optString("conversationId");val status=receipt.optString("status")
        if(!id.matches(Regex("[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")) || current.conversations.none { it.id==conversationId } ||
            status !in setOf("queued","dispatching","running","waiting_for_user","complete","cancelled","failed"))return false
        if(original!=null&&(original.id!=id||original.conversationId!=conversationId))return false
        synchronized(pendingLock){
            if(original!=null&&status=="queued"&&receiptStates[id]?.let { it!="queued" }==true)return true
            receiptStates.remove(id);receiptStates[id]=status
            while(receiptStates.size>64)receiptStates.remove(receiptStates.keys.first())
        }
        val saved=original?:loadPending().firstOrNull { it.id==id }
        val recovery=receipt.optBoolean("recoveryRequired");val code=receipt.optString("failureCode").takeUnless { it=="null" }.orEmpty()
        val canRetry=saved!=null&&saved.body!="{}"&&saved.path.endsWith("/messages")&&DeliveryRules.canRetry(status,recovery,code)
        val minimal=JSONObject().put("submissionId",id).put("conversationId",conversationId).put("profileId",current.currentProfile.id)
            .put("status",status).put("failureCode",code).put("recoveryRequired",recovery).toString()
        val base=saved?:PendingSubmission(id,conversationId,"{}","/v1/conversations/${SignedHouseholdTransport.encode(conversationId)}/messages")
        when(status){
            "queued","dispatching" -> if(saved!=null)addPending(base.copy(phase="accepted",receipt=minimal))
            "failed" -> addPending(base.copy(body=if(canRetry)base.body else "{}",phase=if(canRetry)"retryable" else "attention",receipt=minimal))
            else -> removePending(id)
        }
        val notice=when(status){
            "queued" -> family.hardy.home.model.DeliveryNotice(id,conversationId,status,"Request queued","Waiting for Jarvis to start.")
            "dispatching" -> family.hardy.home.model.DeliveryNotice(id,conversationId,status,"Starting request","Jarvis is connecting to this conversation.")
            "failed" -> family.hardy.home.model.DeliveryNotice(id,conversationId,status,if(recovery||code.contains("unknown"))"Delivery needs review" else "Request could not run",DeliveryRules.detail(code,recovery),canRetry)
            else -> null
        }
        _state.update { it.copy(deliveryNotices=(it.deliveryNotices.filterNot { value -> value.id==id }+listOfNotNull(notice)).takeLast(24)) }
        return true
    }

    override fun retryDelivery(id:String){
        val current=_state.value;if(current.sending)return
        val saved=loadPending().firstOrNull { it.id==id&&it.phase=="retryable" }?:return
        val receipt=runCatching { JSONObject(saved.receipt?:"{}") }.getOrNull()?:return
        if(!saved.path.endsWith("/messages") || !DeliveryRules.canRetry(receipt.optString("status"),receipt.optBoolean("recoveryRequired"),receipt.optString("failureCode")) ||
            current.selectedConversationId!=saved.conversationId || current.conversations.none { it.id==saved.conversationId&&it.canWrite })return
        val nextId=UUID.randomUUID().toString()
        val next=saved.copy(id=nextId,body=JSONObject(saved.body).put("submissionId",nextId).toString(),phase="pending",receipt=null)
        synchronized(pendingLock){savePending(loadPending().filterNot { it.id==id }+next)}
        _state.update { it.copy(sending=true,deliveryNotices=it.deliveryNotices.filterNot { value -> value.id==id },statusNotice="Retrying this request…") }
        scope.launch {
            runCatching { submitPending(next);loadMessagesNow(saved.conversationId);workspace.refreshWorkspace(saved.conversationId) }
                .onFailure { error -> _state.update { it.copy(statusNotice=friendlyClientError(error,"Request saved on this phone; refresh to retry its delivery")) } }
            _state.update { it.copy(sending=false) }
        }
    }

    override fun dismissDelivery(id:String){
        val saved=loadPending().firstOrNull { it.id==id }
        if(saved?.phase in setOf("retryable","attention"))removePending(id)
        _state.update { it.copy(deliveryNotices=it.deliveryNotices.filterNot { value -> value.id==id }) }
    }

    override fun controlGoal(action: String) {
        val current = _state.value
        val goalId = current.taskWorkspace.goalId ?: return
        if (action !in listOf("pause", "resume", "complete") || current.sending) return
        val id = UUID.randomUUID().toString()
        queueControl(current.selectedConversationId, "goal", JSONObject().put("goalId", goalId).put("operationId", id).put("issuedAtMs", System.currentTimeMillis()).put("action", action), id)
    }

    override fun cancelTask() {
        val current = _state.value
        if (current.sending || (current.taskWorkspace.goalId == null && current.taskWorkspace.runId == null)) return
        val id = UUID.randomUUID().toString()
        val body = JSONObject().put("operationId", id).put("issuedAtMs", System.currentTimeMillis())
        current.taskWorkspace.goalId?.let { body.put("goalId", it) }
        current.taskWorkspace.runId?.let { body.put("runId", it) }
        queueControl(current.selectedConversationId, "cancel", body, id)
    }

    private fun queueControl(conversationId: String, action: String, body: JSONObject, id: String) {
        if (conversationId.isEmpty()) return
        _state.update { it.copy(sending = true) }
        scope.launch {
            runCatching {
                val pending = PendingSubmission(id, conversationId, body.toString(), "/v1/conversations/${SignedHouseholdTransport.encode(conversationId)}/$action")
                addPending(pending); submitPending(pending); workspace.refreshWorkspace(conversationId)
            }.onFailure { error -> _state.update { it.copy(statusNotice = friendlyClientError(error, "This request needs attention; refresh to retry")) } }
            _state.update { it.copy(sending = false) }
        }
    }

    override fun setMode(value: family.hardy.home.model.InteractionMode) = workspace.setMode(value)
    override fun setWorkspaceTab(value: family.hardy.home.model.WorkspaceTab) = workspace.setTab(value)
    override fun setLibraryQuery(value: String) = workspace.setLibraryQuery(value)
    override fun setLibraryScope(value: String) = workspace.setLibraryScope(value)
    override fun addAttachment(uri: android.net.Uri, mimeType: String?) {
        if (HouseholdCapability.AttachImages in _state.value.capabilities && !_state.value.sending) workspace.addAttachment(uri, mimeType)
    }
    override fun removeAttachment(id: String) { if (!_state.value.sending) workspace.removeAttachment(id) }
    override fun openContact(id: String) = workspace.openContact(id)
    override fun closeContact() = workspace.closeContact()
    override fun openWiki(id: String) = workspace.openWiki(id)
    override fun closeWiki() = workspace.closeWiki()
    override fun discuss(focus: family.hardy.home.model.ConversationFocus, prompt: String) = workspace.discuss(focus, prompt)
    override fun clearFocus() = workspace.clearFocus()
    override fun answerApproval(approved: Boolean) = workspace.answerApproval(approved)
    override fun replyToQuestion(enabled: Boolean) { _state.update { it.copy(replyingToQuestionId = if (enabled) it.taskWorkspace.question?.id else null) } }
    override suspend fun loadArtifactThumbnail(artifact: family.hardy.home.model.ArtifactCard) = workspace.loadArtifactThumbnail(artifact)
    override fun openArtifact(artifact: family.hardy.home.model.ArtifactCard) = workspace.openArtifact(artifact)
    override fun closePreview() = workspace.closePreview()
    override fun forgetDevice() {
        eventsJob?.cancel(); eventsJob = null
        eventsConnection?.disconnect(); eventsConnection = null
        scope.coroutineContext[Job]?.children?.forEach { it.cancel() }
        identity.clearEnrollment()
        pendingPreferences.edit().clear().commit()
        synchronized(pendingLock){receiptStates.clear()}
        workspace.clearPrivateState()
        workspace.updateConversation(reset = true) { it.copy(currentProfile = placeholder, capabilities = emptySet(), conversations = emptyList(), messages = emptyList(), draft = "", people = emptyList(), selectedConversationId = "", sending = false, deliveryNotices = emptyList(), connectionMode = ConnectionMode.NeedsEnrollment, statusNotice = "Connect this device using a new invitation") }
    }

    private fun startEvents() {
        if (eventsJob?.isActive == true) return
        eventsJob = scope.launch {
            while (isActive && identity.isEnrolled) {
                runCatching {
                    val connection = client().streamEvents()
                    eventsConnection = connection
                    try {
                        if (connection.responseCode != 200) throw IllegalStateException("Event stream returned ${connection.responseCode}")
                        var eventName = ""
                        val data = StringBuilder()
                        connection.inputStream.bufferedReader().useLines { lines ->
                            lines.forEach { line ->
                                if (line.startsWith("event:")) eventName = line.substringAfter(':').trim()
                                if (line.startsWith("data:") && data.length < 256*1024) data.append(line.substringAfter(':').trim()).append('\n')
                                if (line.isEmpty() && eventName.isNotEmpty()) {
                                    if(eventName=="submission.changed")runCatching { JSONObject(data.toString()).optJSONObject("receipt")?.let { recordReceipt(it) } }
                                    eventName = ""; data.setLength(0); refresh()
                                }
                            }
                        }
                    } finally {
                        if(eventsConnection===connection)eventsConnection=null
                        connection.disconnect()
                    }
                }
                delay(2_000)
            }
        }
    }

    override fun setDrawerOpen(open: Boolean) {
        _state.update { it.copy(drawerOpen = open) }
    }

    override fun setDiagnosticsVisible(visible: Boolean) {
        if (visible && !HouseholdRules.canViewDiagnostics(_state.value.capabilities)) return
        _state.update { it.copy(diagnosticsVisible = visible) }
    }

    override fun setStatusNotice(message: String?) {
        _state.update { it.copy(statusNotice = message) }
    }

    override fun close() {
        eventsConnection?.disconnect();eventsConnection=null
        scope.coroutineContext[Job]?.cancel()
    }

    private fun ApiResponse.requireSuccess(expected: Int? = null): ApiResponse {
        if ((expected == null && status in 200..299) || status == expected) return this
        val code = runCatching { JSONObject(body).optString("error") }.getOrNull()
        throw HouseholdRequestException(status, code?.takeIf(String::isNotBlank) ?: "request_failed")
    }

    private fun JSONObject.toPerson(): PersonSummary = PersonSummary(
        id = getString("id"),
        displayName = getString("displayName"),
        initials = getString("initials"),
        color = Color.parseColor(getString("color")).toLong() and 0xFFFFFFFFL,
        status = personStatus(getString("status")),
        statusDetail = getString("statusDetail"),
        role = optString("role", "adult"),
    )

    private fun JSONObject.toConversation(profileId: String = _state.value.currentProfile.id): ConversationSummary = ConversationSummary(
        id = getString("id"),
        title = getString("title"),
        subtitle = "${displayTime(optString("updatedAt"))} · ${if (getString("audience") == "household") "Shared" else "Private"}",
        isShared = getString("audience") == "household",
        canWrite = optString("ownerProfileId", profileId) == profileId,
        tags = optJSONArray("tags")?.strings().orEmpty(),
    )

    private fun parseDiagnostics(raw: String): DiagnosticsSummary {
        val json = JSONObject(raw)
        val openClaw = json.optJSONObject("openclaw")
        val scheduler = json.optJSONObject("scheduler")
        return DiagnosticsSummary(
            gateway = openClaw?.optString("status", "unknown") ?: "unknown",
            model = "Managed by OpenClaw",
            gpu = "Hidden from household clients",
            memory = "${scheduler?.optInt("activeRuns", 0) ?: 0}/${scheduler?.optInt("maxActiveRuns", 2) ?: 2} active runs",
        )
    }

    private fun Throwable.userMessage(fallback: String): String = friendlyClientError(this, fallback)
}

private fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

private fun personStatus(value: String): PersonStatus = when (value) {
    "available" -> PersonStatus.Available
    "working" -> PersonStatus.Working
    "queued" -> PersonStatus.Queued
    "paused" -> PersonStatus.Paused
    else -> PersonStatus.Offline
}

private fun capability(value: String): HouseholdCapability? = when (value) {
    "chat" -> HouseholdCapability.Chat
    "voiceInput" -> HouseholdCapability.VoiceInput
    "attachImages" -> HouseholdCapability.AttachImages
    "viewHouseholdStatus" -> HouseholdCapability.ViewHouseholdStatus
    "viewDiagnostics" -> HouseholdCapability.ViewDiagnostics
    "manageAccess" -> HouseholdCapability.ManageAccess
    else -> null
}

private val householdTimeFormat = DateTimeFormatter.ofPattern("MMM d · h:mm a z", Locale.US)
    .withZone(ZoneId.of("America/New_York"))

internal fun displayTime(value: String): String = runCatching {
    householdTimeFormat.format(OffsetDateTime.parse(value))
}.getOrDefault("Recent")
