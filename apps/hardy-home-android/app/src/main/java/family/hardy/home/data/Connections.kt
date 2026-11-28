package family.hardy.home.data

import java.net.URI
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject

internal data class AccountConnection(val id: String, val label: String, val status: String, val kind: String = "", val account: String = "", val service: String = "", val access: String = "read")
internal data class ConnectionsState(
    val open: Boolean = false,
    val busy: Boolean = false,
    val ready: Boolean = false,
    val vaultConfigured: Boolean = false,
    val googleConfigured: Boolean = false,
    val redirectUri: String = "",
    val connections: List<AccountConnection> = emptyList(),
    val notice: String = "",
    val authorizationUrl: String? = null,
    val flowId: String? = null,
    val formRevision: Int = 0,
)

/** Account secrets remain request-local and never enter chat, saved state, or delivery preferences. */
internal class Connections(
    private val scope: CoroutineScope,
    private val isOwner: () -> Boolean,
    private val request: suspend (String, String, JSONObject?) -> JSONObject,
    private val defaultRedirect: () -> String,
) {
    private val mutable = MutableStateFlow(ConnectionsState())
    val state = mutable.asStateFlow()
    private var job: Job? = null
    private var generation = 0
    private fun operationId() = "connection-" + UUID.randomUUID().toString()

    fun open() {
        if (!isOwner()) return
        generation++
        mutable.value = ConnectionsState(open = true, redirectUri = defaultRedirect())
        refresh()
    }
    fun close() {
        generation++
        job?.cancel()
        mutable.value = ConnectionsState()
    }
    fun ownerChanged() { if (!isOwner()) close() }
    fun resume() { if (state.value.open && state.value.flowId != null) refresh() }
    fun leaveForeground() {
        mutable.update { it.copy(formRevision = it.formRevision + 1) }
    }
    fun refresh() {
        if (!isOwner() || !state.value.open || state.value.busy) return
        perform("Checking the protected connection service…", requireReady = false) {
            load()
            when {
                !state.value.ready -> "Secure setup is unavailable until the protected service passes its isolation check."
                state.value.flowId != null -> googleNextStep()
                else -> "Connections are ready."
            }
        }
    }
    fun saveBitwarden(organizationId: String, projectId: String, accessToken: String) =
        change("Bitwarden connection saved.", requireVault = false) {
            request("POST", "/bitwarden", JSONObject().put("operationId", operationId())
                .put("organizationId", organizationId.trim()).put("projectId", projectId.trim()).put("accessToken", accessToken))
        }
    fun savePassword(label: String, origin: String, username: String, password: String) =
        change("Account saved in Bitwarden.") {
            val website = URI(origin.trim())
            require(website.scheme == "https" && website.host != null && website.userInfo == null && website.query == null && website.fragment == null)
            request("POST", "/password", JSONObject().put("operationId", operationId()).put("label", label.trim())
                .put("origin", "https://" + website.rawAuthority).put("username", username).put("password", password))
        }
    fun saveGoogle(clientId: String, clientSecret: String, redirectUri: String) =
        change("Google authorization setup saved.") {
            request("POST", "/google/config", JSONObject().put("operationId", operationId())
                .put("clientId", clientId.trim()).put("clientSecret", clientSecret.trim()).put("redirectUri", redirectUri.trim()))
        }
    fun startGoogle(label: String, expectedEmail: String, preset: String, connectionId: String? = null) {
        if (!state.value.googleConfigured) return
        val message = if (state.value.redirectUri.startsWith("http:"))
            "Open Google to approve access. Then paste the complete return URL and choose Finish Google connection."
            else "Open Google to approve access. Return here and refresh to check the connection."
        change(message) {
            val result = request("POST", "/google/start", JSONObject().put("operationId", operationId())
                .put("label", label.trim()).put("expectedEmail", expectedEmail.trim()).put("preset", preset).apply { connectionId?.let { put("connectionId", it) } })
            val url = URI(result.getString("authorizationUrl"))
            require(url.scheme == "https" && url.host == "accounts.google.com" && url.userInfo == null)
            mutable.update { it.copy(authorizationUrl = url.toASCIIString(), flowId = result.getString("flowId")) }
        }
    }
    private fun googleNextStep(): String = if (state.value.redirectUri.startsWith("http:"))
        "Paste the complete return URL from Google into Google return URL, then choose Finish Google connection."
        else "Connection status updated. Refresh after Google returns to the household page to check the connected account."

    fun completeGoogle(callbackUrl: String) {
        val flowId = state.value.flowId ?: return
        change("Google account connected.") {
            request("POST", "/google/complete", JSONObject().put("flowId", flowId).put("callbackUrl", callbackUrl))
            mutable.update { it.copy(authorizationUrl = null, flowId = null) }
        }
    }
    fun changeAccess(connection: AccountConnection) {
        if (connection.access == "write") change("HardyAI now has read-only access to this connection.") {
            request("POST", "/google/read-only", JSONObject().put("operationId", operationId()).put("connectionId", connection.id))
        } else startGoogle(connection.label, connection.account, if (connection.service == "gmail") "gmail_manage" else "calendar_manage", connection.id)
    }
    fun disconnect(id: String) = change("Account disconnected.", requireVault = false) {
        request("DELETE", "/" + SignedHouseholdTransport.encode(id), JSONObject().put("operationId", operationId()))
    }
    private fun change(message: String, requireVault: Boolean = true, action: suspend () -> Unit) {
        if (requireVault && !state.value.vaultConfigured) return
        perform("Saving the connection…") {
            action()
            load()
            message
        }
    }
    private fun perform(working: String, requireReady: Boolean = true, action: suspend () -> String) {
        if (!isOwner() || !state.value.open || state.value.busy || requireReady && !state.value.ready) return
        val current = generation
        mutable.update { it.copy(busy = true, notice = working) }
        job = scope.launch {
            try {
                val notice = action()
                if (current == generation) mutable.update { it.copy(notice = notice) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (current == generation) {
                    val code = (error as? HouseholdRequestException)?.code
                    val safeMessage = connectionFailures[code]
                    val rejected = error is HouseholdRequestException && error.status in setOf(401, 403) && safeMessage == null
                    val unavailable = code in setOf("credentials_https_required", "credential_isolation_unavailable")
                    mutable.update { it.copy(
                        ready = if (rejected || unavailable) false else it.ready,
                        flowId = if (code in restartGoogleFailures) null else it.flowId,
                        authorizationUrl = if (code in restartGoogleFailures) null else it.authorizationUrl,
                        formRevision = it.formRevision + 1,
                        notice = safeMessage?.let { message -> message + " Secret fields have been cleared." }
                            ?: if (rejected) "Only the household owner can manage account connections."
                            else "The request could not be confirmed. Refresh connection status before trying again. Secret fields have been cleared.",
                    ) }
                }
            } finally {
                if (current == generation) mutable.update { it.copy(busy = false) }
            }
        }
    }
    private suspend fun load() {
        val current = generation
        val json = request("GET", "", null)
        if (current != generation || !isOwner()) return
        val google = json.optJSONObject("google")
        mutable.update { it.copy(
            ready = json.optJSONObject("security")?.optBoolean("ready") == true,
            vaultConfigured = json.optJSONObject("vault")?.optBoolean("configured") == true,
            googleConfigured = google?.optBoolean("configured") == true,
            redirectUri = google?.optString("redirectUri")?.takeIf(String::isNotBlank) ?: defaultRedirect(),
            connections = json.optJSONArray("connections").objectsSafe().map { value ->
                AccountConnection(value.getString("id"), value.optString("label", "Account connection"), value.optString("status"), value.optString("kind"), value.optString("account"), value.optString("service", if (value.optString("preset").startsWith("gmail_")) "gmail" else "calendar"), value.optString("access", "read"))
            },
        ) }
    }
}

private val connectionFailures = mapOf(
    "bitwarden_not_configured" to "Connect Bitwarden before adding an account.",
    "invalid_bitwarden_project" to "Check the Bitwarden organization and project IDs.",
    "bitwarden_bootstrap_already_configured" to "Bitwarden is already connected. Refresh its status.",
    "credential_vault_unavailable" to "Bitwarden could not be reached or accepted. Check the machine token and project access.",
    "credential_vault_outcome_unknown" to "Bitwarden has not confirmed this request. Refresh before trying again.",
    "connection_reconciliation_required" to "Refresh Connections and resolve the earlier uncertain save before adding this connection again.",
    "connection_operation_conflict" to "This connection request conflicts with an earlier request. Refresh its status.",
    "invalid_google_client" to "Enter the complete client ID and matching client secret from the same Google OAuth Web application client.",
    "invalid_google_redirect" to "Use this app’s loopback return URL or an allowed HTTPS DNS return URL.",
    "google_client_not_configured" to "Complete Google setup before connecting an account.",
    "google_connection_changed" to "This connection changed during authorization. Refresh and start its access change again.",
    "google_connection_ambiguous" to "Choose the existing connection whose access you want to change.",
    "google_account_mismatch" to "Google authorized a different account. Start again with the intended account.",
    "google_scope_not_granted" to "Google did not grant the requested access. Start authorization again.",
    "google_scope_exceeds_request" to "Google returned permissions beyond this request. Start authorization again.",
    "google_authorization_expired" to "The Google authorization expired. Start again.",
    "google_authorization_restart_required" to "Start Google authorization again to finish this connection.",
    "google_authorization_failed" to "Google authorization could not finish. Refresh connection status and start again.",
    "google_client_credentials_rejected" to "Google rejected the OAuth client. In Google setup, use the Web application client ID and its matching client secret, then start a fresh authorization.",
    "google_authorization_code_rejected" to "Google rejected this return authorization. Start a fresh authorization, then paste the complete return URL and choose Finish Google connection once.",
    "google_redirect_uri_mismatch" to "The return URL does not match Google setup. Register the exact Authorized redirect URI in the OAuth web client, save the matching setup here, then start again.",
    "google_consent_denied" to "Access was declined in Google. Start again and approve the requested access to connect this account.",
    "google_token_exchange_unavailable" to "Google could not finish the connection right now. Start a fresh authorization when Google is reachable again.",
    "google_token_exchange_failed" to "Google could not complete this authorization. Check Google setup, then start a fresh authorization.",
    "google_identity_verification_unavailable" to "Google account verification could not be reached. Start a fresh authorization when Google is reachable again.",
    "google_identity_verification_failed" to "The returned Google account identity did not pass verification. Check the OAuth client details, then start a fresh authorization.",
    "google_grant_incomplete" to "Google did not return all details needed for this connection. Start a fresh authorization and approve the requested access.",
    "google_identity_not_verified" to "Google did not verify this account email. Use a verified Google account and start a fresh authorization.",
    "invalid_google_callback" to "The Google return URL could not be accepted. Paste the complete browser return URL from this authorization and choose Finish Google connection.",
    "credentials_https_required" to "Open Hardy Home using its trusted HTTPS address.",
    "credential_isolation_unavailable" to "The protected connection service has not passed its isolation check.",
)

private val restartGoogleFailures = setOf(
    "google_client_credentials_rejected",
    "google_authorization_code_rejected",
    "google_redirect_uri_mismatch",
    "google_consent_denied",
    "google_token_exchange_unavailable",
    "google_token_exchange_failed",
    "google_identity_verification_unavailable",
    "google_identity_verification_failed",
    "google_grant_incomplete",
    "google_identity_not_verified",
    "google_authorization_expired",
    "google_authorization_restart_required",
    "google_scope_exceeds_request",
    "google_scope_not_granted",
    "google_account_mismatch",
)
