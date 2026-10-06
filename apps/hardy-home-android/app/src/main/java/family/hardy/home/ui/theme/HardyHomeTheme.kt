package family.hardy.home.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Ink = Color(0xFF1D2533)
val MutedInk = Color(0xFF687083)
val AppCanvas = Color(0xFFF5F6FA)
val Panel = Color(0xFFFFFFFF)
val OutlineSoft = Color(0xFFE1E4EC)
val BrandBlue = Color(0xFF3559E0)
val BrandBlueSoft = Color(0xFFE9EDFF)
val Success = Color(0xFF16866A)
val Warning = Color(0xFFE48122)

private val HardyColors = lightColorScheme(
    primary = BrandBlue,
    onPrimary = Color.White,
    primaryContainer = BrandBlueSoft,
    onPrimaryContainer = Ink,
    secondary = Success,
    background = AppCanvas,
    onBackground = Ink,
    surface = Panel,
    onSurface = Ink,
    surfaceVariant = Color(0xFFF0F2F7),
    onSurfaceVariant = MutedInk,
    outline = OutlineSoft,
)

@Composable
fun HardyHomeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = HardyColors,
        typography = Typography(),
        content = content,
    )
}
