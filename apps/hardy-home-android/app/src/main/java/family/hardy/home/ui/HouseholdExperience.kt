package family.hardy.home.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import family.hardy.home.data.HouseholdRepository
import family.hardy.home.model.*
import family.hardy.home.ui.theme.AppCanvas
import kotlinx.coroutines.launch

/** Presentation of server-owned tasks and resources. Controls keep their existing permissions. */
@Composable
fun HouseholdExperience(
    state: HouseholdUiState,
    repository: HouseholdRepository,
    onPick: () -> Unit,
    onCamera: () -> Unit,
    onVoice: () -> Unit,
    onEnroll: () -> Unit,
    dictation: DictationState = DictationState(),
    onDiscardDictation: () -> Unit = {},
    onNewReceipt: () -> Unit = {},
    onHouseholdFinances: () -> Unit = {},
    onConnections: () -> Unit = {},
) {
    var attachmentMenu by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<String?>(null) }
    var editingConversationId by rememberSaveable { mutableStateOf<String?>(null) }
    val connected = state.capabilities.isNotEmpty()
    val isChat = state.workspaceTab == WorkspaceTab.Chat
    var detailsOpen by rememberSaveable(connected, isChat) { mutableStateOf(false) }

    val chat: @Composable () -> Unit = {
        HardyHomeScreen(
            state = state,
            onDraftChange = repository::setDraft,
            onSend = repository::sendDraft,
            onAttachment = { if (!state.sending && HouseholdCapability.AttachImages in state.capabilities) attachmentMenu = true },
            onVoiceInput = onVoice,
            dictation = dictation,
            onDiscardDictation = onDiscardDictation,
            onServerUrlChange = repository::setServerUrl,
            onEnrollmentCodeChange = repository::setEnrollmentCode,
            onEnroll = onEnroll,
            onRefresh = repository::refresh,
            loadThumbnail = repository::loadArtifactThumbnail,
            onOpenArtifact = repository::openArtifact,
        )
    }

    if (connected) {
        Surface(color = AppCanvas) {
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
                HouseholdToolbar(
                    state = state,
                    onNavigation = { detailsOpen = false; repository.setDrawerOpen(true) },
                    onDetails = { repository.setDrawerOpen(false); detailsOpen = true },
                )
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    if (isChat) chat() else HouseholdLibraryScreen(state, repository)
                }
            }
        }
    } else {
        chat()
    }

    if (connected && detailsOpen && isChat) {
        HouseholdDrawer("Chat details", atEnd = true, onClose = { detailsOpen = false }) {
            WorkspacePanel(state, repository, close = { detailsOpen = false }, confirm = { confirm = it })
        }
    } else if (connected && state.drawerOpen) {
        HouseholdDrawer("Hardy Home", atEnd = false, onClose = { repository.setDrawerOpen(false) }) {
            WorkspaceTab.entries.filter { it == WorkspaceTab.Chat || it.wire in state.availableViews }.forEach { tab ->
                NavigationDrawerItem(
                    label = { Text(tab.label) },
                    selected = state.workspaceTab == tab,
                    onClick = { repository.setWorkspaceTab(tab); repository.setDrawerOpen(false) },
                )
            }
            HorizontalDivider(Modifier.padding(vertical = 10.dp))
            if (state.currentProfile.id in setOf("alex", "natasha") && HouseholdCapability.Chat in state.capabilities) {
                Button(
                    onClick = { repository.setDrawerOpen(false); onNewReceipt() },
                    enabled = !dictation.blocksSend,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("New receipt") }
                TextButton(
                    onClick = { repository.setDrawerOpen(false); onHouseholdFinances() },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Household finances") }
            }
            if (state.currentProfile.role == "admin" && HouseholdCapability.ManageAccess in state.capabilities) {
                TextButton(onClick = { repository.setDrawerOpen(false); onConnections() }, modifier = Modifier.fillMaxWidth()) { Text("Connections") }
            }
            ConversationDrawerContent(
                state = state,
                onNewConversation = {
                    repository.setWorkspaceTab(WorkspaceTab.Chat)
                    repository.setDrawerOpen(false)
                    repository.createConversation()
                },
                onNewSharedConversation = {
                    repository.setWorkspaceTab(WorkspaceTab.Chat)
                    repository.setDrawerOpen(false)
                    repository.createSharedConversation()
                },
                onConversationSelected = { conversationId ->
                    repository.setWorkspaceTab(WorkspaceTab.Chat)
                    repository.setDrawerOpen(false)
                    repository.selectConversation(conversationId)
                },
                onPresetSelected = repository::selectPreset,
                onEditConversation = { editingConversationId = it },
            )
            HorizontalDivider(Modifier.padding(vertical = 10.dp))
            Text("Household status", style = MaterialTheme.typography.titleSmall)
            PersonStatusStrip(state)
            TextButton(onClick = { repository.setDrawerOpen(false); repository.refresh() }) { Text("Refresh") }
            TextButton(onClick = { repository.setDrawerOpen(false); confirm = "disconnect" }) { Text("Disconnect phone") }
        }
    }

    if (connected) state.conversations.firstOrNull { it.id == editingConversationId && it.canWrite }?.let { conversation ->
        key(conversation.id) {
            ConversationMetadataDialog(
                conversation = conversation,
                onClose = { editingConversationId = null },
                onSave = { title, tags -> repository.updateConversationMetadata(conversation.id, title, tags) },
            )
        }
    }
    if (connected && attachmentMenu) AlertDialog(
        onDismissRequest = { attachmentMenu = false },
        title = { Text("Add a photo or document") },
        text = { Text("Attach a business card, receipt, or another document. Tell Jarvis what you would like done with it.") },
        confirmButton = { TextButton(onClick = { attachmentMenu = false; onCamera() }) { Text("Take photo") } },
        dismissButton = { TextButton(onClick = { attachmentMenu = false; onPick() }) { Text("Choose file") } },
    )
    confirm?.let { action ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(when (action) {
                "disconnect" -> "Disconnect this phone?"
                "complete" -> "Mark this goal complete?"
                else -> "Stop this task?"
            }) },
            text = { Text(when (action) {
                "disconnect" -> "Private previews and drafts on this phone will be cleared. A new invitation is needed to reconnect."
                "complete" -> "Jarvis will record your instruction to end this goal."
                else -> "Jarvis will stop the current task. Actions already completed remain recorded."
            }) },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    when (action) {
                        "disconnect" -> repository.forgetDevice()
                        "complete" -> repository.controlGoal("complete")
                        else -> repository.cancelTask()
                    }
                }) { Text("Confirm") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Keep going") } },
        )
    }
    if (connected) state.preview?.let { ArtifactPreviewDialog(it, repository::closePreview) }
}

