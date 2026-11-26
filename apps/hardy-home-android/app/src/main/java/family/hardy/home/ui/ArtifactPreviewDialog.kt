package family.hardy.home.ui

import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import family.hardy.home.model.MediaPreview
import java.io.ByteArrayInputStream

@Composable
fun ArtifactPreviewDialog(preview: MediaPreview, close: () -> Unit) {
    val context = LocalContext.current
    var notice by remember(preview) { mutableStateOf<String?>(null) }
    val inertDocument = preview.mimeType in setOf("text/html", "image/svg+xml")
    Dialog(onDismissRequest = close, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize().padding(20.dp), shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(preview.title, style = MaterialTheme.typography.titleLarge)
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    when {
                        preview.bitmap != null -> Image(preview.bitmap.asImageBitmap(), preview.title, Modifier.fillMaxSize())
                        inertDocument && preview.text != null -> {
                            val html = if(preview.mimeType == "image/svg+xml") "<html><body>${preview.text}</body></html>" else preview.text
                            AndroidView(modifier = Modifier.fillMaxSize(), factory = { viewContext -> WebView(viewContext).apply {
                                settings.javaScriptEnabled = false; settings.domStorageEnabled = false; settings.allowFileAccess = false; settings.allowContentAccess = false
                                settings.blockNetworkLoads = true; settings.setSupportZoom(true); settings.builtInZoomControls = true; settings.displayZoomControls = false
                                webViewClient = object : WebViewClient() {
                                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = true
                                    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?) = WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
                                }
                                loadDataWithBaseURL("https://artifact.invalid/", "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'\">$html", "text/html", "UTF-8", null)
                            } }, onReset = null, onRelease = { it.stopLoading(); it.destroy() })
                        }
                        preview.text != null -> Text(preview.text, Modifier.fillMaxSize().verticalScroll(rememberScrollState()))
                        else -> Text("This document is ready to open in a viewer on this phone.")
                    }
                }
                notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                Row {
                    if (!inertDocument && preview.contentUri != null) TextButton(onClick = {
                        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(preview.contentUri), preview.mimeType)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        runCatching { context.startActivity(Intent.createChooser(intent, "Open document")) }.onFailure { notice = "No viewer is available for this document" }
                    }) { Text("Open in viewer") }
                    Spacer(Modifier.weight(1f)); TextButton(onClick = close) { Text("Close") }
                }
            }
        }
    }
}
