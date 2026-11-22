package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.luminance
import androidx.compose.material3.toPath
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneOffset

/*
 * Reisinstellingen, the web's trip settings page as a page of its own: the cover, name, dates and colour
 * (saved by themselves shortly after you stop), the figures on the cover, fetching the photos, the dot on
 * the globe, tracking, people, and everything that throws something away together at the bottom.
 */

/** The web's curated swatches; Auto (null) lets the app pick. */
private val TripColors = listOf("#E8613C", "#E0993A", "#4CA05C", "#2A8F85", "#409EC5", "#5A6EE1", "#B054A8", "#DF5C78")

/** A save that must still go out when the page has already closed. */
private val LeaveScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TripSettingsPage(trip: Trip, onBack: () -> Unit, onChanged: () -> Unit, onPeople: () -> Unit, onGone: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val id = trip.remoteId ?: trip.id
    val me = Data.me?.id
    val isOwner = trip.ownerId != null && trip.ownerId == me
    val myRole = trip.members.firstOrNull { it.userId == me }?.role
    val canEdit = isOwner || (myRole != null && myRole != "GUEST")
    val ended = trip.start != null && trip.start.plusDays(trip.days.toLong()).isBefore(LocalDate.now())

    // From the cached trip list first, so colour, tracking and the dot are right from the first frame.
    val cached = remember(id) { SettingsRemote.cachedTrip(id) }
    var info by remember { mutableStateOf(cached) }
    var title by remember { mutableStateOf(cached?.title ?: trip.title) }
    var start by remember { mutableStateOf(cached?.start ?: trip.start?.toString() ?: "") }
    var end by remember { mutableStateOf(cached?.end ?: trip.start?.plusDays((trip.days - 1).toLong())?.toString() ?: "") }
    var autoTrack by remember { mutableStateOf(cached?.autoTrack ?: false) }
    var color by remember { mutableStateOf(cached?.color) }
    LaunchedEffect(id) {
        runCatching { SettingsRemote.trip(id) }.onSuccess {
            info = it; title = it.title; start = it.start; end = it.end; autoTrack = it.autoTrack; color = it.color
        }
    }
    // Saves by itself 700 ms after the last change, as on the web; leaving the page sends what is left.
    var saving by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val dirty = info?.let { title != it.title || start != it.start || end != it.end || autoTrack != it.autoTrack } == true
    suspend fun save() {
        val i = info ?: return
        if (title.isBlank()) return
        saving = true; error = null
        runCatching { SettingsRemote.saveTrip(id, title, start, end, autoTrack) }
            .onSuccess { info = i.copy(title = title, start = start, end = end, autoTrack = autoTrack); saved = true; onChanged() }
            .onFailure { error = it.message ?: "Opslaan mislukt" }
        saving = false
    }
    LaunchedEffect(title, start, end, autoTrack, info) {
        if (!dirty || !isOwner) return@LaunchedEffect
        delay(700); save()
    }
    LaunchedEffect(saved) { if (saved) { delay(1600); saved = false } }
    val latest = remember { arrayOfNulls<() -> Unit>(1) }
    latest[0] = { if (dirty && isOwner && title.isNotBlank()) { val t = title; val s = start; val e = end; val a = autoTrack; LeaveScope.launch { runCatching { SettingsRemote.saveTrip(id, t, s, e, a) }; Data.load() } } }
    DisposableEffect(Unit) { onDispose { latest[0]?.invoke() } }

    // The trip's colour on this page glides to a new pick.
    val pickedColor = color?.let { runCatching { Color(android.graphics.Color.parseColor(it)) }.getOrNull() } ?: trip.color
    val accent by animateColorAsState(pickedColor, MaterialTheme.motionScheme.slowEffectsSpec(), label = "accent")

    SettingsScaffold("Reisinstellingen", onBack, trailing = {
        // Whether the last change is saved: an hourglass while it goes, a tick once it is there.
        AnimatedContent(if (saving) 1 else if (saved) 2 else 0, transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.6f)) togetherWith (fadeOut() + scaleOut(targetScale = 0.6f)) }, label = "autosave") { s ->
            Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                if (s != 0) LineIcon(if (s == 1) Glyphs.hourglass else Glyphs.check, cs.primary, size = 20.dp, stroke = 2.2f)
            }
        }
    }) {
        CoverHeader(trip, info?.coverId ?: trip.coverId, title, start, end, accent, canPick = isOwner, onPicked = {
            onChanged()
            // Only the cover from the server (Automatisch is resolved there), never the fields still being typed.
            scope.launch { runCatching { SettingsRemote.trip(id) }.onSuccess { fresh -> info = info?.copy(coverId = fresh.coverId) } }
        })

        if (isOwner) {
            Header("Reis")
            Panel {
                FormField("Naam", title, { title = it.take(120) }, capitalize = true)
                DatesField(start, end) { s, e -> start = s; end = e }
                Note(error, true)
            }
            Header("Kleur op de globe en de kaart")
            Panel {
                ColorPicker(color, onPick = { hex ->
                    color = hex
                    scope.launch { runCatching { SettingsRemote.setColor(id, hex) }.onSuccess { onChanged() }.onFailure { error = it.message ?: "Kleur opslaan mislukt" } }
                })
            }
            FactsPanel(trip, id, accent)
        } else {
            Spacer(Modifier.height(16.dp))
            Panel { Hint(if (canEdit) "Alleen de organisator kan de naam, datums en kleur wijzigen." else "Je bent gast op deze reis: je kunt hem bekijken, niet aanpassen.") }
        }

        if (canEdit) SyncPanel(id, onChanged)
        if (isOwner) MarkerPanel(trip, id, info)

        Header("Tracking")
        Group(null, listOf(
            Item(
                Glyphs.pin, "Automatisch tracken",
                if (ended) "Deze reis is afgelopen" else "Start route-tracking vanzelf zodra de reis begint, in de app op je telefoon",
                toggle = autoTrack, enabled = isOwner && !ended && info != null,
                action = { autoTrack = !autoTrack },
            ),
        ))

        Header("Mensen")
        Group(null, listOf(Item(Glyphs.friends, "Reisgenoten en delen", "${trip.members.count { it.role != "GUEST" }} reizigers · ${trip.members.count { it.role == "GUEST" }} gasten", action = onPeople)))

        DangerPanel(trip, id, isOwner, canEdit, onGone)
    }
}

