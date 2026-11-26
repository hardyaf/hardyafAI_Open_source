package family.hardy.home.data

import family.hardy.home.model.ChatMessage
import family.hardy.home.model.ConversationSummary
import family.hardy.home.model.DiagnosticsSummary
import family.hardy.home.model.HouseholdCapability
import family.hardy.home.model.HouseholdUiState
import family.hardy.home.model.MessageRole
import family.hardy.home.model.PersonStatus
import family.hardy.home.model.PersonSummary
import family.hardy.home.model.PromptPreset
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class MockHouseholdRepository : HouseholdRepository {
    private val people = listOf(
        PersonSummary("alex", "Alex", "AH", 0xFF3559E0, PersonStatus.Working, "Planning the week"),
        PersonSummary("natasha", "Natasha", "NH", 0xFF9C4DCC, PersonStatus.Working, "Checking the calendar"),
        PersonSummary("fred", "Fred", "FH", 0xFFE48122, PersonStatus.Queued, "Next in line"),
        PersonSummary("belle", "Belle", "BH", 0xFF16866A, PersonStatus.Available, "Ready"),
    )

    private val _state = MutableStateFlow(
        HouseholdUiState(
            currentProfile = people.first(),
            capabilities = setOf(
                HouseholdCapability.Chat,
                HouseholdCapability.VoiceInput,
                HouseholdCapability.AttachImages,
                HouseholdCapability.ViewHouseholdStatus,
                HouseholdCapability.ViewDiagnostics,
                HouseholdCapability.ManageAccess,
            ),
            people = people,
            conversations = listOf(
                ConversationSummary("week", "This week's schedule", "Today · Household planning", false),
                ConversationSummary("ayso", "AYSO weekend", "Yesterday · Shared", true),
                ConversationSummary("repairs", "Garage door options", "Friday · General", false),
                ConversationSummary("story", "The moonlit fox", "Thursday · Story time", true),
            ),
            presets = listOf(
                PromptPreset("ayso", "AYSO soccer", "Fields, uniforms, snacks, and schedules"),
                PromptPreset("homework", "Homework helper", "Coach the work one step at a time"),
                PromptPreset("planning", "Household planning", "Calendar, errands, meals, and lists"),
                PromptPreset("story", "Story time", "Spoken-friendly family stories"),
            ),
            selectedConversationId = "week",
            selectedPresetId = "planning",
            messages = listOf(
                ChatMessage(
                    "m1",
                    MessageRole.User,
                    "What does the family schedule look like after school today?",
                    "9:41 AM",
                ),
                ChatMessage(
                    "m2",
                    MessageRole.Assistant,
                    "There are two things to coordinate: soccer practice at 5:30 and the grocery pickup window beginning at 6:00. I can help work out the handoff.",
                    "9:42 AM",
                ),
            ),
            draft = "",
            maxActiveRuns = 2,
            diagnostics = DiagnosticsSummary(
                gateway = "Online · LAN prototype",
                model = "gpt-oss:20b · ready",
                gpu = "RTX 3090 · chat model resident",
                memory = "Local recall · healthy",
            ),
        ),
    )

    override val state: StateFlow<HouseholdUiState> = _state.asStateFlow()

    override fun setDraft(value: String) {
        _state.update { it.copy(draft = value, statusNotice = null) }
    }

    override fun selectConversation(conversationId: String) {
        val conversation = _state.value.conversations.firstOrNull { it.id == conversationId } ?: return
        val transcript = when (conversationId) {
            "ayso" -> listOf(
                ChatMessage(
                    "ayso-1",
                    MessageRole.Assistant,
                    "AYSO mode is ready. I will keep field locations, uniforms, snacks, and schedule conflicts in view.",
                    "Yesterday",
                ),
            )
            "repairs" -> listOf(
                ChatMessage(
                    "repairs-1",
                    MessageRole.User,
                    "Can you compare the repair and replacement choices?",
                    "Friday",
                ),
            )
            "story" -> listOf(
                ChatMessage(
                    "story-1",
                    MessageRole.Assistant,
                    "The moonlit fox waited at the edge of the quiet garden, listening for the smallest brave sound.",
                    "Thursday",
                ),
            )
            else -> _state.value.messages
        }
        _state.update {
            it.copy(
                selectedConversationId = conversation.id,
                selectedPresetId = when (conversationId) {
                    "ayso" -> "ayso"
                    "story" -> "story"
                    "week" -> "planning"
                    else -> null
                },
                messages = transcript,
                drawerOpen = false,
                diagnosticsVisible = false,
                statusNotice = null,
            )
        }
    }

    override fun selectPreset(presetId: String) {
        if (_state.value.presets.none { it.id == presetId }) return
        _state.update {
            it.copy(
                selectedPresetId = presetId,
                drawerOpen = false,
                diagnosticsVisible = false,
                statusNotice = "Preset selected for this conversation",
            )
        }
    }

    override suspend fun updateConversationMetadata(id: String, title: String, tags: List<String>): String? {
        _state.value = _state.value.copy(conversations = _state.value.conversations.map {
            if (it.id == id && it.canWrite) it.copy(title = title, tags = tags) else it
        })
        return null
    }

    override fun createConversation() {
        val id = UUID.randomUUID().toString()
        val conversation = ConversationSummary(id, "New conversation", "Just now · General", false)
        _state.update {
            it.copy(
                conversations = listOf(conversation) + it.conversations,
                selectedConversationId = id,
                selectedPresetId = null,
                messages = emptyList(),
                draft = "",
                drawerOpen = false,
                diagnosticsVisible = false,
                statusNotice = "New private conversation",
            )
        }
    }

    override fun sendDraft() {
        val current = _state.value
        val text = current.draft.trim()
        if (text.isEmpty()) return

        val activeRuns = current.people.count { it.status == PersonStatus.Working }
        val queued = HouseholdRules.shouldQueue(current.currentProfile.status, activeRuns, current.maxActiveRuns)
        val userMessage = ChatMessage(
            id = UUID.randomUUID().toString(),
            role = MessageRole.User,
            text = text,
            timeLabel = "Now",
        )
        _state.update {
            it.copy(
                messages = it.messages + userMessage,
                draft = "",
                statusNotice = if (queued) "Queued behind two active turns" else "Sent to ${it.currentProfile.displayName}'s agent",
            )
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
}
