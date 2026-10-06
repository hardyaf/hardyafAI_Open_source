package family.hardy.home.data

import family.hardy.home.model.HouseholdCapability
import family.hardy.home.model.PersonStatus
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HouseholdRulesTest {
    @Test
    fun thirdPersonQueuesWhenBothSlotsAreOccupied() {
        assertTrue(HouseholdRules.shouldQueue(PersonStatus.Available, activeRuns = 2, maxActiveRuns = 2))
    }

    @Test
    fun alreadyRunningPersonDoesNotConsumeAnotherSlot() {
        assertFalse(HouseholdRules.shouldQueue(PersonStatus.Working, activeRuns = 2, maxActiveRuns = 2))
    }

    @Test
    fun diagnosticsRequireExplicitCapability() {
        assertFalse(HouseholdRules.canViewDiagnostics(setOf(HouseholdCapability.Chat)))
        assertTrue(
            HouseholdRules.canViewDiagnostics(
                setOf(HouseholdCapability.Chat, HouseholdCapability.ViewDiagnostics),
            ),
        )
    }
}