/** The cover as the trip's card shows it, with the trip's colour under it gliding to a new pick. */
@Composable
private fun CoverHeader(trip: Trip, coverId: String?, title: String, start: String, end: String, accent: Color, canPick: Boolean, onPicked: () -> Unit) {
    var pick by remember { mutableStateOf(false) }
    Spacer(Modifier.height(16.dp))
    // Darkened a little, so the white name on it reads on every colour (a yellow or light blue too).
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(androidx.compose.ui.graphics.lerp(accent, Color.Black, 0.3f))) {
        Box(Modifier.fillMaxWidth().height(180.dp)) {
            Cover(trip.copy(coverId = coverId), Modifier.fillMaxSize(), size = "preview")
            if (canPick) Box(Modifier.align(Alignment.BottomEnd).padding(12.dp)) {
                Row(
                    Modifier.clip(CircleShape).background(Color.Black.copy(alpha = 0.45f)).dip { pick = true }.padding(horizontal = 14.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    LineIcon(Glyphs.photo, Color.White, size = 16.dp, stroke = 2f)
                    Text("Cover kiezen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = Color.White), modifier = Modifier.padding(start = 6.dp))
                }
            }
        }
        Column(Modifier.padding(horizontal = 18.dp, vertical = 14.dp)) {
            Text(title.ifBlank { trip.title }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(600), fontSize = 22.sp, color = Color.White))
            Text(rangeText(start, end), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(550), fontSize = 13.5.sp, color = Color.White.copy(alpha = 0.85f)))
        }
    }
    if (pick) CoverSheet(trip, coverId, onDismiss = { pick = false }, onPicked = onPicked)
}

