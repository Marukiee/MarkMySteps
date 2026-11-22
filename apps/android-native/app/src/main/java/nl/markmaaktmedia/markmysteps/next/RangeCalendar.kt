package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.YearMonth

/*
 * A calendar of one month at a time, made for picking the days of a trip.
 *
 * Press a day and drag to the last one; let go and the range stays. Either end can be picked up again and
 * dragged to another day. A tap starts a new range, a second tap after it closes it. Every day the finger
 * passes gives a light tick. The month changes with the arrows (a calendar you can scroll was not clear),
 * sliding the way you go. The weekday letters are small and quiet, so they never look like dates.
 */

@Composable
/** [bounds]: only these days can be chosen (the days of a trip); the rest stay quiet and do nothing. */
fun RangeCalendar(start: LocalDate?, end: LocalDate?, onChange: (LocalDate?, LocalDate?) -> Unit, modifier: Modifier = Modifier, bounds: ClosedRange<LocalDate>? = null) {
    val cs = MaterialTheme.colorScheme
    val today = remember { LocalDate.now() }
    var month by remember { mutableStateOf(YearMonth.from(start ?: today)) }
    val haptics = rememberHaptics()
    val motion = MaterialTheme.motionScheme

    Column(modifier.fillMaxWidth()) {
        // The month in the middle with an arrow on either side, as the old calendar had it.
        Row(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            @Composable
            fun Arrow(step: Long) = Box(
                Modifier.size(44.dp).clip(CircleShape)
                    .pointerInput(step) { awaitEachGesture { awaitFirstDown(); val up = waitForUpOrCancellation(); if (up != null) { haptics(Haptic.Tap); month = month.plusMonths(step) } } },
                contentAlignment = Alignment.Center,
            ) { LineIcon(if (step < 0) listOf(P("m15 18-6-6 6-6")) else Glyphs.chevronRight, cs.onSurfaceVariant, size = 22.dp, stroke = 2.2f) }
            Arrow(-1)
            AnimatedContent(month, transitionSpec = {
                val dir = if (targetState > initialState) 1 else -1
                (slideInHorizontally(motion.defaultSpatialSpec()) { w -> dir * w / 3 } + fadeIn(motion.defaultEffectsSpec())) togetherWith
                    (slideOutHorizontally(motion.defaultSpatialSpec()) { w -> -dir * w / 3 } + fadeOut(motion.fastEffectsSpec()))
            }, label = "monthName", modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) { m ->
                Text("${stringArrayResource(R.array.calendar_months)[m.monthValue - 1]} ${m.year}", textAlign = TextAlign.Center, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 19.sp, color = cs.onSurface), modifier = Modifier.fillMaxWidth())
            }
            Arrow(1)
        }
        // The weekdays: small capitals in a quiet tone, so they read as labels and not as days.
        Row(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
            stringArrayResource(R.array.calendar_weekdays).forEach { d ->
                Text(d, textAlign = TextAlign.Center, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 12.sp, letterSpacing = 0.04.sp, color = cs.onSurfaceVariant.copy(alpha = 0.75f)), modifier = Modifier.weight(1f))
            }
        }
        AnimatedContent(month, transitionSpec = {
            val dir = if (targetState > initialState) 1 else -1
            (slideInHorizontally(motion.defaultSpatialSpec()) { w -> dir * w / 4 } + fadeIn(motion.defaultEffectsSpec())) togetherWith
                (slideOutHorizontally(motion.defaultSpatialSpec()) { w -> -dir * w / 4 } + fadeOut(motion.fastEffectsSpec()))
        }, label = "monthGrid") { m ->
            MonthGrid(m, start, end, today, onChange, bounds)
        }
    }
}


