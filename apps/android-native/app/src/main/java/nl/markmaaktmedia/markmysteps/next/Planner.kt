package nl.markmaaktmedia.markmysteps.next

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.MutableTransitionState
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
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularWavyProgressIndicator
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material3.ripple
import androidx.compose.material3.toShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import kotlin.math.roundToInt

/*
 * The route planner, the second tab of a trip, as in the web app: how many of
 * the trip's nights are planned, the way there, every stop with its nights and
 * the road from the stop before, the way back, and a field to add a stop.
 *
 * In Material 3 Expressive: the nights as a wavy ring, the stepper as one
 * connected group, the mode as a pill that walks through car, train, bus,
 * boat and flight. Swipe a stop to the left to remove it, hold it to move it.
 */

private val StopShapes = listOf(
    MaterialShapes.Cookie9Sided, MaterialShapes.Sunny, MaterialShapes.Clover4Leaf,
    MaterialShapes.Cookie6Sided, MaterialShapes.SoftBurst, MaterialShapes.Flower, MaterialShapes.Pentagon,
)

fun Mode.icon(): List<Shape24> = when (this) {
    Mode.Car -> Glyphs.car
    Mode.Train -> Glyphs.train
    Mode.Bus -> Glyphs.bus
    Mode.Boat -> Glyphs.boat
    Mode.Flight -> Glyphs.plane
}

private fun Mode.next(): Mode = Mode.entries[(ordinal + 1) % Mode.entries.size]

/** One row of the plan, with a key that stays the same while it moves. */
private class PlanStop(val key: Int, val name: String, val flag: String, val at: LonLat, nights: Int, mode: Mode) {
    var nights by mutableStateOf(nights)
    var mode by mutableStateOf(mode)
}

/** Places the search field knows in this test, per country of the trip. */
private val Places = listOf(
    Triple("Mestia", "🇬🇪", 42.73 to 43.04), Triple("Sighnaghi", "🇬🇪", 45.92 to 41.62), Triple("Borjomi", "🇬🇪", 43.39 to 41.84),
    Triple("Vardzia", "🇬🇪", 43.28 to 41.38), Triple("Gori", "🇬🇪", 44.11 to 41.98),
    Triple("Húsavík", "🇮🇸", -17.34 to 66.04), Triple("Malmö", "🇸🇪", 13.0 to 55.6), Triple("Siracusa", "🇮🇹", 15.29 to 37.07),
    Triple("Sintra", "🇵🇹", -9.39 to 38.8), Triple("Chefchaouen", "🇲🇦", -5.26 to 35.17), Triple("Ålesund", "🇳🇴", 6.15 to 62.47),
)

private val Months = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")

private fun Modifier.squish(onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.92f else 1f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "squish")
    clickable(source, ripple(), onClick = onClick).graphicsLayer { scaleX = scale; scaleY = scale }
}