private val Months = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")

private fun rangeText(start: String, end: String): String = runCatching {
    val a = LocalDate.parse(start); val b = LocalDate.parse(end)
    val tail = "${b.dayOfMonth} ${Months[b.monthValue - 1]} ${b.year}"
    if (a.month == b.month && a.year == b.year) "${a.dayOfMonth} t/m $tail" else "${a.dayOfMonth} ${Months[a.monthValue - 1]}${if (a.year != b.year) " ${a.year}" else ""} t/m $tail"
}.getOrDefault("")

/** The trip's photos to pick the cover from; Automatisch lets the server choose. */
@Composable
private fun CoverSheet(trip: Trip, current: String?, onDismiss: () -> Unit, onPicked: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val media by produceState<List<Media>?>(null, trip.id) { value = runCatching { Remote.media(trip) }.getOrDefault(emptyList()) }
    var chosen by remember { mutableStateOf(current) }
    fun choose(mediaId: String?) {
        chosen = mediaId
        scope.launch {
            runCatching { Api.send("PATCH", "/api/trips/${trip.remoteId}", org.json.JSONObject().put("coverMediaId", mediaId ?: org.json.JSONObject.NULL)) }.onSuccess { onPicked() }
            onDismiss()
        }
    }
    AppSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Coverfoto", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface), modifier = Modifier.weight(1f))
                SoftButton("Automatisch", { choose(null) }, icon = Glyphs.cardAuto)
            }
            Hint("Tik een foto aan om hem de cover van deze reis te maken.", Modifier.padding(top = 6.dp, bottom = 12.dp))
            val list = media
            if (list == null) LazyVerticalGrid(GridCells.Fixed(3), Modifier.height(360.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp), userScrollEnabled = false) {
                items(List(9) { it }) { Placeholder(Modifier.aspectRatio(1f).clip(RoundedCornerShape(10.dp))) }
            } else if (list.isEmpty()) Hint("Nog geen foto's in deze reis.", Modifier.padding(bottom = 24.dp))
            else LazyVerticalGrid(GridCells.Fixed(3), Modifier.height(480.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(list.filter { !it.video }, key = { it.id }) { m ->
                    val on = m.id == chosen
                    Box(Modifier.aspectRatio(1f).clip(RoundedCornerShape(if (on) 22.dp else 10.dp)).dip { choose(m.id) }) {
                        RemotePhoto(m.id, Modifier.fillMaxSize())
                        if (on) Box(Modifier.align(Alignment.TopEnd).padding(6.dp).size(26.dp).clip(CircleShape).background(cs.primary), contentAlignment = Alignment.Center) {
                            LineIcon(Glyphs.check, cs.onPrimary, size = 16.dp, stroke = 2.6f)
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** Start and end as one row that opens Material's range picker. */
@Composable
private fun DatesField(start: String, end: String, onChange: (String, String) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var open by remember { mutableStateOf(false) }
    Column {
        Text("Datums", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 6.dp, bottom = 6.dp))
        Row(
            Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest).dip { open = true }.padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(rangeText(start, end).ifBlank { "Kies de datums" }, style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurface), modifier = Modifier.weight(1f))
            LineIcon(listOf(P("M8 2v4"), P("M16 2v4"), P("M3 10h18"), P("M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z")), cs.onSurfaceVariant, size = 20.dp)
        }
    }
    if (open) {
        val state = remember { androidx.compose.material3.DateRangePickerState(locale = DutchLocale, initialSelectedStartDateMillis = millis(start), initialSelectedEndDateMillis = millis(end)) }
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    val s = state.selectedStartDateMillis; val e = state.selectedEndDateMillis ?: s
                    if (s != null && e != null) onChange(isoDay(s), isoDay(e))
                    open = false
                }, enabled = state.selectedStartDateMillis != null) { Text("Klaar", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Annuleren", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
        ) {
            Dutch {
                DateRangePicker(
                    state, Modifier.height(520.dp), showModeToggle = false,
                    title = { Text("Datums van de reis", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp), modifier = Modifier.padding(start = 24.dp, top = 16.dp)) },
                    headline = {
                        val s = state.selectedStartDateMillis?.let { isoDay(it) }; val e = state.selectedEndDateMillis?.let { isoDay(it) }
                        Text(
                            when { s == null -> "Kies het begin"; e == null -> "${shortDate(s)}, kies het eind"; else -> rangeText(s, e) },
                            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 22.sp), modifier = Modifier.padding(start = 24.dp, bottom = 12.dp),
                        )
                    },
                )
            }
        }
    }
}

