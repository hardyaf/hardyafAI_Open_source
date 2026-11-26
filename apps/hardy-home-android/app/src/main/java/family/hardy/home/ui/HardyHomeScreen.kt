package family.hardy.home.ui

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import family.hardy.home.data.MockHouseholdRepository
import family.hardy.home.model.ArtifactCard
import family.hardy.home.model.ChatMessage
import family.hardy.home.model.ConnectionMode
import family.hardy.home.model.ConversationActivity
import family.hardy.home.model.ConversationSummary
import family.hardy.home.model.DictationPhase
import family.hardy.home.model.DictationState
import family.hardy.home.model.HouseholdCapability
import family.hardy.home.model.HouseholdUiState
import family.hardy.home.model.MessageRole
import family.hardy.home.model.PersonStatus
import family.hardy.home.model.PersonSummary
import family.hardy.home.model.PromptPreset
import family.hardy.home.model.chatImages
import family.hardy.home.model.isConversationImage
import family.hardy.home.ui.theme.BrandBlue
import family.hardy.home.ui.theme.BrandBlueSoft
import family.hardy.home.ui.theme.AppCanvas
import family.hardy.home.ui.theme.Ink
import family.hardy.home.ui.theme.MutedInk
import family.hardy.home.ui.theme.OutlineSoft
import family.hardy.home.ui.theme.Success
import family.hardy.home.ui.theme.Warning
import family.hardy.home.ui.theme.HardyHomeTheme

private val panelShape = RoundedCornerShape(22.dp)
private val previewState = MockHouseholdRepository().state.value

@Composable
fun HardyHomeScreen(
    state: HouseholdUiState,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onAttachment: () -> Unit,
    onVoiceInput: () -> Unit,
    onServerUrlChange: (String) -> Unit,
    onEnrollmentCodeChange: (String) -> Unit,
    onEnroll: () -> Unit,
    onRefresh: () -> Unit,
    loadThumbnail: suspend (ArtifactCard) -> Bitmap? = { null },
    onOpenArtifact: (ArtifactCard) -> Unit = {},
    dictation: DictationState = DictationState(),
    onDiscardDictation: () -> Unit = {},
) {
    Surface(modifier = Modifier.fillMaxSize(), color = AppCanvas) {
        if (state.capabilities.isEmpty() && state.connectionMode != ConnectionMode.Connected) {
            EnrollmentScreen(
                state = state,
                onServerUrlChange = onServerUrlChange,
                onEnrollmentCodeChange = onEnrollmentCodeChange,
                onEnroll = onEnroll,
                onRefresh = onRefresh,
            )
        } else {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentAlignment = Alignment.TopCenter,
                ) {
                    key(state.selectedConversationId) {
                        val images = remember(state.artifacts, state.selectedConversationId) {
                            state.artifacts.filter { it.isConversationImage(state.selectedConversationId) }.associateBy { it.id }
                        }
                        TranscriptPanel(state.messages, images, loadThumbnail, onOpenArtifact, Modifier.widthIn(max = 760.dp).fillMaxSize())
                    }
                }
                ChatStatusRow(state)
                if (dictation.message.isNotBlank()) {
                    Row(
                        modifier = Modifier.widthIn(max = 760.dp).fillMaxWidth().padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(dictation.message, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        if (dictation.phase == DictationPhase.Saved) {
                            TextButton(onClick = onVoiceInput) { Text("Transcribe") }
                            TextButton(onClick = onDiscardDictation) { Text("Discard") }
                        }
                    }
                }
                Composer(state, onDraftChange, onSend, onAttachment, onVoiceInput, dictation)
            }
        }
    }
}

