package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.graphics.graphicsLayer
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

/**
 * The bell's list as a floating panel, as on the web: it opens out of the bell's corner over a dimmed page
 * instead of rising from the bottom. Each line has its own × to take it away (a request stays open when only
 * its line goes), requests get Toelaten / Afwijzen, and a line about a trip or an account request has a way
 * straight there. Back follows the finger and closes it the same way it came.
 */
@Composable
fun NoticesSheet(onDismiss: () -> Unit, onChanged: () -> Unit, onOpenTrip: (String) -> Unit = {}, onOpenRequests: () -> Unit = {}) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<Remote.Notice>?>(null) }
    var answered by remember { mutableStateOf(mapOf<String, Boolean>()) }
    var gone by remember { mutableStateOf(setOf<String>()) }
    val shown = remember { androidx.compose.animation.core.MutableTransitionState(false) }.apply { targetState = targetState }
    androidx.compose.runtime.LaunchedEffect(Unit) { shown.targetState = true }
    var closeThen by remember { mutableStateOf<(() -> Unit)?>(null) }
    fun close(then: () -> Unit = {}) { closeThen = then; shown.targetState = false }
    // Once the panel has played its way out, it leaves and whatever was asked for happens.
    androidx.compose.runtime.LaunchedEffect(shown.currentState, shown.isIdle) {
        if (shown.isIdle && !shown.currentState && !shown.targetState) { onDismiss(); closeThen?.invoke() }
    }
    LaunchedEffect(Unit) {
        items = runCatching { Remote.notices() }.getOrNull() ?: emptyList()
        // Opening the list is reading it, except for questions still unanswered (the server keeps those).
        runCatching { Remote.markNoticesRead() }.onSuccess { onChanged() }
    }
    var backT by remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    androidx.compose.ui.window.Dialog(
        onDismissRequest = { close() },
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        androidx.activity.compose.PredictiveBackHandler { events ->
            try { events.collect { backT = it.progress }; close() } catch (e: kotlin.coroutines.cancellation.CancellationException) { backT = 0f; throw e }
        }
        val motion = MaterialTheme.motionScheme
        val dim by androidx.compose.animation.core.animateFloatAsState(if (shown.targetState) 0.32f else 0f, motion.defaultEffectsSpec(), label = "dim")
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = dim * (1f - backT * 0.5f)))
                .clickable(interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, indication = null) { close() },
        ) {
            androidx.compose.animation.AnimatedVisibility(
                shown,
                modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 64.dp, start = 12.dp, end = 12.dp),
                enter = androidx.compose.animation.scaleIn(motion.defaultSpatialSpec(), initialScale = 0.85f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.92f, 0f)) + androidx.compose.animation.fadeIn(motion.defaultEffectsSpec()),
                exit = androidx.compose.animation.scaleOut(motion.fastSpatialSpec(), targetScale = 0.9f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.92f, 0f)) + androidx.compose.animation.fadeOut(motion.fastEffectsSpec()),
            ) {
                Column(
                    Modifier.fillMaxWidth().graphicsLayer { val k = 1f - 0.08f * backT; scaleX = k; scaleY = k; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.92f, 0f) }
                        .clip(RoundedCornerShape(32.dp)).background(cs.surfaceContainerLow)
                        .border(1.dp, cs.outlineVariant.copy(alpha = 0.55f), RoundedCornerShape(32.dp))
                        .clickable(interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, indication = null) {}
                        .padding(start = 16.dp, end = 10.dp, top = 10.dp, bottom = 14.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Meldingen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface), modifier = Modifier.weight(1f))
                        Box(Modifier.size(44.dp).clip(CircleShape).clickable { close() }, contentAlignment = Alignment.Center) {
                            LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.onSurfaceVariant, size = 20.dp, stroke = 2.2f)
                        }
                    }
                    val list = items?.filter { it.id !in gone }
                    Box(Modifier.padding(top = 8.dp, end = 6.dp).animateContentSize(motion.defaultSpatialSpec())) {
                        when {
                            // Three rows at the height real ones have, so the panel opens at its size.
                            items == null -> Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                repeat(3) { i -> Box(Modifier.fillMaxWidth().height(76.dp).clip(slabShape(i, 3)).background(cs.surfaceContainerHigh)) }
                            }
                            list.isNullOrEmpty() -> Column(Modifier.fillMaxWidth().padding(vertical = 22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Box(Modifier.size(56.dp).clip(CircleShape).background(cs.secondaryContainer), contentAlignment = Alignment.Center) {
                                    LineIcon(Glyphs.bell, cs.onSecondaryContainer, size = 26.dp)
                                }
                                Text("Niets nieuws. Hier komen verzoeken en uitnodigingen.", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center), modifier = Modifier.padding(top = 12.dp, start = 16.dp, end = 16.dp))
                            }
                            else -> Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                list.forEachIndexed { i, n ->
                                    NoticeRow(n, slabShape(i, list.size), answered[n.requestId],
                                        onAnswer = { rid, yes -> scope.launch { runCatching { Remote.answerAccess(rid, yes) }.onSuccess { answered = answered + (rid to yes); onChanged() } } },
                                        onDismiss = { gone = gone + n.id; scope.launch { runCatching { Remote.dismissNotice(n.id) }; onChanged() } },
                                        onOpenTrip = { id -> close { onOpenTrip(id) } },
                                        onOpenRequests = { close { onOpenRequests() } },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun slabShape(i: Int, n: Int) = RoundedCornerShape(
    topStart = if (i == 0) 22.dp else 6.dp, topEnd = if (i == 0) 22.dp else 6.dp,
    bottomStart = if (i == n - 1) 22.dp else 6.dp, bottomEnd = if (i == n - 1) 22.dp else 6.dp,
)

@Composable
private fun NoticeRow(
    n: Remote.Notice, shape: androidx.compose.ui.graphics.Shape, answered: Boolean?,
    onAnswer: (String, Boolean) -> Unit, onDismiss: () -> Unit, onOpenTrip: (String) -> Unit, onOpenRequests: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val rid = n.requestId
    val pending = n.kind == "ACCESS_REQUESTED" && rid != null && n.requestStatus == "PENDING" && answered == null
    Row(Modifier.fillMaxWidth().clip(shape).background(if (n.read) cs.surfaceContainerHigh else cs.secondaryContainer).padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 4.dp)) {
        // The person, with a small mark of what happened on the corner of their photo.
        Box {
            Avatar(n.actorId, n.actor ?: "?", n.actorAvatar, personColor(n.actorId), Modifier.size(40.dp))
            val mark = when (n.kind) {
                "ACCESS_REQUESTED" -> Glyphs.friends; "ACCESS_APPROVED" -> Glyphs.check; "ACCESS_DENIED" -> listOf(P("M18 6 6 18"), P("m6 6 12 12"))
                "SECURITY_LOGIN_ATTEMPTS" -> Glyphs.shield; "ACCOUNT_REQUESTED" -> Glyphs.person; else -> Glyphs.compass
            }
            Box(Modifier.align(Alignment.BottomEnd).offset(x = 4.dp, y = 4.dp).size(20.dp).clip(CircleShape).background(cs.primary).border(2.dp, if (n.read) cs.surfaceContainerHigh else cs.secondaryContainer, CircleShape), contentAlignment = Alignment.Center) {
                LineIcon(mark, cs.onPrimary, size = 11.dp, stroke = 2.4f)
            }
        }
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(describe(n), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.5.sp, lineHeight = 20.sp, color = cs.onSurface))
            n.message?.let { Text("\u201C$it\u201D", style = TextStyle(fontFamily = Inter, fontSize = 13.5.sp, lineHeight = 19.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 4.dp)) }
            Text(ago(n.at), style = TextStyle(fontFamily = Inter, fontSize = 12.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 2.dp))
            if (pending) Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onAnswer(rid!!, true) }, shapes = ButtonDefaults.shapes()) { Text("Toelaten", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)) }
                FilledTonalButton(onClick = { onAnswer(rid!!, false) }, shapes = ButtonDefaults.shapes()) { Text("Afwijzen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)) }
            }
            if (answered != null) Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                LineIcon(if (answered) Glyphs.check else listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.onSurfaceVariant, size = 14.dp, stroke = 2.4f)
                Text(if (answered) "${n.actor ?: "Die persoon"} kijkt nu mee als gast." else "Afgewezen.", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 6.dp))
            }
            val link: Pair<String, () -> Unit>? = when {
                n.kind == "ACCOUNT_REQUESTED" -> "Aanvragen bekijken" to onOpenRequests
                n.tripId != null && n.kind != "ACCESS_DENIED" && !pending -> "Reis openen" to { onOpenTrip(n.tripId) }
                else -> null
            }
            link?.let { (label, go) ->
                Row(Modifier.padding(top = 6.dp).clip(CircleShape).clickable(onClick = go).padding(vertical = 4.dp, horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.primary))
                    LineIcon(Glyphs.chevronRight, cs.primary, size = 14.dp, stroke = 2.4f, modifier = Modifier.padding(start = 2.dp))
                }
            }
        }
        // Taking the line away: for a request only the line goes, the request itself stays open.
        Box(Modifier.size(40.dp).clip(CircleShape).clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
            LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.onSurfaceVariant, size = 16.dp, stroke = 2.2f)
        }
    }
}