private fun millis(iso: String): Long? = runCatching { LocalDate.parse(iso).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
private fun isoDay(ms: Long): String = java.time.Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()

/** A shape that morphs from a circle into the cookie the chosen swatch wears. */
private class MorphShape(private val morph: androidx.graphics.shapes.Morph, private val progress: Float) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val path = morph.toPath(progress, Path())
        path.transform(Matrix().apply { scale(size.width, size.height) })
        return Outline.Generic(path)
    }
}

/** Auto and the eight swatches; the chosen one grows into a cookie with a tick, on an expressive spring. */
@Composable
private fun ColorPicker(current: String?, onPick: (String?) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val morph = remember { androidx.graphics.shapes.Morph(MaterialShapes.Circle, MaterialShapes.Cookie9Sided) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // A colour from before these eight (the old palette) comes first, so the current choice is always marked.
        val own = current?.takeIf { c -> TripColors.none { it.equals(c, ignoreCase = true) } && runCatching { android.graphics.Color.parseColor(c) }.isSuccess }
        val all = listOf<String?>(null) + listOfNotNull(own) + TripColors
        all.chunked(5).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                row.forEach { hex ->
                    val on = if (hex == null) current == null else current.equals(hex, ignoreCase = true)
                    val t by animateFloatAsState(if (on) 1f else 0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow), label = "swatch")
                    val fill = hex?.let { Color(android.graphics.Color.parseColor(it)) } ?: cs.surfaceContainerHighest
                    Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) {
                        Box(
                            Modifier.size(48.dp).graphicsLayer { val k = 1f + 0.12f * t; scaleX = k; scaleY = k; rotationZ = 40f * t }
                                .clip(MorphShape(morph, t.coerceIn(0f, 1f))).background(fill).dip { onPick(hex) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(Modifier.graphicsLayer { rotationZ = -40f * t }, contentAlignment = Alignment.Center) {
                                if (hex == null && t < 0.5f) Text("Auto", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 12.sp, color = cs.onSurface))
                                if (t > 0.01f) LineIcon(listOf(P("m5 12 5 5 9-10")), if (hex == null) cs.onSurface else Color.White, size = 20.dp, stroke = 2.6f, modifier = Modifier.graphicsLayer { scaleX = t; scaleY = t; alpha = t.coerceIn(0f, 1f) })
                            }
                        }
                    }
                }
                repeat(5 - row.size) { Spacer(Modifier.size(56.dp)) }
            }
        }
        Hint("Auto kiest een kleur die past bij je andere reizen.")
    }
}