@Composable
private fun ChatStatusRow(state: HouseholdUiState) {
    val activity = when {
        state.connectionMode == ConnectionMode.Error -> null
        state.sending -> "Sending…"
        state.taskWorkspace.activity == ConversationActivity.Running -> "Jarvis is thinking…"
        state.taskWorkspace.activity == ConversationActivity.Dispatching -> "Starting request…"
        state.taskWorkspace.activity == ConversationActivity.Queued -> "Request queued"
        else -> null
    }
    val label = state.statusNotice ?: activity ?: return
    Row(
        modifier = Modifier.widthIn(max = 760.dp).fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 4.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (activity != null) {
            CircularProgressIndicator(Modifier.size(14.dp), color = BrandBlue, strokeWidth = 2.dp)
        }
        Text(label, color = BrandBlue, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun EnrollmentScreen(
    state: HouseholdUiState,
    onServerUrlChange: (String) -> Unit,
    onEnrollmentCodeChange: (String) -> Unit,
    onEnroll: () -> Unit,
    onRefresh: () -> Unit,
) {
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
    ) {
        Card(shape = panelShape, modifier = Modifier.widthIn(max = 520.dp)) {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.padding(24.dp),
            ) {
                Text("Connect Hardy Home", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    if (state.connectionMode == ConnectionMode.Error) {
                        "Leave the code blank to retry your saved enrollment. Enter a new invitation to enroll again."
                    } else {
                        "Enter your household address and the one-time invitation for your profile. Each phone connects separately."
                    },
                    color = MutedInk,
                )
                OutlinedTextField(
                    value = state.serverUrl,
                    onValueChange = onServerUrlChange,
                    label = { Text("Household service address") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = state.enrollmentCode,
                    onValueChange = onEnrollmentCodeChange,
                    label = { Text("One-time enrollment code") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                state.statusNotice?.let { Text(it, color = if (state.connectionMode == ConnectionMode.Error) Warning else BrandBlue) }
                Button(
                    onClick = if (state.connectionMode == ConnectionMode.Error && state.enrollmentCode.isBlank()) onRefresh else onEnroll,
                    enabled = state.connectionMode != ConnectionMode.Connecting,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        when {
                            state.connectionMode == ConnectionMode.Connecting -> "Connecting…"
                            state.connectionMode == ConnectionMode.Error && state.enrollmentCode.isBlank() -> "Retry connection"
                            else -> "Enroll this device"
                        },
                    )
                }
            }
        }
    }
}

@Composable
internal fun PersonStatusStrip(state: HouseholdUiState) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        state.people.forEach { person ->
            PersonStatusCard(person, state.currentProfile.id == person.id)
        }
    }
}

@Composable
private fun PersonStatusCard(person: PersonSummary, isCurrent: Boolean) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(
            if (isCurrent) 2.dp else 1.dp,
            if (isCurrent) BrandBlue else OutlineSoft,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(12.dp),
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(42.dp)
                    .clip(CircleShape)
                    .background(Color(person.color)),
            ) {
                Text(person.initials, color = Color.White, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(person.displayName, fontWeight = FontWeight.SemiBold)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(statusColor(person.status)),
                    )
                    Spacer(Modifier.width(5.dp))
                    Text(statusLabel(person.status), fontSize = 12.sp, color = MutedInk)
                }
            }
        }
    }
}

