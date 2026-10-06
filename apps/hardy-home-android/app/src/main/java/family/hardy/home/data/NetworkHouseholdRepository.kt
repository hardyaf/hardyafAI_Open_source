package family.hardy.home.data

import android.annotation.SuppressLint
import android.content.Context
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
import family.hardy.home.model.MessageRole
import family.hardy.home.model.PersonStatus
import family.hardy.home.model.PersonSummary
import family.hardy.home.model.PromptPreset
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
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

private data class PendingSubmission(val id: String, val conversationId: String, val text: String)

class NetworkHouseholdRepository(context: Context) : HouseholdRepository {
    private val appContext = context.applicationContext
    private val identity = DeviceIdentityStore(appContext)
    private val pendingPreferences = appContext.getSharedPreferences("hardy_home_pending", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var eventsJob: Job? = null

    private val placeholder = PersonSummary(
        id = "alex",
        displayName = "Owner",
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
            val conversations = conversationsJson.objects().map { it.toConversation() }
            val selectedId = _state.value.selectedConversationId.takeIf { selected ->
                conversations.any { it.id == selected }
            } ?: conversations.firstOrNull()?.id.orEmpty()
            val diagnostics = if (HouseholdCapability.ViewDiagnostics in capabilities) {
                parseDiagnostics(api.getDiagnostics().requireSuccess().body)
            } else {
                DiagnosticsSummary("Connected", "Restricted", "Restricted", "Restricted")
            }
            _state.update {
                it.copy(
                    currentProfile = currentProfile,
                    capabilities = capabilities,
                    people = people,
                    conversations = conversations,
                    presets = presets,
                    selectedConversationId = selectedId,
                    maxActiveRuns = statusJson.getInt("maxActiveRuns"),
                    diagnostics = diagnostics,
                    connectionMode = ConnectionMode.Connected,
                    statusNotice = null,
                )
            }
            if (selectedId.isNotEmpty()) loadMessagesNow(selectedId)
            retryPending()
            startEvents()
        }.onFailure { error ->
            _state.update {
                it.copy(
                    connectionMode = ConnectionMode.Error,
                    statusNotice = error.userMessage("Cannot reach Hardy Home"),
                )
            }
        }
    }

    override fun setDraft(value: String) {
        _state.update { it.copy(draft = value, statusNotice = null) }
    }