/** Which four figures the trip's page shows under its cover. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FactsPanel(trip: Trip, id: String, accent: Color) {
    val cs = MaterialTheme.colorScheme
    val chosen = TripFactsPref.chosen[trip.id]
    Header("Feitjes op de cover")
    Panel {
        Hint("Er is plek voor vier. Kies je niets, dan neemt de app de eerste vier die deze reis heeft.")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FactChip("Automatisch", chosen == null, enabled = true) { TripFactsPref.set(trip.id, null) }
            TripFactsPref.Ids.forEach { f ->
                val on = chosen?.contains(f) == true
                val full = !on && (chosen?.size ?: 0) >= TripFactsPref.MAX
                FactChip(TripFactsPref.Names[f] ?: f, on, enabled = !full) {
                    val now = chosen.orEmpty()
                    TripFactsPref.set(trip.id, if (on) now - f else now + f)
                }
            }
        }
    }
}

@Composable
private fun FactChip(label: String, on: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val bg by animateColorAsState(if (on) cs.primary else cs.surfaceContainerHigh, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "chip")
    val ink by animateColorAsState(if (on) cs.onPrimary else cs.onSurface, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "chipInk")
    val alpha by animateFloatAsState(if (enabled) 1f else 0.4f, label = "chipAlpha")
    Row(
        Modifier.height(44.dp).graphicsLayer { this.alpha = alpha }.clip(CircleShape).background(bg).then(if (enabled) Modifier.dip(onClick) else Modifier).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AnimatedVisibility(on, enter = fadeIn() + androidx.compose.animation.expandHorizontally(), exit = fadeOut() + androidx.compose.animation.shrinkHorizontally()) {
            LineIcon(Glyphs.check, ink, size = 16.dp, stroke = 2.6f, modifier = Modifier.padding(end = 6.dp))
        }
        Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = ink))
    }
}

/** Fetch the trip's photos from Immich again now, and say what came in. */
@Composable
private fun SyncPanel(id: String, onChanged: () -> Unit) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    Header("Foto's")
    Panel {
        Hint("Kijkt in Immich welke foto's op de dagen van deze reis genomen zijn en zet ze in de tijdlijn; met een locatie ook op de kaart.")
        MainButton("Foto's syncen", {
            busy = true; note = null
            scope.launch {
                note = runCatching { SettingsRemote.sync(id) }.fold({ r ->
                    onChanged()
                    "${r.added} ${if (r.added == 1) "nieuwe foto" else "nieuwe foto's"} (${r.found} gevonden, ${r.users} ${if (r.users == 1) "reiziger" else "reizigers"})" to false
                }, { (it.message ?: "Sync mislukt") to true })
                busy = false
            }
        }, Modifier.fillMaxWidth(), icon = Glyphs.download, busy = busy)
        Note(note?.first, note?.second == true)
    }
}

/** One dot on the globe at a place you choose, instead of one at the start and one at the end. */
@Composable
private fun MarkerPanel(trip: Trip, id: String, info: SettingsRemote.TripInfo?) {
    val scope = rememberCoroutineScope()
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    var marker by remember(info) { mutableStateOf(info?.let { i -> if (i.markerLng != null && i.markerLat != null) i.markerLng to i.markerLat else null }) }
    var placing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun save(p: LonLat?) {
        marker = p
        scope.launch { runCatching { SettingsRemote.setMarker(id, p) }.onFailure { error = it.message ?: "Markering opslaan mislukt" } }
    }
    Header("Bolletje op de globe")
    val motion = MaterialTheme.motionScheme
    val enter = fadeIn(motion.defaultEffectsSpec()) + expandVertically(motion.defaultSpatialSpec())
    val exit = fadeOut(motion.fastEffectsSpec()) + shrinkVertically(motion.defaultSpatialSpec())
    Panel(Modifier.animateContentSize(motion.defaultSpatialSpec())) {
        // The text changes with a cross-fade and the panel grows to it, so nothing jumps.
        androidx.compose.animation.Crossfade(if (marker != null) 2 else if (placing) 1 else 0, animationSpec = motion.defaultEffectsSpec(), label = "markerHint") { st ->
            Hint(
                when (st) {
                    2 -> "Eigen plek ingesteld. Tik op de kaart om hem te verplaatsen."
                    1 -> "Tik op de kaart om de plek te kiezen."
                    else -> "Op de globe staat deze reis met een bolletje op het begin en het eind. Kies hier één eigen plek, handig bij een rondreis."
                },
            )
        }
        AnimatedVisibility(marker != null || placing, enter = enter, exit = exit) {
            MarkerMap(trip, marker, dark, Modifier.fillMaxWidth().height(260.dp).clip(RoundedCornerShape(20.dp))) { save(it) }
        }
        // One button at a time: each comes in and goes out on its own, growing and fading.
        Column {
            AnimatedVisibility(marker != null, enter = enter, exit = exit) {
                SoftButton("Terug naar automatisch", { save(null); placing = false }, Modifier.fillMaxWidth())
            }
            AnimatedVisibility(marker == null && !placing, enter = enter, exit = exit) {
                SoftButton("Bolletje zelf plaatsen", { placing = true }, Modifier.fillMaxWidth(), icon = Glyphs.pin, enabled = info != null)
            }
            AnimatedVisibility(marker == null && placing, enter = enter, exit = exit) {
                SoftButton("Annuleren", { placing = false }, Modifier.fillMaxWidth())
            }
        }
        Note(error, true)
    }
}

