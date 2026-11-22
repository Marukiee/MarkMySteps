package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

/*
 * The bell's list, as on the web (NotificationBell): who did what, how long
 * ago, and for a request to look along the buttons to let them in as a guest
 * or turn them down. Opening it marks everything read.
 */

private fun ago(at: Instant): String {
    val s = Duration.between(at, Instant.now()).seconds
    val d = s / 86400
    return when {
        s < 60 -> "net"
        s < 3600 -> "${s / 60} min geleden"
        s < 86400 -> "${s / 3600} uur geleden"
        d == 1L -> "gisteren"
        else -> "$d dagen geleden"
    }
}

private fun describe(n: Remote.Notice): String {
    val who = n.actor ?: "Iemand"
    val trip = n.trip ?: "een reis"
    return when (n.kind) {
        "TRIP_ADDED" -> "$who heeft je toegevoegd aan $trip."
        "ACCESS_REQUESTED" -> "$who vraagt toegang tot $trip."
        "ACCESS_APPROVED" -> "$who heeft je toegelaten tot $trip."
        "ACCESS_DENIED" -> "$who heeft je verzoek voor $trip afgewezen."
        "SECURITY_LOGIN_ATTEMPTS" -> n.detail ?: "Er zijn veel mislukte inlogpogingen geweest."
        "ACCOUNT_REQUESTED" -> "$who wil een account op je server."
        else -> "$who · $trip"
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoticesSheet(onDismiss: () -> Unit, onChanged: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<Remote.Notice>?>(null) }
    var answered by remember { mutableStateOf(mapOf<String, Boolean>()) }
    LaunchedEffect(Unit) {
        items = runCatching { Remote.notices() }.getOrNull() ?: emptyList()
        runCatching { Remote.markNoticesRead() }.onSuccess { onChanged() }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, modifier = Modifier.statusBarsPadding(), containerColor = cs.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 28.dp)) {
            Text("Meldingen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface), modifier = Modifier.padding(bottom = 14.dp))
            val list = items
            when {
                list == null -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    repeat(3) { Box(Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(20.dp)).background(cs.surfaceContainerHigh)) }
                }
                list.isEmpty() -> Text("Niets nieuws. Hier komen verzoeken en uitnodigingen.", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant))
                else -> Column(Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    list.forEachIndexed { i, n ->
                        val shape = RoundedCornerShape(
                            topStart = if (i == 0) 24.dp else 6.dp, topEnd = if (i == 0) 24.dp else 6.dp,
                            bottomStart = if (i == list.lastIndex) 24.dp else 6.dp, bottomEnd = if (i == list.lastIndex) 24.dp else 6.dp,
                        )
                        Column(Modifier.fillMaxWidth().clip(shape).background(if (n.read) cs.surfaceContainerHigh else cs.secondaryContainer).padding(12.dp).animateContentSize(MaterialTheme.motionScheme.defaultSpatialSpec())) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Avatar(n.actorId, n.actor ?: "?", n.actorAvatar, personColor(n.actorId), Modifier.size(40.dp))
                                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                                    Text(describe(n), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.5.sp, lineHeight = 20.sp, color = cs.onSurface))
                                    Text(ago(n.at), style = TextStyle(fontFamily = Inter, fontSize = 12.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 2.dp))
                                }
                            }
                            val rid = n.requestId
                            if (n.kind == "ACCESS_REQUESTED" && rid != null && n.requestStatus == "PENDING") {
                                val done = answered[rid]
                                if (done == null) Row(Modifier.padding(top = 10.dp, start = 52.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(onClick = { scope.launch { runCatching { Remote.answerAccess(rid, true) }.onSuccess { answered = answered + (rid to true); onChanged() } } }, shapes = ButtonDefaults.shapes()) {
                                        Text("Toelaten", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp))
                                    }
                                    FilledTonalButton(onClick = { scope.launch { runCatching { Remote.answerAccess(rid, false) }.onSuccess { answered = answered + (rid to false); onChanged() } } }, shapes = ButtonDefaults.shapes()) {
                                        Text("Afwijzen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp))
                                    }
                                } else Text(
                                    if (done) "${n.actor ?: "Die persoon"} kijkt nu mee als gast." else "Afgewezen.",
                                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.onSurfaceVariant),
                                    modifier = Modifier.padding(top = 8.dp, start = 52.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
