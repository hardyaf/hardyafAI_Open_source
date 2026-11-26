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
    val role: String = "adult",
)

data class ConversationSummary(
    val id: String,
    val title: String,
    val subtitle: String,
    val isShared: Boolean,
    val canWrite: Boolean = true,
    val tags: List<String> = emptyList(),
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
    val sending: Boolean = false,
    val deliveryNotices: List<DeliveryNotice> = emptyList(),
    val workspaceTab: WorkspaceTab = WorkspaceTab.Chat,
    val interactionMode: InteractionMode = InteractionMode.Task,
    val availableViews: Set<String> = emptySet(),
    val taskWorkspace: TaskWorkspace = TaskWorkspace(),
    val replyingToQuestionId: String? = null,
    val focus: ConversationFocus? = null,
    val attachments: List<PendingAttachment> = emptyList(),
    val artifacts: List<ArtifactCard> = emptyList(),
    val preview: MediaPreview? = null,
    val libraryScope: String = "household",
    val libraryQuery: String = "",
    val libraryLoading: Boolean = false,
    val libraryNotice: String? = null,
    val libraryUpdatedAt: String = "",
    val listEntries: List<ListEntry> = emptyList(),
    val contacts: List<ContactCard> = emptyList(),
    val contactDetail: ContactDetail? = null,
    val wikiCards: List<WikiCard> = emptyList(),
    val wikiPage: WikiPage? = null,
    val receiptReviews: List<ReceiptReviewCard> = emptyList(),
)
