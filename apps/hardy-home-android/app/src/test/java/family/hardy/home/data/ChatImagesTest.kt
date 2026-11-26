package family.hardy.home.data

import family.hardy.home.model.ArtifactCard
import family.hardy.home.model.ChatMessage
import family.hardy.home.model.MessageRole
import family.hardy.home.model.chatImages
import family.hardy.home.model.isConversationImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatImagesTest {
    private val chat = "conv-current"
    private val dog = image('a')

    @Test fun matchesAnExactAssistantReferenceOnce() {
        val reply = message("I saved **`/tmp/dog.png`**.\n\n**Artifact ID:** `${dog.id}`\n\nMEDIA:/tmp/dog.png\n\n${dog.id}.")
        assertEquals(listOf(dog), chatImages(reply, mapOf(dog.id to dog)))
    }

    @Test fun ignoresUserTextUnknownIdsAndPathOrUrlComponents() {
        val references = mapOf(dog.id to dog)
        assertTrue(chatImages(message(dog.id, MessageRole.User), references).isEmpty())
        assertTrue(chatImages(message(image('b').id), references).isEmpty())
        val reply = message("/tmp/${dog.id} ${dog.id}.png ${dog.id}b https://example.test/?id=${dog.id} x${dog.id}")
        assertTrue(chatImages(reply, references).isEmpty())
    }

    @Test fun onlyWorkspaceImageOutputsInTheSelectedConversationQualify() {
        assertTrue(dog.isConversationImage(chat))
        assertTrue(listOf(
            dog.copy(conversationId = "conv-other"), dog.copy(conversationId = null),
            dog.copy(contactId = "contact-other"), dog.copy(kind = "input"), dog.copy(mimeType = "image/svg+xml"),
        ).none { it.isConversationImage(chat) })
    }

    @Test fun boundsMultipleImagesInReplyOrder() {
        val outputs = "abcde".map(::image)
        val reply = message(outputs.asReversed().joinToString(" ") { it.id })
        assertEquals(outputs.asReversed().take(4), chatImages(reply, outputs.associateBy { it.id }))
    }

    private fun message(text: String, role: MessageRole = MessageRole.Assistant) = ChatMessage("message", role, text, "Now")

    private fun image(id: Char) = ArtifactCard(
        "artifact-${id.toString().repeat(64)}", "dog.png", "image/png", "private", "output", 1079, conversationId = chat,
    )
}
