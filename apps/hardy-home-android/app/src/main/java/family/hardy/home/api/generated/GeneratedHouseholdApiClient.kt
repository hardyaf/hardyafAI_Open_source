// Generated from contracts/household-api/openapi.json. Do not edit by hand.
// Contract SHA-256: 3ed857fdbdac393003efac293fe2ad00026d1e0adb1d75be88a0232c4311faca
package family.hardy.home.api.generated

import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class ApiResponse(val status: Int, val body: String)
data class ApiBytesResponse(val status: Int, val body: ByteArray, val contentType: String?)

fun interface HouseholdRequestSigner {
    fun headers(method: String, path: String, body: ByteArray): Map<String, String>
}

class GeneratedHouseholdApiClient(
    baseUrl: String,
    private val signer: HouseholdRequestSigner? = null,
) {
    private val origin = baseUrl.trimEnd('/')

    companion object {
        const val contractVersion = "0.8.0"
        const val contractSha256 = "3ed857fdbdac393003efac293fe2ad00026d1e0adb1d75be88a0232c4311faca"
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

    suspend fun updateConversationMetadata(conversationId: String, body: String): ApiResponse =
        execute("PUT", "/v1/conversations/${encodePath(conversationId)}/metadata", body, true)

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

    suspend fun getReadiness(): ApiResponse =
        execute("GET", "/ready", null, false)

    suspend fun getConversationContext(conversationId: String): ApiResponse =
        execute("GET", "/v1/conversations/${encodePath(conversationId)}/context", null, true)

    suspend fun updateConversationGoal(conversationId: String, body: String): ApiResponse =
        execute("POST", "/v1/conversations/${encodePath(conversationId)}/goal", body, true)

    suspend fun listConversationArtifacts(conversationId: String): ApiResponse =
        execute("GET", "/v1/conversations/${encodePath(conversationId)}/artifacts", null, true)

    suspend fun uploadConversationArtifact(conversationId: String, body: String): ApiResponse =
        execute("POST", "/v1/conversations/${encodePath(conversationId)}/artifacts", body, true)

    suspend fun getConversationArtifact(conversationId: String, artifactId: String): ApiResponse =
        execute("GET", "/v1/conversations/${encodePath(conversationId)}/artifacts/${encodePath(artifactId)}", null, true)

    suspend fun getConversationArtifactContent(conversationId: String, artifactId: String): ApiBytesResponse =
        executeBytes("GET", "/v1/conversations/${encodePath(conversationId)}/artifacts/${encodePath(artifactId)}/content", null, true)

    suspend fun getPlatformReadiness(): ApiResponse =
        execute("GET", "/v1/admin/platform", null, true)

    suspend fun getConversationCheckpoint(conversationId: String): ApiResponse =
        execute("GET", "/v1/conversations/${encodePath(conversationId)}/checkpoint", null, true)

    @Deprecated("This API operation is retired and returns no successful mutation")
    suspend fun updateConversationCheckpoint(conversationId: String): ApiResponse =
        execute("PUT", "/v1/conversations/${encodePath(conversationId)}/checkpoint", null, true)

    suspend fun getDomainReadiness(): ApiResponse =
        execute("GET", "/v1/admin/domains", null, true)

    suspend fun getConversationWorkspace(conversationId: String): ApiResponse =
        execute("GET", "/v1/conversations/${encodePath(conversationId)}/workspace", null, true)

    suspend fun searchContacts(query: String? = null, limit: Int? = null): ApiResponse =
        execute("GET", withQuery("/v1/contacts", listOf("query" to query?.toString(), "limit" to limit?.toString())), null, true)

    suspend fun getContact(contactId: String): ApiResponse =
        execute("GET", "/v1/contacts/${encodePath(contactId)}", null, true)

    suspend fun getLists(scope: String? = null): ApiResponse =
        execute("GET", withQuery("/v1/lists", listOf("scope" to scope?.toString())), null, true)

    suspend fun searchWiki(scope: String? = null, query: String? = null, limit: Int? = null): ApiResponse =
        execute("GET", withQuery("/v1/wiki", listOf("scope" to scope?.toString(), "query" to query?.toString(), "limit" to limit?.toString())), null, true)

    suspend fun getWikiPage(pageId: String, scope: String? = null): ApiResponse =
        execute("GET", withQuery("/v1/wiki/${encodePath(pageId)}", listOf("scope" to scope?.toString())), null, true)

    suspend fun getReceiptReview(limit: Int? = null): ApiResponse =
        execute("GET", withQuery("/v1/receipts/review", listOf("limit" to limit?.toString())), null, true)

    suspend fun getContactSourceContent(contactId: String, artifactId: String): ApiBytesResponse =
        executeBytes("GET", "/v1/contacts/${encodePath(contactId)}/sources/${encodePath(artifactId)}/content", null, true)

    suspend fun claimDisplayEnrollment(body: String): ApiResponse =
        execute("POST", "/v1/display/enrollment/claim", body, false)

    suspend fun getDisplaySnapshot(): ApiResponse =
        execute("GET", "/v1/display/snapshot", null, true)

    suspend fun getDisplayPublicationContent(publicationId: String): ApiBytesResponse =
        executeBytes("GET", "/v1/display/publications/${encodePath(publicationId)}/content", null, true)

    suspend fun getMyFitbitStatus(): ApiResponse =
        execute("GET", "/v1/fitbit", null, true)

    suspend fun startMyFitbitSyncSession(body: String): ApiResponse =
        execute("POST", "/v1/fitbit/sync", body, true)

    suspend fun stopMyFitbitSyncSession(body: String): ApiResponse =
        execute("DELETE", "/v1/fitbit/sync", body, true)

    suspend fun getConnections(): ApiResponse =
        execute("GET", "/v1/connections", null, true)

    suspend fun configureBitwarden(body: String): ApiResponse =
        execute("POST", "/v1/connections/bitwarden", body, true)

    suspend fun saveConnectionLogin(body: String): ApiResponse =
        execute("POST", "/v1/connections/password", body, true)

    suspend fun configureGoogleOAuth(body: String): ApiResponse =
        execute("POST", "/v1/connections/google/config", body, true)

    suspend fun startGoogleOAuth(body: String): ApiResponse =
        execute("POST", "/v1/connections/google/start", body, true)

    suspend fun completeGoogleOAuth(body: String): ApiResponse =
        execute("POST", "/v1/connections/google/complete", body, true)

    suspend fun receiveGoogleOAuthCallback(): ApiResponse =
        execute("GET", "/v1/connections/google/callback", null, false)

    suspend fun disconnectConnection(connectionId: String, body: String): ApiResponse =
        execute("DELETE", "/v1/connections/${encodePath(connectionId)}", body, true)

    suspend fun listConversationFolders(): ApiResponse =
        execute("GET", "/v1/conversation-folders", null, true)

    suspend fun createConversationFolder(body: String): ApiResponse =
        execute("POST", "/v1/conversation-folders", body, true)

    suspend fun renameConversationFolder(folderId: String, body: String): ApiResponse =
        execute("PUT", "/v1/conversation-folders/${encodePath(folderId)}", body, true)

    suspend fun deleteConversationFolder(folderId: String): ApiResponse =
        execute("DELETE", "/v1/conversation-folders/${encodePath(folderId)}", null, true)

    suspend fun moveConversationToFolder(conversationId: String, body: String): ApiResponse =
        execute("PUT", "/v1/conversations/${encodePath(conversationId)}/folder", body, true)

    suspend fun deleteConversation(conversationId: String): ApiResponse =
        execute("DELETE", "/v1/conversations/${encodePath(conversationId)}", null, true)

    private fun withQuery(path: String, parameters: List<Pair<String, String?>>): String {
        val query = parameters.filter { it.second != null }
            .joinToString("&") { (name, value) -> encodePath(name) + "=" + encodePath(requireNotNull(value)) }
        return if (query.isEmpty()) path else path + "?" + query
    }

    private suspend fun executeBytes(
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean,
    ): ApiBytesResponse = withContext(Dispatchers.IO) {
        val connection = connection(method, path, body, authenticated, "*/*")
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            ApiBytesResponse(status, stream?.use { it.readBytes() } ?: ByteArray(0), connection.contentType)
        } finally {
            connection.disconnect()
        }
    }

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
        require(!path.startsWith("/v1/connections") || origin.startsWith("https://")) { "Connections require HTTPS" }
        val bytes = body?.toByteArray(StandardCharsets.UTF_8) ?: ByteArray(0)
        val connection = URI.create(origin + path).toURL().openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
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
