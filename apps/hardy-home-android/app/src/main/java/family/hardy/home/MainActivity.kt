package family.hardy.home

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import family.hardy.home.ui.HardyHomeScreen
import family.hardy.home.ui.theme.HardyHomeTheme
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            HardyHomeTheme {
                HardyHomeRoot()
            }
        }
    }
}

@Composable
private fun HardyHomeRoot(viewModel: HardyHomeViewModel = viewModel()) {
    val state = viewModel.state.collectAsStateWithLifecycle().value
    val context = LocalContext.current
    val localNetworkLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            viewModel.enroll()
        } else {
            viewModel.setStatusNotice("Local network access is required to connect to Hardy Home")
        }
    }
    val speechLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val recognized = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
        if (!recognized.isNullOrBlank()) {
            viewModel.setDraft(recognized)
        }
    }

    HardyHomeScreen(
        state = state,
        onDraftChange = viewModel::setDraft,
        onSend = viewModel::sendDraft,
        onNewConversation = viewModel::createConversation,
        onConversationSelected = viewModel::selectConversation,
        onPresetSelected = viewModel::selectPreset,
        onDrawerChange = viewModel::setDrawerOpen,
        onDiagnosticsChange = viewModel::setDiagnosticsVisible,
        onAttachment = { viewModel.setStatusNotice("Image picker connects in the live API milestone") },
        onVoiceInput = {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak to Hardy Home")
            }
            runCatching { speechLauncher.launch(intent) }
                .onFailure { viewModel.setStatusNotice("Speech recognition is not available on this device") }
        },
        onServerUrlChange = viewModel::setServerUrl,
        onEnrollmentCodeChange = viewModel::setEnrollmentCode,
        onEnroll = {
            val needsLocalNetworkPermission = Build.VERSION.SDK_INT >= 37 &&
                context.checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED
            if (needsLocalNetworkPermission) {
                localNetworkLauncher.launch(Manifest.permission.ACCESS_LOCAL_NETWORK)
            } else {
                viewModel.enroll()
            }
        },
        onRefresh = viewModel::refresh,
    )
}
