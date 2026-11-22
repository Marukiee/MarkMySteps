package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import java.time.LocalDate
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource

/*
 * Two quiet helpers of the route planner, as on the web: the weather where a stop is on its first day, and
 * the places your own tracked route says you slept, offered back as stops.
 */

/** "☀ 24°" under a stop's dates, fading in once it is known; nothing when there is no reading. */
@Composable
fun StopWeather(at: LonLat, day: LocalDate, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    val weather by produceState<Remote.Weather?>(null, at, day) { value = runCatching { Remote.weather(at, day) }.getOrNull() }
    AnimatedVisibility(weather != null, modifier = modifier, enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec()), exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + shrinkVertically(MaterialTheme.motionScheme.fastSpatialSpec())) {
        weather?.let { w ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                LineIcon(weatherGlyph(w.code), cs.onSurfaceVariant, size = 15.dp, stroke = 1.8f)
                Text("${w.maxC}°", maxLines = 1, softWrap = false, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp))
            }
        }
    }
}

/** The stays you said "Niet deze" to, kept on the phone as on the web (the last 400). */
private object StayDismissals {
    private const val KEY = "staysDismissed"
    fun read(context: android.content.Context): Set<String> = runCatching {
        val a = org.json.JSONArray(context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE).getString(KEY, "[]"))
        (0 until a.length()).map { a.getString(it) }.toSet()
    }.getOrDefault(emptySet())

    fun add(context: android.content.Context, key: String) {
        val prefs = context.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
        val list = (read(context).toList() + key).takeLast(400)
        prefs.edit().putString(KEY, org.json.JSONArray(list).toString()).apply()
    }
}

private class NamedStay(val stay: SocialRemote.Stay) {
    var name by mutableStateOf<String?>(null)
    var country by mutableStateOf<String?>(null)
    val shown = MutableTransitionState(false).apply { targetState = true }
}

/**
 * "Gevonden in je route": the places the trip's own track says you slept, with their dates, nights and
 * photos; one tap adds one as a stop, "Niet deze" puts it away for good. Named one at a time, since the
 * geocoder is a public one. Folds open and closed from its heading.
 */
