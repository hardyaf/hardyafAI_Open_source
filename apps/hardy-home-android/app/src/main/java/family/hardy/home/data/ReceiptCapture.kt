package family.hardy.home.data

import android.content.Context
import android.net.Uri
import android.graphics.Bitmap
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal data class CapturedReceipt(
    val id: String,
    val createdAt: String,
    val state: String,
    val destination: String?,
    val vendor: String?,
    val date: String?,
    val currency: String?,
    val totalMinor: Long?,
    val ocr: String?,
) {
    constructor(value: JSONObject) : this(
        value.getString("id"), value.getString("createdAt"), value.getString("state"), value.stringOrNull("destination"),
        value.stringOrNull("vendor"), value.stringOrNull("date"), value.stringOrNull("currency"),
        if (value.isNull("totalMinor")) null else value.getLong("totalMinor"), value.stringOrNull("ocr"),
    )
}

private fun JSONObject.stringOrNull(name: String) = if (isNull(name)) null else getString(name)

internal data class ReceiptCaptureState(
    val open: Boolean = false,
    val busy: Boolean = false,
    val uploadPending: Boolean = false,
    val selected: CapturedReceipt? = null,
    val preview: Bitmap? = null,
    val captures: List<CapturedReceipt> = emptyList(),
    val message: String? = null,
)

internal class ReceiptCapture(
    private val context: Context,
    private val scope: CoroutineScope,
    private val owner: () -> String?,
    private val upload: suspend (String, File) -> JSONObject,
    private val request: suspend (String, String, JSONObject?) -> JSONObject,
    private val preview: suspend (String) -> Bitmap?,
) {
    private val stateFlow = MutableStateFlow(ReceiptCaptureState())
    val state = stateFlow.asStateFlow()
    private val prefs = context.getSharedPreferences("receipt_capture", Context.MODE_PRIVATE)
    private val directory = File(context.filesDir, "receipt-camera")

    private fun localId(profile: String) = prefs.getString(profile, null)?.let(UUID::fromString)?.toString()
    private fun photo(id: String) = File(directory, "$id.jpg")

    fun prepareCamera(): Uri? {
        val profile = owner() ?: return null
        if (stateFlow.value.busy || localId(profile) != null) {
            open()
            return null
        }
        check(directory.isDirectory || directory.mkdirs())
        val id = UUID.randomUUID().toString()
        val uri = FileProvider.getUriForFile(context, context.packageName + ".files", photo(id))
        check(prefs.edit().putString(profile, id).commit())
        return uri
    }

    fun cameraResult(saved: Boolean) {
        if (!saved) discardLocal() else uploadPhoto()
    }

    fun open() {
        val profile = owner() ?: return
        if (stateFlow.value.busy) return
        stateFlow.value = stateFlow.value.copy(open = true, selected = null, preview = null, uploadPending = localId(profile) != null)
        refresh()
    }

    fun close() {
        if (!stateFlow.value.busy) reset()
    }

    fun reset() {
        stateFlow.value = ReceiptCaptureState()
    }

    fun discardLocal() {
        val profile = owner() ?: return
        if (stateFlow.value.busy) return
        localId(profile)?.let { photo(it).delete() }
        prefs.edit().remove(profile).apply()
        stateFlow.value = stateFlow.value.copy(uploadPending = false, message = null)
    }

    fun uploadPhoto() = perform("Could not upload this photo. Retry or retake it.") { profile ->
        val id = localId(profile) ?: return@perform
        val file = photo(id)
        stateFlow.value = stateFlow.value.copy(uploadPending = true)
        val result = withContext(Dispatchers.IO) { upload(id, file) }
        if (owner() != profile) return@perform
        val receipt = CapturedReceipt(result.getJSONObject("capture"))
        check(prefs.edit().remove(profile).commit())
        file.delete()
        stateFlow.value = stateFlow.value.copy(selected = receipt, preview = null, uploadPending = false)
        loadPreview(profile, receipt.id)
    }

    fun select(id: String) = perform("Could not open this receipt.") { profile ->
        val result = request("GET", "/$id", null)
        if (owner() == profile) {
            stateFlow.value = stateFlow.value.copy(selected = CapturedReceipt(result.getJSONObject("capture")), preview = null)
            loadPreview(profile, id)
        }
    }

    private suspend fun loadPreview(profile: String, id: String) {
        val bitmap = try { preview(id) }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { null }
        if (owner() == profile && stateFlow.value.selected?.id == id) stateFlow.value = stateFlow.value.copy(preview = bitmap)
    }

    fun file(destination: String) {
        val id = stateFlow.value.selected?.id ?: return
        perform("Could not finish filing. Retry to continue with the saved photo.") { profile ->
            try {
                val result = request("POST", "/$id", JSONObject().put("destination", destination))
                if (owner() == profile) stateFlow.value = stateFlow.value.copy(selected = CapturedReceipt(result.getJSONObject("capture")))
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                try {
                    val current = request("GET", "/$id", null)
                    if (owner() == profile) stateFlow.value = stateFlow.value.copy(selected = CapturedReceipt(current.getJSONObject("capture")))
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    // Keep the previous view when the server is unreachable.
                }
                throw error
            }
        }
    }

    fun review(vendor: String, date: String, currency: String, totalMinor: Long) {
        val id = stateFlow.value.selected?.id ?: return
        perform("Could not save the summary. Check the date, currency, and total.") { profile ->
            val summary = JSONObject().put("vendor", vendor).put("date", date).put("currency", currency).put("totalMinor", totalMinor)
            val result = request("POST", "/$id/summary", summary)
            if (owner() == profile) stateFlow.value = stateFlow.value.copy(selected = CapturedReceipt(result.getJSONObject("capture")))
        }
    }

    private fun refresh() = perform("Could not load household finances.") { profile ->
        val values = request("GET", "", null).getJSONArray("captures").objectsSafe().map(::CapturedReceipt)
        if (owner() == profile) stateFlow.value = stateFlow.value.copy(captures = values)
    }

    private fun perform(fallback: String, action: suspend (String) -> Unit) {
        val profile = owner() ?: return
        if (stateFlow.value.busy) return
        stateFlow.value = stateFlow.value.copy(open = true, busy = true, message = null)
        scope.launch {
            try {
                action(profile)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (owner() == profile) stateFlow.value = stateFlow.value.copy(message = fallback)
            } finally {
                if (owner() == profile) stateFlow.value = stateFlow.value.copy(busy = false)
            }
        }
    }
}
