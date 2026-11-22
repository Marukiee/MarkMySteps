package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate

/*
 * The controls on and around the trip map, as the web's trip page has them: the day pill and its list, the
 * button that puts the map on you, the word when the photos are off, the menu of a long press on the line,
 * the sheet that draws a train ride, the question on an ongoing trip and the picker for a new stop's place.
 */

private val WeekDays = listOf("ma", "di", "wo", "do", "vr", "za", "zo")
private val MonthsShort = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")

/** "di 12 aug": short enough for the pill, clear in a list. */
fun shortDay(d: LocalDate) = "${WeekDays[d.dayOfWeek.value - 1]} ${d.dayOfMonth} ${MonthsShort[d.monthValue - 1]}"

val LocateGlyph = listOf(C(12f, 12f, 3.2f), C(12f, 12f, 7.5f), P("M12 2v3M12 19v3M2 12h3M19 12h3"))
private val CalendarGlyph = listOf(P("M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"), P("M3 10h18"), P("M8 3v4M16 3v4"))
private val RouteGlyph = listOf(C(6f, 18f, 2.2f), C(18f, 6f, 2.2f), P("M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"))
private val EraseGlyph = listOf(P("m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"), P("M22 21H7"), P("m5 11 9 9"))
private val EyeOff = listOf(P("M3 3l18 18"), P("M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"))
private val EyeOn = listOf(P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"), C(12f, 12f, 3f))

private val PillText = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp)

/** A solid pill over the map (never see-through, so it reads on any map), with an icon and a word. */
@Composable
fun MapPill(text: String, icon: List<Shape24>, modifier: Modifier = Modifier, active: Boolean = false, trailing: List<Shape24>? = null, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    val bg by animateColorAsState(if (active) cs.primary else cs.surfaceContainerHighest, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "pill")
    val fg by animateColorAsState(if (active) cs.onPrimary else cs.onSurface, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "pillFg")
    Row(
        modifier.height(40.dp).clip(CircleShape).background(bg).dip { haptics(Haptic.Tap); onClick() }.padding(start = 12.dp, end = if (trailing != null) 10.dp else 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LineIcon(icon, fg, size = 16.dp, stroke = 2.1f)
        Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis, style = PillText.copy(color = fg), modifier = Modifier.padding(start = 6.dp).widthIn(max = 150.dp))
        if (trailing != null) LineIcon(trailing, fg, size = 15.dp, stroke = 2.2f, modifier = Modifier.padding(start = 4.dp))
    }
}

/** The day the map shows: "Hele reis" or one day; only offered when the trip has two days or more with something on them. */
@Composable
fun DayPill(state: TripMapState, onOpen: () -> Unit, modifier: Modifier = Modifier) {
    if (state.days.size < 2) return
    val motion = MaterialTheme.motionScheme
    androidx.compose.animation.AnimatedContent(state.day, transitionSpec = {
        (fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.fastSpatialSpec(), initialScale = 0.9f)) togetherWith
            fadeOut(motion.fastEffectsSpec()) using androidx.compose.animation.SizeTransform(clip = false)
    }, label = "dayPill", modifier = modifier) { day ->
        MapPill(day?.let { shortDay(it) } ?: "Hele reis", CalendarGlyph, active = day != null, trailing = listOf(P("m6 9 6 6 6-6")), onClick = onOpen)
    }
}