@Composable
fun Planner(trip: Trip, dark: Boolean) {
    val cs = MaterialTheme.colorScheme
    val color = legibleColor(trip.color, dark)
    val stops = remember(trip.id) {
        mutableStateListOf<PlanStop>().apply { trip.stops.forEachIndexed { i, s -> add(PlanStop(i, s.name, s.flag, s.at, s.nights, s.mode)) } }
    }
    var nextKey by remember { mutableStateOf(trip.stops.size) }
    var outbound by remember(trip.id) { mutableStateOf(trip.outbound) }
    var back by remember(trip.id) { mutableStateOf(trip.back) }
    // A trip of 19 days has 18 nights.
    val totalNights = (trip.days - 1).coerceAtLeast(1)
    val planned = stops.sumOf { it.nights }

    // The first day and month of the trip, from the first stop's dates.
    // Real dates, so a stay across the end of a month reads "30 aug t/m 2 sep", not "30 t/m 33 aug".
    val firstDate = trip.start ?: trip.stops.firstOrNull()?.start ?: run {
        val d = trip.stops.firstOrNull()?.dates?.takeWhile { it.isDigit() }?.toIntOrNull() ?: 1
        val m = trip.stops.firstOrNull()?.dates?.substringAfterLast(' ')?.let { Months.indexOf(it) }?.takeIf { it >= 0 } ?: 0
        java.time.LocalDate.of(trip.year.toIntOrNull() ?: 2026, m + 1, d)
    }

    // Nights planned, out of the trip's: a wavy ring that fills and then settles.
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 4.dp, bottom = 14.dp)) {
        val share by animateFloatAsState((planned.toFloat() / totalNights).coerceIn(0f, 1f), MaterialTheme.motionScheme.slowSpatialSpec(), label = "nights")
        // A clear opening between where the ring starts and ends, so nearly full never reads as a ring
        // that just fails to close; all nights planned closes it.
        CircularWavyProgressIndicator(
            progress = { share }, modifier = Modifier.size(34.dp), color = color, trackColor = color.copy(alpha = 0.18f),
            gapSize = if (share >= 1f) 0.dp else 7.dp,
        )
        Text(
            "$planned/$totalNights nachten gepland",
            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface),
            modifier = Modifier.padding(start = 12.dp),
        )
    }

    outbound?.let { leg -> LegCard("Heen", leg, onMode = { outbound = leg.copy(mode = leg.mode.next()) }) }

    // Holding a stop lifts it; it follows the finger and swaps with a neighbour once past its middle.
    val heights = remember { mutableStateMapOf<Int, Int>() }
    var dragKey by remember { mutableStateOf<Int?>(null) }
    var dragY by remember { mutableFloatStateOf(0f) }
    val haptics = LocalHapticFeedback.current

    var day = firstDate
    stops.forEachIndexed { index, stop ->
        val from = day
        day = day.plusDays(stop.nights.toLong())
        fun d(x: java.time.LocalDate, withMonth: Boolean) = if (withMonth) "${x.dayOfMonth} ${Months[x.monthValue - 1]}" else "${x.dayOfMonth}"
        val dates = if (stop.nights == 0) d(from, true) else "${d(from, from.month != day.month)} t/m ${d(day, true)}"
        androidx.compose.runtime.key(stop.key) {
            val visible = remember { MutableTransitionState(stop.key < trip.stops.size).apply { targetState = true } }
            AnimatedVisibility(
                visibleState = visible,
                enter = expandVertically(MaterialTheme.motionScheme.defaultSpatialSpec()) + fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()),
                exit = shrinkVertically(MaterialTheme.motionScheme.fastSpatialSpec()) + fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()),
                modifier = Modifier.zIndex(if (dragKey == stop.key) 1f else 0f),
            ) {
                val lifted = dragKey == stop.key
                val lift by animateFloatAsState(if (lifted) 1f else 0f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "lift")
                Column(
                    Modifier
                        .onSizeChanged { heights[stop.key] = it.height }
                        .graphicsLayer {
                            translationY = if (lifted) dragY else 0f
                            scaleX = 1f + 0.03f * lift; scaleY = 1f + 0.03f * lift
                        }
                        .pointerInput(stop.key) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = { dragKey = stop.key; dragY = 0f; haptics.performHapticFeedback(HapticFeedbackType.LongPress) },
                                onDragEnd = { dragKey = null; dragY = 0f },
                                onDragCancel = { dragKey = null; dragY = 0f },
                                onDrag = { change, amount ->
                                    change.consume()
                                    dragY += amount.y
                                    val i = stops.indexOfFirst { it.key == stop.key }
                                    val below = stops.getOrNull(i + 1)
                                    val above = stops.getOrNull(i - 1)
                                    if (below != null && dragY > (heights[below.key] ?: 0) / 2f) {
                                        dragY -= heights[below.key] ?: 0
                                        stops.add(i + 1, stops.removeAt(i))
                                        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                                    } else if (above != null && dragY < -(heights[above.key] ?: 0) / 2f) {
                                        dragY += heights[above.key] ?: 0
                                        stops.add(i - 1, stops.removeAt(i))
                                        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                                    }
                                },
                            )
                        },
                ) {
                    if (index > 0 || outbound != null) {
                        val prev = stops.getOrNull(index - 1)
                        val km = prev?.let { (angle(it.at, stop.at) * 111.2 * if (stop.mode == Mode.Flight) 1.0 else 1.25).roundToInt() }
                        Connector(stop.mode, km, color, showMode = index > 0, onMode = { stop.mode = stop.mode.next() })
                    }
                    StopRow(
                        name = stop.name, flag = stop.flag, dates = dates, nights = stop.nights, index = index,
                        color = color, dark = dark, lifted = lift,
                        onNights = { stop.nights = (stop.nights + it).coerceIn(0, 60) },
                        onRemove = { visible.targetState = false },
                    )
                }
            }
            // Gone from the list only once it has folded away.
            if (visible.isIdle && !visible.currentState) {
                androidx.compose.runtime.LaunchedEffect(Unit) { stops.remove(stop) }
            }
        }
    }

    back?.let { leg ->
        Spacer(Modifier.height(12.dp))
        LegCard("Terug", leg, onMode = { back = leg.copy(mode = leg.mode.next()) })
    }

    AddStop(trip, taken = stops.map { it.name }.toSet(), onAdd = { name, flag, at ->
        stops.add(PlanStop(nextKey, name, flag, at, 1, Mode.Car))
        nextKey += 1
    })
}