@Composable
private fun TranscriptPanel(
    messages: List<ChatMessage>,
    authorizedImages: Map<String, ArtifactCard>,
    loadThumbnail: suspend (ArtifactCard) -> Bitmap?,
    onOpenArtifact: (ArtifactCard) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (messages.isEmpty()) {
        Box(modifier = modifier, contentAlignment = Alignment.Center) {
            Text("Start a conversation", color = MutedInk, style = MaterialTheme.typography.bodyLarge)
        }
    } else {
        val listState = rememberLazyListState()
        val newestMessage = remember { mutableStateOf<String?>(null) }
        val latestId = messages.last().id
        SideEffect {
            if (latestId != newestMessage.value) {
                val showingLatest = listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset == 0
                if (newestMessage.value == null || showingLatest) listState.requestScrollToItem(0)
                newestMessage.value = latestId
            }
        }
        LazyColumn(
            state = listState,
            reverseLayout = true,
            verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Bottom),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
            modifier = modifier,
        ) {
            items(messages.asReversed(), key = { it.id }) { message ->
                val images = remember(message, authorizedImages) { chatImages(message, authorizedImages) }
                MessageBubble(message, images, loadThumbnail, onOpenArtifact)
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: ChatMessage,
    images: List<ArtifactCard>,
    loadThumbnail: suspend (ArtifactCard) -> Bitmap?,
    onOpenArtifact: (ArtifactCard) -> Unit,
) {
    val fromUser = message.role == MessageRole.User
    Row(
        horizontalArrangement = if (fromUser) Arrangement.End else Arrangement.Start,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            horizontalAlignment = if (fromUser) Alignment.End else Alignment.Start,
            modifier = Modifier.widthIn(max = if (fromUser) 560.dp else 680.dp),
        ) {
            SelectionContainer {
                Text(
                    text = message.text,
                    color = if (fromUser) Color.White else Ink,
                    fontSize = 16.sp,
                    lineHeight = 24.sp,
                    modifier = Modifier
                        .clip(
                            RoundedCornerShape(
                                topStart = 18.dp,
                                topEnd = 18.dp,
                                bottomStart = if (fromUser) 18.dp else 4.dp,
                                bottomEnd = if (fromUser) 4.dp else 18.dp,
                            ),
                        )
                        .background(if (fromUser) BrandBlue else Color.White)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
            images.forEach { artifact ->
                key(artifact.id) {
                    ChatImageThumbnail(artifact, loadThumbnail, onOpenArtifact, Modifier.padding(top = 6.dp))
                }
            }
            Text(message.timeLabel, color = MutedInk, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
internal fun DiagnosticsPanel(state: HouseholdUiState) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF172033)),
        shape = panelShape,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text("Diagnostics", color = Color(0xFF9FB4FF), fontWeight = FontWeight.Bold)
            Text(state.diagnostics.gateway, color = Color.White)
            Text(state.diagnostics.model, color = Color.White)
            Text(state.diagnostics.gpu, color = Color.White)
            Text(state.diagnostics.memory, color = Color.White)
            val running = state.people.count { it.status == PersonStatus.Working }
            val queued = state.people.count { it.status == PersonStatus.Queued }
            Text("$running / ${state.maxActiveRuns} running · $queued queued", color = Color(0xFFFFC77D))
        }
    }
}

@Composable
private fun Composer(
    state: HouseholdUiState,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onAttachment: () -> Unit,
    onVoiceInput: () -> Unit,
    dictation: DictationState,
) {
    val focusManager = LocalFocusManager.current
    val writable = state.conversations.firstOrNull { it.id == state.selectedConversationId }?.canWrite != false
    val canSend = !dictation.blocksSend && !state.sending && writable &&
        (state.draft.isNotBlank() || state.attachments.isNotEmpty()) && HouseholdCapability.Chat in state.capabilities
    Surface(color = Color.White, shadowElevation = 2.dp) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .widthIn(max = 760.dp)
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 6.dp),
        ) {
            if (HouseholdCapability.AttachImages in state.capabilities && !state.sending && writable && !dictation.blocksSend) ComposerButton("+", "Attach a photo or document", onAttachment)
            OutlinedTextField(
                value = state.draft,
                enabled = !state.sending && writable,
                onValueChange = onDraftChange,
                placeholder = { Text("Ask ${state.currentProfile.displayName}'s agent…") },
                maxLines = 5,
                keyboardActions = KeyboardActions(onDone = {
                    if (canSend) onSend()
                    focusManager.clearFocus()
                }),
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.weight(1f),
            )
            if (HouseholdCapability.VoiceInput in state.capabilities && writable && !state.sending) {
                when (dictation.phase) {
                    DictationPhase.Recording -> OutlinedButton(onClick = onVoiceInput) { Text("Stop") }
                    DictationPhase.Idle -> ComposerButton("🎙", "Start recording", onVoiceInput)
                    DictationPhase.Transcribing, DictationPhase.Saved -> Unit
                }
            }
            Button(
                onClick = onSend,
                enabled = canSend,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.heightIn(min = 48.dp),
                contentPadding = PaddingValues(horizontal = 12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = BrandBlue),
            ) {
                Text("Send")
            }
        }
    }
}

@Composable
private fun ComposerButton(label: String, description: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        contentPadding = PaddingValues(0.dp),
        modifier = Modifier.size(48.dp).semantics { contentDescription = description },
    ) {
        Text(label, fontSize = 18.sp)
    }
}