/** Danger at the bottom: wiping your tracked route or the drawn roads, deleting or leaving the trip. */
@Composable
private fun DangerPanel(trip: Trip, id: String, isOwner: Boolean, canEdit: Boolean, onGone: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    var ask by remember { mutableStateOf<String?>(null) }
    var day by remember { mutableStateOf<String?>(null) }
    var pickDay by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var typed by remember { mutableStateOf("") }
    Header("Verwijderen")
    if (canEdit) Panel {
        Text("Getrackte data wissen", style = TitleStyle.copy(color = cs.onSurface))
        Hint("Verwijdert jouw GPS-route; de reis en de foto's blijven. Kies een dag, of wis alles.")
        ButtonRow {
            SoftButton(day?.let { shortDate(it) } ?: "Kies een dag", { pickDay = true }, Modifier.weight(1f), icon = listOf(P("M8 2v4"), P("M16 2v4"), P("M3 10h18"), P("M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z")))
            QuietDangerButton("Wis dag", { ask = "day" }, Modifier.weight(1f), enabled = day != null && !busy)
        }
        QuietDangerButton("Alles wissen", { ask = "all" }, Modifier.fillMaxWidth(), enabled = !busy)
    }
    if (canEdit) {
        Spacer(Modifier.height(10.dp))
        Panel {
            Text("Getekende routes wissen", style = TitleStyle.copy(color = cs.onSurface))
            PathHint("Alleen de routes die je tekende via ", listOf("Ingedrukt houden", "Route via wegen"), ". Je eigen getrackte GPS blijft staan.")
            QuietDangerButton("Wissen", { ask = "routes" }, Modifier.fillMaxWidth(), enabled = !busy)
        }
    }
    Note(note?.first, note?.second == true)
    Spacer(Modifier.height(10.dp))
    if (isOwner) MainButton("Reis verwijderen", { typed = ""; ask = "delete" }, Modifier.fillMaxWidth(), icon = Glyphs.trash, danger = true)
    else MainButton("Reis verlaten", { ask = "leave" }, Modifier.fillMaxWidth(), icon = Glyphs.signOut, danger = true)

    fun run(block: suspend () -> String) {
        busy = true; note = null
        scope.launch { note = runCatching { block() }.fold({ it to false }, { (it.message ?: "Wissen mislukt") to true }); busy = false }
    }
    when (ask) {
        "day" -> Confirm("Tracking wissen?", "Weet je zeker dat je de tracking van ${day?.let { shortDate(it) }} wilt verwijderen? Dit kan niet ongedaan worden gemaakt.", "Wissen",
            onConfirm = { val d = day; run { val n = SettingsRemote.wipeTracked(id, d); day = null; "$n ${if (n == 1) "trackpunt" else "trackpunten"} verwijderd." } }, onDismiss = { ask = null })
        "all" -> Confirm("Tracking wissen?", "Weet je zeker dat je alle getrackte data van deze reis wilt verwijderen? Dit kan niet ongedaan worden gemaakt.", "Wissen",
            onConfirm = { run { val n = SettingsRemote.wipeTracked(id, null); "$n ${if (n == 1) "trackpunt" else "trackpunten"} verwijderd." } }, onDismiss = { ask = null })
        "routes" -> Confirm("Getekende routes wissen?", "Alleen de automatisch getekende routes worden verwijderd. Je eigen getrackte GPS blijft staan.", "Wissen",
            onConfirm = { run { val n = SettingsRemote.wipeRouteFills(id); "$n ${if (n == 1) "routepunt" else "routepunten"} verwijderd." } }, onDismiss = { ask = null })
        "delete" -> Confirm(
            "Reis verwijderen?", "${trip.title} wordt verwijderd met alle stops, routes en notities. Je foto's blijven in Immich. Typ de naam van de reis om te bevestigen.", "Verwijderen",
            confirmEnabled = typed.trim() == trip.title.trim(),
            extra = { FormField("Naam van de reis", typed, { typed = it }, hint = trip.title) },
            onConfirm = { scope.launch { runCatching { Remote.deleteTrip(trip) }.onSuccess { Data.load(); onGone() }.onFailure { note = (it.message ?: "Verwijderen mislukt") to true } } },
            onDismiss = { ask = null },
        )
        "leave" -> Confirm("Reis verlaten?", "Je verdwijnt uit ${trip.title}. De organisator kan je later opnieuw toevoegen.", "Verlaten",
            onConfirm = { scope.launch { runCatching { Remote.leaveTrip(trip) }.onSuccess { Data.load(); onGone() }.onFailure { note = (it.message ?: "Verlaten mislukt") to true } } },
            onDismiss = { ask = null })
    }
    if (pickDay) {
        val first = trip.start ?: LocalDate.now()
        val last = first.plusDays((trip.days - 1).coerceAtLeast(0).toLong())
        val state = remember { androidx.compose.material3.DatePickerState(
            initialSelectedDateMillis = millis((day ?: first.toString())),
            initialDisplayedMonthMillis = millis(first.withDayOfMonth(1).toString()),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean = LocalDate.parse(isoDay(utcTimeMillis)).let { !it.isBefore(first) && !it.isAfter(last) }
                override fun isSelectableYear(year: Int): Boolean = year in first.year..last.year
            },
            locale = DutchLocale,
        ) }
        DatePickerDialog(
            onDismissRequest = { pickDay = false },
            confirmButton = { TextButton(onClick = { state.selectedDateMillis?.let { day = isoDay(it) }; pickDay = false }) { Text("Klaar", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
            dismissButton = { TextButton(onClick = { pickDay = false }) { Text("Annuleren", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600))) } },
        ) {
            Dutch {
                DatePicker(
                    state, showModeToggle = false,
                    title = { Text("Dag om te wissen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp), modifier = Modifier.padding(start = 24.dp, top = 16.dp)) },
                    headline = { Text(state.selectedDateMillis?.let { shortDate(isoDay(it)) } ?: "Kies een dag", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 22.sp), modifier = Modifier.padding(start = 24.dp, bottom = 12.dp)) },
                )
            }
        }
    }
}

/** A small map of the trip: a tap puts the dot there. Lives and dies with the page, as the trip's map does. */
@Composable
private fun MarkerMap(trip: Trip, marker: LonLat?, dark: Boolean, modifier: Modifier, onPlace: (LonLat) -> Unit) {
    val context = LocalContext.current
    val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
    val color = MaterialTheme.colorScheme.primary.toArgb()
    val view = remember {
        org.maplibre.android.MapLibre.getInstance(context)
        org.maplibre.android.maps.MapView(
            context,
            org.maplibre.android.maps.MapLibreMapOptions.createFromAttributes(context).textureMode(true).attributionEnabled(false).logoEnabled(false)
                .foregroundLoadColor(if (dark) 0xFF14181D.toInt() else 0xFFF3ECE2.toInt()),
        ).apply { onCreate(null) }
    }
    DisposableEffect(lifecycle, view) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, e ->
            when (e) {
                androidx.lifecycle.Lifecycle.Event.ON_START -> view.onStart()
                androidx.lifecycle.Lifecycle.Event.ON_RESUME -> view.onResume()
                androidx.lifecycle.Lifecycle.Event.ON_PAUSE -> view.onPause()
                androidx.lifecycle.Lifecycle.Event.ON_STOP -> view.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) view.onStart()
        if (lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) view.onResume()
        onDispose { lifecycle.removeObserver(observer); view.onPause(); view.onStop(); view.onDestroy() }
    }
    val place = remember { arrayOfNulls<(LonLat) -> Unit>(1) }
    place[0] = onPlace
    val style = remember { arrayOfNulls<org.maplibre.android.maps.Style>(1) }
    fun point(p: LonLat?) = org.maplibre.geojson.FeatureCollection.fromFeatures(
        listOfNotNull(p?.let { org.maplibre.geojson.Feature.fromGeometry(org.maplibre.geojson.Point.fromLngLat(it.first, it.second)) }),
    )
    LaunchedEffect(marker) { (style[0]?.getSource("mms-marker") as? org.maplibre.android.style.sources.GeoJsonSource)?.setGeoJson(point(marker)) }
    androidx.compose.ui.viewinterop.AndroidView(factory = {
        view.getMapAsync { m ->
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.isCompassEnabled = false
            val uri = if (dark) "https://tiles.openfreemap.org/styles/dark" else "https://tiles.openfreemap.org/styles/positron"
            m.setStyle(org.maplibre.android.maps.Style.Builder().fromUri(uri)) { st ->
                style[0] = st
                st.addSource(org.maplibre.android.style.sources.GeoJsonSource("mms-marker", point(marker)))
                st.addLayer(
                    org.maplibre.android.style.layers.CircleLayer("mms-marker-dot", "mms-marker").withProperties(
                        org.maplibre.android.style.layers.PropertyFactory.circleRadius(9f),
                        org.maplibre.android.style.layers.PropertyFactory.circleColor(color),
                        org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor(android.graphics.Color.WHITE),
                        org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth(3f),
                    ),
                )
                val around = (listOfNotNull(marker) + trip.stops.map { it.at } + trip.route).ifEmpty { listOf(HomeAirport) }
                val lat = around.map { it.second }.average(); val lon = around.map { it.first }.average()
                m.cameraPosition = org.maplibre.android.camera.CameraPosition.Builder().target(org.maplibre.android.geometry.LatLng(lat, lon)).zoom(if (marker != null) 6.0 else 4.0).build()
            }
            m.addOnMapClickListener { ll -> place[0]?.invoke(ll.longitude to ll.latitude); true }
        }
        view
    }, modifier = modifier)
}