/** The way there or back: its name, the mode pill, where from and where to, and how far. */
@Composable
private fun LegCard(name: String, leg: Leg, onMode: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(cs.surfaceContainerLow).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(name, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, color = cs.onSurface), modifier = Modifier.width(54.dp))
        ModePill(leg.mode, onMode)
        // Where from and where to, with the arrow drawn as one of the app's icons, not a font's.
        Row(Modifier.weight(1f).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            val code = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface)
            Text(leg.from, maxLines = 1, style = code)
            LineIcon(Glyphs.arrowRight, cs.onSurfaceVariant, size = 16.dp, stroke = 2.2f, modifier = Modifier.padding(horizontal = 6.dp))
            Text(leg.to, maxLines = 1, style = code)
        }
        if (leg.km > 0) Text(km(leg.km), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
    }
}

private fun km(value: Int): String = "%,d km".format(value).replace(',', '.')

/** A pill with the mode's icon and name; a tap walks to the next mode, the icon turning over. */
@Composable
private fun ModePill(mode: Mode, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    Row(
        Modifier.height(36.dp).clip(CircleShape).background(cs.secondaryContainer).squish(onClick).padding(start = 10.dp, end = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AnimatedContent(
            mode,
            transitionSpec = {
                (scaleIn(motion.fastSpatialSpec(), initialScale = 0.4f) + fadeIn(motion.fastEffectsSpec())) togetherWith
                    (scaleOut(motion.fastSpatialSpec(), targetScale = 0.4f) + fadeOut(motion.fastEffectsSpec()))
            },
            label = "mode",
        ) { m ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                LineIcon(m.icon(), cs.onSecondaryContainer, size = 18.dp, stroke = 1.9f)
                Text(m.label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.onSecondaryContainer), modifier = Modifier.padding(start = 6.dp))
            }
        }
    }
}

/** Between two stops: the line in the trip's colour, how the road was travelled and how far. */
@Composable
private fun Connector(mode: Mode, km: Int?, color: Color, showMode: Boolean, onMode: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.height(if (showMode) 56.dp else 16.dp).padding(start = 33.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(2.dp).fillMaxHeight().background(color.copy(alpha = 0.35f)))
        if (showMode) {
            Spacer(Modifier.width(18.dp))
            ModePill(mode, onMode)
            if (km != null) {
                Text(
                    if (km < 5) "in de buurt" else km(km),
                    style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant),
                    modifier = Modifier.padding(start = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun StopRow(
    name: String, flag: String, dates: String, nights: Int, index: Int, color: Color, dark: Boolean, lifted: Float,
    onNights: (Int) -> Unit, onRemove: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val tile = color.copy(alpha = if (dark) 0.32f else 0.2f).compositeOver(cs.surfaceContainerLow)
    val swipe = rememberSwipeToDismissBoxState()
    SwipeToDismissBox(
        state = swipe,
        enableDismissFromStartToEnd = false,
        onDismiss = { if (it == SwipeToDismissBoxValue.EndToStart) onRemove() },
        backgroundContent = {
            val bg by animateColorAsState(
                if (swipe.targetValue == SwipeToDismissBoxValue.EndToStart) cs.error else cs.errorContainer,
                MaterialTheme.motionScheme.fastEffectsSpec(), label = "swipeBg",
            )
            Box(Modifier.fillMaxSize().clip(RoundedCornerShape(26.dp)).background(bg).padding(end = 24.dp), contentAlignment = Alignment.CenterEnd) {
                LineIcon(Glyphs.trash, if (swipe.targetValue == SwipeToDismissBoxValue.EndToStart) cs.onError else cs.onErrorContainer, size = 22.dp)
            }
        },
    ) {
        Row(
            Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(26.dp))
                .background(androidx.compose.ui.graphics.lerp(cs.surfaceContainerLow, cs.secondaryContainer, lifted))
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(46.dp).clip(StopShapes[index % StopShapes.size].toShape()).background(tile), contentAlignment = Alignment.Center) {
                Text("${index + 1}", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 17.sp, color = color))
            }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text("$flag  $name", maxLines = 1, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, color = cs.onSurface))
                Text(dates, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant))
            }
            Stepper(nights, onNights)
        }
    }
}

