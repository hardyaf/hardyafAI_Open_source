package family.hardy.home.data

import android.annotation.SuppressLint
import android.content.Context
import android.media.MediaRecorder
import family.hardy.home.model.DictationPhase
import family.hardy.home.model.DictationState
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

internal data class DictationTarget(val profileId: String, val conversationId: String)

/** Owns the foreground microphone and one retryable, app-private recording. */
internal class JournalDictation(
    private val context: Context,
    private val scope: CoroutineScope,
    private val destination: () -> DictationTarget?,
    private val transcribe: suspend (File) -> String,
    private val append: (DictationTarget, String) -> Boolean,
) {
    private data class Clip(val file: File, val target: DictationTarget)
    private var recorder: MediaRecorder? = null
    private var clip: Clip? = null
    private var limit: Job? = null
    private var upload: Job? = null
    private val current = MutableStateFlow(DictationState())
    val state = current.asStateFlow()

    fun toggle() {
        when (current.value.phase) {
            DictationPhase.Idle -> start()
            DictationPhase.Recording -> finish(transcribeNow = true)
            DictationPhase.Transcribing -> Unit
            DictationPhase.Saved -> recognize()
        }
    }

    @SuppressLint("MissingPermission") // MainActivity obtains RECORD_AUDIO before starting.
    private fun start() {
        val target = destination() ?: return
        var file: File? = null
        var candidate: MediaRecorder? = null
        try {
            val directory = File(context.cacheDir, "dictation").apply { mkdirs() }
            directory.listFiles()?.filter { it.isFile && System.currentTimeMillis() - it.lastModified() > DAY_MS }
                ?.forEach { it.delete() }
            val output = File.createTempFile("journal-", ".m4a", directory)
            file = output
            val microphone = MediaRecorder(context)
            candidate = microphone
            microphone.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioChannels(1)
                setAudioSamplingRate(16_000)
                setAudioEncodingBitRate(32_000)
                setOutputFile(output.absolutePath)
                setOnErrorListener { source, _, _ ->
                    if (recorder === source) finish(transcribeNow = false)
                }
                prepare()
                start()
            }
            recorder = microphone
            clip = Clip(output, target)
            current.value = DictationState(DictationPhase.Recording, "Recording. Pause whenever you like. Tap Stop when finished.")
            limit = scope.launch {
                delay(MAX_RECORDING_MS)
                finish(transcribeNow = false, savedMessage = "The 30-minute recording is saved. Tap Transcribe to add it to your draft.")
            }
        } catch (_: Exception) {
            runCatching { candidate?.release() }
            file?.delete()
            current.value = DictationState(message = "Could not start the microphone. Check Hardy Home’s microphone access.")
        }
    }

    fun leaveForeground() {
        if (recorder != null) finish(transcribeNow = false)
    }

    fun destinationChanged() {
        if (recorder != null && clip?.target != destination()) leaveForeground()
    }

    private fun finish(
        transcribeNow: Boolean,
        savedMessage: String = "Recording saved. Tap Transcribe to add it to your draft.",
    ) {
        val microphone = recorder ?: return
        recorder = null
        limit?.cancel()
        limit = null
        val stopped = runCatching { microphone.stop() }.isSuccess
        runCatching { microphone.release() }
        val saved = clip
        if (!stopped || saved == null || saved.file.length() < 12) {
            discard()
            current.value = DictationState(message = "No usable recording was captured. Tap the microphone to try again.")
            return
        }
        current.value = DictationState(DictationPhase.Saved, savedMessage)
        if (transcribeNow) recognize()
    }

    private fun recognize() {
        val saved = clip ?: return
        if (destination() != saved.target) {
            current.value = DictationState(DictationPhase.Saved, "Return to the chat where you recorded to transcribe it.")
            return
        }
        current.value = DictationState(DictationPhase.Transcribing, "Transcribing on Hardybot…")
        upload = scope.launch {
            try {
                val text = transcribe(saved.file).trim()
                if (clip !== saved) return@launch
                when {
                    text.isEmpty() -> current.value = DictationState(DictationPhase.Saved, "No speech was recognized. You can discard this recording.")
                    append(saved.target, text) -> {
                        saved.file.delete()
                        clip = null
                        current.value = DictationState(message = "Dictation added to your draft.")
                    }
                    else -> current.value = DictationState(DictationPhase.Saved, "Return to the original chat to add the transcript.")
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (clip === saved) current.value = DictationState(DictationPhase.Saved, "Could not transcribe. Your recording is saved on this phone. Tap Transcribe to retry.")
            }
        }
    }

    fun discard() {
        limit?.cancel()
        upload?.cancel()
        val microphone = recorder
        recorder = null
        runCatching { microphone?.release() }
        clip?.file?.delete()
        clip = null
        current.value = DictationState()
    }

    private companion object {
        const val DAY_MS = 24 * 60 * 60 * 1000L
        const val MAX_RECORDING_MS = 30 * 60 * 1000L
    }
}
