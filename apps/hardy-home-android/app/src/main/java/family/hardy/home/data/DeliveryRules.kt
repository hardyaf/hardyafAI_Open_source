package family.hardy.home.data

/** Only delivery failures known to occur before chat dispatch may offer a fresh user retry. */
internal object DeliveryRules {
    private val retryable = setOf("gateway_unavailable", "gateway_connect_timeout", "gateway_probe_failed", "gateway_closed",
        "gateway_unavailable_attempts_exhausted", "household_boundary_unavailable", "goal_start_preflight_unavailable", "goal_start_session_unavailable")
    fun canRetry(status: String, recoveryRequired: Boolean, code: String): Boolean = status == "failed" && !recoveryRequired && code in retryable
    fun detail(code: String, recoveryRequired: Boolean): String = when {
        recoveryRequired || code.contains("unknown") || code == "gateway_receipt_invalid" -> "Delivery is uncertain. Jarvis may have received this request. Check its progress before sending it again."
        code == "new_task_requires_new_conversation" -> "Another goal is still open here. Continue in Chat, or start a new conversation for a separate task."
        code == "question_binding_conflict" -> "The question changed before this answer could be sent. Refresh the conversation and answer the current question."
        code.contains("superseded") -> "A newer pause, edit, or stop replaced this request."
        code.contains("authorization") || code.contains("admission_revoked") -> "Your access changed before this request could run. Refresh your connection."
        code == "goal_source_unavailable" -> "The original task source is unavailable. Use Explain a problem to inspect the task."
        code in retryable -> "The connection or household service was unavailable before this request was sent. You can retry it."
        else -> "Jarvis could not complete this request. Check its progress, or use Explain a problem for details."
    }
}
