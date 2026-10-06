// Generated from contracts/household-api/openapi.json. Do not edit by hand.
// Contract SHA-256: f2fb326a10022bcdbf446913013650f9b83edec40df55abd1a920016ccb25473
package family.hardy.home.api.generated

import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class ApiResponse(val status: Int, val body: String)

fun interface HouseholdRequestSigner {
    fun headers(method: String, path: String, body: ByteArray): Map<String, String>
}

class GeneratedHouseholdApiClient(
    baseUrl: String,
    private val signer: HouseholdRequestSigner? = null,
) {
    private val origin = baseUrl.trimEnd('/')

    companion object {
        const val contractVersion = "0.2.0"
        const val contractSha256 = "f2fb326a10022bcdbf446913013650f9b83edec40df55abd1a920016ccb25473"
    }

    suspend fun getHealth(): ApiResponse =
        execute("GET", "/health", null, false)

    suspend fun claimEnrollment(body: String): ApiResponse =
        execute("POST", "/v1/enrollment/claim", body, false)

    suspend fun getCurrentProfile(): ApiResponse =
        execute("GET", "/v1/me", null, true)

    suspend fun getHouseholdStatus(): ApiResponse =
        execute("GET", "/v1/household/status", null, true)

    suspend fun listPresets(): ApiResponse =
        execute("GET", "/v1/presets", null, true)

    suspend fun listConversations(): ApiResponse =
        execute("GET", "/v1/conversations", null, true)

    suspend fun createConversation(body: String): ApiResponse =
        execute("POST", "/v1/conversations", body, true)

    suspend fun listMessages(conversationId: String): ApiResponse =
        execute("GET", "/v1/conversations/${encodePath(conversationId)}/messages", null, true)

    suspend fun submitMessage(conversationId: String, body: String): ApiResponse =
        execute("POST", "/v1/conversations/${encodePath(conversationId)}/messages", body, true)

    suspend fun cancelConversation(conversationId: String, body: String): ApiResponse =
        execute("POST", "/v1/conversations/${encodePath(conversationId)}/cancel", body, true)

    fun streamEvents(): HttpURLConnection =
        connection("GET", "/v1/events", null, true, "text/event-stream")

    suspend fun getDiagnostics(): ApiResponse =
        execute("GET", "/v1/admin/diagnostics", null, true)

    private suspend fun execute(
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean,
    ): ApiResponse = withContext(Dispatchers.IO) {
        val connection = connection(method, path, body, authenticated, "application/json")
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            ApiResponse(status, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
        } finally {
            connection.disconnect()
        }
    }

    private fun connection(
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean,
        accept: String,
    ): HttpURLConnection {
        require(origin.startsWith("https://") || origin.startsWith("http://")) { "Server URL must use HTTP or HTTPS" }
        val bytes = body?.toByteArray(StandardCharsets.UTF_8) ?: ByteArray(0)
        val connection = URI.create(origin + path).toURL().openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = if (accept == "text/event-stream") 0 else 60_000
        connection.setRequestProperty("Accept", accept)
        connection.setRequestProperty("Cache-Control", "no-store")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setFixedLengthStreamingMode(bytes.size)
        }
        if (authenticated) {
            val requestSigner = requireNotNull(signer) { "An enrolled device signer is required" }
            requestSigner.headers(method, path, bytes).forEach(connection::setRequestProperty)
        }
        return connection
    }

    private fun encodePath(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}
