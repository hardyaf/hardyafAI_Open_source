package family.hardy.home.data

import java.security.MessageDigest

internal fun canonicalDeviceRequest(
    method: String,
    path: String,
    timestamp: String,
    nonce: String,
    body: ByteArray,
): String {
    val bodyHash = MessageDigest.getInstance("SHA-256")
        .digest(body)
        .joinToString("") { "%02x".format(it) }
    return listOf(method.uppercase(), path, timestamp, nonce, bodyHash).joinToString("\n")
}
