package family.hardy.home.model

enum class PersonStatus {
    Available,
    Working,
    Queued,
    Paused,
    Offline,
}

enum class HouseholdCapability {
    Chat,
    VoiceInput,
    AttachImages,
    ViewHouseholdStatus,
    ViewDiagnostics,
    ManageAccess,
}

enum class ConnectionMode {
    NeedsEnrollment,
    Connecting,
    Connected,
    Error,
}

data class PersonSummary(
    val id: String,
    val displayName: String,
    val initials: String,
    val color: Long,
    val status: PersonStatus,
    val statusDetail: String,
)

data class ConversationSummary(
    val id: String,
    val title: String,
    val subtitle: String,
    val isShared: Boolean,
)

data class PromptPreset(
    val id: String,
    val label: String,
    val description: String,
)

enum class MessageRole {
    User,
    Assistant,
}

data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val text: String,
    val timeLabel: String,
)

data class DiagnosticsSummary(
    val gateway: String,
    val model: String,
    val gpu: String,
    val memory: String,
)

data class HouseholdUiState(
    val currentProfile: PersonSummary,
    val capabilities: Set<HouseholdCapability>,
    val people: List<PersonSummary>,
    val conversations: List<ConversationSummary>,
    val presets: List<PromptPreset>,
    val selectedConversationId: String,
    val selectedPresetId: String?,
    val messages: List<ChatMessage>,
    val draft: String,
    val maxActiveRuns: Int,
    val diagnostics: DiagnosticsSummary,
    val drawerOpen: Boolean = false,
    val diagnosticsVisible: Boolean = false,
    val statusNotice: String? = null,
    val connectionMode: ConnectionMode = ConnectionMode.Connected,
    val serverUrl: String = "",
    val enrollmentCode: String = "",
)
