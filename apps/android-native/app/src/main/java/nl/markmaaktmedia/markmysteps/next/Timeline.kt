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
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import java.time.format.TextStyle as DateStyle
import java.util.Locale

/*
 * The timeline as in today's app: the places of the trip as a row of photo
 * cards at the top, then day by day the date, where you were and the weather,
 * with all of that day's photos underneath, joined by a line down the left.
 */

private val Dutch = Locale.forLanguageTag("nl-NL")
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
fun Timeline(trip: Trip, dark: Boolean, media: List<Media>? = null, onPhoto: (Media) -> Unit = {}, bounds: TileBounds? = null, hidden: String? = null, onJump: (Float) -> Unit = {}) {
    if (media != null) { LiveTimeline(trip, media, onPhoto, bounds, hidden, onJump); return }
    if (trip.remoteId != null) { TimelinePlaceholder(); return }
    val cs = MaterialTheme.colorScheme
    val scenes = Scene.entries

    val places = trip.stops.distinctBy { it.name }
    if (places.size > 1) Text(
        "Plaatsen",
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
                            "De foto's van deze dag komen hier vanzelf",
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
private fun LiveTimeline(trip: Trip, media: List<Media>, onPhoto: (Media) -> Unit, bounds: TileBounds?, hidden: String?, onJump: (Float) -> Unit) {
    // Where each day's heading sits, so a place tile can scroll to its first day.
    val dayAt = androidx.compose.runtime.remember { HashMap<LocalDate, androidx.compose.ui.layout.LayoutCoordinates>() }
    // The trip's day notes, read once, shown under their day as on the web.
    val notes by androidx.compose.runtime.produceState(emptyList<Remote.Note>(), trip.id) { value = runCatching { Remote.notes(trip) }.getOrDefault(emptyList()) }
    val cs = MaterialTheme.colorScheme
    // Photos and videos together, as on the web; a video carries a play badge.
    val photos = media
    fun stopOn(date: LocalDate): Stop? = trip.stops.lastOrNull { s -> s.start != null && !s.start.isAfter(date) } ?: trip.stops.firstOrNull()

    // A row of places only when there is more than one: a single place says nothing a row would add.
    if (trip.stops.distinctBy { it.name }.size > 1) {
        Text(
            "Plaatsen",
            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 18.sp, color = cs.onBackground),
            modifier = Modifier.padding(bottom = 12.dp),
        )
        Row(Modifier.bleed(16.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            trip.stops.distinctBy { it.name }.forEach { stop ->
                val pick = photos.firstOrNull { stopOn(it.takenAt)?.name == stop.name }
                Box(Modifier.width(138.dp).height(168.dp).clip(RoundedCornerShape(22.dp)).background(cs.surfaceContainerHigh)
                    .clickable(enabled = pick != null) {
                        // A tap goes to that place's first day, as on the web.
                        pick?.let { p -> dayAt[p.takenAt]?.takeIf { it.isAttached }?.let { onJump(it.boundsInRoot().top) } }
                    }) {
                    if (pick != null) {
                        RemotePhoto(pick.id, Modifier.fillMaxSize(), "preview")
                        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.62f))))
                    } else {
                        // No photo yet: the place in the trip's colour, with its flag, instead of an empty frame.
                        Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(trip.color.copy(alpha = 0.35f), trip.color.copy(alpha = 0.12f)))))
                        FlagIcon(stop.flag, 24.dp, Modifier.padding(14.dp))
                    }
                    Text(
                        stop.name, maxLines = 2,
                        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, lineHeight = 19.sp, color = if (pick != null) Color.White else cs.onSurface),
                        modifier = Modifier.align(Alignment.BottomStart).padding(12.dp),
                    )
                }
            }
        }
        Spacer(Modifier.height(26.dp))
    }

    if (photos.isEmpty()) {
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(cs.surfaceContainerLow).padding(18.dp)) {
            Text(
                if (trip.upcoming) "De foto's komen hier vanzelf zodra de reis begint" else "Nog geen foto's bij deze reis",
                style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant),
            )
        }
        return
    }

    val line = cs.outlineVariant
    val days = photos.groupBy { it.takenAt }.toSortedMap().entries.toList()
    // Pinch the timeline to make the photos bigger or smaller: five sizes, a step per 1.3x of finger distance (web).
    var perRow by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableIntStateOf(2) }
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
    days.forEachIndexed { d, (date, list) ->
        val last = d == days.lastIndex
        val stop = stopOn(date)
        var all by androidx.compose.runtime.saveable.rememberSaveable(date.toString()) { androidx.compose.runtime.mutableStateOf(false) }
        Column(
            Modifier.fillMaxWidth().drawBehind {
                val x = 6.dp.toPx()
                drawLine(line, Offset(x, 22.dp.toPx()), Offset(x, if (last) 40.dp.toPx() else size.height), strokeWidth = 2.dp.toPx())
            },
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.onGloballyPositioned { dayAt[date] = it }) {
                Box(Modifier.size(13.dp).clip(CircleShape).background(cs.primary))
                val weekday = date.dayOfWeek.getDisplayName(DateStyle.FULL, Dutch).replaceFirstChar { it.uppercase() }
                Text(
                    "$weekday ${date.dayOfMonth} ${date.month.getDisplayName(DateStyle.FULL, Dutch)}",
                    style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = 24.sp, letterSpacing = (-0.01).em, color = cs.onBackground),
                    modifier = Modifier.padding(start = 14.dp),
                )
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
            notes.filter { it.day == date.toString() }.forEach { n ->
                Column(Modifier.padding(start = 27.dp, top = 10.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(cs.surfaceContainerLow).padding(14.dp)) {
                    n.title?.let { Text(it, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp, color = cs.onSurface)) }
                    Text(n.body, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(450), fontSize = 15.sp, lineHeight = 22.sp, color = cs.onSurface), modifier = Modifier.padding(top = if (n.title != null) 4.dp else 0.dp))
                    Text(n.author, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 6.dp))
                }
            }
            Column(
                Modifier.padding(start = 27.dp, top = 12.dp, bottom = 30.dp).animateContentSize(MaterialTheme.motionScheme.defaultSpatialSpec()),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                val shown = list
                justified(shown, perRow).forEach { row ->
                    val ratio = row.sumOf { Photos.ratioOf(it).toDouble() }.toFloat().coerceAtLeast(0.8f)
                    Row(Modifier.fillMaxWidth().aspectRatio(ratio), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { m ->
                            // Each photo tells the viewer where it is; the one open in the viewer leaves its place empty.
                            Box(Modifier.weight(Photos.ratioOf(m)).fillMaxSize()
                                .onGloballyPositioned { bounds?.tiles?.set(m.id, it) }
                                .graphicsLayer { alpha = if (m.id == hidden) 0f else 1f }
                                .clip(RoundedCornerShape(14.dp)).clickable { onPhoto(m) }) {
                                RemotePhoto(m.id, Modifier.fillMaxSize())
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
}

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
private fun weatherGlyph(code: Int): List<Shape24> = when (code) {
    0, 1 -> Glyphs.sun
    2 -> Glyphs.partly
    in 71..77, 85, 86 -> Glyphs.snow
    in 95..99 -> Glyphs.storm
    in 51..67, in 80..82 -> Glyphs.rain
    else -> Glyphs.cloud
}
