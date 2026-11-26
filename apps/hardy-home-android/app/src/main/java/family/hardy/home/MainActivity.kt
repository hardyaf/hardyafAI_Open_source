package family.hardy.home

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import family.hardy.home.model.DictationPhase
import family.hardy.home.ui.HouseholdExperience
import family.hardy.home.ui.ReceiptCaptureDialog
import family.hardy.home.ui.ConnectionsDialog
import family.hardy.home.ui.theme.HardyHomeTheme
import java.io.File
import java.util.UUID

class MainActivity : ComponentActivity() {
    private val homeViewModel by viewModels<HardyHomeViewModel>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { HardyHomeTheme { HardyHomeRoot(homeViewModel) } }
    }

    override fun onResume() {
        super.onResume()
        homeViewModel.connections.resume()
    }

    override fun onStop() {
        homeViewModel.stopRecordingInBackground()
        homeViewModel.connections.leaveForeground()
        super.onStop()
    }
}

@Composable
private fun HardyHomeRoot(viewModel: HardyHomeViewModel) {
    val state = viewModel.state.collectAsStateWithLifecycle().value
    val voice by viewModel.dictationState.collectAsStateWithLifecycle()
    val receiptState by viewModel.receiptCapture.state.collectAsStateWithLifecycle()
    val connectionState by viewModel.connections.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.currentProfile.id, state.capabilities) { viewModel.connections.ownerChanged() }
    val view = LocalView.current
    DisposableEffect(view, voice.phase) {
        val priorKeepScreenOn = view.keepScreenOn
        if (voice.phase == DictationPhase.Recording) view.keepScreenOn = true
        onDispose { view.keepScreenOn = priorKeepScreenOn }
    }
    val context = LocalContext.current
    LaunchedEffect(state.currentProfile.id, state.selectedConversationId, state.workspaceTab, state.capabilities, state.sending) {
        viewModel.checkDictationDestination()
    }
    var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }
    val localNetworkLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) viewModel.enroll() else viewModel.setStatusNotice("Local network access is needed to connect to your household")
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) viewModel.addAttachment(uri) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        cameraUri?.let { if(saved) viewModel.addAttachment(Uri.parse(it), "image/jpeg") }
        cameraUri = null
    }
    val receiptCamera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        viewModel.receiptCapture.cameraResult(saved)
    }
    val microphonePermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) viewModel.toggleDictation() else viewModel.setStatusNotice("Allow microphone access to record a draft.")
    }
    HouseholdExperience(state, viewModel,
        onNewReceipt = {
            runCatching { viewModel.receiptCapture.prepareCamera()?.let { receiptCamera.launch(it) } }
                .onFailure {
                    viewModel.receiptCapture.cameraResult(false)
                    viewModel.setStatusNotice("The receipt camera could not open.")
                }
        },
        onHouseholdFinances = viewModel.receiptCapture::open,
        onConnections = viewModel.connections::open,
        onPick = { runCatching { picker.launch(arrayOf("image/png", "image/jpeg", "image/webp", "application/pdf")) }.onFailure { viewModel.setStatusNotice("The file picker is unavailable on this phone") } },
        onCamera = {
            runCatching {
                val directory = File(context.cacheDir, "capture").apply { mkdirs() }
                directory.listFiles()?.filter { System.currentTimeMillis()-it.lastModified() > 24*60*60*1000 }?.forEach(File::delete)
                val file = File(directory, "photo-${UUID.randomUUID()}.jpg").apply { createNewFile() }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                cameraUri = uri.toString(); camera.launch(uri)
            }.onFailure { viewModel.setStatusNotice("The camera is unavailable on this phone") }
        },
        dictation = voice,
        onDiscardDictation = viewModel::discardDictation,
        onVoice = {
            if (voice.phase == DictationPhase.Idle &&
                context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
            } else {
                viewModel.toggleDictation()
            }
        },
        onEnroll = {
            if(Build.VERSION.SDK_INT >= 37 && context.checkSelfPermission(Manifest.permission.ACCESS_LOCAL_NETWORK) != PackageManager.PERMISSION_GRANTED)
                localNetworkLauncher.launch(Manifest.permission.ACCESS_LOCAL_NETWORK) else viewModel.enroll()
        })
    if (connectionState.open && state.currentProfile.role == "admin" && family.hardy.home.model.HouseholdCapability.ManageAccess in state.capabilities) {
        ConnectionsDialog(connectionState, viewModel.connections)
    }
    if (receiptState.open && state.currentProfile.id in setOf("alex", "natasha") && state.capabilities.isNotEmpty()) {
        ReceiptCaptureDialog(receiptState, viewModel.receiptCapture)
    }
}
