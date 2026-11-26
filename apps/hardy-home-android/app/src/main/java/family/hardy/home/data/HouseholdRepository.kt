package family.hardy.home.data

import family.hardy.home.model.HouseholdUiState
import kotlinx.coroutines.flow.StateFlow

interface HouseholdRepository {
    val state: StateFlow<HouseholdUiState>

    fun setDraft(value: String)

    fun selectConversation(conversationId: String)

    fun selectPreset(presetId: String)

    fun createConversation()
    suspend fun updateConversationMetadata(id: String, title: String, tags: List<String>): String?

    fun sendDraft()

    fun setDrawerOpen(open: Boolean)

    fun setDiagnosticsVisible(visible: Boolean)

    fun setStatusNotice(message: String?)

    fun setServerUrl(value: String) {}

    fun setEnrollmentCode(value: String) {}

    fun enroll() {}

    fun refresh() {}


    fun createSharedConversation() {}
    fun setMode(value: family.hardy.home.model.InteractionMode) {}
    fun setWorkspaceTab(value: family.hardy.home.model.WorkspaceTab) {}
    fun setLibraryQuery(value: String) {}
    fun setLibraryScope(value: String) {}
    fun addAttachment(uri: android.net.Uri, mimeType: String? = null) {}
    fun removeAttachment(id: String) {}
    fun openContact(id: String) {}
    fun closeContact() {}
    fun openWiki(id: String) {}
    fun closeWiki() {}
    fun discuss(focus: family.hardy.home.model.ConversationFocus, prompt: String) {}
    fun clearFocus() {}
    fun answerApproval(approved: Boolean) {}
    fun replyToQuestion(enabled: Boolean) {}
    suspend fun loadArtifactThumbnail(artifact: family.hardy.home.model.ArtifactCard): android.graphics.Bitmap? = null
    fun openArtifact(artifact: family.hardy.home.model.ArtifactCard) {}
    fun closePreview() {}
    fun controlGoal(action: String) {}
    fun cancelTask() {}
    fun retryDelivery(id: String) {}
    fun dismissDelivery(id: String) {}
    fun forgetDevice() {}

    fun close() {}
}
