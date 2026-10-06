package family.hardy.home

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import family.hardy.home.data.HouseholdRepository
import family.hardy.home.data.NetworkHouseholdRepository

class HardyHomeViewModel(
    application: Application,
) : AndroidViewModel(application), HouseholdRepository {
    private val repository: HouseholdRepository = NetworkHouseholdRepository(application)

    override val state = repository.state
    override fun setDraft(value: String) = repository.setDraft(value)
    override fun selectConversation(conversationId: String) = repository.selectConversation(conversationId)
    override fun selectPreset(presetId: String) = repository.selectPreset(presetId)
    override fun createConversation() = repository.createConversation()
    override fun sendDraft() = repository.sendDraft()
    override fun setDrawerOpen(open: Boolean) = repository.setDrawerOpen(open)
    override fun setDiagnosticsVisible(visible: Boolean) = repository.setDiagnosticsVisible(visible)
    override fun setStatusNotice(message: String?) = repository.setStatusNotice(message)
    override fun setServerUrl(value: String) = repository.setServerUrl(value)
    override fun setEnrollmentCode(value: String) = repository.setEnrollmentCode(value)
    override fun enroll() = repository.enroll()
    override fun refresh() = repository.refresh()

    override fun onCleared() {
        repository.close()
    }
}
