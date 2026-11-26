package family.hardy.home.data

import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal data class SignedResponse(val status: Int, val bytes: ByteArray, val mimeType: String) {
    fun json(): JSONObject = JSONObject(bytes.toString(Charsets.UTF_8))
    fun requireSuccess(): SignedResponse {
        if (status in 200..299) return this
        val code = runCatching { json().optString("error") }.getOrNull().orEmpty()
        throw HouseholdRequestException(status, code.ifBlank { "request_failed" })
    }
}
internal class HouseholdRequestException(val status: Int, val code: String) : IllegalStateException(code)

/** Uses the same enrolled P-256 identity; no Gateway or provider credentials enter this transport. */
internal class SignedHouseholdTransport(private val identity: DeviceIdentityStore) {
    suspend fun request(method: String, path: String, body: String? = null, maximumBytes: Int = 2 * 1024 * 1024): SignedResponse =
        requestBytes(method, path, body?.toByteArray(Charsets.UTF_8), "application/json; charset=utf-8", maximumBytes,
            if (method == "POST" && path.endsWith("/artifacts")) 120_000 else 45_000)

    suspend fun connectionRequest(method: String, path: String, body: JSONObject?): SignedResponse {
        require(URI(identity.serverUrl).scheme == "https") { "secure_connection_required" }
        require(path.matches(Regex("/v1/connections(?:/[A-Za-z0-9._%/-]+)?")))
        return requestBytes(method, path, body?.toString()?.toByteArray(Charsets.UTF_8),
            "application/json; charset=utf-8", 256 * 1024, 45_000)
    }

    suspend fun transcribeDictation(audio: ByteArray): SignedResponse =
        requestBytes("POST", "/v1/dictation", audio, "audio/mp4", 512 * 1024, 330_000)

    suspend fun uploadReceipt(id: String, photo: ByteArray): SignedResponse =
        requestBytes("PUT", "/v1/receipt-captures/" + encode(id), photo, "image/jpeg", 512 * 1024, 120_000)

    suspend fun receiptRequest(method: String, suffix: String, body: JSONObject?): SignedResponse =
        requestBytes(method, "/v1/receipt-captures" + suffix, body?.toString()?.toByteArray(Charsets.UTF_8),
            "application/json; charset=utf-8", 25 * 1024 * 1024, 360_000)

    private suspend fun requestBytes(
        method: String,
        path: String,
        body: ByteArray?,
        contentType: String,
        maximumBytes: Int,
        readTimeoutMs: Int,
    ): SignedResponse = withContext(Dispatchers.IO) {
        require(path.startsWith("/v1/") && !path.startsWith("//") && !path.contains('\n') && !path.contains('\r'))
        val base = URI(identity.serverUrl)
        require(base.scheme in setOf("https", "http") && base.host != null && base.userInfo == null && base.rawQuery == null && base.rawFragment == null)
        val bytes = body ?: ByteArray(0)
        val connection = URI(identity.serverUrl.trimEnd('/') + path).toURL().openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = readTimeoutMs
        connection.setRequestProperty("Accept", "application/json, image/*, application/pdf, text/plain, text/csv")
        connection.setRequestProperty("Cache-Control", "no-store")
        identity.headers(method, path, bytes).forEach(connection::setRequestProperty)
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", contentType)
            connection.setFixedLengthStreamingMode(bytes.size)
        }
        try {
            if (body != null) connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val output = ByteArrayOutputStream()
            stream?.use { input ->
                val chunk = ByteArray(16 * 1024)
                while (true) {
                    val count = input.read(chunk)
                    if (count < 0) break
                    if (output.size() + count > maximumBytes) throw IllegalStateException("response_too_large")
                    output.write(chunk, 0, count)
                }
            }
            SignedResponse(status, output.toByteArray(), connection.contentType?.substringBefore(';').orEmpty())
        } finally { connection.disconnect() }
    }
    companion object { fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20") }
}
