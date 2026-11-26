package family.hardy.home.data

import family.hardy.home.model.*
import org.json.JSONArray
import org.json.JSONObject

internal class HouseholdLibraryApi(private val transport: SignedHouseholdTransport) {
    suspend fun contacts(query: String): List<ContactCard> {
        val json = get("/v1/contacts?query=${encode(query)}&limit=50")
        return json.optJSONArray("contacts").objectsSafe().map(::contact)
    }
    suspend fun contact(id: String): ContactDetail {
        val json = get("/v1/contacts/${encode(id)}")
        val value = json.optJSONObject("contact") ?: json
        val card = contact(value)
        val sources = value.optJSONArray("sources").objectsSafe().map { source -> ArtifactCard(
            source.optString("artifactId", source.optString("id")), source.optString("filename", "Card source"),
            source.optString("mimeType"), card.audience, "input", source.optLong("byteLength"), card.id,
        ) }
        val history = json.optJSONArray("revisions") ?: value.optJSONArray("revisions")
        return ContactDetail(card, sources, history.objectsSafe().map { revision -> ContactRevisionCard(
            revision.optInt("revision"), revision.optString("reason"), revision.optString("createdAt"), fields(revision.optJSONObject("fields")),
        ) }, value.optJSONArray("uncertainties").stringsSafe())
    }
    suspend fun lists(scope: String): Pair<List<ListEntry>,String> {
        val json = get("/v1/lists?scope=${encode(scope)}")
        return json.optJSONArray("items").objectsSafe().map { value -> ListEntry(value.getString("id"), value.getString("text"), value.optString("kind", "shopping"), value.optBoolean("done")) } to json.optString("updatedAt")
    }
    suspend fun wiki(scope: String, query: String): List<WikiCard> {
        val json = get("/v1/wiki?scope=${encode(scope)}&query=${encode(query)}")
        val pages = json.optJSONArray("pages") ?: json.optJSONArray("results")
        return pages.objectsSafe().map { value -> WikiCard(value.optString("id", value.optString("lookup")), value.optString("title", "Knowledge"), value.optString("excerpt", value.optString("snippet"))) }
    }
    suspend fun wikiPage(scope: String, id: String): WikiPage {
        val json = get("/v1/wiki/${encode(id)}?scope=${encode(scope)}")
        val page = json.optJSONObject("page") ?: json
        return WikiPage(id, page.optString("title", "Knowledge"), page.optString("body", page.optString("content")), page.optJSONArray("sources").let { sources ->
            if (sources == null) emptyList() else (0 until sources.length()).map { index ->
                val source = sources.opt(index)
                if (source is JSONObject) source.optString("title", source.optString("label", "Source")) else "Source ${index + 1}"
            }
        })
    }
    suspend fun reviews(): List<ReceiptReviewCard> = get("/v1/receipts/review").optJSONArray("items").objectsSafe().map { value ->
        ReceiptReviewCard(value.getString("receiptId"), value.optInt("revision"), value.optString("title", "Receipt awaiting review"),
            value.optJSONArray("reasons").let { reasons -> if (reasons == null) emptyList() else (0 until reasons.length()).map { index ->
                val reason = reasons.opt(index)
                if (reason is JSONObject) reason.optString("message", reason.optString("label", "Needs clarification")) else reason.toString().replace('_', ' ')
            } }, value.optString("question"))
    }
    suspend fun workspace(conversationId: String): JSONObject = get("/v1/conversations/${encode(conversationId)}/workspace")
    private suspend fun get(path: String): JSONObject = transport.request("GET", path).requireSuccess().json()
    private fun contact(value: JSONObject): ContactCard {
        val fields = fields(value.optJSONObject("fields"))
        return ContactCard(value.getString("id"), fields["full_name"]?.firstOrNull() ?: "Scanned card", fields["organization"]?.firstOrNull().orEmpty(),
            value.optInt("currentRevision", value.optInt("revision", 1)), value.optString("audience", "private"), fields)
    }
    companion object {
        fun fields(value: JSONObject?): Map<String,List<String>> = value?.keys()?.asSequence()?.associateWith { key ->
            when (val item = value.opt(key)) { is JSONArray -> item.stringsSafe(); is String -> listOf(item); else -> emptyList() }
        } ?: emptyMap()
        fun encode(value: String): String = SignedHouseholdTransport.encode(value)
    }
}
internal fun JSONArray?.objectsSafe(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull(::optJSONObject)
internal fun JSONArray?.stringsSafe(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { index -> optString(index).takeIf(String::isNotBlank) }
