package family.hardy.home.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import family.hardy.home.data.ReceiptCapture
import family.hardy.home.data.ReceiptCaptureState
import family.hardy.home.data.CapturedReceipt
import family.hardy.home.data.displayTime
import java.math.BigDecimal
import java.util.Locale

@Composable
internal fun ReceiptCaptureDialog(state: ReceiptCaptureState, receiptCapture: ReceiptCapture) {
    val selected = state.selected
    AlertDialog(
        onDismissRequest = receiptCapture::close,
        title = { Text(if (selected == null) "Household finances" else "Receipt") },
        text = {
            Column(
                Modifier.heightIn(max = 540.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                state.message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (state.busy) CircularProgressIndicator()
                if (state.uploadPending && !state.busy) {
                    Text("A receipt photo is saved on this phone.")
                    Row {
                        TextButton(onClick = receiptCapture::uploadPhoto) { Text("Retry upload") }
                        TextButton(onClick = receiptCapture::discardLocal) { Text("Discard local photo") }
                    }
                }
                if (selected == null) {
                    if (state.captures.isEmpty() && !state.busy && !state.uploadPending) Text("No receipts yet.")
                    state.captures.forEach { receipt ->
                        TextButton(onClick = { receiptCapture.select(receipt.id) }, enabled = !state.busy) {
                            Text(listOf(receipt.vendor ?: "Receipt", receipt.date ?: displayTime(receipt.createdAt),
                                receiptStatus(receipt.state)).joinToString(" · "))
                        }
                    }
                } else key(selected.id) {
                    state.preview?.let {
                        Image(it.asImageBitmap(), "Receipt photo", Modifier.fillMaxWidth().heightIn(max = 215.dp))
                    }
                    when (selected.state) {
                        "uploaded" -> ReceiptDestination(state.busy, receiptCapture::file)
                        "processing" -> {
                            val destination = selected.destination ?: "household"
                            Text(if (destination == "uplift") "Uplift filing was interrupted." else "OCR or household filing was interrupted.")
                            TextButton(onClick = { receiptCapture.file(destination) }, enabled = !state.busy) { Text("Retry filing") }
                        }
                        "review" -> ReceiptSummaryReview(selected, state.busy, receiptCapture::review)
                        "filed" -> Text(listOfNotNull("Filed in household finances", selected.vendor, selected.date,
                            selected.totalMinor?.let { formatReceiptTotal(selected.currency.orEmpty(), it) }).joinToString("\n"))
                        "uplift_intake" -> Text("Tagged Uplift. The original is in Uplift intake awaiting project filing.")
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = receiptCapture::close, enabled = !state.busy) { Text("Close") } },
        dismissButton = {
            if (selected != null) TextButton(onClick = receiptCapture::open, enabled = !state.busy) { Text("All receipts") }
        },
    )
}

@Composable
private fun ReceiptDestination(busy: Boolean, file: (String) -> Unit) {
    var uplift by rememberSaveable { mutableStateOf(false) }
    Text("Photo uploaded. Choose where to file it.")
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = uplift, onCheckedChange = { uplift = it }, enabled = !busy)
        Text("Tag Uplift")
    }
    TextButton(onClick = { file(if (uplift) "uplift" else "household") }, enabled = !busy) {
        Text(if (uplift) "Send to Uplift intake" else "Scan and file in household finances")
    }
}

@Composable
private fun ReceiptSummaryReview(receipt: CapturedReceipt, busy: Boolean, submit: (String, String, String, Long) -> Unit) {
    var merchant by rememberSaveable { mutableStateOf(receipt.vendor.orEmpty()) }
    var date by rememberSaveable { mutableStateOf(receipt.date.orEmpty()) }
    var currency by rememberSaveable { mutableStateOf(receipt.currency.orEmpty()) }
    var total by rememberSaveable { mutableStateOf("") }
    val minor = runCatching { BigDecimal(total.trim()).movePointRight(2).longValueExact() }.getOrNull()
    Text("Check the photo and the extracted text before confirming the summary. Check your ledger for another photo of the same receipt.")
    receipt.ocr?.takeIf(String::isNotBlank)?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    OutlinedTextField(merchant, { merchant = it.take(180) }, label = { Text("Merchant") }, singleLine = true, enabled = !busy)
    OutlinedTextField(date, { date = it.take(10) }, label = { Text("Date (YYYY-MM-DD)") }, singleLine = true, enabled = !busy)
    OutlinedTextField(currency, { currency = it.uppercase(Locale.ROOT).take(3) }, label = { Text("Currency (e.g. USD)") }, singleLine = true, enabled = !busy)
    OutlinedTextField(total, { total = it.take(16) }, label = { Text("Total (e.g. 12.34)") }, singleLine = true, enabled = !busy)
    TextButton(
        onClick = { minor?.let { submit(merchant.trim(), date.trim(), currency, it) } },
        enabled = !busy && merchant.isNotBlank() && date.length == 10 && currency.length == 3 && minor != null,
    ) { Text("Confirm and file") }
}

private fun receiptStatus(state: String) = when (state) {
    "uploaded" -> "Choose destination"
    "processing" -> "Retry filing"
    "review" -> "Review needed"
    "filed" -> "Filed"
    "uplift_intake" -> "Uplift intake"
    else -> state
}

private fun formatReceiptTotal(currency: String, minor: Long): String =
    currency + " " + BigDecimal.valueOf(minor, 2).toPlainString()