@Composable
private fun ConversationMetadataDialog(
    conversation: ConversationSummary,
    onClose: () -> Unit,
    onSave: suspend (String, List<String>) -> String?,
) {
    var title by rememberSaveable { mutableStateOf(conversation.title) }
    var tagText by rememberSaveable { mutableStateOf(conversation.tags.joinToString(", ")) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val tags = tagText.split(',').map(String::trim).filter(String::isNotEmpty)
        .distinctBy { it.lowercase() }
    val valid = title.isNotBlank() && title.trim().length <= 120 &&
        tags.size <= 8 && tags.all { it.length <= 32 && it.none(Char::isISOControl) }
    AlertDialog(
        onDismissRequest = { if (!saving) onClose() },
        title = { Text("Name and tags") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it; error = null },
                    label = { Text("Conversation name") },
                    singleLine = true,
                    enabled = !saving,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = tagText,
                    onValueChange = { tagText = it; error = null },
                    label = { Text("Tags") },
                    supportingText = { Text("Separate up to 8 tags with commas. Each tag can be up to 32 characters.") },
                    singleLine = true,
                    enabled = !saving,
                    modifier = Modifier.fillMaxWidth(),
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = valid && !saving,
                onClick = {
                    saving = true
                    scope.launch {
                        error = onSave(title.trim(), tags)
                        saving = false
                        if (error == null) onClose()
                    }
                },
            ) { Text(if (saving) "Saving…" else "Save") }
        },
        dismissButton = { TextButton(enabled = !saving, onClick = onClose) { Text("Cancel") } },
    )
}

