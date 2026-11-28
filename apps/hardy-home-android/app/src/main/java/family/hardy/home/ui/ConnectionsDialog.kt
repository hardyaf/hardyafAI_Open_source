package family.hardy.home.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.SecureFlagPolicy
import family.hardy.home.data.AccountConnection
import family.hardy.home.data.Connections
import family.hardy.home.data.ConnectionsState

@Composable
internal fun ConnectionsDialog(state: ConnectionsState, connections: Connections) {
    val context = LocalContext.current
    var editor by remember { mutableStateOf<String?>(null) }
    var disconnect by remember { mutableStateOf<AccountConnection?>(null) }
    var browserError by remember { mutableStateOf(false) }
    DisposableEffect(context) {
        val window = context.activity()?.window
        val previouslySecure = window?.attributes?.flags?.and(WindowManager.LayoutParams.FLAG_SECURE) != 0
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { if (!previouslySecure) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
    Dialog(
        onDismissRequest = connections::close,
        properties = DialogProperties(usePlatformDefaultWidth = false, securePolicy = SecureFlagPolicy.SecureOn),
    ) {
        Surface(shape = MaterialTheme.shapes.extraLarge, modifier = Modifier.fillMaxWidth().padding(16.dp)) {
            Column(Modifier.fillMaxWidth().heightIn(max = 680.dp).imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Connections", style = MaterialTheme.typography.headlineSmall)
                Text("Connect an account privately. Jarvis receives a connection label and the approved account tools.")
                if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (state.notice.isNotBlank()) Text(state.notice, style = MaterialTheme.typography.bodySmall)
                if (!state.ready) Text("Account setup stays disabled until the protected connection service passes its isolation check.",
                    color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                if (state.connections.isEmpty() && !state.busy) Text("No account connections yet.")
                state.connections.forEach { connection ->
                    OutlinedCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text(connection.label, style = MaterialTheme.typography.titleMedium)
                            Text(connectionStatus(connection.status), style = MaterialTheme.typography.bodySmall)
                            if (connection.kind == "google") {
                                Text((if (connection.service == "gmail") "Gmail" else "Calendar") + " · " + (if (connection.access == "write") "Read and write" else "Read only"), style = MaterialTheme.typography.bodySmall)
                                if (connection.account.isNotBlank() && connection.status == "connected") TextButton(onClick = { connections.changeAccess(connection) }, enabled = state.ready && !state.busy) {
                                    Text(if (connection.access == "write") "Use read only" else "Enable write access")
                                }
                            }
                            TextButton(onClick = { disconnect = connection }, enabled = state.ready && !state.busy) { Text("Disconnect") }
                        }
                    }
                }
                HorizontalDivider()
                Text(if (state.vaultConfigured) "Bitwarden connected" else "Connect Bitwarden before adding account credentials.")
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { editor = if (editor == "bitwarden") null else "bitwarden" }, enabled = state.ready && !state.busy, modifier = Modifier.fillMaxWidth()) { Text("Set up Bitwarden") }
                    OutlinedButton(onClick = { editor = if (editor == "password") null else "password" }, enabled = state.ready && state.vaultConfigured && !state.busy, modifier = Modifier.fillMaxWidth()) { Text("Add a username and password") }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { editor = if (editor == "googleSetup") null else "googleSetup" }, enabled = state.ready && state.vaultConfigured && !state.busy, modifier = Modifier.fillMaxWidth()) { Text("Set up Google authorization") }
                    OutlinedButton(onClick = { editor = if (editor == "google") null else "google" }, enabled = state.ready && state.vaultConfigured && state.googleConfigured && !state.busy, modifier = Modifier.fillMaxWidth()) { Text("Connect a Google account") }
                }
                key(editor, state.formRevision, state.ready) {
                    if (state.ready && !state.busy) when (editor) {
                        "bitwarden" -> BitwardenForm { organization, project, token ->
                            editor = null
                            connections.saveBitwarden(organization, project, token)
                        }
                        "password" -> PasswordConnectionForm { label, origin, username, password ->
                            editor = null
                            connections.savePassword(label, origin, username, password)
                        }
                        "googleSetup" -> GoogleSetupForm(state.redirectUri) { clientId, clientSecret, redirect ->
                            editor = null
                            connections.saveGoogle(clientId, clientSecret, redirect)
                        }
                        "google" -> GoogleConnectionForm { label, email, preset ->
                            editor = null
                            connections.startGoogle(label, email, preset)
                        }
                        "callback" -> GoogleReturnForm { callback ->
                            editor = null
                            connections.completeGoogle(callback)
                        }
                    }
                }
                state.authorizationUrl?.let { url ->
                    Button(onClick = {
                        browserError = runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        }.isFailure
                    }, enabled = state.ready && !state.busy) { Text("Open Google authorization") }
                    Text(if (state.redirectUri.startsWith("http://localhost:"))
                        "After Google sign-in, the localhost page may be unavailable. Return here and enter the complete browser address using the button below."
                        else "Approve access in Google. Return here and refresh to see the connected account.", style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = { editor = "callback" }, enabled = state.ready && !state.busy && state.flowId != null) { Text("Enter a return URL manually") }
                }
                if (browserError) Text("Google authorization could not open on this phone.", color = MaterialTheme.colorScheme.error)
                Text("Account fields clear when you leave this screen.", style = MaterialTheme.typography.bodySmall)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { editor = null; connections.refresh() }, enabled = !state.busy) { Text("Refresh") }
                    TextButton(onClick = connections::close) { Text("Close") }
                }
            }
        }
    }
    disconnect?.let { connection ->
        AlertDialog(onDismissRequest = { disconnect = null },
            properties = DialogProperties(securePolicy = SecureFlagPolicy.SecureOn),
            title = { Text("Disconnect this account?") },
            text = { Text(connection.label) },
            confirmButton = { TextButton(onClick = { disconnect = null; connections.disconnect(connection.id) }) { Text("Disconnect") } },
            dismissButton = { TextButton(onClick = { disconnect = null }) { Text("Keep connected") } })
    }
}