@Composable
fun StaySuggestions(trip: Trip, onAdd: suspend (SocialRemote.Stay, String, String?) -> Unit) {
    if (trip.remoteId == null) return
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val stays = remember(trip.id) { mutableStateListOf<NamedStay>() }
    var open by remember { mutableStateOf(true) }
    LaunchedEffect(trip.id) {
        val dismissed = StayDismissals.read(context)
        val found = runCatching { SocialRemote.stays(trip) }.getOrNull().orEmpty().filter { it.key !in dismissed }
        stays.clear(); stays.addAll(found.map { NamedStay(it) })
        for (s in stays.toList()) {
            SocialRemote.townAt(s.stay.lat, s.stay.lon)?.let { (name, cc) -> s.name = name; s.country = cc }
        }
    }
    val live = stays.filter { it.shown.targetState }
    AnimatedVisibility(live.isNotEmpty(), enter = fadeIn(motion.defaultEffectsSpec()) + expandVertically(motion.defaultSpatialSpec()), exit = fadeOut(motion.fastEffectsSpec()) + shrinkVertically(motion.fastSpatialSpec())) {
        Column(Modifier.padding(top = 20.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(cs.tertiaryContainer.copy(alpha = 0.45f)).animateContentSize(motion.defaultSpatialSpec())) {
            Row(
                Modifier.fillMaxWidth().clickable { haptics(Haptic.Tap); open = !open }.padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = if (open) 6.dp else 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(34.dp).clip(CircleShape).background(cs.tertiaryContainer), contentAlignment = Alignment.Center) {
                    // A small spark: something was found for you.
                    LineIcon(listOf(P("M12 3v4"), P("M12 17v4"), P("M3 12h4"), P("M17 12h4"), P("m6 6 2.5 2.5"), P("m15.5 15.5 2.5 2.5"), P("m6 18 2.5-2.5"), P("m15.5 8.5 2.5-2.5")), cs.onTertiaryContainer, size = 17.dp, stroke = 2f)
                }
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(stringResource(R.string.plannerx_found), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.5.sp, color = cs.onSurface))
                    Text(pluralStringResource(R.plurals.plannerx_stays, live.size, live.size), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
                }
                val turn by animateFloatAsState(if (open) 180f else 0f, motion.defaultSpatialSpec(), label = "caret")
                LineIcon(listOf(P("m6 9 6 6 6-6")), cs.onSurfaceVariant, size = 18.dp, stroke = 2.2f, modifier = Modifier.graphicsLayer { rotationZ = turn })
            }
            if (open) Column(Modifier.padding(start = 10.dp, end = 10.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                stays.forEachIndexed { i, s ->
                    key(s.stay.key) {
                        // They rise in a little as they arrive.
                        AnimatedVisibility(s.shown, enter = fadeIn(motion.defaultEffectsSpec()) + slideInVertically(motion.defaultSpatialSpec()) { it / 4 }, exit = fadeOut(motion.fastEffectsSpec()) + shrinkVertically(motion.fastSpatialSpec())) {
                            StayCard(s, onAdd = {
                                haptics(Haptic.Confirm)
                                runCatching { onAdd(s.stay, s.name ?: "%.3f, %.3f".format(java.util.Locale.ROOT, s.stay.lat, s.stay.lon), s.country) }
                                    .onSuccess { s.shown.targetState = false }
                            }, onDismiss = {
                                haptics(Haptic.Tap)
                                s.shown.targetState = false
                                StayDismissals.add(context, s.stay.key)
                            })
                        }
                        if (s.shown.isIdle && !s.shown.currentState) LaunchedEffect(Unit) { stays.remove(s) }
                    }
                }
            }
        }
    }
}

@Composable
private fun StayCard(s: NamedStay, onAdd: suspend () -> Unit, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(cs.surfaceContainerLow).padding(start = 14.dp, end = 6.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                s.country?.let { FlagIcon(Remote.flag(it), 14.dp, Modifier.padding(end = 8.dp)) }
                androidx.compose.animation.Crossfade(s.name, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "name") { n ->
                    Text(
                        n ?: "%.3f, %.3f".format(java.util.Locale.ROOT, s.stay.lat, s.stay.lon), maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.5.sp, color = if (n != null) cs.onSurface else cs.onSurfaceVariant),
                    )
                }
            }
            val from = parseDay(s.stay.from); val to = parseDay(s.stay.to)
            val dates = if (from != null && to != null) shortRange(from, to) else ""
            val meta = listOfNotNull(dates.ifBlank { null }, plural(s.stay.nights, stringResource(R.string.planner_night), stringResource(R.string.planner_nights))).joinToString(" · ")
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                Text(meta, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
                if (s.stay.photos > 0) {
                    Text(" · ", style = TextStyle(fontFamily = Inter, fontSize = 13.sp, color = cs.onSurfaceVariant))
                    LineIcon(Glyphs.camera, cs.onSurfaceVariant, size = 13.dp, stroke = 1.9f)
                    Text(" ${s.stay.photos}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
                }
            }
        }
        Button(
            onClick = { busy = true; scope.launch { runCatching { onAdd() }; busy = false } }, enabled = !busy, shapes = ButtonDefaults.shapes(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 12.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        ) {
            LineIcon(Glyphs.plus, cs.onPrimary, size = 15.dp, stroke = 2.4f)
            Text(stringResource(R.string.common_add), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp), modifier = Modifier.padding(start = 4.dp))
        }
        Box(Modifier.padding(start = 2.dp).size(40.dp).clip(CircleShape).clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
            LineIcon(listOf(P("M6 6l12 12"), P("M18 6 6 18")), cs.onSurfaceVariant, size = 15.dp, stroke = 2.2f)
        }
    }
}
