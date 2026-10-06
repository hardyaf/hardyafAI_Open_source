package family.hardy.home.data

import family.hardy.home.model.HouseholdUiState
import kotlinx.coroutines.flow.StateFlow

interface HouseholdRepository {
    val state: StateFlow<HouseholdUiState>

    fun setDraft(value: String)

    fun selectConversation(conversationId: String)

    fun selectPreset(presetId: String)

    fun createConversation()

    fun sendDraft()

    fun setDrawerOpen(open: Boolean)

    fun setDiagnosticsVisible(visible: Boolean)

    fun setStatusNotice(message: String?)

    fun setServerUrl(value: String) {}

    fun setEnrollmentCode(value: String) {}

    fun enroll() {}

    fun refresh() {}

    fun close() {}
}