/** Fewer, the count, more: one connected group, outer ends round, the number rolling. */
@Composable
private fun Stepper(nights: Int, onChange: (Int) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    val outer = 20.dp
    val inner = 6.dp
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(38.dp).clip(RoundedCornerShape(topStart = outer, bottomStart = outer, topEnd = inner, bottomEnd = inner))
                .background(cs.surfaceContainerHighest).squish { onChange(-1) },
            contentAlignment = Alignment.Center,
        ) { LineIcon(Glyphs.minus, cs.onSurface, size = 16.dp, stroke = 2.4f) }
        Box(Modifier.height(38.dp).width(52.dp).clip(RoundedCornerShape(inner)).background(cs.secondaryContainer), contentAlignment = Alignment.Center) {
            AnimatedContent(
                nights,
                transitionSpec = {
                    val up = targetState > initialState
                    (androidx.compose.animation.slideInVertically(motion.fastSpatialSpec()) { if (up) it else -it } + fadeIn(motion.fastEffectsSpec())) togetherWith
                        (androidx.compose.animation.slideOutVertically(motion.fastSpatialSpec()) { if (up) -it else it } + fadeOut(motion.fastEffectsSpec()))
                },
                label = "nights",
            ) { n ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$n", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 16.sp, lineHeight = 16.sp, color = cs.onSecondaryContainer))
                    Text(if (n == 1) "nacht" else "nachten", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 9.5.sp, lineHeight = 10.sp, color = cs.onSecondaryContainer))
                }
            }
        }
        Box(
            Modifier.size(38.dp).clip(RoundedCornerShape(topStart = inner, bottomStart = inner, topEnd = outer, bottomEnd = outer))
                .background(cs.surfaceContainerHighest).squish { onChange(1) },
            contentAlignment = Alignment.Center,
        ) { LineIcon(Glyphs.plus, cs.onSurface, size = 16.dp, stroke = 2.4f) }
    }
}

/** A search field for a new stop; places that match open underneath, one tap adds it. */
@Composable
private fun AddStop(trip: Trip, taken: Set<String>, onAdd: (String, String, LonLat) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var query by remember { mutableStateOf("") }
    val flag = trip.stops.firstOrNull()?.flag
    val matches = Places.filter { (name, f, _) ->
        name !in taken && if (query.isBlank()) f == flag else name.contains(query.trim(), ignoreCase = true)
    }.take(4)

    Column(Modifier.padding(top = 20.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(cs.surfaceContainerLow).padding(14.dp)) {
        Text("Nieuwe stop", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, color = cs.onSurface), modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
        Row(
            Modifier.fillMaxWidth().height(52.dp).clip(CircleShape).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineIcon(Glyphs.search, cs.onSurfaceVariant, size = 20.dp)
            Box(Modifier.weight(1f).padding(start = 12.dp)) {
                if (query.isEmpty()) {
                    Text("Zoek een stad, bijv. Mestia", style = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurfaceVariant))
                }
                BasicTextField(
                    query, { query = it }, singleLine = true,
                    textStyle = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurface),
                    cursorBrush = SolidColor(cs.primary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            matches.forEachIndexed { i, (name, f, at) ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(if (i == 0) 18.dp else 6.dp, if (i == 0) 18.dp else 6.dp, if (i == matches.lastIndex) 18.dp else 6.dp, if (i == matches.lastIndex) 18.dp else 6.dp))
                        .background(cs.surfaceContainer).clickable { onAdd(name, f, at); query = "" }.padding(horizontal = 14.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("$f  $name", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface), modifier = Modifier.weight(1f))
                    LineIcon(Glyphs.plus, cs.primary, size = 18.dp, stroke = 2.4f)
                }
            }
        }
        if (query.isNotBlank() && matches.isEmpty()) {
            Button(
                onClick = { onAdd(query.trim(), flag ?: "📍", trip.stops.lastOrNull()?.at ?: trip.route.lastOrNull() ?: HomeAirport); query = "" },
                shapes = ButtonDefaults.shapes(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                modifier = Modifier.padding(top = 10.dp),
            ) { Text("“${query.trim()}” toevoegen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)) }
        }
    }
}