/** The list of days: the whole trip above a line, every day under it with its number of photos. */
@Composable
fun DaySheet(state: TripMapState, onPick: (LocalDate?) -> Unit, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    AppSheet(onDismiss = onDismiss) {
        Text("Dag op de kaart", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface), modifier = Modifier.padding(horizontal = 20.dp))
        Text("Kies één dag om alleen die route en die foto's te zien.", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 12.dp))
        @Composable fun Row(label: String, count: String, chosen: Boolean, camera: Boolean, onClick: () -> Unit) {
            val bg by animateColorAsState(if (chosen) cs.secondaryContainer else cs.surfaceContainerHigh, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "dayRow")
            androidx.compose.foundation.layout.Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 2.dp).height(54.dp).clip(RoundedCornerShape(18.dp)).background(bg)
                    .dip { if (!chosen) haptics(Haptic.Tick); onClick() }.padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
                    androidx.compose.animation.AnimatedVisibility(chosen, enter = scaleIn(MaterialTheme.motionScheme.fastSpatialSpec()) + fadeIn(), exit = scaleOut() + fadeOut()) {
                        LineIcon(Glyphs.check, cs.primary, size = 20.dp, stroke = 2.6f)
                    }
                }
                Text(label, style = TitleStyle.copy(fontSize = 16.sp, color = cs.onSurface), modifier = Modifier.weight(1f).padding(start = 10.dp))
                if (camera) LineIcon(Glyphs.camera, cs.onSurfaceVariant, size = 15.dp, stroke = 1.9f, modifier = Modifier.padding(end = 5.dp))
                Text(count, style = ValueStyle.copy(color = cs.onSurfaceVariant))
            }
        }
        val dismiss = { close() }
        LazyColumn(Modifier.heightIn(max = 520.dp).padding(bottom = 16.dp)) {
            item { Row("Hele reis", "${state.days.size} dagen", state.day == null, camera = false) { onPick(null); dismiss() } }
            item { Box(Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 8.dp).height(1.dp).background(cs.outlineVariant)) }
            items(state.days, key = { it.day.toString() }) { d ->
                Row(shortDay(d.day), "${d.photos}", state.day == d.day, camera = true) { onPick(d.day); dismiss() }
            }
        }
    }
}

/** A word on the map that comes and goes by itself, such as why the map cannot find you. A tap does [onClick]. */
@Composable
fun MapNote(text: String?, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val cs = MaterialTheme.colorScheme
    var last by remember { mutableStateOf(text ?: "") }
    if (text != null) last = text
    AnimatedVisibility(
        text != null, modifier = modifier,
        enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + scaleIn(MaterialTheme.motionScheme.fastSpatialSpec(), initialScale = 0.9f),
        exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + scaleOut(MaterialTheme.motionScheme.fastSpatialSpec(), targetScale = 0.9f),
    ) {
        Text(
            last, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(550), fontSize = 13.5.sp, lineHeight = 18.sp, color = cs.inverseOnSurface),
            modifier = Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(18.dp)).background(cs.inverseSurface)
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp, vertical = 10.dp),
        )
    }
}

/** The round button that puts the map back on you; the icon turns the accent colour once a position is in. */
@Composable
fun LocateButton(hasFix: Boolean, busy: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    val tint by animateColorAsState(if (hasFix) cs.primary else cs.onSurfaceVariant, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "locate")
    Box(Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHighest).dip { haptics(Haptic.Tap); onClick() }, contentAlignment = Alignment.Center) {
        androidx.compose.animation.Crossfade(busy, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "locating") { b ->
            if (b) LoadingIndicator(Modifier.size(26.dp), color = cs.primary) else LineIcon(LocateGlyph, tint, size = 21.dp, stroke = 2f)
        }
    }
}

// ---- The line menu ----------------------------------------------------------------------------

/** Which planned leg a press landed on: the stop it arrives at, within 80 km of the straight line to it. */
fun nearestLeg(trip: Trip, at: LonLat): Stop? {
    var best: Pair<Stop, Double>? = null
    trip.stops.zipWithNext().forEach { (from, to) ->
        val ky = 110.57; val kx = 111.32 * kotlin.math.cos(Math.toRadians((from.at.second + to.at.second) / 2))
        val px = at.first * kx; val py = at.second * ky
        val ax = from.at.first * kx; val ay = from.at.second * ky
        val dx = to.at.first * kx - ax; val dy = to.at.second * ky - ay
        val len2 = dx * dx + dy * dy
        val t = if (len2 == 0.0) 0.0 else (((px - ax) * dx + (py - ay) * dy) / len2).coerceIn(0.0, 1.0)
        val d = kotlin.math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if (best == null || d < best!!.second) best = to to d
    }
    return best?.takeIf { it.second <= 80.0 }?.first
}