    override fun selectConversation(conversationId: String) {
        if (_state.value.conversations.none { it.id == conversationId }) return
        _state.update {
            it.copy(
                selectedConversationId = conversationId,
                messages = emptyList(),
                drawerOpen = false,
                diagnosticsVisible = false,
                statusNotice = "Loading conversation…",
            )
        }
        scope.launch {
            runCatching { loadMessagesNow(conversationId) }
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
        scope.launch {
            runCatching { createConversationNow() }
                .onFailure { error -> _state.update { it.copy(statusNotice = error.userMessage("Could not create conversation")) } }
        }
    }

    private suspend fun createConversationNow(): String {
        val preset = _state.value.selectedPresetId
        val title = _state.value.presets.firstOrNull { it.id == preset }?.label ?: "New conversation"
        val request = JSONObject().put("title", title).put("presetId", preset).toString()
        val response = client().createConversation(request).requireSuccess(201)
        val conversation = JSONObject(response.body).getJSONObject("conversation").toConversation()
        _state.update {
            it.copy(
                conversations = listOf(conversation) + it.conversations.filterNot { item -> item.id == conversation.id },
                selectedConversationId = conversation.id,
                messages = emptyList(),
                drawerOpen = false,
                statusNotice = "New private conversation",
            )
        }
        return conversation.id
    }

    override fun sendDraft() {
        val text = _state.value.draft.trim()
        if (text.isEmpty()) return
        _state.update { it.copy(draft = "", statusNotice = "Sending…") }
        scope.launch {
            runCatching {
                val conversationId = _state.value.selectedConversationId.ifEmpty { createConversationNow() }
                val pending = PendingSubmission(UUID.randomUUID().toString(), conversationId, text)
                savePending(loadPending() + pending)
                _state.update {
                    it.copy(
                        messages = it.messages + ChatMessage(pending.id, MessageRole.User, text, "Now"),
                        statusNotice = "Sending…",
                    )
                }
                submitPending(pending)
            }.onFailure { error ->
                _state.update { it.copy(statusNotice = error.userMessage("Message saved; retrying when connected")) }
            }
        }
    }

    private suspend fun submitPending(pending: PendingSubmission) {
        val request = JSONObject().put("text", pending.text).put("submissionId", pending.id).toString()
        val response = client().submitMessage(pending.conversationId, request)
        if (response.status == 409) {
            savePending(loadPending().filterNot { it.id == pending.id })
            throw IllegalStateException("The server rejected a conflicting submission ID")
        }
        response.requireSuccess(202)
        val receipt = JSONObject(response.body).getJSONObject("receipt")
        savePending(loadPending().filterNot { it.id == pending.id })
        val status = receipt.getString("status")
        _state.update {
            it.copy(statusNotice = if (status == "queued") "Queued for the agent" else "Sent to ${it.currentProfile.displayName}'s agent")
        }
    }

    private suspend fun retryPending() {
        for (pending in loadPending()) {
            runCatching { submitPending(pending) }.onFailure { return }
        }
    }

    private fun loadPending(): List<PendingSubmission> {
        val raw = pendingPreferences.getString("submissions", "[]") ?: "[]"
        return runCatching {
            JSONArray(raw).objects().map {
                PendingSubmission(it.getString("id"), it.getString("conversationId"), it.getString("text"))
            }
        }.getOrDefault(emptyList())
    }

    @SuppressLint("ApplySharedPref")
    private fun savePending(values: List<PendingSubmission>) {
        val json = JSONArray()
        values.forEach { json.put(JSONObject().put("id", it.id).put("conversationId", it.conversationId).put("text", it.text)) }
        // Persist synchronously before dispatch so a process death cannot lose
        // the idempotency key after the Gateway accepts the message.
        pendingPreferences.edit().putString("submissions", json.toString()).commit()
    }

    private fun startEvents() {
        if (eventsJob?.isActive == true) return
        eventsJob = scope.launch {
            while (isActive && identity.isEnrolled) {
                runCatching {
                    val connection = client().streamEvents()
                    try {
                        if (connection.responseCode != 200) throw IllegalStateException("Event stream returned ${connection.responseCode}")
                        var hasEvent = false
                        connection.inputStream.bufferedReader().useLines { lines ->
                            lines.forEach { line ->
                                if (line.startsWith("event:")) hasEvent = true
                                if (line.isEmpty() && hasEvent) {
                                    hasEvent = false
                                    refresh()
                                }
                            }
                        }
                    } finally {
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
        scope.coroutineContext[Job]?.cancel()
    }

    private fun ApiResponse.requireSuccess(expected: Int? = null): ApiResponse {
        if ((expected == null && status in 200..299) || status == expected) return this
        val code = runCatching { JSONObject(body).optString("error") }.getOrNull()
        throw IllegalStateException(code?.takeIf(String::isNotBlank) ?: "Request failed ($status)")
    }

    private fun JSONObject.toPerson(): PersonSummary = PersonSummary(
        id = getString("id"),
        displayName = getString("displayName"),
        initials = getString("initials"),
        color = Color.parseColor(getString("color")).toLong() and 0xFFFFFFFFL,
        status = personStatus(getString("status")),
        statusDetail = getString("statusDetail"),
    )

    private fun JSONObject.toConversation(): ConversationSummary = ConversationSummary(
        id = getString("id"),
        title = getString("title"),
        subtitle = "${displayTime(optString("updatedAt"))} · ${if (getString("audience") == "household") "Shared" else "Private"}",
        isShared = getString("audience") == "household",
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

    private fun Throwable.userMessage(fallback: String): String =
        message?.replace('_', ' ')?.take(160)?.let { "$fallback: $it" } ?: fallback
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

private fun displayTime(value: String): String = runCatching {
    OffsetDateTime.parse(value).format(DateTimeFormatter.ofPattern("MMM d · h:mm a"))
}.getOrDefault("Recent")
