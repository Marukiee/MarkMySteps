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
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.unit.em
import androidx.compose.ui.graphics.compositeOver
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
import androidx.compose.ui.res.stringResource
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
            .onFailure { error = it.message ?: Lang.text(R.string.tripsettings_save_failed) }
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

    SettingsScaffold(stringResource(R.string.tripsettings_title), onBack, trailing = {
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
            Header(stringResource(R.string.tripsettings_trip))
            Panel {
                FormField(stringResource(R.string.tripsettings_name), title, { title = it.take(120) }, capitalize = true)
                DatesField(start, end) { s, e -> start = s; end = e }
                Note(error, true)
            }
            Header(stringResource(R.string.tripsettings_color))
            Panel {
                ColorPicker(color, onPick = { hex ->
                    color = hex
                    scope.launch { runCatching { SettingsRemote.setColor(id, hex) }.onSuccess { onChanged() }.onFailure { error = it.message ?: Lang.text(R.string.tripsettings_color_failed) } }
                })
            }
            FactsPanel(trip, id, accent)
        } else {
            Spacer(Modifier.height(16.dp))
            Panel { Hint(if (canEdit) stringResource(R.string.tripsettings_owner_only) else stringResource(R.string.tripsettings_guest)) }
        }

        if (canEdit) SyncPanel(id, onChanged)
        // Photos from this phone's gallery in the timeline and on the map, without uploading (AppScreens.kt).
        DevicePhotosPanel(trip, onChanged)
        if (isOwner) MarkerPanel(trip, id, info)
        // The map of where the trip went, kept on the phone for a trip without signal.
        OfflineMapPanel(trip, id)

        Header(stringResource(R.string.tripsettings_tracking))
        // A trip that is over has nothing to start: the grey switch below already says so.
        if (!ended || Tracker.tripId == id) TrackNowPanel(trip, id, ended, myRole)
        Spacer(Modifier.height(8.dp))
        Group(null, listOf(
            Item(
                Glyphs.pin, stringResource(R.string.tripsettings_auto_track),
                if (ended) stringResource(R.string.tripsettings_auto_track_ended) else stringResource(R.string.tripsettings_auto_track_hint),
                toggle = autoTrack, enabled = isOwner && !ended && info != null,
                action = { autoTrack = !autoTrack },
            ),
        ))

        Header(stringResource(R.string.tripsettings_people))
        Group(null, listOf(Item(Glyphs.friends, stringResource(R.string.tripsettings_people_item), stringResource(R.string.tripsettings_people_summary, trip.members.count { it.role != "GUEST" }, trip.members.count { it.role == "GUEST" }), action = onPeople)))

        DangerPanel(trip, id, isOwner, canEdit, onGone)
    }
}

/**
 * "Route nu bijhouden": start or stop recording this trip from here, as the web's trip settings. A trip that is
 * over can still be stopped; otherwise the panel says why it cannot start (over, a guest, or the organiser
 * switched tracking off for you).
 */
@Composable
private fun TrackNowPanel(trip: Trip, id: String, ended: Boolean, myRole: String?) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val haptics = rememberHaptics()
    val here = Tracker.tripId == id
    val allowed = !ended && canTrack(trip)
    var confirmStop by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    val ask = rememberLocationRequest(
        stringResource(R.string.track_loc_title),
        stringResource(R.string.track_loc_body),
        notifications = true,
        onRefused = { msg, _ -> note = msg },
    )
    Panel(animate = true) {
        if (allowed || here) {
            Text(stringResource(R.string.track_now_title), style = TitleStyle.copy(color = MaterialTheme.colorScheme.onSurface))
            Hint(if (allowed) stringResource(R.string.track_now_hint) else stringResource(R.string.track_now_ended_running))
            AnimatedContent(here, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "trackNow") { on ->
                if (on) QuietDangerButton(stringResource(R.string.track_stop), { confirmStop = true }, Modifier.fillMaxWidth())
                else MainButton(stringResource(R.string.track_start), {
                    ask.run(context) {
                        Tracker.start(context, id, trip.title, trip.start?.plusDays((trip.days - 1).toLong()))
                        haptics(Haptic.Confirm); note = null
                    }
                }, Modifier.fillMaxWidth(), icon = Glyphs.pin)
            }
            if (!here && allowed && Tracker.tripId != null) Hint(stringResource(R.string.track_now_other))
            Note(note, true)
        } else {
            // What can not be done is grey and says why only when tapped, never as a standing notice.
            val why = when {
                ended -> stringResource(R.string.track_now_ended)
                myRole == "GUEST" -> stringResource(R.string.track_now_guest)
                else -> stringResource(R.string.track_off_by_organiser)
            }
            Text(stringResource(R.string.track_now_title), style = TitleStyle.copy(color = MaterialTheme.colorScheme.onSurface))
            Box {
                MainButton(stringResource(R.string.track_start), {}, Modifier.fillMaxWidth(), icon = Glyphs.pin, enabled = false)
                Box(Modifier.matchParentSize().clip(CircleShape).clickable { haptics(Haptic.Reject); note = why })
            }
            Note(note, false, feel = null)
        }
    }
    if (confirmStop) Confirm(
        stringResource(R.string.track_stop_title), stringResource(R.string.track_stop_body, trip.title), stringResource(R.string.track_stop_confirm),
        onConfirm = { Tracker.stop(context) }, onDismiss = { confirmStop = false },
    )
}

