package family.hardy.home.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import family.hardy.home.data.displayTime
import family.hardy.home.data.HouseholdRepository
import family.hardy.home.model.*

@Composable
fun HouseholdLibraryScreen(state: HouseholdUiState, repository: HouseholdRepository) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (state.workspaceTab == WorkspaceTab.Lists || state.workspaceTab == WorkspaceTab.Wiki) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = state.libraryScope == "household", onClick = { repository.setLibraryScope("household") }, label = { Text("Shared household") })
            FilterChip(selected = state.libraryScope == "personal", onClick = { repository.setLibraryScope("personal") }, label = { Text("Only me") })
        }
        if (state.workspaceTab == WorkspaceTab.Contacts || state.workspaceTab == WorkspaceTab.Wiki) OutlinedTextField(value = state.libraryQuery, onValueChange = repository::setLibraryQuery,
            modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text(if (state.workspaceTab == WorkspaceTab.Contacts) "Find a name, email, or company" else "Search knowledge") })
        if (state.workspaceTab == WorkspaceTab.Contacts) Text("Household Rolodex · saved cards and their sources", style = MaterialTheme.typography.bodySmall)
        if (state.libraryLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.libraryNotice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (state.libraryUpdatedAt.isNotBlank() && state.workspaceTab == WorkspaceTab.Lists) Text("Last updated ${state.libraryUpdatedAt}", style = MaterialTheme.typography.labelSmall)
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            when(state.workspaceTab) {
                WorkspaceTab.Contacts -> {
                    if (state.contacts.isEmpty() && !state.libraryLoading) item { EmptyCard("No saved cards found", "Attach a business-card photo in a conversation and ask Jarvis to save it.") }
                    items(state.contacts, key = { it.id }) { contact -> ResourceCard(contact.name, contact.organization.ifBlank { "Saved card" }) { TextButton(onClick = { repository.openContact(contact.id) }) { Text("Open card") } } }
                }
                WorkspaceTab.Lists -> {
                    if(state.listEntries.isEmpty() && !state.libraryLoading) item { EmptyCard("This list is empty", "Ask Jarvis to add shopping items or other tasks in a conversation.") }
                    items(state.listEntries, key = { it.id }) { entry -> ResourceCard("${if(entry.done) "✓" else "○"} ${entry.text}", entry.kind.replace('_', ' ')) {
                        TextButton(onClick = { repository.discuss(ConversationFocus("list_item", entry.id, scope = state.libraryScope, label = entry.text), if(entry.done) "Please reopen this item." else "Please mark this item done.") }) { Text(if(entry.done) "Reopen…" else "Mark done…") }
                        TextButton(onClick = { repository.discuss(ConversationFocus("list_item", entry.id, scope = state.libraryScope, label = entry.text), "About this item: ") }) { Text("Discuss or change…") }
                    } }
                }
                WorkspaceTab.Wiki -> {
                    if(state.wikiCards.isEmpty() && !state.libraryLoading) item { EmptyCard("No knowledge pages found", "Jarvis builds grounded pages from the facts you share.") }
                    items(state.wikiCards, key = { it.id }) { page -> ResourceCard(page.title, page.excerpt) { TextButton(onClick = { repository.openWiki(page.id) }) { Text("Read page") } } }
                }
                WorkspaceTab.Receipts -> {
                    item { Text("Processed means extracted. Provisional items need review. Accepted receipts have passed the required checks.", style = MaterialTheme.typography.bodySmall) }
                    if(state.receiptReviews.isEmpty() && !state.libraryLoading) item { EmptyCard("No receipts awaiting review", "Uncertain amounts, project assignments, and reconciliation issues appear here.") }
                    items(state.receiptReviews, key = { it.receiptId }) { receipt -> ResourceCard(receipt.title, (receipt.reasons + receipt.question).filter(String::isNotBlank).joinToString("\n")) {
                        TextButton(onClick = { repository.discuss(ConversationFocus("receipt", receipt.receiptId, receipt.revision, label = receipt.title), "Please help me resolve the review for this receipt.") }) { Text("Review with Jarvis…") }
                    } }
                }
                else -> Unit
            }
        }
        state.statusNotice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
    state.contactDetail?.let { detail -> ContactDetailDialog(detail, repository) }
    state.wikiPage?.let { page -> AlertDialog(onDismissRequest = repository::closeWiki, title = { Text(page.title) }, text = {
        LazyColumn { item { Text(page.body) }; items(page.sourceLabels) { Text("Source: $it", style = MaterialTheme.typography.bodySmall) } }
    }, confirmButton = { TextButton(onClick = { repository.discuss(ConversationFocus("wiki", page.id, scope = state.libraryScope, label = page.title), "About this knowledge page: ") }) { Text("Discuss…") } }, dismissButton = { TextButton(onClick = repository::closeWiki) { Text("Close") } }) }
}

@Composable
private fun ContactDetailDialog(detail: ContactDetail, repository: HouseholdRepository) {
    val card = detail.contact
    AlertDialog(onDismissRequest = repository::closeContact, title = { Text(card.name) }, text = {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Text("${if(card.audience == "household") "Shared household" else "Private"} · revision ${card.revision}", style = MaterialTheme.typography.labelSmall) }
            card.fields.forEach { (key,values) -> if (values.isNotEmpty()) item { Text(key.replace('_', ' '), style = MaterialTheme.typography.labelMedium); Text(values.joinToString("\n")) } }
            if(detail.uncertainties.isNotEmpty()) item { Text("Needs a closer look", style = MaterialTheme.typography.titleSmall); Text(detail.uncertainties.joinToString("\n")) }
            items(detail.sources, key = { it.id }) { source -> TextButton(onClick = { repository.openArtifact(source) }) { Text("View ${source.filename}") } }
            if(detail.revisions.isNotEmpty()) item { Text("Card history", style = MaterialTheme.typography.titleSmall) }
            items(detail.revisions, key = { it.revision }) { revision ->
                Text("Revision ${revision.revision} · ${displayTime(revision.createdAt)}", style = MaterialTheme.typography.labelMedium)
                if(revision.reason.isNotBlank()) Text(revision.reason)
                revision.fields.forEach { (key,values) -> if(values.isNotEmpty()) Text("${key.replace('_',' ')}: ${values.joinToString(", ")}", style = MaterialTheme.typography.bodySmall) }
            }
        }
    }, confirmButton = { TextButton(onClick = { repository.discuss(ConversationFocus("contact", card.id, card.revision, scope = if(card.audience == "household") "household" else "personal", label = card.name), "About this card: ") }) { Text("Ask or correct…") } },
        dismissButton = { TextButton(onClick = repository::closeContact) { Text("Close") } })
}

@Composable
private fun EmptyCard(title: String, detail: String) = ResourceCard(title,detail) {}

@Composable
private fun ResourceCard(title: String, detail: String, actions: @Composable RowScope.() -> Unit) {
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp)) { Text(title, style = MaterialTheme.typography.titleMedium); if(detail.isNotBlank()) Text(detail); Row(content = actions) } }
}