/** What a long press on the line offers, as the web: draw by road, draw a train ride, wipe a drawn stretch, hide a leg. */
@Composable
fun LineMenuSheet(trip: Trip, state: TripMapState, at: LonLat, onDismiss: () -> Unit, onTrain: (prefill: Pair<String, String>?) -> Unit, onDone: (String?) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val tripId = state.tripId ?: return
    val leg = remember(at) { nearestLeg(trip, at) }
    // Asked for, not waited for: the wipe comes in with the server's answer.
    var near by remember { mutableStateOf(false) }
    LaunchedEffect(at) { near = MapRemote.drawnNear(tripId, at) }
    val byTrain = leg?.mode == Mode.Train
    val hidden = leg?.id?.let { state.hiddenLegs[it] } ?: leg?.hideLeg ?: false
    fun act(close: () -> Unit, block: suspend () -> Unit, done: String) {
        close()
        scope.launch {
            onDone(runCatching { block(); state.reloadRoutes() }.fold({ done }, { it.message ?: "Dat lukte niet" }))
        }
    }
    AppSheet(onDismiss = onDismiss) {
        val dismiss = { close() }
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("Deze lijn", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface), modifier = Modifier.padding(start = 4.dp))
            Text("Wat wil je met het stuk route dat je ingedrukt hield?", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp, top = 4.dp, bottom = 12.dp))
            val draw = @Composable { i: Int, n: Int ->
                ChoiceRow(RouteGlyph, "Route via wegen tekenen", "Vult het dichtstbijzijnde rechte stuk aan via de snelste weg.", i, n) {
                    act(dismiss, { MapRemote.drawRoad(tripId, at) }, "Route via wegen getekend")
                }
            }
            val train = @Composable { i: Int, n: Int ->
                ChoiceRow(Glyphs.train, "Treinroute tekenen",
                    if (byTrain) "De leg naar ${leg!!.name} gaat met de trein. Kies je begin- en eindstation." else "Voor een treinreis zonder signaal: kies je begin- en eindstation.", i, n) {
                    val before = leg?.let { l -> trip.stops.getOrNull(trip.stops.indexOf(l) - 1) }
                    dismiss(); onTrain(if (leg != null && before != null) before.name to leg.name else null)
                }
            }
            val total = 2 + (if (leg != null) 1 else 0) + (if (near) 1 else 0)
            if (byTrain) { train(0, total); draw(1, total) } else { draw(0, total); train(1, total) }
            if (leg != null) {
                if (hidden) ChoiceRow(EyeOn, "Lijn naar ${leg.name} terugzetten", "De rechte lijn tussen deze twee stops komt terug.", 2, total) {
                    leg.id?.let { id -> state.hiddenLegs[id] = false; act(dismiss, { MapRemote.hideLeg(tripId, id, false) }, "Lijn teruggezet") }
                } else ChoiceRow(EyeOff, "Lijn naar ${leg.name} verwijderen", "De stop blijft staan; alleen de lijn ernaartoe verdwijnt.", 2, total, danger = true) {
                    leg.id?.let { id -> state.hiddenLegs[id] = true; act(dismiss, { MapRemote.hideLeg(tripId, id, true) }, "Lijn verwijderd") }
                }
            }
            // Only where there is something to wipe, so it comes in once the server said so.
            AnimatedVisibility(near, enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec())) {
                ChoiceRow(EraseGlyph, "Getekende route wissen", "Alleen dit automatisch getekende stuk. Je eigen GPS blijft staan.", total - 1, total, danger = true) {
                    act(dismiss, { MapRemote.wipeDrawn(tripId, at) }, "Getekende route gewist")
                }
            }
        }
    }
}

/** One choice of a sheet: its icon on a tile, a name and a line on what it does. */
@Composable
private fun ChoiceRow(icon: List<Shape24>, title: String, hint: String, i: Int, n: Int, danger: Boolean = false, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    Row(
        Modifier.fillMaxWidth().clip(slabShape(i, n)).background(cs.surfaceContainerHigh).dip { haptics(Haptic.Tap); onClick() }.padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(icon, i + 2, danger = danger)
        Column(Modifier.weight(1f).padding(start = 14.dp)) {
            Text(title, style = TitleStyle.copy(fontSize = 16.sp, color = if (danger) cs.error else cs.onSurface))
            Text(hint, style = ValueStyle.copy(color = cs.onSurfaceVariant, lineHeight = 17.sp))
        }
    }
}

// ---- The train sheet --------------------------------------------------------------------------

/**
 * Where the train left from and where it put you down: in a train the phone records almost nothing, so the
 * two stations are said out loud and the rails between them are drawn. Opened from a train leg, both boxes
 * look their station up themselves.
 */
