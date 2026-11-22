package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate

/*
 * What Instellingen › Voorkeuren › Route-tracking shows about tracking itself, as the web: where the last
 * position landed (a place name and a small map with today's line behind the dot, a tap opens today's points)
 * and the location log, every check with how far it moved and how sure it was.
 */

private fun clockOf(ms: Long): String = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneId.systemDefault()).toLocalTime().let { "%02d:%02d".format(it.hour, it.minute) }

/** The last position: a still map with the dot and today's line, its place, how long ago and how sure. */
@Composable
fun LastFixCard(fix: Triple<Double, Double, Long>, now: Long, tripId: String?, onOpenMap: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val dark = cs.background.luminance() < 0.5f
    // Rounded, so drifting a few metres does not ask again on every position.
    val key = "%.3f,%.3f".format(java.util.Locale.ROOT, fix.second, fix.first)
    val place by produceState<String?>(null, key) { value = runCatching { ViewerApi.placeName(fix.second, fix.first) }.getOrNull() }
    // Today's own points behind the dot: the tracker's own view, read again as the line grows.
    val line by produceState(emptyList<LonLat>(), tripId, fix.third) {
        val id = tripId ?: return@produceState
        runCatching { MapRemote.dayPoints(id, LocalDate.now()) }.onSuccess { value = it.map { p -> p.at } }
    }
    val age = ((now - fix.third) / 1000).coerceAtLeast(0)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(92.dp).clip(RoundedCornerShape(18.dp)).clickable(onClick = onOpenMap)) {
            PlainMap(dark, Modifier.size(92.dp), around = listOf(fix.first to fix.second), pin = fix.first to fix.second, line = line, onTap = null, zoom = 13.0)
            // The still map takes no taps itself, so the card does.
            Box(Modifier.size(92.dp).clickable(onClick = onOpenMap))
        }
        Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(9.dp).clip(CircleShape).background(cs.primary))
                androidx.compose.animation.Crossfade(place, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "place") { p ->
                    Text(p ?: "Plaats opzoeken…", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface), modifier = Modifier.padding(start = 8.dp))
                }
            }
            Text(
                "laatste positie " + (if (age < 2) "zojuist" else if (age < 120) "${age}s geleden" else "${age / 60} min geleden") + (Tracker.lastAccuracy?.let { " · ±${it.toInt()} m" } ?: ""),
                style = ValueStyle.copy(color = cs.onSurfaceVariant),
            )
            Text("%.5f, %.5f".format(java.util.Locale.ROOT, fix.second, fix.first), style = ValueStyle.copy(fontSize = 12.sp, color = cs.onSurfaceVariant.copy(alpha = 0.8f)))
        }
    }
}

/** One check: the time, how far it moved (or start) and how sure, how many it merged, and where. */
@Composable
private fun LogRow(e: Tracker.FixLog, now: Long, full: Boolean) {
    val cs = MaterialTheme.colorScheme
    val ago = (now - e.at) / 1000
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.width(58.dp)) {
            Text(clockOf(e.at), style = TitleStyle.copy(fontSize = 14.sp, color = cs.onSurface))
            if (ago < 3600) Text("${(ago / 60).coerceAtLeast(0)} min", style = ValueStyle.copy(fontSize = 11.5.sp, color = cs.onSurfaceVariant))
        }
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(e.movedM?.let { "$it m" } ?: "start", style = ValueStyle.copy(fontWeight = FontWeight(650), color = cs.onSurface))
            e.accuracyM?.let { Text("±$it m", style = ValueStyle.copy(color = cs.onSurfaceVariant)) }
            // How many checks on the same spot were merged into this one.
            if (e.stayCount > 0) Text("+${e.stayCount}", style = ValueStyle.copy(fontWeight = FontWeight(650), color = cs.onSecondaryContainer),
                modifier = Modifier.clip(CircleShape).background(cs.secondaryContainer).padding(horizontal = 7.dp, vertical = 1.dp))
        }
        Text(
            if (full) "%.4f, %.4f".format(java.util.Locale.ROOT, e.lat, e.lng) else "%.4f\n%.4f".format(java.util.Locale.ROOT, e.lat, e.lng),
            style = ValueStyle.copy(fontSize = 12.sp, lineHeight = 15.sp, color = cs.onSurfaceVariant), textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
    }
}

/** The location log, open from the start, the last 25 checks, with the whole log in a sheet. */
@Composable
fun TrackingLog(now: Long) {
    val cs = MaterialTheme.colorScheme
    val log = Tracker.log
    if (log.isEmpty()) return
    var open by remember { mutableStateOf(true) }
    var full by remember { mutableStateOf(false) }
    val turn by animateFloatAsState(if (open) 90f else 0f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "logCaret")
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHigh)) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            LineIcon(Glyphs.chevronRight, cs.onSurfaceVariant, size = 16.dp, stroke = 2.2f, modifier = Modifier.graphicsLayer { rotationZ = turn })
            Text("Locatie-log · ${log.size} ${if (log.size == 1) "check" else "checks"}", style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface), modifier = Modifier.weight(1f).padding(start = 8.dp))
            Box(Modifier.size(40.dp).clip(CircleShape).clickable { full = true }, contentAlignment = Alignment.Center) {
                LineIcon(listOf(P("M4 9V4h5"), P("M20 9V4h-5"), P("M4 15v5h5"), P("M20 15v5h-5")), cs.onSurfaceVariant, size = 17.dp, stroke = 2.1f)
            }
        }
        AnimatedVisibility(open, enter = fadeIn() + expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec()), exit = fadeOut() + shrinkVertically(MaterialTheme.motionScheme.fastSpatialSpec())) {
            Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 8.dp)) {
                log.take(25).forEach { LogRow(it, now, full = false) }
            }
        }
    }
    if (full) AppSheet(onDismiss = { full = false }) {
        Text("Locatie-log", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface), modifier = Modifier.padding(horizontal = 20.dp))
        Text("${log.size} checks", style = ValueStyle.copy(color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 20.dp, top = 2.dp, bottom = 8.dp))
        LazyColumn(Modifier.heightIn(max = 600.dp).padding(horizontal = 20.dp).padding(bottom = 16.dp)) {
            items(log) { LogRow(it, now, full = true) }
        }
    }
}
