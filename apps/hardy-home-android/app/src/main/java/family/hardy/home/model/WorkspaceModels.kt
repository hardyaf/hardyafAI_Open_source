package family.hardy.home.model

import android.graphics.Bitmap

enum class WorkspaceTab(val label: String, val wire: String) {
    Chat("Conversation", "chat"), Lists("Lists", "lists"), Contacts("People", "contacts"),
    Wiki("Knowledge", "wiki"), Receipts("Receipts", "receipts"),
}
enum class InteractionMode(val label: String, val wire: String) {
    Conversation("Chat", "conversation"), Task("Get something done", "task"),
    BrainDump("Brain dump", "brain_dump"), Diagnostic("Explain a problem", "diagnostic"),
}
data class ConversationFocus(val kind: String, val id: String, val revision: Int? = null, val scope: String? = null, val label: String = "")
data class TaskStep(val text: String, val status: String)
data class TaskQuestion(val id: String, val text: String, val kind: String = "clarification", val approval: Boolean = false)
enum class ConversationActivity(val wire: String) {
    Idle("idle"), Queued("queued"), Dispatching("dispatching"), Running("running"),
}
data class TaskWorkspace(
    val mode: String = "conversation", val phase: String = "", val status: String = "", val goalId: String? = null,
    val objective: String = "", val progress: String = "", val steps: List<TaskStep> = emptyList(),
    val question: TaskQuestion? = null, val checkpointRevision: Int? = null, val runId: String? = null,
    val activity: ConversationActivity = ConversationActivity.Idle,
)
data class PendingAttachment(val id: String, val filename: String, val mimeType: String, val byteLength: Long, val status: String = "Ready")
data class ArtifactCard(
    val id: String, val filename: String, val mimeType: String, val audience: String, val kind: String,
    val byteLength: Long = 0, val contactId: String? = null, val conversationId: String? = null,
)
internal val rasterArtifactMimeTypes = setOf("image/png", "image/jpeg", "image/webp")

internal fun ArtifactCard.isConversationImage(conversationId: String): Boolean =
    this.conversationId == conversationId && contactId == null && kind == "output" && mimeType in rasterArtifactMimeTypes

data class MediaPreview(val title: String, val mimeType: String, val bitmap: Bitmap? = null, val text: String? = null, val contentUri: String? = null)
data class ListEntry(val id: String, val text: String, val kind: String = "shopping", val done: Boolean = false)
data class ContactCard(val id: String, val name: String, val organization: String, val revision: Int, val audience: String, val fields: Map<String,List<String>> = emptyMap())
data class ContactRevisionCard(val revision: Int, val reason: String, val createdAt: String, val fields: Map<String,List<String>>)
data class ContactDetail(val contact: ContactCard, val sources: List<ArtifactCard>, val revisions: List<ContactRevisionCard>, val uncertainties: List<String>)
data class WikiCard(val id: String, val title: String, val excerpt: String)
data class WikiPage(val id: String, val title: String, val body: String, val sourceLabels: List<String> = emptyList())
data class ReceiptReviewCard(val receiptId: String, val revision: Int, val title: String, val reasons: List<String>, val question: String = "")

data class DeliveryNotice(val id: String, val conversationId: String, val status: String, val title: String, val detail: String, val canRetry: Boolean = false)
