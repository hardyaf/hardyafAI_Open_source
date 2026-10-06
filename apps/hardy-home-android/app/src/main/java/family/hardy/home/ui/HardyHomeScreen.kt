package family.hardy.home.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import family.hardy.home.data.MockHouseholdRepository
import family.hardy.home.model.ChatMessage
import family.hardy.home.model.ConnectionMode
import family.hardy.home.model.ConversationSummary
import family.hardy.home.model.HouseholdCapability
import family.hardy.home.model.HouseholdUiState
import family.hardy.home.model.MessageRole
import family.hardy.home.model.PersonStatus
import family.hardy.home.model.PersonSummary
import family.hardy.home.model.PromptPreset
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
    onNewConversation: () -> Unit,
    onConversationSelected: (String) -> Unit,
    onPresetSelected: (String) -> Unit,
    onDrawerChange: (Boolean) -> Unit,
    onDiagnosticsChange: (Boolean) -> Unit,
    onAttachment: () -> Unit,
    onVoiceInput: () -> Unit,
    onServerUrlChange: (String) -> Unit,
    onEnrollmentCodeChange: (String) -> Unit,
    onEnroll: () -> Unit,
    onRefresh: () -> Unit,
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
        } else BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding(),
        ) {
            val tablet = maxWidth >= 840.dp
            Row(modifier = Modifier.fillMaxSize()) {
                if (tablet) {
                    HouseholdRail(
                        state = state,
                        width = 300.dp,
                        onNewConversation = onNewConversation,
                        onConversationSelected = onConversationSelected,
                        onPresetSelected = onPresetSelected,
                    )
                }

                HouseholdWorkspace(
                    state = state,
                    tablet = tablet,
                    onMenu = { onDrawerChange(true) },
                    onDraftChange = onDraftChange,
                    onSend = onSend,
                    onAttachment = onAttachment,
                    onVoiceInput = onVoiceInput,
                    onDiagnosticsChange = onDiagnosticsChange,
                    modifier = Modifier.weight(1f),
                )
            }

            if (!tablet && state.drawerOpen) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.28f))
                        .clickable { onDrawerChange(false) },
                )
                HouseholdRail(
                    state = state,
                    width = minOf(maxWidth * 0.88f, 360.dp),
                    onNewConversation = onNewConversation,
                    onConversationSelected = onConversationSelected,
                    onPresetSelected = onPresetSelected,
                    modifier = Modifier.fillMaxHeight(),
                )
            }
        }
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
                    "Run the Alex invitation command on hardybot, then enter the one-time code here. This phone creates its own protected signing key.",
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
private fun HouseholdWorkspace(
    state: HouseholdUiState,
    tablet: Boolean,
    onMenu: () -> Unit,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
    onAttachment: () -> Unit,
    onVoiceInput: () -> Unit,
    onDiagnosticsChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxHeight()) {
        AppHeader(
            state = state,
            showMenu = !tablet,
            onMenu = onMenu,
            onDiagnosticsChange = onDiagnosticsChange,
        )
        PersonStatusStrip(state)

        val selected = state.conversations.firstOrNull { it.id == state.selectedConversationId }
        Column(
            modifier = Modifier
                .padding(horizontal = if (tablet) 22.dp else 12.dp)
                .padding(bottom = 10.dp)
                .weight(1f),
        ) {
            TranscriptPanel(
                title = selected?.title ?: "New conversation",
                messages = state.messages,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.height(10.dp))
            if (state.diagnosticsVisible) {
                DiagnosticsPanel(state)
            } else if (state.selectedPresetId != null) {
                PresetContextPanel(state)
            }
        }

        state.statusNotice?.let { notice ->
            Text(
                text = notice,
                color = BrandBlue,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp),
            )
        }
        Composer(
            state = state,
            onDraftChange = onDraftChange,
            onSend = onSend,
            onAttachment = onAttachment,
            onVoiceInput = onVoiceInput,
        )
    }
}