@Composable
fun TrainSheet(prefill: Pair<String, String>?, onDraw: suspend (MapRemote.Station, MapRemote.Station) -> Unit, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var from by remember { mutableStateOf<MapRemote.Station?>(null) }
    var to by remember { mutableStateOf<MapRemote.Station?>(null) }
    var fromText by remember { mutableStateOf("") }
    var toText by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    AppSheet(onDismiss = onDismiss) {
        val dismiss = { close() }
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Treinroute tekenen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 22.sp, color = cs.onSurface), modifier = Modifier.padding(start = 4.dp))
            Hint("In de trein heeft je telefoon vaak geen signaal. Zeg van welk station naar welk station je ging, dan tekent hij het spoor ertussen en sluit hij het aan op je route ervoor en erna. Je foto's blijven staan.", Modifier.padding(horizontal = 4.dp))
            StationField("Vertrekstation", prefill?.first, from, { from = it }, { fromText = it })
            StationField("Aankomststation", prefill?.second, to, { to = it }, { toText = it })
            Note(error, true)
            ButtonRow {
                SoftButton("Annuleren", dismiss, Modifier.weight(1f))
                MainButton(if (busy) "Tekenen…" else "Route tekenen", {
                    if (busy) return@MainButton
                    busy = true; error = null
                    scope.launch {
                        // Whatever is typed and not yet picked is looked up now, so the button always means what it says.
                        val dep = from ?: fromText.takeIf { it.trim().length >= 2 }?.let { MapRemote.stations(it).firstOrNull() }
                        val arr = to ?: toText.takeIf { it.trim().length >= 2 }?.let { MapRemote.stations(it).firstOrNull() }
                        if (dep == null || arr == null) {
                            error = if (dep == null && arr == null) "Vul allebei de stations in." else if (dep == null) "Vul nog een vertrekstation in." else "Vul nog een aankomststation in."
                            busy = false; return@launch
                        }
                        from = dep; to = arr
                        runCatching { onDraw(dep, arr) }.onSuccess { dismiss() }.onFailure { error = it.message ?: "Dat lukte niet"; busy = false }
                    }
                }, Modifier.weight(1f), busy = busy)
            }
        }
    }
}

/** One station box: typing searches stations only; a pick becomes a chip with Wijzig. */
@Composable
private fun StationField(label: String, city: String?, value: MapRemote.Station?, onPick: (MapRemote.Station?) -> Unit, onType: (String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<MapRemote.Station>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    // Opened from a leg: that city's best station is picked straight away, the others one tap away.
    LaunchedEffect(city) {
        if (city.isNullOrBlank()) return@LaunchedEffect
        busy = true
        val found = MapRemote.stations(city)
        busy = false
        if (found.isNotEmpty()) { results = found; onPick(found.first()) } else { query = city; onType(city) }
    }
    LaunchedEffect(query) {
        if (query.trim().length < 2 || value != null) return@LaunchedEffect
        delay(320); busy = true
        results = MapRemote.stations(query)
        busy = false
    }
    Column {
        Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 6.dp, bottom = 6.dp))
        androidx.compose.animation.AnimatedContent(value, label = "station") { picked ->
            Row(
                Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest).padding(start = 16.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LineIcon(Glyphs.train, cs.onSurfaceVariant, size = 18.dp, stroke = 1.9f)
                if (picked != null) {
                    Column(Modifier.weight(1f).padding(start = 10.dp)) {
                        Text(picked.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface))
                        if (picked.region.isNotBlank()) Text(picked.region, maxLines = 1, overflow = TextOverflow.Ellipsis, style = ValueStyle.copy(fontSize = 12.sp, color = cs.onSurfaceVariant))
                    }
                    androidx.compose.material3.TextButton(onClick = { onPick(null); query = picked.name; onType(picked.name) }) {
                        Text("Wijzig", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.primary))
                    }
                } else {
                    Box(Modifier.weight(1f).padding(start = 10.dp)) {
                        if (query.isEmpty()) Text("Zoek een station", style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurfaceVariant.copy(alpha = 0.7f)))
                        BasicTextField(query, { query = it; onType(it) }, singleLine = true, textStyle = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurface), cursorBrush = SolidColor(cs.primary), modifier = Modifier.fillMaxWidth())
                    }
                    Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) { if (busy) LoadingIndicator(Modifier.size(22.dp)) }
                }
            }
        }
        // The stations keep their place while the next answer is on its way, so the row never jumps under a finger.
        AnimatedVisibility(value == null && results.isNotEmpty() && query.isNotBlank(), enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                results.take(5).forEachIndexed { i, s ->
                    Row(
                        Modifier.fillMaxWidth().clip(slabShape(i, minOf(5, results.size))).background(cs.surfaceContainerHigh).dip { onPick(s) }.padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(s.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TitleStyle.copy(fontSize = 15.sp, color = cs.onSurface))
                            Text(listOf(s.region, if (s.main) "hoofdstation" else "").filter { it.isNotBlank() }.joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis, style = ValueStyle.copy(fontSize = 12.sp, color = cs.onSurfaceVariant))
                        }
                    }
                }
            }
        }
    }
}

