package nl.markmaaktmedia.markmysteps.next

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import kotlinx.coroutines.launch
import java.time.format.TextStyle as DateStyle
import java.util.Locale
import androidx.compose.ui.res.stringResource

/*
 * The timeline as in today's app: the places of the trip as a row of photo
 * cards at the top, then day by day the date, where you were and the weather,
 * with all of that day's photos underneath, joined by a line down the left.
 */

private val Dutch get() = Locale.forLanguageTag(Lang.current)
private val MonthIndex = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")

/** One day of the trip: its date and the stop it was spent at. */
private data class Day(val date: LocalDate, val stop: Stop, val stopIndex: Int)

private fun daysOf(trip: Trip): List<Day> {
    val first = trip.stops.firstOrNull() ?: return emptyList()
    val day = first.dates.takeWhile { it.isDigit() }.toIntOrNull() ?: 1
    val month = MonthIndex.indexOf(first.dates.substringAfterLast(' ')).coerceAtLeast(0) + 1
    var date = LocalDate.of(trip.year.toIntOrNull() ?: 2026, month, day)
    val out = mutableListOf<Day>()
    trip.stops.forEachIndexed { i, stop ->
        repeat(stop.nights.coerceAtLeast(1)) {
            out += Day(date, stop, i)
            date = date.plusDays(1)
        }
    }
    return out
}

@Composable
fun Timeline(
    trip: Trip, dark: Boolean, media: List<Media>? = null, onPhoto: (Media) -> Unit = {}, bounds: TileBounds? = null, hidden: String? = null, onJump: (() -> Float?) -> Unit = {},
    talk: TripTalk? = null, onComments: (Media) -> Unit = {}, marks: TimelineMarks? = null,
) {
    if (media != null) { LiveTimeline(trip, media, onPhoto, bounds, hidden, onJump, talk, onComments, marks); return }
    if (trip.remoteId != null) { TimelinePlaceholder(); return }
    val cs = MaterialTheme.colorScheme
    val scenes = Scene.entries

    val places = trip.stops.distinctBy { it.name }
    if (places.size > 1) Text(
        stringResource(R.string.timeline_places),
        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 18.sp, color = cs.onBackground),
        modifier = Modifier.padding(bottom = 12.dp),
    )
    // The places, each a photo with its name, wider than the screen so the row asks to be swiped.
    if (places.size > 1) Row(
        Modifier.bleed(16.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        trip.stops.distinctBy { it.name }.forEachIndexed { i, stop ->
            Box(Modifier.width(138.dp).height(168.dp).clip(RoundedCornerShape(22.dp))) {
                Scenery(scenes[(i * 2 + 1) % scenes.size], Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.5f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.6f))))
                Text(
                    stop.name, maxLines = 1,
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, color = Color.White),
                    modifier = Modifier.align(Alignment.BottomStart).padding(12.dp),
                )
            }
        }
    }

    val days = daysOf(trip)
    val line = cs.outlineVariant
    if (places.size > 1) Spacer(Modifier.height(26.dp))
    days.forEachIndexed { d, day ->
        val last = d == days.lastIndex
        Column(
            Modifier.fillMaxWidth().drawBehind {
                // The line down the left, from this day's dot to the next one.
                val x = 6.dp.toPx()
                drawLine(line, Offset(x, 22.dp.toPx()), Offset(x, if (last) 40.dp.toPx() else size.height), strokeWidth = 2.dp.toPx())
            },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(13.dp).clip(CircleShape).background(cs.primary))
                val weekday = day.date.dayOfWeek.getDisplayName(DateStyle.FULL, Dutch).replaceFirstChar { it.uppercase() }
                val month = day.date.month.getDisplayName(DateStyle.FULL, Dutch)
                Text(
                    "$weekday ${day.date.dayOfMonth} $month",
                    style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = 24.sp, letterSpacing = (-0.01).em, color = cs.onBackground),
                    modifier = Modifier.padding(start = 14.dp),
                )
            }
            Row(Modifier.padding(start = 27.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                FlagIcon(day.stop.flag, 14.dp)
                Text(
                    day.stop.name,
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = cs.onSurfaceVariant),
                    modifier = Modifier.padding(start = 6.dp),
                )
                LineIcon(Glyphs.cloud, cs.onSurfaceVariant, size = 16.dp, stroke = 1.8f, modifier = Modifier.padding(start = 12.dp))
                Text(
                    "${weatherFor(trip, d)}°",
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = cs.onSurfaceVariant),
                    modifier = Modifier.padding(start = 5.dp),
                )
            }

            Column(Modifier.padding(start = 27.dp, top = 12.dp, bottom = 30.dp)) {
                if (trip.upcoming) {
                    // Nothing taken yet: the photos arrive here by themselves once the trip starts.
                    Box(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(cs.surfaceContainerLow).padding(horizontal = 16.dp, vertical = 14.dp),
                    ) {
                        Text(
                            stringResource(R.string.timeline_day_photos),
                            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.5.sp, color = cs.onSurfaceVariant),
                        )
                    }
                } else {
                    DayPhotos(seed = d + trip.id.length, count = 3 + (d * 7 + trip.id.length) % 5)
                }
            }
        }
    }
}