/**
 * The figures picked for this trip in its settings, in the order picked, or null to let the page choose.
 * A figure the trip has nothing to say about yet waits as a quiet shape (null value), as the page's own do.
 */
fun chosenFacts(trip: Trip, photos: Int?, stopsKnown: Boolean): List<Pair<String?, String>>? {
    val ids = TripFactsPref.chosen[trip.id] ?: return null
    return ids.map { f ->
        when (f) {
            "km" -> (trip.km?.let { "%,d".format(it).replace(',', '.') } ?: "0") to "kilometer"
            "days" -> "${trip.days}" to (if (trip.days == 1) "dag" else "dagen")
            "stops" -> (if (stopsKnown) "${trip.stops.size}" else null) to (if (trip.stops.size == 1) "stop" else "stops")
            "photos" -> (photos?.toString() ?: if (trip.remoteId != null) null else "${trip.photos}") to "foto's"
            "travellers" -> "${trip.people.size + trip.extraPeople}" to "reizigers"
            else -> (if (stopsKnown) "${trip.stops.map { it.flag }.distinct().size}" else null) to "landen"
        }
    }
}

/** Month and day names in Dutch, like the rest of the app, whatever language the phone speaks. */
private val DutchLocale: java.util.Locale = java.util.Locale.forLanguageTag("nl-NL")

@Composable
private fun Dutch(content: @Composable () -> Unit) {
    val cfg = androidx.compose.ui.platform.LocalConfiguration.current
    val nl = remember(cfg) { android.content.res.Configuration(cfg).apply { setLocale(java.util.Locale.forLanguageTag("nl-NL")) } }
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalConfiguration provides nl) { content() }
}