// ---- Map settings: whose routes and photos ------------------------------------------------------

/** What the map settings need to show the travellers: who, whose line and photos are on, and when they were last seen. */
class MapLayers(
    val members: List<Member>,
    val routeUsers: Set<String>,
    val photoUsers: Set<String>,
    val live: List<MapRemote.LiveFix>,
    val colorOf: (String) -> Color,
    val onRoute: (String) -> Unit,
    val onPhoto: (String) -> Unit,
    val onAllPhotos: (Boolean) -> Unit,
)

/** The two lists of the map settings, as the web's MapLayersSheet: routes per traveller, photos per traveller with all on or off. */
@Composable
fun MapLayersSections(layers: MapLayers) {
    val cs = MaterialTheme.colorScheme
    val me = Data.me?.id
    @Composable fun Title(text: String, hint: String) {
        Text(text, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, color = cs.onSurface), modifier = Modifier.padding(top = 4.dp, start = 4.dp))
        Text(hint, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, lineHeight = 18.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp, top = 2.dp, bottom = 10.dp))
    }
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(5_000); now = System.currentTimeMillis() } }
    Title("Routes op de kaart", "Wiens gevolgde route je ziet.")
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        layers.members.forEachIndexed { i, m ->
            val fix = layers.live.firstOrNull { it.userId == m.userId }
            val seen = fix?.let { f ->
                val mins = (now - f.time.toEpochMilli()) / 60_000
                (if (mins < 2) "zojuist gezien" else if (mins < 60) "$mins min geleden" else if (mins < 48 * 60) "${mins / 60} uur geleden" else "${mins / 1440} dagen geleden") to (mins < 15)
            }
            LayerRow(m, m.userId == me, layers.colorOf(m.userId), m.userId in layers.routeUsers, seen, i, layers.members.size) { layers.onRoute(m.userId) }
        }
    }
    Spacer(Modifier.height(20.dp))
    Title("Foto's op de kaart", "Wiens foto's als bolletjes op de kaart staan. Zet ze allemaal uit om alleen de route te zien.")
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        layers.members.forEachIndexed { i, m ->
            LayerRow(m, m.userId == me, layers.colorOf(m.userId), m.userId in layers.photoUsers, null, i, layers.members.size) { layers.onPhoto(m.userId) }
        }
    }
    val haptics = rememberHaptics()
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
        val all = layers.members.isNotEmpty() && layers.members.all { it.userId in layers.photoUsers }
        val none = layers.photoUsers.none { id -> layers.members.any { it.userId == id } }
        listOf(true to "Allemaal aan", false to "Allemaal uit").forEachIndexed { i, (on, label) ->
            ToggleButton(
                checked = if (on) all else none,
                onCheckedChange = { haptics(Haptic.Tick); layers.onAllPhotos(on) },
                modifier = Modifier.weight(1f).height(48.dp),
                shapes = if (i == 0) ButtonGroupDefaults.connectedLeadingButtonShapes() else ButtonGroupDefaults.connectedTrailingButtonShapes(),
                colors = ToggleButtonDefaults.toggleButtonColors(containerColor = cs.surfaceContainerHigh, contentColor = cs.onSurfaceVariant, checkedContainerColor = cs.primary, checkedContentColor = cs.onPrimary),
            ) { Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)) }
        }
    }
}

