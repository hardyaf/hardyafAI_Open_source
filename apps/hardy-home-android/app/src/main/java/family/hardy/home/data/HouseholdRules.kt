package family.hardy.home.data

import family.hardy.home.model.HouseholdCapability
import family.hardy.home.model.PersonStatus

object HouseholdRules {
    fun shouldQueue(
        status: PersonStatus,
        activeRuns: Int,
        maxActiveRuns: Int,
    ): Boolean = status != PersonStatus.Working && activeRuns >= maxActiveRuns

    fun canViewDiagnostics(capabilities: Set<HouseholdCapability>): Boolean =
        HouseholdCapability.ViewDiagnostics in capabilities
}
