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
fun Timeline(trip: Trip, dark: Boolean, media: List<Media>? = null, onPhoto: (Media) -> Unit = {}) {
    if (media != null) { LiveTimeline(trip, media, onPhoto); return }
    if (trip.remoteId != null) { TimelinePlaceholder(); return }
    val cs = MaterialTheme.colorScheme
    val scenes = Scene.entries

    val places = trip.stops.distinctBy { it.name }
    if (places.size > 1) Text(
        "Plaatsen",
        style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 18.sp, color = cs.onBackground),
        modifier = Modifier.padding(start = 2.dp, bottom = 12.dp),
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
                Text(day.stop.flag, fontSize = 15.sp)
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
private fun LiveTimeline(trip: Trip, media: List<Media>, onPhoto: (Media) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val photos = media.filter { !it.video }
    fun stopOn(date: LocalDate): Stop? = trip.stops.lastOrNull { s -> s.start != null && !s.start.isAfter(date) } ?: trip.stops.firstOrNull()

    // A row of places only when there is more than one: a single place says nothing a row would add.
    if (trip.stops.distinctBy { it.name }.size > 1) {
        Text(
            "Plaatsen",
            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 18.sp, color = cs.onBackground),
            modifier = Modifier.padding(start = 2.dp, bottom = 12.dp),
        )
        Row(Modifier.bleed(16.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            trip.stops.distinctBy { it.name }.forEach { stop ->
                val pick = photos.firstOrNull { stopOn(it.takenAt)?.name == stop.name }
                Box(Modifier.width(138.dp).height(168.dp).clip(RoundedCornerShape(22.dp)).background(cs.surfaceContainerHigh)) {
                    if (pick != null) {
                        RemotePhoto(pick.id, Modifier.fillMaxSize(), "preview")
                        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.62f))))
                    } else {
                        // No photo yet: the place in the trip's colour, with its flag, instead of an empty frame.
                        Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(trip.color.copy(alpha = 0.35f), trip.color.copy(alpha = 0.12f)))))
                        Text(stop.flag, fontSize = 30.sp, modifier = Modifier.padding(14.dp))
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(13.dp).clip(CircleShape).background(cs.primary))
                val weekday = date.dayOfWeek.getDisplayName(DateStyle.FULL, Dutch).replaceFirstChar { it.uppercase() }
                Text(
                    "$weekday ${date.dayOfMonth} ${date.month.getDisplayName(DateStyle.FULL, Dutch)}",
                    style = TextStyle(fontFamily = Fraunces, fontWeight = FontWeight(560), fontSize = 24.sp, letterSpacing = (-0.01).em, color = cs.onBackground),
                    modifier = Modifier.padding(start = 14.dp),
                )
            }
            if (stop != null) {
                Row(Modifier.padding(start = 27.dp, top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stop.flag, fontSize = 15.sp)
                    Text(
                        stop.name,
                        style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 15.sp, color = cs.onSurfaceVariant),
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }
            Column(
                Modifier.padding(start = 27.dp, top = 12.dp, bottom = 30.dp).animateContentSize(MaterialTheme.motionScheme.defaultSpatialSpec()),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                val shown = if (all) list else list.take(12)
                justified(shown).forEach { row ->
                    val ratio = row.sumOf { it.ratio.toDouble() }.toFloat().coerceAtLeast(0.8f)
                    Row(Modifier.fillMaxWidth().aspectRatio(ratio), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { m -> RemotePhoto(m.id, Modifier.weight(m.ratio).fillMaxSize().clip(RoundedCornerShape(14.dp)).clickable { onPhoto(m) }) }
                    }
                }
                if (list.size > 12) {
                    androidx.compose.material3.FilledTonalButton(
                        onClick = { all = !all },
                        shapes = androidx.compose.material3.ButtonDefaults.shapes(),
                        modifier = Modifier.padding(top = 4.dp),
                    ) {
                        Text(
                            if (all) "Minder tonen" else "Alle ${list.size} foto's van deze dag",
                            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp),
                        )
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
private fun justified(list: List<Media>): List<List<Media>> {
    val rows = mutableListOf<List<Media>>()
    var i = 0
    while (i < list.size) {
        val a = list[i]
        val take = when {
            a.ratio > 1.6f -> 1
            i + 2 < list.size && list.subList(i, i + 3).all { it.ratio < 0.9f } -> 3
            else -> 2
        }.coerceAtMost(list.size - i)
        rows += list.subList(i, i + take)
        i += take
    }
    return rows
}


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