@Composable
private fun LayerRow(m: Member, me: Boolean, color: Color, on: Boolean, seen: Pair<String, Boolean>?, i: Int, n: Int, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    val fill by animateColorAsState(if (on) cs.primary else Color.Transparent, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "check")
    val tick by animateFloatAsState(if (on) 1f else 0f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "tick")
    Row(
        Modifier.fillMaxWidth().clip(slabShape(i, n)).background(cs.surfaceContainerHigh).dip { haptics.toggle(!on); onClick() }.padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(color).padding(2.5.dp)) {
            Avatar(m.userId, m.name, m.hasAvatar, color, Modifier.matchParentSize())
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(m.name + if (me) " (ik)" else "", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TitleStyle.copy(fontSize = 16.sp, color = cs.onSurface))
            if (seen != null) Text(seen.first, style = ValueStyle.copy(color = if (seen.second) cs.primary else cs.onSurfaceVariant))
        }
        Box(
            Modifier.size(26.dp).clip(CircleShape).background(fill).then(if (!on) Modifier.background(Color.Transparent) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            if (!on) Box(Modifier.size(26.dp).clip(CircleShape).background(cs.outlineVariant.copy(alpha = 0.5f)).padding(2.dp).clip(CircleShape).background(cs.surfaceContainerHigh))
            LineIcon(Glyphs.check, cs.onPrimary, size = 16.dp, stroke = 2.8f, modifier = Modifier.graphicsLayer { scaleX = tick; scaleY = tick; alpha = tick })
        }
    }
}

// ---- "X is bezig. Route bijhouden?" -----------------------------------------------------------

/** Kept per trip: once said Later, an ongoing trip does not ask again. */
object TrackPromptPref {
    private fun prefs(c: android.content.Context) = c.getSharedPreferences("mms.next.ui", android.content.Context.MODE_PRIVATE)
    fun dismissed(c: android.content.Context, tripId: String) = prefs(c).getString("trackPrompt", null) == tripId
    fun dismiss(c: android.content.Context, tripId: String) { prefs(c).edit().putString("trackPrompt", tripId).apply() }
}

/** Whether you may record your route on this trip: the organiser, or a companion the organiser lets track. */
fun canTrack(trip: Trip): Boolean {
    val me = Data.me?.id ?: return false
    val m = trip.members.firstOrNull { it.userId == me } ?: return trip.ownerId == me
    return m.role == "OWNER" || (m.role == "MEMBER" && m.canTrack)
}

/** The question on an ongoing trip you are not recording yet, as the web's tracking prompt; Later keeps it away for this trip. */
@Composable
fun TrackPrompt(trip: Trip, visible: Boolean, onLater: () -> Unit, onStart: () -> Unit, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    AnimatedVisibility(
        visible, modifier = modifier,
        enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + androidx.compose.animation.slideInVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) { it / 2 },
        exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + androidx.compose.animation.slideOutVertically(MaterialTheme.motionScheme.fastSpatialSpec()) { it / 2 },
    ) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(cs.secondaryContainer).padding(start = 18.dp, end = 12.dp, top = 16.dp, bottom = 12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LineIcon(Glyphs.pin, cs.onSecondaryContainer, size = 20.dp, stroke = 2f)
                Text(
                    androidx.compose.ui.text.buildAnnotatedString {
                        pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight(700))); append(trip.title); pop()
                        append(" is bezig. Route bijhouden?")
                    },
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, lineHeight = 20.sp, color = cs.onSecondaryContainer),
                    modifier = Modifier.padding(start = 10.dp),
                )
            }
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                val label = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)
                androidx.compose.material3.FilledTonalButton(onClick = onLater, shapes = androidx.compose.material3.ButtonDefaults.shapes(), modifier = Modifier.height(44.dp),
                    colors = androidx.compose.material3.ButtonDefaults.filledTonalButtonColors(containerColor = cs.surfaceContainerHighest)) { Text("Later", style = label) }
                androidx.compose.material3.Button(onClick = onStart, shapes = androidx.compose.material3.ButtonDefaults.shapes(), modifier = Modifier.height(44.dp)) { Text("Start tracking", style = label) }
            }
        }
    }
}

// ---- Picking a new stop's place on the map ----------------------------------------------------

/**
 * A map over the whole screen to tap the place of a new stop, as the web's planner lets you tap its map: the
 * spot gets a pin, the nearest town is looked up, and "Stop toevoegen" hands it to the planner.
 */
