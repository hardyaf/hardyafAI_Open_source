package family.hardy.home.model

enum class DictationPhase { Idle, Recording, Transcribing, Saved }

data class DictationState(val phase: DictationPhase = DictationPhase.Idle, val message: String = "") {
    val blocksSend: Boolean get() = phase == DictationPhase.Recording || phase == DictationPhase.Transcribing
}