/** The weather of a day in this test: a mild, slightly wandering temperature per trip. */
private fun weatherFor(trip: Trip, day: Int): Int {
    val base = when (trip.id) {
        "iceland" -> 11; "sweden" -> 21; "sicily" -> 24; "lisbon" -> 17; "marrakech" -> 22; "norway" -> 15; "georgia" -> 4
        else -> 18
    }
    return base + ((day * 37) % 5) - 2
}

/**
 * A day's photos in rows, as the app lays them out: a narrow and a wide one,
 * then two of equal size, now and then one across the whole width.
 */
@Composable
private fun DayPhotos(seed: Int, count: Int) {
    val scenes = Scene.entries
    var left = count
    var k = 0
    var row = 0
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        while (left > 0) {
            val kind = if (left == 1) 2 else (row + seed) % 3
            when (kind) {
                0 -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Photo(scenes[(seed + k) % scenes.size], Modifier.weight(1f).height(170.dp))
                    Photo(scenes[(seed + k + 1) % scenes.size], Modifier.weight(2f).height(170.dp))
                }.also { k += 2; left -= 2 }
                1 -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Photo(scenes[(seed + k) % scenes.size], Modifier.weight(1f).height(140.dp))
                    Photo(scenes[(seed + k + 1) % scenes.size], Modifier.weight(1f).height(140.dp))
                }.also { k += 2; left -= 2 }
                else -> Photo(scenes[(seed + k) % scenes.size], Modifier.fillMaxWidth().height(200.dp)).also { k += 1; left -= 1 }
            }
            row++
        }
    }
}

@Composable
private fun Photo(scene: Scene, modifier: Modifier) {
    Box(modifier.clip(RoundedCornerShape(14.dp))) { Scenery(scene, Modifier.fillMaxSize()) }
}


