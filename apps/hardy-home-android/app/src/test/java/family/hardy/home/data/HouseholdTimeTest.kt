package family.hardy.home.data

import org.junit.Assert.assertEquals
import org.junit.Test

class HouseholdTimeTest {
    @Test
    fun usesEasternTimeAcrossDaylightSavingAndDateRollover() {
        assertEquals("Nov 8 · 11:30 PM EST", displayTime("2026-11-09T04:30:00Z"))
        assertEquals("Jul 4 · 8:00 AM EDT", displayTime("2026-07-04T12:00:00Z"))
        assertEquals("Recent", displayTime(""))
    }
}