@Composable
private fun MonthGrid(month: YearMonth, start: LocalDate?, end: LocalDate?, today: LocalDate, onChange: (LocalDate?, LocalDate?) -> Unit, bounds: ClosedRange<LocalDate>? = null) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    val lead = month.atDay(1).dayOfWeek.value - 1
    val days = month.lengthOfMonth()
    val rows = (lead + days + 6) / 7
    val cellH = 46.dp
    val current by rememberUpdatedState(start to end)
    val change by rememberUpdatedState(onChange)

    Column(
        Modifier.fillMaxWidth().height(cellH * 6).pointerInput(month) {
            val cellW = size.width / 7f
            val cellPx = cellH.toPx()
            fun dayAt(x: Float, y: Float): LocalDate? {
                val col = (x / cellW).toInt().coerceIn(0, 6); val row = (y / cellPx).toInt()
                val n = row * 7 + col - lead + 1
                return if (n in 1..days && y >= 0) month.atDay(n).takeIf { bounds == null || it in bounds } else null
            }
            awaitEachGesture {
                val down = awaitFirstDown()
                val first = dayAt(down.position.x, down.position.y) ?: return@awaitEachGesture
                val (s, e) = current
                // Which end is held: an existing end picked up again, or a new range from this day.
                var holding: String
                var anchor: LocalDate
                when {
                    s != null && e != null && first == e -> { holding = "end"; anchor = s }
                    s != null && e != null && first == s -> { holding = "start"; anchor = e }
                    else -> { holding = "new"; anchor = first }
                }
                var last = first
                var dragged = false
                val slop = viewConfiguration.touchSlop
                var travelled = 0f
                while (true) {
                    val ev = awaitPointerEvent()
                    val c = ev.changes.firstOrNull() ?: break
                    if (!c.pressed) break
                    travelled += c.positionChange().getDistance()
                    if (!dragged && travelled > slop) {
                        dragged = true
                        haptics(Haptic.Tick)
                        if (holding == "new") change(first, first)
                    }
                    if (dragged) {
                        c.consume()
                        val d = dayAt(c.position.x, c.position.y) ?: continue
                        if (d != last) {
                            last = d
                            haptics(Haptic.DragTick)
                            // The held end follows the finger; past the other end the two simply swap roles.
                            if (d.isBefore(anchor)) change(d, anchor) else change(anchor, d)
                        }
                    }
                }
                if (!dragged) {
                    // A tap: the first day of a new range, or the last day of one that has only a start.
                    haptics(Haptic.Tap)
                    when {
                        s != null && e == null && !first.isBefore(s) -> change(s, first)
                        else -> change(first, null)
                    }
                }
            }
        },
    ) {
        for (r in 0 until rows) {
            Row(Modifier.fillMaxWidth().height(cellH)) {
                for (c in 0 until 7) {
                    val n = r * 7 + c - lead + 1
                    Box(Modifier.weight(1f).height(cellH), contentAlignment = Alignment.Center) {
                        if (n in 1..days) DayCell(month.atDay(n), start, end, today, c, bounds)
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(day: LocalDate, start: LocalDate?, end: LocalDate?, today: LocalDate, column: Int, bounds: ClosedRange<LocalDate>? = null) {
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    val last = end ?: start
    val isStart = day == start
    val isEnd = day == last
    val inRange = start != null && last != null && !day.isBefore(start) && !day.isAfter(last)
    val endpoint = isStart || isEnd
    // The band between the ends, joined across the week, rounded where a week or the range starts or stops.
    val band by animateColorAsState(if (inRange && start != last) cs.primaryContainer else Color.Transparent, motion.defaultEffectsSpec(), label = "band")
    val firstOfMonth = day.dayOfMonth == 1
    val lastOfMonth = day.dayOfMonth == day.lengthOfMonth()
    val roundL = isStart || column == 0 || firstOfMonth
    val roundR = isEnd || column == 6 || lastOfMonth
    Box(
        Modifier.fillMaxWidth().height(40.dp)
            .padding(start = if (isStart) 4.dp else 0.dp, end = if (isEnd) 4.dp else 0.dp)
            .clip(RoundedCornerShape(topStart = if (roundL) 20.dp else 0.dp, bottomStart = if (roundL) 20.dp else 0.dp, topEnd = if (roundR) 20.dp else 0.dp, bottomEnd = if (roundR) 20.dp else 0.dp))
            .background(band),
    )
    // The two ends pop in as filled circles; a day that becomes an end grows into it.
    val scale by animateFloatAsState(if (endpoint) 1f else 0f, motion.fastSpatialSpec(), label = "end")
    Box(Modifier.size(42.dp).graphicsLayer { scaleX = scale; scaleY = scale }.clip(CircleShape).background(cs.primary))
    val fg by animateColorAsState(
        when {
            endpoint -> cs.onPrimary; inRange -> cs.onPrimaryContainer
            bounds != null -> if (day in bounds) cs.onSurface else cs.onSurface.copy(alpha = 0.3f)
            // Past days can be picked (a trip that already happened), so they look like any other day.
            else -> cs.onSurface
        },
        motion.defaultEffectsSpec(), label = "dayText",
    )
    Text("${day.dayOfMonth}", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(if (endpoint || day == today) 650 else 500), fontSize = 15.5.sp, color = fg))
    // Today: a small dot under the number instead of a ring that looks like a selection.
    if (day == today && !endpoint) Box(Modifier.padding(top = 26.dp).size(4.dp).clip(CircleShape).background(cs.primary))
}