/** For a trip from the server: the real photos, day by day, laid out by their own shape. */
@Composable
private fun LiveTimeline(
    trip: Trip, media: List<Media>, onPhoto: (Media) -> Unit, bounds: TileBounds?, hidden: String?, onJump: (() -> Float?) -> Unit,
    talk0: TripTalk?, onComments: (Media) -> Unit, marks: TimelineMarks?,
) {
    // Where each day's heading sits, so a place tile can scroll to its first day.
    val dayAt = androidx.compose.runtime.remember { HashMap<LocalDate, androidx.compose.ui.layout.LayoutCoordinates>() }
    // The trip's day stories and the talk around them: from the trip page, else read here once.
    val talk = talk0 ?: androidx.compose.runtime.remember(trip.id) { TripTalk(trip) }
    if (talk0 == null) androidx.compose.runtime.LaunchedEffect(trip.id) { talk.load() }
    val notes = talk.notes
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    androidx.compose.runtime.SideEffect { talk.scope = scope }
    val me = Data.me?.id
    // Organiser and companions write a story per day; guests read along.
    val canEdit = trip.remoteId != null && me != null && (trip.ownerId == me || trip.members.any { it.userId == me && it.role != "GUEST" })
    var editingDay by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf<String?>(null) }
    var removing by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<SocialRemote.DayNote?>(null) }
    val cs = MaterialTheme.colorScheme
    // Photos and videos together, as on the web; a video carries a play badge.
    val photos = media
    fun stopOn(date: LocalDate): Stop? = trip.stops.lastOrNull { s -> s.start != null && !s.start.isAfter(date) } ?: trip.stops.firstOrNull()

    // A row of places only when there is more than one: a single place says nothing a row would add.
    if (trip.stops.distinctBy { it.name }.size > 1) {
        Text(
            stringResource(R.string.timeline_places),
            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 18.sp, color = cs.onBackground),
            modifier = Modifier.padding(bottom = 12.dp),
        )
        // Four in view, as on the web.
        Row(
            Modifier.bleed(16.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            trip.stops.distinctBy { it.name }.forEach { stop ->
                val pick = photos.firstOrNull { stopOn(it.takenAt)?.name == stop.name }
                Box(Modifier.width(92.dp).height(116.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHigh)
                    .clickable(enabled = pick != null) {
                        // A tap goes to that place's first day, as on the web.
                        // Where that day is, asked again as the page scrolls: rows further down only take their real
                        // height once they come near, so one measured jump landed well short of the place.
                        // The day's real position, not its visible bounds: those are cut off at the screen edge, so a day
                        // further down measured 0 and the page scrolled up instead of down to it.
                        pick?.let { p -> val where = { dayAt[p.takenAt]?.takeIf { it.isAttached }?.positionInRoot()?.y }; if (where() != null) onJump(where) }
                    }) {
                    if (pick != null) {
                        // The small picture the timeline uses too, fetched as soon as the photos are known: they are few.
                        RemotePhoto(pick.id, Modifier.fillMaxSize(), eager = true)
                        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.62f))))
                    } else {
                        // No photo yet: the place in the trip's colour, with its flag, instead of an empty frame.
                        Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(trip.color.copy(alpha = 0.35f), trip.color.copy(alpha = 0.12f)))))
                        FlagIcon(stop.flag, 20.dp, Modifier.padding(10.dp))
                    }
                    Text(
                        stop.name, maxLines = 2,
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 14.sp, lineHeight = 16.sp, color = if (pick != null) Color.White else cs.onSurface),
                        modifier = Modifier.align(Alignment.BottomStart).padding(horizontal = 9.dp, vertical = 8.dp),
                    )
                }
            }
        }
        Spacer(Modifier.height(26.dp))
    }

    if (photos.isEmpty() && notes.isEmpty()) {
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(cs.surfaceContainerLow).padding(18.dp)) {
            Text(
                if (trip.upcoming) stringResource(R.string.timeline_photos_upcoming) else stringResource(R.string.timeline_no_photos),
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant),
            )
        }
        return
    }

    val line = cs.outlineVariant
    // Days that only have a story (no photos) still get their own section, as on the web.
    val byDay = photos.groupBy { it.takenAt }.toMutableMap()
    notes.mapNotNull { parseDay(it.day) }.forEach { d -> byDay.getOrPut(d) { emptyList() } }
    val days = byDay.toSortedMap().entries.toList()
    // Each photo's place in the timeline, for fetching the first screens before anything is scrolled.
    val order = androidx.compose.runtime.remember(photos) { days.flatMap { it.value }.withIndex().associate { (i, m) -> m.id to i } }
    // The photos whose rows are real photos right now (see the rows below).
    val real = androidx.compose.runtime.remember(photos) { HashSet<String>() }
    val windowH = androidx.compose.ui.platform.LocalWindowInfo.current.containerSize.height.toFloat().coerceAtLeast(1f)
    // Pinch the timeline to make the photos bigger or smaller: five sizes, a step per 1.3x of finger distance (web).
    // Remembered on the phone, as the web's gridZoom: the next trip opens at the size the last pinch left (AppCore.kt).
    var perRow by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableIntStateOf(AppPrefs.timelinePerRow) }
    androidx.compose.runtime.LaunchedEffect(perRow) { AppPrefs.changeTimelinePerRow(perRow) }
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    Column(Modifier.pointerInput(Unit) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            var start = 0f
            while (true) {
                val e = awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                val pressed = e.changes.filter { it.pressed }
                if (pressed.isEmpty()) break
                if (pressed.size == 2) {
                    val d = (pressed[0].position - pressed[1].position).getDistance()
                    if (start == 0f) start = d
                    val ratio = d / start
                    val step = when { ratio > 1.3f -> -1; ratio < 1f / 1.3f -> 1; else -> 0 }
                    if (step != 0) {
                        val next = (perRow + step).coerceIn(1, 5)
                        if (next != perRow) { perRow = next; haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.SegmentTick) }
                        start = d
                    }
                    e.changes.forEach { it.consume() }
                }
            }
        }
    }) {
    days.forEachIndexed { d, (date, list) -> androidx.compose.runtime.key(date) {
        val last = d == days.lastIndex
        val stop = stopOn(date)
        var all by androidx.compose.runtime.saveable.rememberSaveable(date.toString()) { androidx.compose.runtime.mutableStateOf(false) }
        Column(
            Modifier.fillMaxWidth().drawBehind {
                val x = 6.dp.toPx()
                drawLine(line, Offset(x, 22.dp.toPx()), Offset(x, if (last) 40.dp.toPx() else size.height), strokeWidth = 2.dp.toPx())
            },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.onGloballyPositioned { dayAt[date] = it; marks?.put(date, it, stop?.name) }) {
                Box(Modifier.size(13.dp).clip(CircleShape).background(cs.primary))
                val weekday = date.dayOfWeek.getDisplayName(DateStyle.FULL, Dutch).replaceFirstChar { it.uppercase() }
                Text(
                    "$weekday ${date.dayOfMonth} ${date.month.getDisplayName(DateStyle.FULL, Dutch)}",
                    style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = 24.sp, letterSpacing = (-0.01).em, color = cs.onBackground),
                    modifier = Modifier.padding(start = 14.dp).weight(1f, fill = false),
                )
                // A day without a story yet: the app's own pencil starts one.
                val dayKey = date.toString()
                androidx.compose.animation.AnimatedVisibility(
                    canEdit && editingDay != dayKey && notes.none { it.day == dayKey },
                    enter = androidx.compose.animation.fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + androidx.compose.animation.scaleIn(MaterialTheme.motionScheme.fastSpatialSpec(), initialScale = 0.6f),
                    exit = androidx.compose.animation.fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + androidx.compose.animation.scaleOut(MaterialTheme.motionScheme.fastSpatialSpec(), targetScale = 0.6f),
                ) { WriteStoryButton { editingDay = dayKey } }
            }
            if (stop != null) {
                // Where you were and that day's real weather there.
                val weather by androidx.compose.runtime.produceState<Remote.Weather?>(null, stop.at, date) { value = Remote.weather(stop.at, date) }
                Row(Modifier.padding(start = 27.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    FlagIcon(stop.flag, 14.dp)
                    Text(
                        stop.name,
                        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = cs.onSurfaceVariant),
                        modifier = Modifier.padding(start = 6.dp),
                    )
                    androidx.compose.animation.AnimatedVisibility(weather != null, enter = androidx.compose.animation.fadeIn(), exit = androidx.compose.animation.fadeOut()) {
                        weather?.let { w ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                LineIcon(weatherGlyph(w.code), cs.onSurfaceVariant, size = 17.dp, stroke = 1.8f, modifier = Modifier.padding(start = 12.dp))
                                Text("${w.maxC}°", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 5.dp))
                            }
                        }
                    }
                }
            }
            val dayKey = date.toString()
            val dayNotes = notes.filter { it.day == dayKey }
            if (dayNotes.isNotEmpty() || editingDay == dayKey) DayStory(
                dayKey, dayNotes, canEdit, editing = editingDay == dayKey,
                onEdit = { editingDay = dayKey }, onDone = { if (editingDay == dayKey) editingDay = null },
                onSave = { body ->
                    val saved = SocialRemote.saveNote(trip, dayKey, body)
                    // A dry run answers nothing: the story still shows, as written, under your name.
                    talk.notes = saved ?: (talk.notes.filter { !(it.day == dayKey && it.authorId == me) } +
                        SocialRemote.DayNote(talk.notes.firstOrNull { it.day == dayKey && it.authorId == me }?.id ?: ("local-" + java.util.UUID.randomUUID()), dayKey, null, body, me, Data.me?.name ?: ""))
                    if (editingDay == dayKey) editingDay = null
                },
                onDelete = { removing = it },
                modifier = Modifier.padding(start = 27.dp, top = 12.dp),
            )
            // Comments on the day's story, from the trip.
            if (dayNotes.isNotEmpty() && editingDay != dayKey && trip.remoteId != null) DayThread(talk, dayKey, Modifier.padding(start = 27.dp, top = 10.dp))
            Column(
                Modifier.padding(start = 27.dp, top = 12.dp, bottom = 30.dp).animateContentSize(MaterialTheme.motionScheme.defaultSpatialSpec()),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                val shown = list
                justified(shown, perRow).forEach { row ->
                    androidx.compose.runtime.key(row.first().id) {
                        val ratio = row.sumOf { Photos.ratioOf(it).toDouble() }.toFloat().coerceAtLeast(0.8f)
                        // Only the rows near the screen are real photos (a screen and a half above, two and a half screens past the bottom edge,
                        // so they are fetched before you get there); the rest are their quiet shapes at the same size, so
                        // opening a trip with six hundred photos composes one screen and not all of them.
                        // A row that reflowed (a size learnt, a pinch) stays real if its photos were: no flash of shapes.
                        var near by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf((order[row.first().id] ?: 0) < EAGER_FIRST || row.any { it.id in real }) }
                        androidx.compose.runtime.SideEffect { if (near) row.forEach { real += it.id } else row.forEach { real -= it.id } }
                        val rowModifier = Modifier.fillMaxWidth().aspectRatio(ratio).onGloballyPositioned { c ->
                            if (!c.isAttached) return@onGloballyPositioned
                            val top = c.positionInWindow().y
                            val bottom = top + c.size.height
                            if (!near && bottom > -windowH * 1.5f && top < windowH * 3.5f) near = true
                            else if (near && (bottom < -windowH * 4f || top > windowH * 6f)) near = false
                            // A shape stands in for its photos in TileBounds, so the page can still scroll to one of them.
                            if (!near) row.forEach { m -> bounds?.tiles?.set(m.id, c) }
                        }
                        if (!near) {
                            val tone = cs.surfaceContainerHigh
                            Box(rowModifier.drawBehind {
                                val gap = 6.dp.toPx(); val r = TileRadius.toPx()
                                val total = row.sumOf { Photos.ratioOf(it).toDouble() }.toFloat()
                                val room = size.width - gap * (row.size - 1)
                                var x = 0f
                                row.forEach { m ->
                                    val w = room * Photos.ratioOf(m) / total
                                    drawRoundRect(tone, Offset(x, 0f), androidx.compose.ui.geometry.Size(w, size.height), androidx.compose.ui.geometry.CornerRadius(r))
                                    x += w + gap
                                }
                            })
                        } else Row(rowModifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            row.forEach { m ->
                                // Keyed by the photo, so when the rows reflow (a size learnt, a pinch) each tile keeps its own
                                // photo, its place in TileBounds and its tap, instead of taking over its neighbour's slot.
                                androidx.compose.runtime.key(m.id) {
                                    // Each photo tells the viewer where it is; the one open in the viewer leaves its place empty.
                                    Box(Modifier.weight(Photos.ratioOf(m)).fillMaxSize()
                                        .onGloballyPositioned { bounds?.tiles?.set(m.id, it) }
                                        .graphicsLayer { alpha = if (m.id == hidden) 0f else 1f }
                                        .clip(RoundedCornerShape(TileRadius)).clickable { onPhoto(m) }) {
                                        RemotePhoto(m.id, Modifier.fillMaxSize(), eager = true, onShown = { b -> bounds?.shown(m.id, b) })
                                        // Liked and talked about, top right; too small to read once five share a row.
                                        if (perRow <= 3) TileFlags(
                                            talk.reactions.counts[m.id].orEmpty(), talk.comments.count { it.mediaId == m.id },
                                            onComments = { onComments(m) }, modifier = Modifier.align(Alignment.TopEnd),
                                        )
                                        if (m.video) Box(Modifier.align(Alignment.Center).size(44.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                                            LineIcon(listOf(P("M9 7.5v9l7.5-4.5Z")), Color.White, size = 22.dp, filled = true)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    } }
    }
    removing?.let { n ->
        Confirm(
            stringResource(R.string.timeline_story_delete), stringResource(R.string.timeline_story_delete_body), stringResource(R.string.home_delete),
            onConfirm = {
                val before = talk.notes
                talk.notes = talk.notes.filter { it.id != n.id }
                if (!n.id.startsWith("local-")) scope.launch { runCatching { SocialRemote.deleteNote(trip, n.id) }.onFailure { talk.notes = before } }
            },
            onDismiss = { removing = null },
        )
    }
}

/** How many photos at the top of a timeline are fetched straight away, about the first two screens. */
private const val EAGER_FIRST = 24

/** The rounding of a timeline photo; the viewer rounds to the same when it grows out of one or goes back. */
val TileRadius = 14.dp

/**
 * Rows of photos that fill the width at a pleasant height: two side by side
 * as a rule, three when they are all tall, a wide one alone.
 */
private fun justified(list: List<Media>, perRow: Int = 2): List<List<Media>> {
    val rows = mutableListOf<List<Media>>()
    var i = 0
    while (i < list.size) {
        // A wide photo takes two places, a tall one half a place more room per row.
        var slots = 0f
        var take = 0
        val goal = perRow + if (list.subList(i, minOf(list.size, i + perRow + 1)).all { Photos.ratioOf(it) < 0.9f }) 1 else 0
        while (i + take < list.size && (take == 0 || slots + slot(list[i + take]) <= goal + 0.01f)) {
            slots += slot(list[i + take]); take++
        }
        rows += list.subList(i, i + take)
        i += take
    }
    return rows
}

private fun slot(m: Media): Float = if (Photos.ratioOf(m) > 1.6f) 2f else 1f


/** While a real trip's photos are read: quiet shapes where the day and its photos will be, never the demo. */
@Composable
private fun TimelinePlaceholder() {
    val cs = MaterialTheme.colorScheme
    val pulse by androidx.compose.animation.core.rememberInfiniteTransition(label = "pulse").animateFloat(
        0.55f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween<Float>(1100), androidx.compose.animation.core.RepeatMode.Reverse), label = "a",
    )
    Column(Modifier.graphicsLayer { alpha = pulse }) {
        repeat(2) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(13.dp).clip(CircleShape).background(cs.surfaceContainerHigh))
                Box(Modifier.padding(start = 14.dp).size(width = 190.dp, height = 22.dp).clip(CircleShape).background(cs.surfaceContainerHigh))
            }
            Row(Modifier.padding(start = 27.dp, top = 14.dp, bottom = 30.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.weight(1f).height(170.dp).clip(RoundedCornerShape(14.dp)).background(cs.surfaceContainerHigh))
                Box(Modifier.weight(2f).height(170.dp).clip(RoundedCornerShape(14.dp)).background(cs.surfaceContainerHigh))
            }
        }
    }
}


/** The weather code as one of the app's line icons (WMO codes, as open-meteo gives them). */
internal fun weatherGlyph(code: Int): List<Shape24> = when (code) {
    0, 1 -> Glyphs.sun
    2 -> Glyphs.partly
    in 71..77, 85, 86 -> Glyphs.snow
    in 95..99 -> Glyphs.storm
    in 51..67, in 80..82 -> Glyphs.rain
    else -> Glyphs.cloud
}
