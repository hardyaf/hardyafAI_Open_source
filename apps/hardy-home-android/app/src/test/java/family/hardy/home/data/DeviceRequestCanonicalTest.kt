package family.hardy.home.data

import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceRequestCanonicalTest {
    @Test
    fun canonicalRequestMatchesServerContract() {
        assertEquals(
            "POST\n/v1/conversations/conv-1/messages\n1730000000000\nnonce-test-00000001\n" +
                "cbbbdcd27692344de5dbab3abcaba413fb0f45307267de7081401576df1cb176",
            canonicalDeviceRequest(
                method = "post",
                path = "/v1/conversations/conv-1/messages",
                timestamp = "1730000000000",
                nonce = "nonce-test-00000001",
                body = "{\"text\":\"hello\"}".toByteArray(),
            ),
        )
    }
}