/** The cover as the trip's card shows it, with the trip's colour under it gliding to a new pick. */
@Composable
private fun CoverHeader(trip: Trip, coverId: String?, title: String, start: String, end: String, accent: Color, canPick: Boolean, onPicked: () -> Unit) {
    var pick by remember { mutableStateOf(false) }
    Spacer(Modifier.height(16.dp))
    // The same front as the trip page's cover (photo edge to edge, a soft dark fade, the name in Outfit), without
    // the faces; choosing another cover sits where the faces are there.
    val shown = trip.copy(coverId = coverId)
    val hasPhoto = shown.coverId != null || shown.cover != null
    Box(Modifier.fillMaxWidth().height(236.dp).clip(RoundedCornerShape(32.dp))) {
        if (hasPhoto) {
            Cover(shown, Modifier.fillMaxSize(), size = "preview")
            Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Brush.verticalGradient(0.35f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.62f))))
        } else {
            val deep = Color(0xFF1B2440).copy(alpha = 0.55f).compositeOver(accent)
            Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(accent, deep))))
        }
        if (canPick) Row(
            Modifier.align(Alignment.TopEnd).padding(14.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.38f)).dip { pick = true }.padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineIcon(Glyphs.photo, Color.White, size = 16.dp, stroke = 2f)
            Text(stringResource(R.string.tripsettings_cover_choose), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = Color.White), modifier = Modifier.padding(start = 6.dp))
        }
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(20.dp)) {
            Text(
                title.ifBlank { trip.title }, maxLines = 2,
                style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 32.sp, lineHeight = 35.sp, letterSpacing = (-0.02).em, color = Color.White,
                    shadow = androidx.compose.ui.graphics.Shadow(Color.Black.copy(alpha = 0.3f), blurRadius = 10f)),
            )
            Text(rangeText(start, end), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = Color.White.copy(alpha = 0.88f)), modifier = Modifier.padding(top = 2.dp))
        }
    }
    if (pick) CoverSheet(trip, coverId, onDismiss = { pick = false }, onPicked = onPicked)
}

private fun rangeText(start: String, end: String): String = runCatching {
    val a = LocalDate.parse(start); val b = LocalDate.parse(end)
    val tail = "${b.dayOfMonth} ${DateText.month(b.monthValue)} ${b.year}"
    if (a.month == b.month && a.year == b.year) "${a.dayOfMonth} ${DateText.through} $tail" else "${a.dayOfMonth} ${DateText.month(a.monthValue)}${if (a.year != b.year) " ${a.year}" else ""} ${DateText.through} $tail"
}.getOrDefault("")

