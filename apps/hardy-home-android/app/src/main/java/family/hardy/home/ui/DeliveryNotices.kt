package family.hardy.home.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import family.hardy.home.data.HouseholdRepository
import family.hardy.home.model.HouseholdUiState

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DeliveryNotices(state: HouseholdUiState, repository: HouseholdRepository) {
    state.deliveryNotices.filter { it.conversationId == state.selectedConversationId }.takeLast(2).forEach { notice ->
        Card(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Column(Modifier.padding(12.dp)) {
                Text(notice.title, style = MaterialTheme.typography.titleSmall)
                Text(notice.detail, style = MaterialTheme.typography.bodySmall)
                if (notice.status in setOf("failed", "unconfirmed")) FlowRow {
                    if (notice.canRetry) TextButton(onClick = { repository.retryDelivery(notice.id) }, enabled = !state.sending) { Text("Retry request") }
                    TextButton(onClick = repository::refresh) { Text("Refresh progress") }
                    TextButton(onClick = { repository.dismissDelivery(notice.id) }) { Text("Hide") }
                }
            }
        }
    }
}