@Composable
fun MapPickDialog(trip: Trip, dark: Boolean, onPicked: (Remote.Place) -> Unit, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var spot by remember { mutableStateOf<LonLat?>(null) }
    var place by remember { mutableStateOf<Remote.Place?>(null) }
    val haptics = rememberHaptics()
    FullScreenLayer(onDismiss) { close ->
        Box(Modifier.fillMaxSize()) {
            PlainMap(
                dark, Modifier.fillMaxSize(),
                around = (trip.stops.map { it.at } + trip.route).ifEmpty { listOf(HomeAirport) },
                pin = spot,
                onTap = { at ->
                    haptics(Haptic.Tap)
                    spot = at; place = null
                    scope.launch { place = runCatching { MapRemote.placeAt(at) }.getOrNull() ?: Remote.Place("%.4f, %.4f".format(java.util.Locale.ROOT, at.second, at.first), "", null, at) }
                },
            )
            Column(Modifier.statusBarsPadding().padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(48.dp).clip(CircleShape).background(cs.surfaceContainerHighest).dip { close() }, contentAlignment = Alignment.Center) {
                        LineIcon(listOf(P("M18 6 6 18"), P("m6 6 12 12")), cs.onSurface, size = 22.dp, stroke = 2.2f)
                    }
                    Text("Tik op de kaart waar de stop komt", maxLines = 1, overflow = TextOverflow.Ellipsis,
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface),
                        modifier = Modifier.padding(start = 10.dp).clip(CircleShape).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp, vertical = 12.dp))
                }
            }
            AnimatedVisibility(
                spot != null, modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(16.dp),
                enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + androidx.compose.animation.slideInVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) { it / 2 },
                exit = fadeOut() + androidx.compose.animation.slideOutVertically { it / 2 },
            ) {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(cs.surfaceContainerHighest).padding(start = 18.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        androidx.compose.animation.Crossfade(place, animationSpec = MaterialTheme.motionScheme.defaultEffectsSpec(), label = "place") { p ->
                            Column {
                                Text(p?.name ?: "Plaats opzoeken…", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TitleStyle.copy(color = cs.onSurface))
                                Text(p?.region?.takeIf { it.isNotBlank() } ?: " ", maxLines = 1, overflow = TextOverflow.Ellipsis, style = ValueStyle.copy(color = cs.onSurfaceVariant))
                            }
                        }
                    }
                    androidx.compose.material3.Button(
                        onClick = { place?.let { haptics(Haptic.Confirm); onPicked(it); close() } }, enabled = place != null,
                        shapes = androidx.compose.material3.ButtonDefaults.shapes(), modifier = Modifier.height(48.dp),
                    ) { Text("Stop toevoegen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)) }
                }
            }
        }
    }
    @Suppress("UNUSED_EXPRESSION") context
}

/**
 * The corners of a trip map: bottom right your own spot over the expand button, bottom left the day and (when
 * the photos are switched off) a word that says so, and in the middle a passing note.
 */
@Composable
fun androidx.compose.foundation.layout.BoxScope.MapCorners(
    state: TripMapState, showLocate: Boolean, locating: Boolean, note: Pair<String, Boolean>?,
    onDays: () -> Unit, onLocate: () -> Unit, onPhotosOff: () -> Unit, onNote: () -> Unit,
    expand: @Composable () -> Unit,
) {
    val motion = MaterialTheme.motionScheme
    Column(Modifier.align(Alignment.BottomEnd), horizontalAlignment = Alignment.End) {
        AnimatedVisibility(showLocate, enter = fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.fastSpatialSpec(), initialScale = 0.6f), exit = fadeOut(motion.fastEffectsSpec()) + scaleOut(motion.fastSpatialSpec(), targetScale = 0.6f)) {
            Column {
                LocateButton(state.self != null, locating, onLocate)
                Spacer(Modifier.height(10.dp))
            }
        }
        expand()
    }
    // Level with the round buttons: a 40 dp pill on a 48 dp button's line.
    Column(Modifier.align(Alignment.BottomStart).padding(bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AnimatedVisibility(state.photoUsers?.isEmpty() == true, enter = fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.fastSpatialSpec(), initialScale = 0.8f), exit = fadeOut(motion.fastEffectsSpec()) + scaleOut(motion.fastSpatialSpec(), targetScale = 0.8f)) {
            MapPill("Foto's staan uit op de kaart", Glyphs.camera, onClick = onPhotosOff)
        }
        DayPill(state, onDays)
    }
    MapNote(note?.first, Modifier.align(Alignment.BottomCenter).padding(bottom = 60.dp), onClick = if (note?.second == true) onNote else null)
}
