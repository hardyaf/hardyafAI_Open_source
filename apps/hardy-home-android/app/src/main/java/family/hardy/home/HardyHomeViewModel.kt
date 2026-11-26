package family.hardy.home

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import family.hardy.home.data.Connections
import family.hardy.home.data.ReceiptCapture
import family.hardy.home.data.JournalDictation
import family.hardy.home.data.HouseholdRepository
import family.hardy.home.data.NetworkHouseholdRepository

class HardyHomeViewModel(
    application: Application,
) : AndroidViewModel(application), HouseholdRepository {
    private val repository = NetworkHouseholdRepository(application)
    private val dictation = JournalDictation(
        application, viewModelScope, repository::dictationTarget,
        repository::transcribeDictation, repository::appendDictation,
    )
    internal val receiptCapture = ReceiptCapture(
        application, viewModelScope, repository::receiptOwner, repository::uploadReceipt,
        repository::receiptRequest, repository::receiptPreview,
    )

    internal val connections = Connections(
        viewModelScope, repository::connectionsOwner, repository::connectionRequest, repository::connectionRedirect,
    )

    internal val dictationState = dictation.state
    internal fun toggleDictation() = dictation.toggle()
    internal fun stopRecordingInBackground() = dictation.leaveForeground()
    internal fun checkDictationDestination() = dictation.destinationChanged()
    internal fun discardDictation() = dictation.discard()

    override val state = repository.state
    override fun setDraft(value: String) = repository.setDraft(value)
    override fun selectConversation(conversationId: String) = repository.selectConversation(conversationId)
    override fun selectPreset(presetId: String) = repository.selectPreset(presetId)
    override fun createConversation() = repository.createConversation()
    override suspend fun updateConversationMetadata(id: String, title: String, tags: List<String>) =
        repository.updateConversationMetadata(id, title, tags)
    override fun sendDraft() {
        if (!dictationState.value.blocksSend) repository.sendDraft()
    }
    override fun setDrawerOpen(open: Boolean) = repository.setDrawerOpen(open)
    override fun setDiagnosticsVisible(visible: Boolean) = repository.setDiagnosticsVisible(visible)
    override fun setStatusNotice(message: String?) = repository.setStatusNotice(message)
    override fun setServerUrl(value: String) = repository.setServerUrl(value)
    override fun setEnrollmentCode(value: String) = repository.setEnrollmentCode(value)
    override fun enroll() = repository.enroll()
    override fun refresh() = repository.refresh()

    override fun createSharedConversation() = repository.createSharedConversation()
    override fun setMode(value: family.hardy.home.model.InteractionMode) = repository.setMode(value)
    override fun setWorkspaceTab(value: family.hardy.home.model.WorkspaceTab) = repository.setWorkspaceTab(value)
    override fun setLibraryQuery(value: String) = repository.setLibraryQuery(value)
    override fun setLibraryScope(value: String) = repository.setLibraryScope(value)
    override fun addAttachment(uri: android.net.Uri, mimeType: String?) = repository.addAttachment(uri, mimeType)
    override fun removeAttachment(id: String) = repository.removeAttachment(id)
    override fun openContact(id: String) = repository.openContact(id)
    override fun closeContact() = repository.closeContact()
    override fun openWiki(id: String) = repository.openWiki(id)
    override fun closeWiki() = repository.closeWiki()
    override fun discuss(focus: family.hardy.home.model.ConversationFocus, prompt: String) = repository.discuss(focus, prompt)
    override fun clearFocus() = repository.clearFocus()
    override fun answerApproval(approved: Boolean) = repository.answerApproval(approved)
    override fun replyToQuestion(enabled: Boolean) = repository.replyToQuestion(enabled)
    override suspend fun loadArtifactThumbnail(artifact: family.hardy.home.model.ArtifactCard) = repository.loadArtifactThumbnail(artifact)
    override fun openArtifact(artifact: family.hardy.home.model.ArtifactCard) = repository.openArtifact(artifact)
    override fun closePreview() = repository.closePreview()
    override fun controlGoal(action: String) = repository.controlGoal(action)
    override fun cancelTask() = repository.cancelTask()
    override fun retryDelivery(id: String) = repository.retryDelivery(id)
    override fun dismissDelivery(id: String) = repository.dismissDelivery(id)
    override fun forgetDevice() {
        connections.close()
        receiptCapture.discardLocal()
        receiptCapture.reset()
        dictation.discard()
        repository.forgetDevice()
    }

    override fun onCleared() {
        connections.close()
        dictation.discard()
        repository.close()
    }
}