/** The trip's photos to pick the cover from; Automatisch lets the server choose. */
@Composable
private fun CoverSheet(trip: Trip, current: String?, onDismiss: () -> Unit, onPicked: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val scope = rememberCoroutineScope()
    val media by produceState<List<Media>?>(null, trip.id) { value = runCatching { Remote.media(trip) }.getOrDefault(emptyList()) }
    var chosen by remember { mutableStateOf(current) }
    val haptics = rememberHaptics()
    fun choose(mediaId: String?) {
        if (mediaId != chosen) haptics(Haptic.Tick)
        chosen = mediaId
        scope.launch {
            runCatching { Api.send("PATCH", "/api/trips/${trip.remoteId}", org.json.JSONObject().put("coverMediaId", mediaId ?: org.json.JSONObject.NULL)) }.onSuccess { onPicked() }
            onDismiss()
        }
    }
    AppSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.tripsettings_cover_photo), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface), modifier = Modifier.weight(1f))
                SoftButton(stringResource(R.string.tripsettings_automatic), { choose(null) }, icon = Glyphs.cardAuto)
            }
            Hint(stringResource(R.string.tripsettings_cover_hint), Modifier.padding(top = 6.dp, bottom = 12.dp))
            val list = media
            if (list == null) LazyVerticalGrid(GridCells.Fixed(3), Modifier.height(360.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp), userScrollEnabled = false) {
                items(List(9) { it }) { Placeholder(Modifier.aspectRatio(1f).clip(RoundedCornerShape(10.dp))) }
            } else if (list.isEmpty()) Hint(stringResource(R.string.tripsettings_cover_none), Modifier.padding(bottom = 24.dp))
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
        Text(stringResource(R.string.tripsettings_dates), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 6.dp, bottom = 6.dp))
        Row(
            Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest).dip { open = true }.padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(rangeText(start, end).ifBlank { stringResource(R.string.tripsettings_dates_pick) }, style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurface), modifier = Modifier.weight(1f))
            LineIcon(listOf(P("M8 2v4"), P("M16 2v4"), P("M3 10h18"), P("M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z")), cs.onSurfaceVariant, size = 20.dp)
        }
    }
    if (open) {
        // The app's own range calendar (as for a new trip) in a sheet, with the chosen days above it.
        var a by remember { mutableStateOf(runCatching { LocalDate.parse(start) }.getOrNull()) }
        var b by remember { mutableStateOf(runCatching { LocalDate.parse(end) }.getOrNull()) }
        AppSheet(onDismiss = { open = false }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
                Text(stringResource(R.string.tripsettings_dates_title), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant))
                val label = a?.let { s0 -> rangeText(s0.toString(), (b ?: s0).toString()) } ?: stringResource(R.string.tripsettings_days_pick)
                AnimatedContent(label, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "range") { t ->
                    Text(t, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 21.sp, color = cs.onSurface))
                }
                RangeCalendar(a, b, onChange = { x, y -> a = x; b = y }, modifier = Modifier.padding(top = 16.dp))
                Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.End) {
                    DialogButtons(stringResource(R.string.tripsettings_done), danger = false, enabled = a != null, onConfirm = {
                        a?.let { s0 -> onChange(s0.toString(), (b ?: s0).toString()) }; open = false
                    }, onDismiss = { open = false })
                }
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
    val haptics = rememberHaptics()
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
                                .clip(MorphShape(morph, t.coerceIn(0f, 1f))).background(fill).dip { if (!on) haptics(Haptic.Tick); onPick(hex) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(Modifier.graphicsLayer { rotationZ = -40f * t }, contentAlignment = Alignment.Center) {
                                if (hex == null && t < 0.5f) Text(stringResource(R.string.tripsettings_color_auto), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 12.sp, color = cs.onSurface))
                                if (t > 0.01f) LineIcon(listOf(P("m5 12 5 5 9-10")), if (hex == null) cs.onSurface else Color.White, size = 20.dp, stroke = 2.6f, modifier = Modifier.graphicsLayer { scaleX = t; scaleY = t; alpha = t.coerceIn(0f, 1f) })
                            }
                        }
                    }
                }
                repeat(5 - row.size) { Spacer(Modifier.size(56.dp)) }
            }
        }
        Hint(stringResource(R.string.tripsettings_color_auto_hint))
    }
}

