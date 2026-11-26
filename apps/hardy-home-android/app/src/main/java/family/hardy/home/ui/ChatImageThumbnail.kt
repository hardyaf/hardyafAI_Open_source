package family.hardy.home.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import family.hardy.home.model.ArtifactCard

@Composable
internal fun ChatImageThumbnail(
    artifact: ArtifactCard,
    loadThumbnail: suspend (ArtifactCard) -> Bitmap?,
    openArtifact: (ArtifactCard) -> Unit,
    modifier: Modifier = Modifier,
) {
    var bitmap by remember(artifact) { mutableStateOf<Bitmap?>(null) }
    var loading by remember(artifact) { mutableStateOf(true) }
    LaunchedEffect(artifact) {
        bitmap = loadThumbnail(artifact)
        loading = false
    }

    Box(
        modifier = modifier
            .size(width = 200.dp, height = 152.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .clickable(role = Role.Button, onClickLabel = "Open image preview") { openArtifact(artifact) },
        contentAlignment = Alignment.Center,
    ) {
        val thumbnail = bitmap
        if (thumbnail != null) {
            Image(
                bitmap = remember(thumbnail) { thumbnail.asImageBitmap() },
                contentDescription = artifact.filename,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                text = if (loading) "Loading ${artifact.filename}…" else "Open ${artifact.filename}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(12.dp),
            )
        }
    }
}