@Composable
private fun HouseholdToolbar(state: HouseholdUiState, onNavigation: () -> Unit, onDetails: () -> Unit) {
    val conversation = state.conversations.firstOrNull { it.id == state.selectedConversationId }
    val isChat = state.workspaceTab == WorkspaceTab.Chat
    val subtitle = if (isChat) listOfNotNull(
        conversation?.let { if (it.isShared) "Household" else "Private" },
        state.interactionMode.takeIf { it != InteractionMode.Conversation }?.label,
    ).joinToString(" · ").ifBlank { "Hardy Home" } else "Hardy Home"
    val detailNotice = when {
        state.taskWorkspace.question?.approval == true -> "Approval needed"
        state.taskWorkspace.question != null && state.replyingToQuestionId == state.taskWorkspace.question.id -> "Reply linked"
        state.taskWorkspace.question != null -> "Jarvis has a question"
        state.deliveryNotices.any { it.conversationId == state.selectedConversationId } -> "Delivery updates"
        state.attachments.isNotEmpty() -> "${state.attachments.size} attached"
        state.focus != null -> "Context linked"
        else -> null
    }

    Surface(color = MaterialTheme.colorScheme.surface) {
        Column {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onNavigation) {
                    Text("☰", fontSize = 22.sp, modifier = Modifier.clearAndSetSemantics {
                        contentDescription = "Open navigation"
                    })
                }
                Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                    Text(
                        if (isChat) conversation?.title ?: "Hardy Home" else state.workspaceTab.label,
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(subtitle, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (isChat) {
                    TextButton(onClick = onDetails) {
                        Column(horizontalAlignment = Alignment.End) {
                            Text("Details")
                            detailNotice?.let {
                                Text(it, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                            }
                        }
                    }
                }
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun HouseholdDrawer(title: String, atEnd: Boolean, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            Box(
                Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.24f))
                    .clickable(onClick = onClose)
                    .semantics { contentDescription = "Close ${title.lowercase()}" },
            )
            Surface(
                modifier = Modifier.align(if (atEnd) Alignment.CenterEnd else Alignment.CenterStart)
                    .width(minOf(maxWidth * 0.9f, 400.dp)).fillMaxHeight()
                    .semantics { paneTitle = title },
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 3.dp,
                shadowElevation = 12.dp,
            ) {
                Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                        TextButton(onClick = onClose) { Text("Close") }
                    }
                    HorizontalDivider()
                    Column(
                        Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                        content = content,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WorkspacePanel(state: HouseholdUiState, repository: HouseholdRepository, close: () -> Unit, confirm: (String) -> Unit) {
    var progressExpanded by remember(state.selectedConversationId) { mutableStateOf(false) }
    val task = state.taskWorkspace
    val adult = state.currentProfile.role != "child"
    val shared = state.conversations.firstOrNull { it.id == state.selectedConversationId }?.isShared == true
    val diagnosticsAllowed = HouseholdCapability.ViewDiagnostics in state.capabilities

    DeliveryNotices(state, repository)
    task.question?.let { question ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (question.approval) "Your approval is needed" else "Jarvis has a question", style = MaterialTheme.typography.titleSmall)
                Text(question.text)
                FlowRow {
                    if (question.approval && adult) {
                        TextButton(onClick = { repository.answerApproval(true) }, enabled = !state.sending) { Text("Approve") }
                        TextButton(onClick = { repository.answerApproval(false) }, enabled = !state.sending) { Text("Decline") }
                    }
                    val linked = state.replyingToQuestionId == question.id
                    TextButton(onClick = { repository.replyToQuestion(!linked); close() }, enabled = !state.sending) {
                        Text(if (linked) "Unlink next reply" else "Link my next reply")
                    }
                }
            }
        }
    }

    Text("Message mode", style = MaterialTheme.typography.titleSmall)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        InteractionMode.entries.filter { mode ->
            (adult || mode == InteractionMode.Conversation) &&
                (mode != InteractionMode.Diagnostic || diagnosticsAllowed)
        }.forEach { mode ->
            FilterChip(
                selected = state.interactionMode == mode,
                enabled = !state.sending,
                onClick = { repository.setMode(mode) },
                label = { Text(mode.label) },
            )
        }
    }
    when (state.interactionMode) {
        InteractionMode.BrainDump -> Text(
            "Jarvis can carry out clear items and ask about uncertain details. ${if (shared) "This conversation is shared." else "This conversation is private."}",
            style = MaterialTheme.typography.bodySmall,
        )
        InteractionMode.Diagnostic -> Text("Jarvis can explain logs and suggest repairs.", style = MaterialTheme.typography.bodySmall)
        else -> Unit
    }

    if (task.status.isNotBlank()) {
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        TextButton(onClick = { progressExpanded = !progressExpanded }) {
            Text("Task: ${task.status.replace('_', ' ')} ${if (progressExpanded) "▴" else "▾"}")
        }
    }
    if (progressExpanded) {
        if (task.objective.isNotBlank()) Text(task.objective, style = MaterialTheme.typography.titleSmall)
        if (task.progress.isNotBlank()) Text(task.progress)
        task.steps.forEach { Text("${it.status.replace('_', ' ')} · ${it.text}", style = MaterialTheme.typography.bodySmall) }
        task.checkpointRevision?.let { Text("Progress saved · update $it", style = MaterialTheme.typography.labelSmall) }
        FlowRow {
            if (adult && task.goalId != null && task.status !in listOf("complete", "completed", "cancelled", "failed")) {
                val paused = task.status == "paused" || task.phase == "paused"
                TextButton(onClick = { repository.controlGoal(if (paused) "resume" else "pause") }, enabled = !state.sending) { Text(if (paused) "Resume" else "Pause") }
                TextButton(onClick = { close(); confirm("complete") }, enabled = !state.sending) { Text("Finish goal") }
            }
            if (adult && (task.goalId != null || task.runId != null) && task.status !in listOf("complete", "completed", "cancelled")) {
                TextButton(onClick = { close(); confirm("stop") }, enabled = !state.sending) { Text("Stop task") }
            }
        }
    }

    state.focus?.let { focus ->
        ListItem(
            headlineContent = { Text(focus.label) },
            supportingContent = { Text("Context for this conversation") },
            trailingContent = { TextButton(onClick = repository::clearFocus, enabled = !state.sending) { Text("Clear") } },
        )
    }
    if (state.attachments.isNotEmpty()) {
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        Text("Attachments to send", style = MaterialTheme.typography.titleSmall)
        state.attachments.forEach { attachment ->
            ListItem(
                headlineContent = { Text(attachment.filename, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                trailingContent = { TextButton(onClick = { repository.removeAttachment(attachment.id) }, enabled = !state.sending) { Text("Remove") } },
            )
        }
    }
    if (state.artifacts.isNotEmpty()) {
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        Text("Files in this chat", style = MaterialTheme.typography.titleSmall)
        state.artifacts.forEach { artifact ->
            ListItem(
                headlineContent = { Text(artifact.filename, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                supportingContent = { Text(if (artifact.audience == "household") "Shared" else "Private") },
                modifier = Modifier.clickable { close(); repository.openArtifact(artifact) },
            )
        }
    }
    if (diagnosticsAllowed) {
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        TextButton(onClick = { repository.setDiagnosticsVisible(!state.diagnosticsVisible) }) {
            Text(if (state.diagnosticsVisible) "Hide diagnostics" else "Show diagnostics")
        }
        if (state.diagnosticsVisible) DiagnosticsPanel(state)
    }
}
