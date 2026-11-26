package family.hardy.home.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import family.hardy.home.model.PendingAttachment
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

internal data class StoredAttachment(
    val id: String, val filename: String, val mimeType: String, val byteLength: Long,
    val artifactId: String? = null, val conversationId: String? = null,
)

/** Draft-only client cache. The server owns accepted bytes, tasks and effects. */
internal class ClientAttachmentStore(private val context: Context) {
    private val preferences = context.getSharedPreferences("hardy_home_pending_media", Context.MODE_PRIVATE)
    private val directory = File(context.filesDir, "pending_media").apply { mkdirs() }
    private val lock = Any()
    private val media = setOf("image/png", "image/jpeg", "image/webp", "application/pdf")
    private val maximumBytes = 25 * 1024 * 1024

    fun load(): List<StoredAttachment> = synchronized(lock) {
        runCatching {
            val values = JSONArray(preferences.getString("media", "[]"))
            (0 until values.length()).mapNotNull { index ->
                val value = values.getJSONObject(index)
                val id = value.getString("id")
                if (!id.matches(Regex("media-[a-f0-9-]{36}")) || !File(directory, id).isFile) null else StoredAttachment(
                    id, value.getString("filename"), value.getString("mimeType"), value.getLong("byteLength"),
                    value.optString("artifactId").takeIf(String::isNotBlank), value.optString("conversationId").takeIf(String::isNotBlank),
                )
            }
        }.getOrDefault(emptyList())
    }
    private fun save(values: List<StoredAttachment>) {
        val array = JSONArray()
        values.forEach { value -> array.put(JSONObject().put("id", value.id).put("filename", value.filename).put("mimeType", value.mimeType)
            .put("byteLength", value.byteLength).put("artifactId", value.artifactId).put("conversationId", value.conversationId)) }
        check(preferences.edit().putString("media", array.toString()).commit()) { "attachment_draft_not_saved" }
    }
    fun add(uri: Uri, explicitMime: String? = null): StoredAttachment = synchronized(lock) {
        val current = load()
        check(current.size < 8) { "attachment_limit" }
        val mime = explicitMime ?: context.contentResolver.getType(uri) ?: ""
        require(mime in media) { "attachment_type_not_supported" }
        val name = runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        }.getOrNull().orEmpty().replace(Regex("[\\\\/\\p{Cntrl}]"), "_").take(60).trimEnd { it.isHighSurrogate() }.ifBlank {
            if (mime == "application/pdf") "Document.pdf" else "Photo.jpg"
        }
        val id = "media-${UUID.randomUUID()}"
        val target = File(directory, id)
        val temporary = File(directory, "$id.tmp")
        var count = 0L
        try {
            context.contentResolver.openInputStream(uri).use { input ->
                requireNotNull(input) { "attachment_cannot_open" }
                FileOutputStream(temporary).use { output ->
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        count += read
                        require(count <= maximumBytes) { "attachment_too_large" }
                        output.write(buffer, 0, read)
                    }
                    output.fd.sync()
                }
            }
            require(count > 0) { "attachment_empty" }
            check(temporary.renameTo(target)) { "attachment_draft_not_saved" }
            val result = StoredAttachment(id, name, mime, count)
            save(current + result)
            result
        } catch (error: Throwable) {
            temporary.delete(); target.delete(); throw error
        }
    }
    fun remove(id: String) = synchronized(lock) {
        val existing = load(); save(existing.filterNot { it.id == id })
        existing.firstOrNull { it.id == id }?.let { File(directory, it.id).delete() }
    }
    fun clear(ids: Set<String> = load().map { it.id }.toSet()) = synchronized(lock) {
        val existing = load(); save(existing.filterNot { it.id in ids })
        existing.filter { it.id in ids }.forEach { File(directory, it.id).delete() }
    }
    fun clearAcceptedRemote(conversationId: String, artifactIds: Set<String>) = synchronized(lock) {
        clear(load().filter { it.conversationId == conversationId && it.artifactId in artifactIds }.map { it.id }.toSet())
    }
    fun ui(): List<PendingAttachment> = load().map { PendingAttachment(it.id, it.filename, it.mimeType, it.byteLength) }
    suspend fun upload(ids: Set<String>, conversationId: String, audience: String, transport: SignedHouseholdTransport, progress: (String) -> Unit): List<String> {
        val results = mutableListOf<String>()
        val selected = load().filter { it.id in ids }
        require(selected.size == ids.size) { "attachment_draft_changed" }
        for (value in selected) {
            if (value.conversationId == conversationId && value.artifactId != null) { results += value.artifactId; continue }
            progress("Uploading ${value.filename}…")
            val file = File(directory, value.id)
            require(file.length() == value.byteLength && file.length() <= maximumBytes) { "attachment_draft_changed" }
            val body = JSONObject().put("filename", value.filename).put("mimeType", value.mimeType)
                .put("contentBase64", Base64.encodeToString(file.readBytes(), Base64.NO_WRAP))
                .put("idempotencyKey", "upload-${value.id}-$conversationId").put("audience", audience).toString()
            val response = transport.request("POST", "/v1/conversations/${SignedHouseholdTransport.encode(conversationId)}/artifacts", body).requireSuccess().json()
            val artifact = response.optJSONObject("artifact") ?: response.optJSONObject("metadata") ?: response
            val artifactId = artifact.getString("id")
            require(artifactId.matches(Regex("artifact-[a-f0-9]{64}"))) { "attachment_upload_unconfirmed" }
            synchronized(lock) { save(load().map { if (it.id == value.id) it.copy(artifactId = artifactId, conversationId = conversationId) else it }) }
            results += artifactId
        }
        return results
    }
}