@Composable
private fun AppHeader(
    state: HouseholdUiState,
    showMenu: Boolean,
    onMenu: () -> Unit,
    onDiagnosticsChange: (Boolean) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        if (showMenu) {
            Text(
                text = "☰",
                fontSize = 24.sp,
                modifier = Modifier
                    .clip(CircleShape)
                    .clickable(onClick = onMenu)
                    .padding(10.dp),
            )
            Spacer(Modifier.width(8.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text("Hardy Home", fontWeight = FontWeight.Bold, fontSize = 21.sp)
            Text(
                "${state.maxActiveRuns} household turns can work at once",
                color = MutedInk,
                fontSize = 13.sp,
            )
        }
        if (HouseholdCapability.ViewDiagnostics in state.capabilities) {
            OutlinedButton(
                onClick = { onDiagnosticsChange(!state.diagnosticsVisible) },
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(if (state.diagnosticsVisible) "Chat" else "Diagnostics")
            }
        }
    }
}

@Composable
private fun PersonStatusStrip(state: HouseholdUiState) {
    val scroll = rememberScrollState()
    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(scroll)
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .padding(bottom = 10.dp),
    ) {
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
        modifier = Modifier.width(178.dp),
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
private fun TranscriptPanel(title: String, messages: List<ChatMessage>, modifier: Modifier = Modifier) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = panelShape,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.padding(horizontal = 18.dp, vertical = 14.dp)) {
                Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text("Private conversation · saved on Hardybot", color = MutedInk, fontSize = 12.sp)
            }
            HorizontalDivider(color = OutlineSoft)
            if (messages.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Start a conversation", fontWeight = FontWeight.SemiBold)
                        Text("Ask something or choose a prompt flavor.", color = MutedInk)
                    }
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(16.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(messages, key = { it.id }) { message ->
                        MessageBubble(message)
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    val fromUser = message.role == MessageRole.User
    Row(
        horizontalArrangement = if (fromUser) Arrangement.End else Arrangement.Start,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            horizontalAlignment = if (fromUser) Alignment.End else Alignment.Start,
            modifier = Modifier.widthIn(max = 560.dp),
        ) {
            Text(
                text = message.text,
                color = if (fromUser) Color.White else Ink,
                lineHeight = 21.sp,
                modifier = Modifier
                    .clip(
                        RoundedCornerShape(
                            topStart = 18.dp,
                            topEnd = 18.dp,
                            bottomStart = if (fromUser) 18.dp else 4.dp,
                            bottomEnd = if (fromUser) 4.dp else 18.dp,
                        ),
                    )
                    .background(if (fromUser) BrandBlue else Color(0xFFF0F2F7))
                    .padding(horizontal = 15.dp, vertical = 11.dp),
            )
            Text(message.timeLabel, color = MutedInk, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun PresetContextPanel(state: HouseholdUiState) {
    val preset = state.presets.firstOrNull { it.id == state.selectedPresetId } ?: return
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFFEEF7F1)),
        shape = panelShape,
        modifier = Modifier
            .fillMaxWidth()
            .height(154.dp),
    ) {
        Row(modifier = Modifier.fillMaxSize()) {
            if (preset.id == "ayso") {
                SoccerField(
                    modifier = Modifier
                        .width(190.dp)
                        .fillMaxHeight(),
                )
            }
            Column(
                verticalArrangement = Arrangement.Center,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .padding(18.dp),
            ) {
                Text("Conversation flavor", color = Success, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text(preset.label, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text(preset.description, color = MutedInk, fontSize = 13.sp)
                Spacer(Modifier.height(6.dp))
                Text("The service supplies the maintained context; the phone sends only this preset ID.", fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun SoccerField(modifier: Modifier = Modifier) {
    Canvas(modifier = modifier.background(Color(0xFF4D9B61))) {
        val stroke = Stroke(width = 3f)
        val inset = 16f
        drawRect(
            color = Color.White.copy(alpha = 0.86f),
            topLeft = Offset(inset, inset),
            size = androidx.compose.ui.geometry.Size(size.width - inset * 2, size.height - inset * 2),
            style = stroke,
        )
        drawLine(Color.White.copy(alpha = 0.86f), Offset(size.width / 2, inset), Offset(size.width / 2, size.height - inset), strokeWidth = 3f, cap = StrokeCap.Round)
        drawCircle(Color.White.copy(alpha = 0.86f), radius = size.minDimension * 0.16f, center = center, style = stroke)
        drawCircle(Color.White, radius = 4f, center = center)
    }
}

@Composable
private fun DiagnosticsPanel(state: HouseholdUiState) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF172033)),
        shape = panelShape,
        modifier = Modifier
            .fillMaxWidth()
            .height(174.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(18.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(18.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Alex diagnostics", color = Color(0xFF9FB4FF), fontWeight = FontWeight.Bold)
                Text(state.diagnostics.gateway, color = Color.White, modifier = Modifier.padding(top = 8.dp))
                Text(state.diagnostics.model, color = Color.White)
                Text(state.diagnostics.gpu, color = Color.White)
                Text(state.diagnostics.memory, color = Color.White)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("RUNS", color = Color(0xFF9EA9BD), fontSize = 11.sp)
                Text(
                    "${state.people.count { it.status == PersonStatus.Working }} / ${state.maxActiveRuns}",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 30.sp,
                )
                Text("${state.people.count { it.status == PersonStatus.Queued }} queued", color = Color(0xFFFFC77D))
            }
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
) {
    val focusManager = LocalFocusManager.current
    Surface(color = Color.White, shadowElevation = 10.dp) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            ComposerButton("＋", "Add image", onAttachment)
            OutlinedTextField(
                value = state.draft,
                onValueChange = onDraftChange,
                placeholder = { Text("Ask ${state.currentProfile.displayName}'s agent…") },
                maxLines = 6,
                keyboardActions = KeyboardActions(onDone = {
                    onSend()
                    focusManager.clearFocus()
                }),
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.weight(1f),
            )
            if (HouseholdCapability.VoiceInput in state.capabilities) {
                ComposerButton("🎙", "Speak", onVoiceInput)
            }
            Button(
                onClick = onSend,
                enabled = state.draft.isNotBlank(),
                shape = RoundedCornerShape(16.dp),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
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
        contentPadding = PaddingValues(horizontal = 13.dp, vertical = 16.dp),
        modifier = Modifier.widthIn(min = 52.dp),
    ) {
        Text(label, fontSize = 18.sp)
    }
}

@Composable
private fun HouseholdRail(
    state: HouseholdUiState,
    width: Dp,
    onNewConversation: () -> Unit,
    onConversationSelected: (String) -> Unit,
    onPresetSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = Color.White,
        shadowElevation = 12.dp,
        modifier = modifier.width(width),
    ) {
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxHeight(),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(46.dp)
                            .clip(CircleShape)
                            .background(Color(state.currentProfile.color)),
                    ) {
                        Text(state.currentProfile.initials, color = Color.White, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(state.currentProfile.displayName, fontWeight = FontWeight.Bold)
                        Text("Personal household agent", color = MutedInk, fontSize = 12.sp)
                    }
                }
            }
            item {
                Button(onClick = onNewConversation, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp)) {
                    Text("＋  New conversation")
                }
            }
            item { RailHeading("CONVERSATIONS") }
            items(state.conversations, key = { it.id }) { conversation ->
                ConversationRow(
                    conversation = conversation,
                    selected = conversation.id == state.selectedConversationId,
                    onClick = { onConversationSelected(conversation.id) },
                )
            }
            item {
                Spacer(Modifier.height(8.dp))
                RailHeading("PROMPT FLAVORS")
            }
            items(state.presets, key = { it.id }) { preset ->
                PresetRow(
                    preset = preset,
                    selected = preset.id == state.selectedPresetId,
                    onClick = { onPresetSelected(preset.id) },
                )
            }
            item {
                Spacer(Modifier.height(12.dp))
                Text(
                    "This app deliberately has no model, terminal, tool, file, or Gateway configuration screens.",
                    color = MutedInk,
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xFFF3F4F8))
                        .padding(12.dp),
                )
            }
        }
    }
}

@Composable
private fun RailHeading(text: String) {
    Text(text, color = MutedInk, fontWeight = FontWeight.Bold, fontSize = 11.sp, modifier = Modifier.padding(top = 12.dp, bottom = 2.dp))
}

@Composable
private fun ConversationRow(conversation: ConversationSummary, selected: Boolean, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) BrandBlueSoft else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(12.dp),
    ) {
        Text(if (conversation.isShared) "⌂" else "◯", color = if (selected) BrandBlue else MutedInk)
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(conversation.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium)
            Text(conversation.subtitle, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MutedInk, fontSize = 11.sp)
        }
    }
}

@Composable
private fun PresetRow(preset: PromptPreset, selected: Boolean, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .border(1.dp, if (selected) BrandBlue else OutlineSoft, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(12.dp),
    ) {
        Text(preset.label, fontWeight = FontWeight.SemiBold)
        Text(preset.description, color = MutedInk, fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
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

@Preview(widthDp = 1100, heightDp = 720, showBackground = true)
@Composable
private fun HardyHomeTabletPreview() {
    HardyHomeTheme {
        HardyHomeScreen(
            state = previewState,
            onDraftChange = {},
            onSend = {},
            onNewConversation = {},
            onConversationSelected = {},
            onPresetSelected = {},
            onDrawerChange = {},
            onDiagnosticsChange = {},
            onAttachment = {},
            onVoiceInput = {},
            onServerUrlChange = {},
            onEnrollmentCodeChange = {},
            onEnroll = {},
            onRefresh = {},
        )
    }
}
