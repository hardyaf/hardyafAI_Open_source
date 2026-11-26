package family.hardy.home.model

private val artifactMention = Regex(
    """(?<![\p{L}\p{N}._:/?=&%#-])artifact-[a-f0-9]{64}(?![\p{L}\p{N}_:/?=&%#-]|\.[a-zA-Z0-9])""",
)

/** The signed workspace supplies the image and audience. A reply can only refer to an exact ID. */
internal fun chatImages(message: ChatMessage, authorizedImages: Map<String, ArtifactCard>): List<ArtifactCard> {
    if (message.role != MessageRole.Assistant || authorizedImages.isEmpty()) return emptyList()
    return artifactMention.findAll(message.text)
        .mapNotNull { authorizedImages[it.value] }
        .distinctBy { it.id }
        .take(4)
        .toList()
}
