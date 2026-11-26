package family.hardy.home.data

import org.junit.Assert.*
import org.junit.Test

class DeliveryRulesTest {
    @Test fun unknownOrPartiallyDeliveredRequestsNeverOfferResubmission() {
        assertFalse(DeliveryRules.canRetry("failed", true, "gateway_unavailable"))
        assertFalse(DeliveryRules.canRetry("failed", false, "gateway_send_outcome_unknown"))
        assertFalse(DeliveryRules.canRetry("failed", false, "gateway_receipt_invalid"))
        assertFalse(DeliveryRules.canRetry("running", false, "gateway_unavailable"))
    }
    @Test fun onlyKnownPreDispatchTransportFailuresOfferAnExplicitRetry() {
        assertTrue(DeliveryRules.canRetry("failed", false, "household_boundary_unavailable"))
        assertTrue(DeliveryRules.canRetry("failed", false, "goal_start_preflight_unavailable"))
        assertFalse(DeliveryRules.canRetry("failed", false, "new_task_requires_new_conversation"))
        assertFalse(DeliveryRules.canRetry("failed", false, "delivery_authorization_revoked"))
    }
}