/** Which four figures the trip's page shows under its cover. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FactsPanel(trip: Trip, id: String, accent: Color) {
    val cs = MaterialTheme.colorScheme
    val chosen = TripFactsPref.chosen[trip.id]
    Header(stringResource(R.string.tripsettings_facts))
    Panel {
        Hint(stringResource(R.string.tripsettings_facts_hint))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            FactChip(stringResource(R.string.tripsettings_automatic), chosen == null, enabled = true) { TripFactsPref.set(trip.id, null) }
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
    Header(stringResource(R.string.tripsettings_photos))
    Panel {
        Hint(stringResource(R.string.tripsettings_photos_hint))
        MainButton(stringResource(R.string.tripsettings_photos_sync), {
            busy = true; note = null
            scope.launch {
                note = runCatching { SettingsRemote.sync(id) }.fold({ r ->
                    onChanged()
                    Lang.text(R.string.tripsettings_sync_result, Lang.plural(R.plurals.tripsettings_sync_photos, r.added), r.found, Lang.plural(R.plurals.tripsettings_sync_travellers, r.users)) to false
                }, { (it.message ?: Lang.text(R.string.tripsettings_sync_failed)) to true })
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
        // The globe on the homepage draws the new spot once the trips are read again.
        scope.launch { runCatching { SettingsRemote.setMarker(id, p) }.onSuccess { Data.load() }.onFailure { error = it.message ?: Lang.text(R.string.tripsettings_marker_failed) } }
    }
    Header(stringResource(R.string.tripsettings_marker))
    val motion = MaterialTheme.motionScheme
    val enter = fadeIn(motion.defaultEffectsSpec()) + expandVertically(motion.defaultSpatialSpec())
    val exit = fadeOut(motion.fastEffectsSpec()) + shrinkVertically(motion.defaultSpatialSpec())
    Panel(animate = true) {
        // The text changes with a cross-fade and the panel grows to it, so nothing jumps.
        androidx.compose.animation.Crossfade(if (marker != null) 2 else if (placing) 1 else 0, animationSpec = motion.defaultEffectsSpec(), label = "markerHint") { st ->
            Hint(
                when (st) {
                    2 -> stringResource(R.string.tripsettings_marker_set)
                    1 -> stringResource(R.string.tripsettings_marker_placing)
                    else -> stringResource(R.string.tripsettings_marker_hint)
                },
            )
        }
        AnimatedVisibility(marker != null || placing, enter = enter, exit = exit) {
            MarkerMap(trip, marker, dark, Modifier.fillMaxWidth().height(260.dp).clip(RoundedCornerShape(20.dp))) { save(it) }
        }
        // One button at a time: each comes in and goes out on its own, growing and fading.
        Column {
            AnimatedVisibility(marker != null, enter = enter, exit = exit) {
                SoftButton(stringResource(R.string.tripsettings_marker_reset), { save(null); placing = false }, Modifier.fillMaxWidth())
            }
            AnimatedVisibility(marker == null && !placing, enter = enter, exit = exit) {
                SoftButton(stringResource(R.string.tripsettings_marker_place), { placing = true }, Modifier.fillMaxWidth(), icon = Glyphs.pin, enabled = info != null)
            }
            AnimatedVisibility(marker == null && placing, enter = enter, exit = exit) {
                SoftButton(stringResource(R.string.tripsettings_cancel), { placing = false }, Modifier.fillMaxWidth())
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
    Header(stringResource(R.string.tripsettings_delete))
    if (canEdit) Panel {
        Text(stringResource(R.string.tripsettings_wipe_tracked), style = TitleStyle.copy(color = cs.onSurface))
        Hint(stringResource(R.string.tripsettings_wipe_tracked_hint))
        ButtonRow {
            SoftButton(day?.let { shortDate(it) } ?: stringResource(R.string.tripsettings_day_pick), { pickDay = true }, Modifier.weight(1f), icon = listOf(P("M8 2v4"), P("M16 2v4"), P("M3 10h18"), P("M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z")))
            QuietDangerButton(stringResource(R.string.tripsettings_wipe_day), { ask = "day" }, Modifier.weight(1f), enabled = day != null && !busy)
        }
        QuietDangerButton(stringResource(R.string.tripsettings_wipe_all), { ask = "all" }, Modifier.fillMaxWidth(), enabled = !busy)
    }
    if (canEdit) {
        Spacer(Modifier.height(10.dp))
        Panel {
            Text(stringResource(R.string.tripsettings_wipe_routes), style = TitleStyle.copy(color = cs.onSurface))
            PathHint(stringResource(R.string.tripsettings_wipe_routes_prefix), listOf(stringResource(R.string.tripsettings_wipe_routes_step_hold), stringResource(R.string.tripsettings_wipe_routes_step_roads)), stringResource(R.string.tripsettings_wipe_routes_suffix))
            QuietDangerButton(stringResource(R.string.tripsettings_wipe), { ask = "routes" }, Modifier.fillMaxWidth(), enabled = !busy)
        }
    }
    Note(note?.first, note?.second == true)
    Spacer(Modifier.height(10.dp))
    if (isOwner) MainButton(stringResource(R.string.tripsettings_delete_trip), { typed = ""; ask = "delete" }, Modifier.fillMaxWidth(), icon = Glyphs.trash, danger = true)
    else MainButton(stringResource(R.string.tripsettings_leave_trip), { ask = "leave" }, Modifier.fillMaxWidth(), icon = Glyphs.signOut, danger = true)

    fun run(block: suspend () -> String) {
        busy = true; note = null
        scope.launch { note = runCatching { block() }.fold({ it to false }, { (it.message ?: Lang.text(R.string.tripsettings_wipe_failed)) to true }); busy = false }
    }
    when (ask) {
        "day" -> Confirm(stringResource(R.string.tripsettings_wipe_tracking_title), stringResource(R.string.tripsettings_wipe_day_text, "${day?.let { shortDate(it) }}"), stringResource(R.string.tripsettings_wipe),
            onConfirm = { val d = day; run { val n = SettingsRemote.wipeTracked(id, d); day = null; Lang.plural(R.plurals.tripsettings_wiped_track, n) } }, onDismiss = { ask = null })
        "all" -> Confirm(stringResource(R.string.tripsettings_wipe_tracking_title), stringResource(R.string.tripsettings_wipe_all_text), stringResource(R.string.tripsettings_wipe),
            onConfirm = { run { val n = SettingsRemote.wipeTracked(id, null); Lang.plural(R.plurals.tripsettings_wiped_track, n) } }, onDismiss = { ask = null })
        "routes" -> Confirm(stringResource(R.string.tripsettings_wipe_routes_title), stringResource(R.string.tripsettings_wipe_routes_text), stringResource(R.string.tripsettings_wipe),
            onConfirm = { run { val n = SettingsRemote.wipeRouteFills(id); Lang.plural(R.plurals.tripsettings_wiped_routes, n) } }, onDismiss = { ask = null })
        "delete" -> Confirm(
            stringResource(R.string.tripsettings_delete_title), stringResource(R.string.tripsettings_delete_text, trip.title), stringResource(R.string.tripsettings_delete),
            confirmEnabled = typed.trim() == trip.title.trim(),
            extra = { FormField(stringResource(R.string.tripsettings_delete_name), typed, { typed = it }, hint = trip.title) },
            onConfirm = { scope.launch { runCatching { Remote.deleteTrip(trip) }.onSuccess { Data.load(); onGone() }.onFailure { note = (it.message ?: Lang.text(R.string.tripsettings_delete_failed)) to true } } },
            onDismiss = { ask = null },
        )
        "leave" -> Confirm(stringResource(R.string.tripsettings_leave_title), stringResource(R.string.tripsettings_leave_text, trip.title), stringResource(R.string.tripsettings_leave),
            onConfirm = { scope.launch { runCatching { Remote.leaveTrip(trip) }.onSuccess { Data.load(); onGone() }.onFailure { note = (it.message ?: Lang.text(R.string.tripsettings_leave_failed)) to true } } },
            onDismiss = { ask = null })
    }
    if (pickDay) {
        val first = trip.start ?: LocalDate.now()
        val last = first.plusDays((trip.days - 1).coerceAtLeast(0).toLong())
        var chosen by remember { mutableStateOf(day?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: first) }
        AppSheet(onDismiss = { pickDay = false }) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
                Text(stringResource(R.string.tripsettings_day_title), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurfaceVariant))
                Text(chosen?.let { shortDate(it.toString()) } ?: stringResource(R.string.tripsettings_day_pick_trip), style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 21.sp, color = cs.onSurface))
                // One day: the last tap wins, and only days of the trip count.
                RangeCalendar(chosen, null, onChange = { x, y -> (y ?: x)?.takeIf { !it.isBefore(first) && !it.isAfter(last) }?.let { chosen = it } }, modifier = Modifier.padding(top = 16.dp))
                Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.End) {
                    DialogButtons(stringResource(R.string.tripsettings_done), danger = false, enabled = chosen != null, onConfirm = { day = chosen?.toString(); pickDay = false }, onDismiss = { pickDay = false })
                }
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
            "km" -> (trip.km?.let { "%,d".format(Lang.locale, it) } ?: "0") to Lang.text(R.string.tripsettings_fact_km)
            "days" -> "${trip.days}" to (if (trip.days == 1) Lang.text(R.string.tripsettings_fact_day) else Lang.text(R.string.tripsettings_fact_days))
            "stops" -> (if (stopsKnown) "${trip.stops.size}" else null) to (if (trip.stops.size == 1) Lang.text(R.string.tripsettings_fact_stop) else Lang.text(R.string.tripsettings_fact_stops))
            "photos" -> (photos?.toString() ?: if (trip.remoteId != null) null else "${trip.photos}") to Lang.text(R.string.tripsettings_fact_photos)
            "travellers" -> "${trip.people.size + trip.extraPeople}" to Lang.text(R.string.tripsettings_fact_travellers)
            else -> (if (stopsKnown) "${trip.stops.map { it.flag }.distinct().size}" else null) to Lang.text(R.string.tripsettings_fact_countries)
        }
    }
}

@Composable
private fun Dutch(content: @Composable () -> Unit) {
    val cfg = androidx.compose.ui.platform.LocalConfiguration.current
    val nl = remember(cfg) { android.content.res.Configuration(cfg).apply { setLocale(Lang.locale) } }
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalConfiguration provides nl) { content() }
}