@Composable
private fun BitwardenForm(save: (String, String, String) -> Unit) {
    var organization by remember { mutableStateOf("") }
    var project by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    Text("Bitwarden Secrets Manager", style = MaterialTheme.typography.titleMedium)
    ConnectionField("Organization ID", organization, { organization = it }, maximum = 100)
    ConnectionField("Secrets Manager project ID", project, { project = it }, maximum = 100)
    ConnectionField("Machine account access token", token, { token = it }, secret = true, maximum = 8192)
    Button(onClick = {
        val submitted = token
        token = ""
        save(organization, project, submitted)
        organization = ""; project = ""
    }, enabled = organization.isNotBlank() && project.isNotBlank() && token.isNotBlank()) { Text("Connect Bitwarden") }
}

@Composable
private fun PasswordConnectionForm(save: (String, String, String, String) -> Unit) {
    var label by remember { mutableStateOf("") }
    var origin by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Text("Save an account in Bitwarden", style = MaterialTheme.typography.titleMedium)
    ConnectionField("Connection label", label, { label = it }, maximum = 120)
    ConnectionField("Account HTTPS website", origin, { origin = it }, maximum = 500)
    ConnectionField("Username or email", username, { username = it }, maximum = 320)
    ConnectionField("Password", password, { password = it }, secret = true, maximum = 8192)
    Button(onClick = {
        val submitted = password
        password = ""
        save(label, origin, username, submitted)
        label = ""; origin = ""; username = ""
    }, enabled = listOf(label, username, password).all(String::isNotBlank) && origin.startsWith("https://")) { Text("Save account in Bitwarden") }
}

@Composable
private fun GoogleSetupForm(defaultRedirect: String, save: (String, String, String) -> Unit) {
    var clientId by remember { mutableStateOf("") }
    var clientSecret by remember { mutableStateOf("") }
    var redirect by remember { mutableStateOf(defaultRedirect) }
    Text("Google OAuth web client", style = MaterialTheme.typography.titleMedium)
    Text("Create an OAuth web client in your Google Cloud project. Add the redirect URI below to its authorized redirect URIs.", style = MaterialTheme.typography.bodySmall)
    ConnectionField("Google client ID", clientId, { clientId = it }, maximum = 1024)
    ConnectionField("Google client secret", clientSecret, { clientSecret = it }, secret = true, maximum = 2048)
    ConnectionField("Authorized redirect URI", redirect, { redirect = it }, maximum = 1024)
    Text(if (redirect.startsWith("http://localhost:"))
        "Register this loopback return URL for a household IP address. Google may show an unavailable page after sign-in. Return here and enter the complete browser address to finish privately."
        else "An allowed HTTPS DNS return address can finish the connection automatically.", style = MaterialTheme.typography.bodySmall)
    Button(onClick = {
        val submitted = clientSecret
        clientSecret = ""
        save(clientId, submitted, redirect)
        clientId = ""; redirect = ""
    }, enabled = clientId.isNotBlank() && clientSecret.isNotBlank() && redirect.isNotBlank()) { Text("Save Google setup") }
}