@Composable
internal fun ConversationDrawerContent(
    state: HouseholdUiState,
    onNewConversation: () -> Unit,
    onNewSharedConversation: () -> Unit,
    onConversationSelected: (String) -> Unit,
    onPresetSelected: (String) -> Unit,
    onEditConversation: (String) -> Unit,
) {
    Button(
        onClick = onNewConversation,
        enabled = !state.sending,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
    ) {
        Text("New private chat")
    }
    if (state.currentProfile.role != "child") {
        OutlinedButton(
            onClick = onNewSharedConversation,
            enabled = !state.sending,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
        ) {
            Text("New household chat")
        }
    }
    RailHeading("CONVERSATIONS")
    state.conversations.forEach { conversation ->
        ConversationRow(
            conversation = conversation,
            selected = conversation.id == state.selectedConversationId,
            enabled = !state.sending,
            onClick = { onConversationSelected(conversation.id) },
            onEdit = if (conversation.canWrite) { { onEditConversation(conversation.id) } } else null,
        )
    }
    if (state.presets.isNotEmpty()) {
        RailHeading("PROMPT FLAVORS")
        state.presets.forEach { preset ->
            PresetRow(
                preset = preset,
                selected = preset.id == state.selectedPresetId,
                enabled = !state.sending,
                onClick = { onPresetSelected(preset.id) },
            )
        }
    }
    Text(
        "Your profile and private conversations belong to you. Shared conversations and household lists are visible to your household.",
        color = MutedInk,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.padding(vertical = 8.dp),
    )
}

@Composable
private fun RailHeading(text: String) {
    Text(text, color = MutedInk, fontWeight = FontWeight.Bold, fontSize = 11.sp, modifier = Modifier.padding(top = 12.dp, bottom = 2.dp))
}

@Composable
private fun ConversationRow(
    conversation: ConversationSummary,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
    onEdit: (() -> Unit)?,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) BrandBlueSoft else Color.Transparent)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(12.dp),
    ) {
        Text(if (conversation.isShared) "⌂" else "◯", color = if (selected) BrandBlue else MutedInk)
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(conversation.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
            if (conversation.tags.isNotEmpty()) {
                Text(conversation.tags.joinToString(" · "), maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = MutedInk, fontSize = 11.sp)
            }
            Text(conversation.subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MutedInk, fontSize = 11.sp)
        }
        if (onEdit != null) TextButton(onClick = onEdit, enabled = enabled) { Text("Edit") }
    }
}

@Composable
private fun PresetRow(preset: PromptPreset, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .border(1.dp, if (selected) BrandBlue else OutlineSoft, RoundedCornerShape(14.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(12.dp),
    ) {
        Text(preset.label, fontWeight = FontWeight.SemiBold)
        Text(preset.description, color = MutedInk, style = MaterialTheme.typography.bodySmall)
    }
}

private fun statusColor(status: PersonStatus): Color = when (status) {
    PersonStatus.Available -> Success
    PersonStatus.Working -> BrandBlue
    PersonStatus.Queued -> Warning
    PersonStatus.Paused -> Warning
    PersonStatus.Offline -> Color(0xFF9AA1AF)
}

private fun statusLabel(status: PersonStatus): String = when (status) {
    PersonStatus.Available -> "Ready"
    PersonStatus.Working -> "Working"
    PersonStatus.Queued -> "Queued"
    PersonStatus.Paused -> "Paused"
    PersonStatus.Offline -> "Offline"
}

@Preview(widthDp = 390, heightDp = 800, showBackground = true)
@Preview(widthDp = 1100, heightDp = 720, showBackground = true)
@Composable
private fun HardyHomeChatPreview() {
    HardyHomeTheme {
        HardyHomeScreen(
            state = previewState,
            onDraftChange = {},
            onSend = {},
            onAttachment = {},
            onVoiceInput = {},
            onServerUrlChange = {},
            onEnrollmentCodeChange = {},
            onEnroll = {},
            onRefresh = {},
        )
    }
}