@Composable
private fun GoogleConnectionForm(save: (String, String, String) -> Unit) {
    var label by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var preset by remember { mutableStateOf("gmail_read") }
    Text("Connect a Google account", style = MaterialTheme.typography.titleMedium)
    ConnectionField("Connection label", label, { label = it }, maximum = 120)
    ConnectionField("Google account email", email, { email = it }, maximum = 320)
    listOf("gmail_read" to "Gmail — read only", "gmail_manage" to "Gmail — read and write", "calendar_read" to "Calendar — read only", "calendar_manage" to "Calendar — read and write").forEach { (value, caption) ->
        Row { RadioButton(selected = preset == value, onClick = { preset = value }); TextButton(onClick = { preset = value }) { Text(caption) } }
    }
    Text("Google shows the requested permissions before you approve access.", style = MaterialTheme.typography.bodySmall)
    Button(onClick = { save(label, email, preset); label = ""; email = "" }, enabled = label.isNotBlank() && email.contains('@')) { Text("Start Google authorization") }
}

@Composable
private fun GoogleReturnForm(save: (String) -> Unit) {
    var callback by remember { mutableStateOf("") }
    Text("Enter the complete return URL from Google. It is used once to finish this connection.", style = MaterialTheme.typography.bodySmall)
    ConnectionField("Google return URL", callback, { callback = it }, secret = true, maximum = 8192)
    Button(onClick = { val submitted = callback; callback = ""; save(submitted) }, enabled = callback.isNotBlank()) { Text("Finish Google connection") }
}

// Native fields disable saved text, autofill, personalized learning, and copy/cut/share.
// Pasting is accepted so a user can enter a vault token without this app writing to the clipboard.
@Composable
private fun ConnectionField(label: String, value: String, change: (String) -> Unit, secret: Boolean = false, maximum: Int) {
    val latestChange by rememberUpdatedState(change)
    Text(label, style = MaterialTheme.typography.labelLarge)
    AndroidView(factory = { context ->
        PrivateConnectionInput(context).apply {
            isSaveEnabled = false
            setFreezesText(false)
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            importantForContentCapture = View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS
            inputType = InputType.TYPE_CLASS_TEXT or if (secret) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            imeOptions = EditorInfo.IME_ACTION_NEXT or EditorInfo.IME_FLAG_NO_EXTRACT_UI or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
            setSingleLine(true)
            filters = arrayOf(android.text.InputFilter.LengthFilter(maximum))
            val noExport = object : ActionMode.Callback {
                override fun onCreateActionMode(mode: ActionMode?, menu: Menu?): Boolean { filter(menu); return true }
                override fun onPrepareActionMode(mode: ActionMode?, menu: Menu?): Boolean { filter(menu); return true }
                override fun onActionItemClicked(mode: ActionMode?, item: MenuItem?): Boolean = item?.itemId in setOf(android.R.id.copy, android.R.id.cut, android.R.id.shareText)
                override fun onDestroyActionMode(mode: ActionMode?) {}
                private fun filter(menu: Menu?) {
                    menu?.clear()
                    menu?.add(0, android.R.id.paste, 0, "Paste")
                }
            }
            customSelectionActionModeCallback = noExport
            customInsertionActionModeCallback = noExport
            setOnKeyListener { _, code, event -> event.isCtrlPressed && code in setOf(android.view.KeyEvent.KEYCODE_C, android.view.KeyEvent.KEYCODE_X) }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) { latestChange(text?.toString().orEmpty()) }
                override fun afterTextChanged(text: Editable?) {}
            })
        }
    }, update = { input ->
        if (input.text.toString() != value) { input.setText(value); input.setSelection(value.length) }
        input.contentDescription = label
    }, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp))
}

private class PrivateConnectionInput(context: Context) : EditText(context) {
    override fun onTextContextMenuItem(id: Int): Boolean =
        if (id in setOf(android.R.id.paste, android.R.id.pasteAsPlainText, android.R.id.selectAll)) super.onTextContextMenuItem(id) else true
}
private fun Context.activity(): Activity? = when (this) { is Activity -> this; is ContextWrapper -> baseContext.activity(); else -> null }
private fun connectionStatus(value: String): String = when (value) {
    "connected", "ready", "active" -> "Connected"
    "disconnected" -> "Disconnected"
    "unknown" -> "Needs verification"
    "needs_attention", "error" -> "Needs attention"
    "expired" -> "Authorization expired"
    "pending" -> "Waiting for authorization"
    else -> "Connection saved"
}
