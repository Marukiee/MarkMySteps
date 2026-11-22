package nl.markmaaktmedia.markmysteps.next

import android.view.View
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sign

/*
 * The route planner, the second tab of a trip, with everything the web planner
 * has: how many of the trip's nights are planned, the way there and back with
 * their flights, every stop with a photo from its days, its nights and its day
 * trips, the road from the stop before, and a field to add a stop.
 *
 * In Material 3 Expressive, tonal and without shadows: the mode is picked from
 * the app's menu, a flight is filled in on a sheet, a stop is swiped away the
 * way PixelPlayer removes a song from its queue, and held to move it.
 */

fun Mode.icon(): List<Shape24> = when (this) {
    Mode.Car -> Glyphs.car
    Mode.Train -> Glyphs.train
    Mode.Bus -> Glyphs.bus
    Mode.Boat -> Glyphs.boat
    Mode.Flight -> Glyphs.plane
}

/** A day trip on the plan, with a key that stays the same while the list changes. */
private class PlanDayTrip(val key: Int, val id: String?, val name: String, val flag: String, val at: LonLat?, val day: LocalDate?)

/** One row of the plan, with a key that stays the same while it moves. */
private class PlanStop(
    val key: Int, val name: String, val flag: String, val at: LonLat, nights: Int, mode: Mode, val id: String? = null,
    flightNumber: String? = null, fromAirport: String? = null, toAirport: String? = null, dayTrips: List<PlanDayTrip> = emptyList(),
) {
    var nights by mutableStateOf(nights)
    var mode by mutableStateOf(mode)
    var flightNumber by mutableStateOf(flightNumber)
    var fromAirport by mutableStateOf(fromAirport)
    var toAirport by mutableStateOf(toAirport)
    val dayTrips = mutableStateListOf<PlanDayTrip>().apply { addAll(dayTrips) }

    fun copy(key: Int) = PlanStop(key, name, flag, at, nights, mode, id, flightNumber, fromAirport, toAirport, dayTrips.toList())
}

/** The way there or back, a stop of its own on the server with no nights. */
private class PlanLeg(val outbound: Boolean, val id: String?, mode: Mode, number: String?, from: String?, to: String?, val km: Int) {
    var mode by mutableStateOf(mode)
    var flightNumber by mutableStateOf(number)
    var fromAirport by mutableStateOf(from)
    var toAirport by mutableStateOf(to)
}

/** What the flight sheet edits, and where the result goes. */
private class FlightTarget(
    val title: String, val subtitle: String?, val number: String?, val from: String?, val to: String?,
    val nearFrom: LonLat?, val nearTo: LonLat?, val onSave: (String?, String?, String?) -> Unit,
)

/** A removal that waits 7 s for "Ongedaan maken" before it reaches the server. */
private class Pending(val name: String, val restore: () -> Unit, val commit: suspend () -> Unit) { var job: Job? = null }

/** Places the search field knows in this test, per country of the trip. */
private val Places = listOf(
    Triple("Mestia", "🇬🇪", 42.73 to 43.04), Triple("Sighnaghi", "🇬🇪", 45.92 to 41.62), Triple("Borjomi", "🇬🇪", 43.39 to 41.84),
    Triple("Vardzia", "🇬🇪", 43.28 to 41.38), Triple("Gori", "🇬🇪", 44.11 to 41.98),
    Triple("Húsavík", "🇮🇸", -17.34 to 66.04), Triple("Malmö", "🇸🇪", 13.0 to 55.6), Triple("Siracusa", "🇮🇹", 15.29 to 37.07),
    Triple("Sintra", "🇵🇹", -9.39 to 38.8), Triple("Chefchaouen", "🇲🇦", -5.26 to 35.17), Triple("Ålesund", "🇳🇴", 6.15 to 62.47),
)

private val Months = listOf("jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec")
private val Teal = Color(0xFF2BB6A8)
private val IataCode = Regex("[A-Z]{3,4}")

private fun day(d: LocalDate, month: Boolean = true, year: Boolean = false) =
    "${d.dayOfMonth}" + (if (month) " ${Months[d.monthValue - 1]}" else "") + (if (year) " ${d.year}" else "")

/** "16 t/m 23 dec 2026", "30 aug t/m 2 sep 2026", "30 dec 2026 t/m 2 jan 2027", or one day for no nights. */
private fun stay(from: LocalDate, to: LocalDate): String = when {
    from == to -> day(from, year = true)
    from.year != to.year -> "${day(from, year = true)} t/m ${day(to, year = true)}"
    else -> "${day(from, month = from.month != to.month)} t/m ${day(to, year = true)}"
}

private fun km(value: Int): String = "%,d km".format(value).replace(',', '.')

private fun contrast(a: Color, b: Color): Float {
    val x = a.luminance(); val y = b.luminance()
    return (maxOf(x, y) + 0.05f) / (minOf(x, y) + 0.05f)
}

/** The colour itself when it reads well enough on [bg], else moved toward black or white until it does (4.5:1). */
private fun readable(fg: Color, bg: Color, dark: Boolean): Color {
    var c = fg
    var t = 0f
    while (contrast(c, bg) < 4.5f && t < 1f) { t += 0.05f; c = lerp(fg, if (dark) Color.White else Color.Black, t) }
    return c
}

/**
 * Black or white on a coloured badge, whichever reads best. Pure black, not a near black: only then does one
 * of the two clear 4.5:1 on every colour (the worst, a mid tone, still gets 4.6:1).
 */
private fun onBadge(bg: Color): Color = listOf(Color.White, Color.Black).maxBy { contrast(it, bg) }

private fun Modifier.squish(onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.92f else 1f, MaterialTheme.motionScheme.fastSpatialSpec(), label = "squish")
    clickable(source, ripple(), onClick = onClick).graphicsLayer { scaleX = scale; scaleY = scale }
}

/** The photo in the middle of a stay: the first ones are often still the station or the airport. */
private fun photoFor(media: List<Media>?, from: LocalDate?, nights: Int): String? {
    if (media == null || from == null) return null
    val until = from.plusDays(nights.coerceAtLeast(1).toLong())
    val list = media.filter { !it.video && !it.takenAt.isBefore(from) && it.takenAt.isBefore(until) }
    return list.getOrNull(list.size / 2)?.id
}

@Composable
fun Planner(
    trip: Trip, dark: Boolean, media: List<Media>? = null,
    /** A tapped stop: the trip map flies there (TripPage). */
    onFlyTo: ((LonLat) -> Unit)? = null,
    /** Opens the map to tap a new stop's place; the place picked comes back through the callback (TripPage). */
    onPickOnMap: (((Remote.Place) -> Unit) -> Unit)? = null,
) {
    val cs = MaterialTheme.colorScheme
    val color = legibleColor(trip.color, dark)
    val context = LocalContext.current
    var nextKey by remember { mutableIntStateOf(trip.stops.size) }
    fun newKey() = nextKey.also { nextKey += 1 }
    var dayTripKey by remember { mutableIntStateOf(0) }
    val stops = remember(trip.id) {
        mutableStateListOf<PlanStop>().apply {
            trip.stops.forEachIndexed { i, s ->
                add(PlanStop(i, s.name, s.flag, s.at, s.nights, s.mode, s.id, s.flightNumber, s.fromAirport, s.toAirport,
                    s.dayTrips.map { d -> PlanDayTrip(dayTripKey++, d.id, d.name, d.flag, d.at, d.day) }))
            }
        }
    }
    fun legOf(l: Leg?, outbound: Boolean): PlanLeg? = l?.let {
        // The demo's flights name their airports in from and to; a server leg has them apart.
        val code = { s: String -> s.takeIf { l.id == null && l.mode == Mode.Flight && it.matches(IataCode) } }
        PlanLeg(outbound, l.id ?: trip.remoteId?.let { id -> Remote.legStopIds[id]?.let { if (outbound) it.first else it.second } },
            l.mode, l.flightNumber, l.fromAirport ?: code(l.from), l.toAirport ?: code(l.to), l.km)
    }
    var outbound by remember(trip.id) { mutableStateOf(legOf(trip.outbound, true)) }
    var back by remember(trip.id) { mutableStateOf(legOf(trip.back, false)) }
    // The airports are read from the app's assets once, for the flight times and the flight sheet.
    val airports by produceState(FlightAirports.ready) { FlightAirports.load(context); value = true }

    // The window makes room for the keyboard instead of sliding up as a whole, so the trip's top bar
    // and the status bar backdrop stay put while a field scrolls itself above the keyboard.
    val activity = context as? android.app.Activity
    DisposableEffect(activity) {
        val window = activity?.window
        val before = window?.attributes?.softInputMode
        window?.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        onDispose { if (before != null) window.setSoftInputMode(before) }
    }

    // A trip of 19 days has 18 nights.
    val totalNights = (trip.days - 1).coerceAtLeast(1)
    // A trip from the server saves every change straight away, as the web planner does; a failure says so.
    val live = trip.remoteId != null
    val scope = rememberCoroutineScope()
    var saveError by remember { mutableStateOf<String?>(null) }
    val nightJobs = remember { HashMap<Int, Job>() }
    var undo by remember { mutableStateOf<Pending?>(null) }
    fun save(block: suspend () -> Unit) { if (live) scope.launch { runCatching { block() }.onSuccess { saveError = null }.onFailure { saveError = "Opslaan mislukt" } } }

    /** A removal that waited for undo goes through now (a new removal, or a reorder that must name every stop the server still has). */
    suspend fun flushUndo() {
        val p = undo ?: return
        p.job?.cancel(); undo = null
        runCatching { p.commit() }.onFailure { saveError = "Opslaan mislukt" }
    }
    fun offerUndo(name: String, restore: () -> Unit, commit: suspend () -> Unit) {
        val previous = undo
        val p = Pending(name, restore, commit)
        undo = p
        p.job = scope.launch {
            previous?.let { it.job?.cancel(); runCatching { it.commit() } }
            delay(7000)
            if (live) runCatching { commit() }.onFailure { saveError = "Opslaan mislukt" }
            if (undo === p) undo = null
        }
    }

    // Every stop of the route in its new order, with the way there first and the way back last, as the server asks.
    fun routeOrder(): List<String> {
        val legs = trip.remoteId?.let { Remote.legStopIds[it] }
        return listOfNotNull(outbound?.id ?: legs?.first) + stops.mapNotNull { it.id } + listOfNotNull(back?.id ?: legs?.second)
    }
    fun saveOrder() = save { flushUndo(); Remote.reorderStops(trip, routeOrder()) }
    fun syncLegIds() { trip.remoteId?.let { Remote.legStopIds[it] = outbound?.id to back?.id } }

    val planned = stops.sumOf { it.nights }
    // The first day of the trip; real dates, so a stay across the end of a month reads "30 aug t/m 2 sep".
    val firstDate = trip.start ?: trip.stops.firstOrNull()?.start ?: run {
        val d = trip.stops.firstOrNull()?.dates?.takeWhile { it.isDigit() }?.toIntOrNull() ?: 1
        val m = trip.stops.firstOrNull()?.dates?.substringAfterLast(' ')?.let { Months.indexOf(it) }?.takeIf { it >= 0 } ?: 0
        LocalDate.of(trip.year.toIntOrNull() ?: 2026, m + 1, d)
    }

    var flight by remember { mutableStateOf<FlightTarget?>(null) }
    fun legFlight(leg: PlanLeg) {
        flight = FlightTarget(
            if (leg.outbound) "Heenvlucht" else "Terugvlucht", if (leg.outbound) stops.firstOrNull()?.let { "Naar ${it.name}" } else stops.lastOrNull()?.let { "Vanuit ${it.name}" },
            leg.flightNumber, leg.fromAirport, leg.toAirport,
            nearFrom = if (leg.outbound) HomeAirport else stops.lastOrNull()?.at, nearTo = if (leg.outbound) stops.firstOrNull()?.at else HomeAirport,
        ) { n, f, t ->
            leg.mode = Mode.Flight
            // An emptied number is cleared, here and on the server.
            val number = if (n.isNullOrBlank() && leg.flightNumber != null) "" else n
            leg.flightNumber = PlannerRemote.cleanNumber(n) ?: if (number == "") null else leg.flightNumber
            PlannerRemote.cleanCode(f)?.let { leg.fromAirport = it }
            PlannerRemote.cleanCode(t)?.let { leg.toAirport = it }
            leg.id?.let { id -> save { PlannerRemote.saveFlight(trip, id, number, f, t) } }
        }
    }
    fun stopFlight(stop: PlanStop) {
        val prev = stops.getOrNull(stops.indexOf(stop) - 1)
        flight = FlightTarget(
            "Vlucht naar ${stop.name}", prev?.let { "Vanuit ${it.name}" }, stop.flightNumber, stop.fromAirport, stop.toAirport,
            nearFrom = prev?.at, nearTo = stop.at,
        ) { n, f, t ->
            stop.mode = Mode.Flight
            // An emptied number is cleared, here and on the server.
            val number = if (n.isNullOrBlank() && stop.flightNumber != null) "" else n
            stop.flightNumber = PlannerRemote.cleanNumber(n) ?: if (number == "") null else stop.flightNumber
            PlannerRemote.cleanCode(f)?.let { stop.fromAirport = it }
            PlannerRemote.cleanCode(t)?.let { stop.toAirport = it }
            stop.id?.let { id -> save { PlannerRemote.saveFlight(trip, id, number, f, t) } }
        }
    }
    fun pickLegMode(leg: PlanLeg, m: Mode) {
        if (m != leg.mode) {
            leg.mode = m
            // Away from a flight the server forgets the airports; so does the screen.
            if (m != Mode.Flight) { leg.flightNumber = null; leg.fromAirport = null; leg.toAirport = null }
            leg.id?.let { id -> save { PlannerRemote.setMode(trip, id, m) } }
        }
        if (m == Mode.Flight) legFlight(leg)
    }
    fun pickStopMode(stop: PlanStop, m: Mode) {
        if (m != stop.mode) {
            stop.mode = m
            if (m != Mode.Flight) { stop.flightNumber = null; stop.fromAirport = null; stop.toAirport = null }
            stop.id?.let { id -> save { PlannerRemote.setMode(trip, id, m) } }
        }
        if (m == Mode.Flight) stopFlight(stop)
    }
    fun addLeg(outboundLeg: Boolean, m: Mode) {
        val id = if (live) java.util.UUID.randomUUID().toString() else null
        val leg = PlanLeg(outboundLeg, id, m, null, null, null, 0)
        if (outboundLeg) outbound = leg else back = leg
        syncLegIds()
        if (id != null) save { flushUndo(); PlannerRemote.addLeg(trip, id, outboundLeg, m, if (outboundLeg) routeOrder() else null) }
        if (m == Mode.Flight) legFlight(leg)
    }
    fun removeLeg(leg: PlanLeg) {
        if (leg.outbound) outbound = null else back = null
        syncLegIds()
        offerUndo(if (leg.outbound) "Heen" else "Terug", restore = {
            if (leg.outbound) outbound = PlanLeg(true, leg.id, leg.mode, leg.flightNumber, leg.fromAirport, leg.toAirport, leg.km)
            else back = PlanLeg(false, leg.id, leg.mode, leg.flightNumber, leg.fromAirport, leg.toAirport, leg.km)
            syncLegIds()
        }) { leg.id?.let { Remote.deleteStop(trip, it) } }
    }

    // Nights planned, out of the trip's: a pill with a dot in the trip's colour that turns teal once all are planned.
    NightsPill(planned, totalNights, color)

    // Holding a stop lifts it; it follows the finger and swaps with a neighbour once past its middle.
    val heights = remember { mutableStateMapOf<Int, Int>() }
    var dragKey by remember { mutableStateOf<Int?>(null) }
    var dragY by remember { mutableFloatStateOf(0f) }
    // Let go, the stop glides the last bit into its place instead of jumping there.
    var settleKey by remember { mutableStateOf<Int?>(null) }
    val settle = remember { Animatable(0f) }
    val view = LocalView.current
    val motion = MaterialTheme.motionScheme

    LegSlot(outbound, outboundSide = true, color = color, dark = dark, airports = airports, hasStops = stops.isNotEmpty(),
        onAdd = { addLeg(true, it) }, onMode = { leg, m -> pickLegMode(leg, m) }, onFlight = { legFlight(it) }, onRemove = { removeLeg(it) })

    var day = firstDate
    stops.forEachIndexed { index, stop ->
        val from = day
        day = day.plusDays(stop.nights.toLong())
        val to = day
        key(stop.key) {
            val visible = remember { MutableTransitionState(stop.key < trip.stops.size).apply { targetState = true } }
            val swipe = rememberSwipeRemove {
                // Folded away by the swipe itself: gone from the list straight away, on the server after 7 s.
                val at = stops.indexOf(stop)
                stops.remove(stop)
                offerUndo(stop.name, restore = { stops.add(at.coerceIn(0, stops.size), stop.copy(newKey())) }) { stop.id?.let { Remote.deleteStop(trip, it) } }
            }
            AnimatedVisibility(
                visibleState = visible,
                enter = expandVertically(motion.defaultSpatialSpec()) + fadeIn(motion.defaultEffectsSpec()),
                exit = shrinkVertically(motion.fastSpatialSpec()) + fadeOut(motion.fastEffectsSpec()),
                modifier = Modifier.zIndex(if (dragKey == stop.key) 1f else 0f),
            ) {
                val lifted = dragKey == stop.key
                val lift by animateFloatAsState(if (lifted) 1f else 0f, motion.fastSpatialSpec(), label = "lift")
                Column(
                    Modifier
                        // Neighbours glide to their new place while a stop is moved past them, instead of jumping.
                        .glideToPlace(active = { dragKey != null && !lifted })
                        .onSizeChanged { heights[stop.key] = it.height }
                        .swipeCollapse(swipe)
                        .graphicsLayer {
                            translationY = if (lifted) dragY else if (settleKey == stop.key) settle.value else 0f
                            // Lifted: a little bigger and a slight tilt, as on the web.
                            scaleX = 1f + 0.02f * lift; scaleY = 1f + 0.02f * lift
                            rotationZ = -0.4f * lift
                        }
                        .pointerInput(stop.key) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = {
                                    dragKey = stop.key; dragY = 0f
                                    view.haptic(Haptic.LongPress)
                                },
                                onDragEnd = {
                                    val left = dragY
                                    settleKey = stop.key; dragKey = null; dragY = 0f
                                    scope.launch { settle.snapTo(left); settle.animateTo(0f, motion.fastSpatialSpec()); if (settleKey == stop.key) settleKey = null }
                                    saveOrder()
                                },
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
                                        view.haptic(Haptic.Tick)
                                    } else if (above != null && dragY < -(heights[above.key] ?: 0) / 2f) {
                                        dragY += heights[above.key] ?: 0
                                        stops.add(i - 1, stops.removeAt(i))
                                        view.haptic(Haptic.Tick)
                                    }
                                },
                            )
                        },
                ) {
                    val prev = stops.getOrNull(index - 1)
                    if (index > 0) {
                        val km = prev?.let { (angle(it.at, stop.at) * 111.2 * if (stop.mode == Mode.Flight) 1.0 else 1.25).roundToInt() }
                        Connector(
                            stop.mode, km, color, dark, airports,
                            flightNumber = stop.flightNumber, fromAirport = stop.fromAirport, toAirport = stop.toAirport,
                            onMode = { pickStopMode(stop, it) }, onFlight = { stopFlight(stop) },
                        )
                    } else if (outbound != null) Line(color)
                    SwipeSurface(swipe, enabled = { dragKey == null }) {
                        StopCard(
                            trip = trip, stop = stop, index = index, from = from, to = to, color = color, dark = dark, lifted = lift,
                            photo = photoFor(media, from, stop.nights), media = media,
                            onFly = onFlyTo?.let { fly -> { fly(stop.at) } },
                            onNights = {
                                stop.nights = (stop.nights + it).coerceIn(NightsRange.first, NightsRange.last)
                                // Taps in a row become one save, after a short pause.
                                stop.id?.let { id ->
                                    nightJobs[stop.key]?.cancel()
                                    if (live) nightJobs[stop.key] = scope.launch { delay(600); runCatching { Remote.updateStop(trip, id, nights = stop.nights) }.onFailure { saveError = "Opslaan mislukt" } }
                                }
                            },
                            onAddDayTrip = { place, d ->
                                view.haptic(Haptic.Confirm)
                                val id = java.util.UUID.randomUUID().toString()
                                stop.dayTrips.add(PlanDayTrip(dayTripKey++, if (live) id else null, place.name, Remote.flag(place.countryCode), place.at, d))
                                val parent = stop.id
                                if (parent != null) save { PlannerRemote.addDayTrip(trip, id, parent, place, d) }
                            },
                            onRemoveDayTrip = { dt ->
                                val at = stop.dayTrips.indexOf(dt)
                                stop.dayTrips.remove(dt)
                                offerUndo(dt.name, restore = { stop.dayTrips.add(at.coerceIn(0, stop.dayTrips.size), PlanDayTrip(dayTripKey++, dt.id, dt.name, dt.flag, dt.at, dt.day)) }) {
                                    dt.id?.let { Remote.deleteStop(trip, it) }
                                }
                            },
                        )
                    }
                }
            }
        }
    }

    if (back != null && stops.isNotEmpty()) Line(color)
    else if (back == null) Spacer(Modifier.height(12.dp))
    LegSlot(back, outboundSide = false, color = color, dark = dark, airports = airports, hasStops = stops.isNotEmpty(),
        onAdd = { addLeg(false, it) }, onMode = { leg, m -> pickLegMode(leg, m) }, onFlight = { legFlight(it) }, onRemove = { removeLeg(it) })

    // The undo pill floats at the bottom of the screen, above everything, the moment something is removed;
    // inside the list it could sit off screen and the stop was gone before anyone saw it.
    if (undo != null) androidx.compose.ui.window.Popup(
        alignment = Alignment.BottomCenter,
        properties = androidx.compose.ui.window.PopupProperties(focusable = false),
    ) { Box(Modifier.padding(horizontal = 16.dp).padding(bottom = 96.dp)) { UndoPill(undo?.name, onUndo = {
        undo?.let { p -> p.job?.cancel(); p.restore() }
        undo = null
    }) } }
    HapticOn(saveError, Haptic.Reject)
    if (saveError != null) Text(saveError ?: "", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.error), modifier = Modifier.padding(top = 12.dp, start = 4.dp))
    AddStop(trip, taken = stops.map { it.name }.toSet(), onPickOnMap = onPickOnMap, onAdd = { place ->
        view.haptic(Haptic.Confirm)
        val id = java.util.UUID.randomUUID().toString()
        // Before the way back, never after it.
        val after = stops.lastOrNull()?.id ?: outbound?.id
        stops.add(PlanStop(newKey(), place.name, Remote.flag(place.countryCode), place.at, 1, Mode.Car, if (live) id else null))
        save { Remote.addStop(trip, id, place, 1, afterStopId = after) }
    })

    flight?.let { f -> FlightSheet(f, color, dark, onDismiss = { flight = null }) }
}

/** "7/7 nachten gepland" on a tonal pill, the count rolling and the dot turning teal once every night is planned. */
@Composable
private fun NightsPill(planned: Int, total: Int, color: Color) {
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    val dot by animateColorAsState(if (planned == total) Teal else color, motion.defaultEffectsSpec(), label = "dot")
    Row(
        Modifier.padding(bottom = 14.dp).clip(CircleShape).background(cs.surfaceContainerHigh).padding(start = 8.dp, end = 14.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The wavy ring fills with the nights planned; a clear opening until every night is planned.
        val share by androidx.compose.animation.core.animateFloatAsState((planned.toFloat() / total.coerceAtLeast(1)).coerceIn(0f, 1f), motion.slowSpatialSpec(), label = "nights")
        androidx.compose.material3.CircularWavyProgressIndicator(
            progress = { share }, modifier = Modifier.size(24.dp), color = dot, trackColor = dot.copy(alpha = 0.18f),
            gapSize = if (share >= 1f) 0.dp else 5.dp,
        )
        val style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurface)
        AnimatedContent(
            planned,
            transitionSpec = {
                val up = targetState > initialState
                (slideInVertically(motion.fastSpatialSpec()) { if (up) it else -it } + fadeIn(motion.fastEffectsSpec())) togetherWith
                    (slideOutVertically(motion.fastSpatialSpec()) { if (up) -it else it } + fadeOut(motion.fastEffectsSpec()))
            },
            label = "planned",
            modifier = Modifier.padding(start = 8.dp),
        ) { n -> Text("$n", style = style) }
        Text("/$total nachten gepland", style = style)
    }
}

/** The short line in the trip's colour between a leg and the stop beside it. */
@Composable
private fun Line(color: Color) {
    Box(Modifier.padding(start = 45.dp).width(2.dp).height(16.dp).background(color.copy(alpha = 0.35f)))
}

/** The way there or back as a row, or a button to add it; a row is swiped away like a stop. */
@Composable
private fun LegSlot(
    leg: PlanLeg?, outboundSide: Boolean, color: Color, dark: Boolean, airports: Boolean, hasStops: Boolean,
    onAdd: (Mode) -> Unit, onMode: (PlanLeg, Mode) -> Unit, onFlight: (PlanLeg) -> Unit, onRemove: (PlanLeg) -> Unit,
) {
    val motion = MaterialTheme.motionScheme
    AnimatedContent(
        leg,
        transitionSpec = {
            (fadeIn(motion.defaultEffectsSpec()) + expandVertically(motion.defaultSpatialSpec())) togetherWith
                (fadeOut(motion.fastEffectsSpec()) + shrinkVertically(motion.fastSpatialSpec()))
        },
        contentKey = { it?.let { l -> System.identityHashCode(l) } ?: 0 },
        label = "leg",
    ) { l ->
        if (l != null) {
            val swipe = rememberSwipeRemove { onRemove(l) }
            Box(Modifier.swipeCollapse(swipe)) {
                SwipeSurface(swipe, enabled = { true }) { LegRow(l, color, dark, airports, onMode = { onMode(l, it) }, onFlight = { onFlight(l) }) }
            }
        } else if (hasStops || outboundSide) {
            // The way there's button keeps the same gap to the first stop as the stops keep to each other.
            Box(Modifier.padding(bottom = if (outboundSide && hasStops) 12.dp else 0.dp)) {
                AddLegRow(if (outboundSide) "Heenreis toevoegen" else "Terugreis toevoegen", onAdd)
            }
        } else Spacer(Modifier.height(0.dp))
    }
}

/** "Heen" or "Terug": the airports on an accent pill and the flight time, the mode on the right. */
@Composable
private fun LegRow(leg: PlanLeg, color: Color, dark: Boolean, airports: Boolean, onMode: (Mode) -> Unit, onFlight: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(cs.surfaceContainerLow).padding(start = 16.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (leg.outbound) "Heen" else "Terug", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, color = cs.onSurface), modifier = Modifier.widthIn(min = 52.dp))
        Row(Modifier.weight(1f).padding(end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            AnimatedVisibility(
                leg.mode == Mode.Flight,
                enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + scaleIn(MaterialTheme.motionScheme.fastSpatialSpec(), initialScale = 0.8f),
                exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + scaleOut(MaterialTheme.motionScheme.fastSpatialSpec(), targetScale = 0.8f),
            ) { AirportPill(leg.flightNumber, leg.fromAirport, leg.toAirport, color, dark, onFlight) }
            val time = flightTime(leg.mode, leg.fromAirport, leg.toAirport, airports) ?: leg.km.takeIf { it > 0 && leg.mode != Mode.Flight }?.let { km(it) }
            if (time != null) Text(time, maxLines = 1, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 10.dp))
        }
        ModeChooser(leg.mode, onMode)
    }
}

/** "5u 38m" for a flight with both airports known, as the web estimates it from the distance between them. */
private fun flightTime(mode: Mode, from: String?, to: String?, airports: Boolean): String? {
    if (mode != Mode.Flight || !airports) return null
    val a = FlightAirports.byCode(from) ?: return null
    val b = FlightAirports.byCode(to) ?: return null
    return estimateDuration(FlightAirports.km(a, b), Mode.Flight)
}

/** A quiet row to add the way there or back; the mode is picked from the menu it opens. */
@Composable
private fun AddLegRow(label: String, onAdd: (Mode) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.clip(CircleShape).background(cs.surfaceContainerLow).squish { open = true }.padding(start = 14.dp, end = 18.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineIcon(Glyphs.plus, cs.primary, size = 18.dp, stroke = 2.4f)
            Text(label, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.5.sp, color = cs.primary), modifier = Modifier.padding(start = 8.dp))
        }
        val haptics = rememberHaptics()
        AppMenu(open, { open = false }, listOf(Mode.entries.map { m -> MenuEntry(m.label, m.icon()) { haptics(Haptic.Confirm); onAdd(m) } }))
    }
}

/** The outlined accent pill of a flight: its airports, else its number, else an invitation to fill it in. */
@Composable
private fun AirportPill(number: String?, from: String?, to: String?, color: Color, dark: Boolean, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val fill = color.copy(alpha = if (dark) 0.18f else 0.10f).compositeOver(cs.surfaceContainerLow)
    val ink = readable(color, fill, dark)
    Row(
        Modifier.height(32.dp).clip(CircleShape).background(fill).border(1.5.dp, color, CircleShape).squish(onClick).padding(start = 10.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LineIcon(Glyphs.plane, ink, size = 15.dp, stroke = 1.8f)
        val style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = ink)
        if (from != null && to != null) {
            Text(from, style = style, modifier = Modifier.padding(start = 6.dp))
            LineIcon(Glyphs.chevronRight, ink, size = 13.dp, stroke = 2.2f, modifier = Modifier.padding(horizontal = 2.dp))
            Text(to, style = style)
        } else Text(number ?: "Toevoegen", style = style, modifier = Modifier.padding(start = 6.dp))
    }
}

/** The mode pill with the app's menu of every mode under it, the current one ticked. */
@Composable
private fun ModeChooser(mode: Mode, onPick: (Mode) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        ModePill(mode) { open = true }
        AppMenu(open, { open = false }, listOf(Mode.entries.map { m -> MenuEntry(m.label, m.icon(), selected = m == mode) { onPick(m) } }))
    }
}

/**
 * The mode's icon and name with a chevron, on a pill as wide as its name. The pill grows before a longer name
 * shows, and a shorter name shows before the pill shrinks, so a name never sticks out of it or is cut off.
 */
@Composable
private fun ModePill(mode: Mode, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    val density = LocalDensity.current
    val style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.onSecondaryContainer)
    val measurer = rememberTextMeasurer()
    fun widthOf(m: Mode): Float = measurer.measure(m.label, style).size.width + with(density) { (11.dp + 18.dp + 6.dp + 5.dp + 14.dp + 9.dp).toPx() }
    val width = remember { Animatable(widthOf(mode)) }
    var shown by remember { mutableStateOf(mode) }
    val fade = 110
    LaunchedEffect(mode) {
        val target = widthOf(mode)
        if (target <= width.value + 0.5f) {
            // Shorter: the new name first, then the pill closes in once the old one has faded.
            shown = mode
            delay(fade.toLong())
            width.animateTo(target, motion.fastSpatialSpec())
        } else {
            // Longer: the pill opens first; the new name only once there is room for all of it.
            launch { width.animateTo(target, motion.fastSpatialSpec()) }
            snapshotFlow { width.value }.first { it >= target - 0.5f }
            shown = mode
        }
    }
    Box(
        Modifier.height(36.dp).width(with(density) { width.value.toDp() }).clip(CircleShape).background(cs.secondaryContainer).squish(onClick),
        contentAlignment = Alignment.CenterStart,
    ) {
        AnimatedContent(
            shown,
            transitionSpec = {
                (fadeIn(tween(fade)) + scaleIn(motion.fastSpatialSpec(), initialScale = 0.85f)) togetherWith fadeOut(tween(fade))
            },
            label = "mode",
            modifier = Modifier.padding(start = 11.dp),
        ) { m ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                LineIcon(m.icon(), cs.onSecondaryContainer, size = 18.dp, stroke = 1.9f)
                Text(m.label, maxLines = 1, softWrap = false, style = style, modifier = Modifier.padding(start = 6.dp))
            }
        }
        LineIcon(listOf(P("m6 9 6 6 6-6")), cs.onSecondaryContainer, size = 14.dp, stroke = 2.2f, modifier = Modifier.align(Alignment.CenterEnd).padding(end = 9.dp))
    }
}

/** Between two stops: the line in the trip's colour, the mode, a flight's airports, and how far. */
@Composable
private fun Connector(
    mode: Mode, km: Int?, color: Color, dark: Boolean, airports: Boolean,
    flightNumber: String?, fromAirport: String?, toAirport: String?, onMode: (Mode) -> Unit, onFlight: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val line = color.copy(alpha = 0.35f)
    val density = LocalDensity.current
    // The line is drawn behind the row, so it runs the full height when the row wraps on a narrow phone.
    Row(
        Modifier.fillMaxWidth().drawBehind {
            val x = with(density) { 45.dp.toPx() }
            drawRect(line, topLeft = Offset(x, 0f), size = Size(with(density) { 2.dp.toPx() }, size.height))
        }.padding(start = 64.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ModeChooser(mode, onMode)
        AnimatedVisibility(
            mode == Mode.Flight,
            enter = fadeIn(MaterialTheme.motionScheme.defaultEffectsSpec()) + androidx.compose.animation.expandHorizontally(MaterialTheme.motionScheme.fastSpatialSpec()),
            exit = fadeOut(MaterialTheme.motionScheme.fastEffectsSpec()) + androidx.compose.animation.shrinkHorizontally(MaterialTheme.motionScheme.fastSpatialSpec()),
        ) { Box(Modifier.padding(start = 8.dp)) { AirportPill(flightNumber, fromAirport, toAirport, color, dark, onFlight) } }
        val time = flightTime(mode, fromAirport, toAirport, airports)
        val text = time ?: km?.let { if (it < 5) "in de buurt" else km(it) }
        if (text != null) {
            Text(text, maxLines = 2, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 10.dp))
        }
    }
}

/** A stop: its photo with the number on the corner, name and dates, the nights, and its day trips. */
@Composable
private fun StopCard(
    trip: Trip, stop: PlanStop, index: Int, from: LocalDate, to: LocalDate, color: Color, dark: Boolean, lifted: Float,
    photo: String?, media: List<Media>?,
    onFly: (() -> Unit)? = null,
    onNights: (Int) -> Unit, onAddDayTrip: (Remote.Place, LocalDate) -> Unit, onRemoveDayTrip: (PlanDayTrip) -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    var adding by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(26.dp))
            .background(lerp(cs.surfaceContainerLow, cs.secondaryContainer, lifted))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // The photo itself sits in the middle of the card's height; the number hangs on its corner.
            Box(Modifier.size(56.dp)) {
                Thumb(photo, stop.flag, color, dark, Modifier.matchParentSize(), RoundedCornerShape(16.dp))
                // The number on the photo's corner, ringed in the card's tone so it stands off any photo.
                val badge = color
                Box(
                    Modifier.offset(x = (-6).dp, y = (-6).dp).size(24.dp).clip(CircleShape).background(lerp(cs.surfaceContainerLow, cs.secondaryContainer, lifted)).padding(2.dp).clip(CircleShape).background(badge),
                    contentAlignment = Alignment.Center,
                ) { Text("${index + 1}", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 11.5.sp, lineHeight = 12.sp, color = onBadge(badge))) }
            }
            Column(Modifier.weight(1f).then(if (onFly != null) Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onFly) else Modifier).padding(start = 10.dp, end = 10.dp)) {
                Text(stop.name, maxLines = 2, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 17.sp, lineHeight = 21.sp, color = cs.onSurface))
                Text(stay(from, to), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 13.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 2.dp))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Stepper(stop.nights, onNights)
                // Opens the place search for a day trip from here; the plus turns into a cross to close it again.
                val turn by animateFloatAsState(if (adding) 45f else 0f, motion.fastSpatialSpec(), label = "turn")
                Row(
                    Modifier.padding(top = 4.dp).clip(CircleShape).squish { adding = !adding }.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    LineIcon(Glyphs.plus, cs.primary, size = 15.dp, stroke = 2.4f, modifier = Modifier.graphicsLayer { rotationZ = turn })
                    Text("Dagtrip", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.primary), modifier = Modifier.padding(start = 4.dp))
                }
            }
        }
        // Day trips under their stop, each sliding open when added and folding away when removed.
        stop.dayTrips.forEach { dt ->
            key(dt.key) {
                val shown = remember { MutableTransitionState(false).apply { targetState = true } }
                AnimatedVisibility(shown, enter = expandVertically(motion.defaultSpatialSpec()) + fadeIn(motion.defaultEffectsSpec()), exit = shrinkVertically(motion.fastSpatialSpec()) + fadeOut(motion.fastEffectsSpec())) {
                    DayTripRow(dt, photoFor(media, dt.day, 0), color, dark, onRemove = { shown.targetState = false })
                }
                if (shown.isIdle && !shown.currentState) LaunchedEffect(Unit) { onRemoveDayTrip(dt) }
            }
        }
        AnimatedVisibility(adding, enter = expandVertically(motion.defaultSpatialSpec()) + fadeIn(motion.defaultEffectsSpec()), exit = shrinkVertically(motion.fastSpatialSpec()) + fadeOut(motion.fastEffectsSpec())) {
            DayTripPanel(trip, stop.name, from, stop.nights, taken = stop.dayTrips.map { it.name }.toSet() + stop.name, onPick = { place, d -> onAddDayTrip(place, d); adding = false }, onClose = { adding = false })
        }
    }
}

/** A photo from the stop's days, else its flag on the trip's colour. */
@Composable
private fun Thumb(photo: String?, flag: String, color: Color, dark: Boolean, modifier: Modifier, shape: RoundedCornerShape) {
    val cs = MaterialTheme.colorScheme
    val tile = color.copy(alpha = if (dark) 0.32f else 0.2f).compositeOver(cs.surfaceContainerLow)
    Box(modifier.clip(shape).background(tile), contentAlignment = Alignment.Center) {
        FlagIcon(flag, 18.dp)
        if (photo != null) RemotePhoto(photo, Modifier.matchParentSize())
    }
}

@Composable
private fun DayTripRow(dt: PlanDayTrip, photo: String?, color: Color, dark: Boolean, onRemove: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.padding(top = 8.dp).fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainer).padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Thumb(photo, dt.flag, color, dark, Modifier.size(40.dp), RoundedCornerShape(12.dp))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(dt.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface))
            Text("Dagtrip" + (dt.day?.let { " · ${day(it)}" } ?: ""), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 12.5.sp, color = cs.onSurfaceVariant))
        }
        // A day trip keeps a cross, as on the web: the rows are small, and a swipe on something this size is fiddly.
        Box(Modifier.size(36.dp).clip(CircleShape).background(cs.surfaceContainerHighest).squish(onRemove), contentAlignment = Alignment.Center) {
            LineIcon(listOf(P("M6 6l12 12"), P("M18 6 6 18")), cs.onSurfaceVariant, size = 15.dp, stroke = 2.2f)
        }
    }
}

/** Where the day trip went, searched like a new stop, and on which day of the stay. */
@Composable
private fun DayTripPanel(trip: Trip, parent: String, from: LocalDate, nights: Int, taken: Set<String>, onPick: (Remote.Place, LocalDate) -> Unit, onClose: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    var query by remember { mutableStateOf("") }
    val days = (0 until nights.coerceAtLeast(1)).map { from.plusDays(it.toLong()) }
    var chosen by remember { mutableStateOf(days.first()) }
    val haptics = rememberHaptics()
    val matches = placeMatches(trip, query, taken)
    val focus = remember { FocusRequester() }
    val above = rememberAboveKeyboard()
    LaunchedEffect(Unit) { delay(320); runCatching { focus.requestFocus() } }
    LaunchedEffect(matches.size, query.isNotEmpty(), above.keyboard) { delay(150); above.show() }
    Column(Modifier.padding(top = 10.dp).fillMaxWidth().then(above.modifier)) {
        SearchField(query, { query = it }, "Waar ging je heen vanuit $parent?", Modifier.focusRequester(focus))
        if (days.size > 1) {
            Text("Welke dag?", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 13.5.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 4.dp, top = 12.dp, bottom = 6.dp))
            // Out to the card's edges, so a day that scrolls past is cut by the card and not short of it.
            Row(Modifier.bleedSides(12.dp).horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                days.forEach { d ->
                    val on = d == chosen
                    val bg by animateColorAsState(if (on) cs.secondaryContainer else cs.surfaceContainerHighest, MaterialTheme.motionScheme.fastEffectsSpec(), label = "day")
                    Row(Modifier.height(34.dp).clip(CircleShape).background(bg).squish { if (!on) haptics(Haptic.Tick); chosen = d }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        AnimatedVisibility(on) { LineIcon(Glyphs.check, cs.onSecondaryContainer, size = 15.dp, stroke = 2.4f, modifier = Modifier.padding(end = 5.dp)) }
                        Text(day(d), style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(600), fontSize = 13.sp, color = if (on) cs.onSecondaryContainer else cs.onSurface))
                    }
                }
            }
        }
        PlaceList(matches, trip) { onPick(it, chosen) }
        if (query.isBlank()) Text(
            "Annuleren", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.primary),
            modifier = Modifier.padding(top = 8.dp).clip(CircleShape).clickable(onClick = onClose).padding(horizontal = 8.dp, vertical = 8.dp),
        )
    }
}

/** How many nights a stop can have. */
private val NightsRange = 0..60

/** Fewer, the count, more: one pill, the number rolling. Each step clicks like a dial; past either end it says no. */
@Composable
private fun Stepper(nights: Int, onChange: (Int) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val motion = MaterialTheme.motionScheme
    val haptics = rememberHaptics()
    fun step(by: Int) { haptics(if (nights + by in NightsRange) Haptic.Step else Haptic.Reject); onChange(by) }
    Row(Modifier.height(40.dp).clip(CircleShape).background(cs.surfaceContainerHighest).padding(3.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(34.dp).clip(CircleShape).background(cs.surfaceContainerLow).squish { step(-1) }, contentAlignment = Alignment.Center) {
            LineIcon(Glyphs.minus, cs.onSurface, size = 15.dp, stroke = 2.4f)
        }
        Box(Modifier.width(50.dp), contentAlignment = Alignment.Center) {
            AnimatedContent(
                nights,
                transitionSpec = {
                    val up = targetState > initialState
                    (slideInVertically(motion.fastSpatialSpec()) { if (up) it else -it } + fadeIn(motion.fastEffectsSpec())) togetherWith
                        (slideOutVertically(motion.fastSpatialSpec()) { if (up) -it else it } + fadeOut(motion.fastEffectsSpec()))
                },
                label = "nights",
            ) { n ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("$n", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(700), fontSize = 16.sp, lineHeight = 17.sp, color = cs.onSurface))
                    Text(if (n == 1) "nacht" else "nachten", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 10.sp, lineHeight = 11.sp, color = cs.onSurfaceVariant))
                }
            }
        }
        Box(Modifier.size(34.dp).clip(CircleShape).background(cs.surfaceContainerLow).squish { step(1) }, contentAlignment = Alignment.Center) {
            LineIcon(Glyphs.plus, cs.onSurface, size = 15.dp, stroke = 2.4f)
        }
    }
}

/** Signed in, real towns from the place search; the demo picks from a few it knows. */
@Composable
private fun placeMatches(trip: Trip, query: String, taken: Set<String>): List<Remote.Place> {
    val live by produceState<List<Remote.Place>?>(null, query, trip.remoteId) {
        value = if (trip.remoteId == null || query.isBlank()) null else { delay(300); Remote.searchPlaces(query) }
    }
    if (trip.remoteId != null) return if (query.isBlank()) emptyList() else live?.filter { it.name !in taken }.orEmpty()
    val flag = trip.stops.firstOrNull()?.flag
    return Places.filter { (name, f, _) ->
        name !in taken && if (query.isBlank()) f == flag else name.contains(query.trim(), ignoreCase = true)
    }.take(4).map { (name, _, at) -> Remote.Place(name, "", null, at) }
}

@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit, hint: String, modifier: Modifier = Modifier) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().height(52.dp).clip(CircleShape).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LineIcon(Glyphs.search, cs.onSurfaceVariant, size = 20.dp)
        Box(Modifier.weight(1f).padding(start = 12.dp)) {
            if (query.isEmpty()) Text(hint, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurfaceVariant))
            BasicTextField(
                query, onQuery, singleLine = true,
                textStyle = TextStyle(fontFamily = Inter, fontSize = 15.sp, color = cs.onSurface),
                cursorBrush = SolidColor(cs.primary),
                modifier = Modifier.fillMaxWidth().then(modifier),
            )
        }
    }
}

/** Places that match, one connected group, one tap picks it. */
@Composable
private fun PlaceList(matches: List<Remote.Place>, trip: Trip, onPick: (Remote.Place) -> Unit) {
    val cs = MaterialTheme.colorScheme
    val flag = trip.stops.firstOrNull()?.flag
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        matches.forEachIndexed { i, place ->
            val top = if (i == 0) 18.dp else 6.dp
            val bottom = if (i == matches.lastIndex) 18.dp else 6.dp
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(top, top, bottom, bottom))
                    .background(cs.surfaceContainer).clickable { onPick(place) }.padding(horizontal = 14.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val shownFlag = place.countryCode?.let { Remote.flag(it) } ?: Places.firstOrNull { it.first == place.name }?.second ?: flag ?: ""
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        FlagIcon(shownFlag, 13.dp)
                        Text(place.name, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface), modifier = Modifier.padding(start = 8.dp))
                    }
                    if (place.region.isNotBlank()) Text(place.region, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontSize = 12.5.sp, color = cs.onSurfaceVariant))
                }
                LineIcon(Glyphs.plus, cs.primary, size = 18.dp, stroke = 2.4f)
            }
        }
    }
}

/** A search field for a new stop; places that match open underneath, one tap adds it. */
@Composable
private fun AddStop(trip: Trip, taken: Set<String>, onPickOnMap: (((Remote.Place) -> Unit) -> Unit)? = null, onAdd: (Remote.Place) -> Unit) {
    val cs = MaterialTheme.colorScheme
    var query by remember { mutableStateOf("") }
    val matches = placeMatches(trip, query, taken)
    // The card scrolls itself into view above the keyboard as places come in.
    val above = rememberAboveKeyboard()
    LaunchedEffect(matches.size, query.isNotEmpty(), above.keyboard) { if (query.isNotEmpty() || above.keyboard) { delay(120); above.show() } }
    Column(Modifier.padding(top = 20.dp).fillMaxWidth().then(above.modifier).clip(RoundedCornerShape(28.dp)).background(cs.surfaceContainerLow).padding(14.dp)) {
        Text("Nieuwe stop", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 17.sp, color = cs.onSurface), modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
        SearchField(query, { query = it }, if (trip.remoteId != null) "Zoek een stad, bijv. Hanoi" else "Zoek een stad, bijv. Mestia")
        PlaceList(matches, trip) { onAdd(it); query = "" }
        // Or tap its place on a map, as the web's planner lets you tap its map.
        if (onPickOnMap != null && query.isBlank()) Row(
            Modifier.padding(top = 8.dp).clip(CircleShape).clickable { onPickOnMap { onAdd(it) } }.padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            LineIcon(Glyphs.pin, cs.primary, size = 16.dp, stroke = 2.1f)
            Text("Kies de plek op de kaart", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.primary), modifier = Modifier.padding(start = 6.dp))
        }
        if (query.isNotBlank() && matches.isEmpty() && trip.remoteId == null) {
            Button(
                onClick = { onAdd(Remote.Place(query.trim(), "", null, trip.stops.lastOrNull()?.at ?: trip.route.lastOrNull() ?: HomeAirport)); query = "" },
                shapes = ButtonDefaults.shapes(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                modifier = Modifier.padding(top = 10.dp),
            ) { Text("“${query.trim()}” toevoegen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp)) }
        }
    }
}

/**
 * What the flight sheet holds. Each field reads its own value, so a keystroke recomposes that field and not
 * the whole sheet. An airport is only ever a chosen code: typing is a search, and the field takes an airport
 * when one of its suggestions is tapped.
 */
private class FlightForm(number: String, from: String?, to: String?) {
    var number by mutableStateOf(number)
    var from by mutableStateOf(from)
    var to by mutableStateOf(to)
}

/** The calm curve the suggestions open and close on: no overshoot, as Mark asked. */
private val SuggestEase = androidx.compose.animation.core.CubicBezierEasing(0.2f, 0f, 0f, 1f)

/** A flight filled in properly: its number and the airports it flew from and to, each picked from the airport list. */
@Composable
private fun FlightSheet(target: FlightTarget, color: Color, dark: Boolean, onDismiss: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    // An empty airport starts at the one nearest the city it leaves from or flies to, as on the web.
    val form = remember {
        FlightForm(
            target.number.orEmpty(),
            target.from ?: FlightAirports.nearest(target.nearFrom)?.iata,
            target.to ?: FlightAirports.nearest(target.nearTo)?.iata,
        )
    }
    AppSheet(onDismiss = onDismiss) {
        val sheet = this
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 20.dp)) {
            Text(target.title, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 24.sp, color = cs.onSurface))
            target.subtitle?.let { Text(it, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(top = 2.dp)) }
            Label("Vluchtnummer")
            NumberField(form)
            Label("Van")
            AirportField(code = { form.from }, onPick = { form.from = it }, hint = "Stad, vliegveld of code")
            Label("Naar")
            AirportField(code = { form.to }, onPick = { form.to = it }, hint = "Stad, vliegveld of code")
            FlightTime(form, color, dark)
            Button(
                onClick = { target.onSave(form.number, form.from, form.to); sheet.close() },
                shapes = ButtonDefaults.shapes(),
                contentPadding = PaddingValues(vertical = 16.dp),
                modifier = Modifier.fillMaxWidth().padding(top = 20.dp),
            ) { Text("Opslaan", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 16.sp)) }
        }
    }
}

@Composable
private fun NumberField(form: FlightForm) {
    SheetField(form.number, { form.number = it.uppercase().take(16) }, "bijv. KL1703")
}

/** "Ongeveer 5u 48m reizen" once both airports are chosen. */
@Composable
private fun FlightTime(form: FlightForm, color: Color, dark: Boolean) {
    val cs = MaterialTheme.colorScheme
    val time = flightTime(Mode.Flight, form.from, form.to, FlightAirports.ready)
    AnimatedVisibility(
        time != null,
        enter = fadeIn(tween(200)) + expandVertically(tween(260, easing = SuggestEase)),
        exit = fadeOut(tween(150)) + shrinkVertically(tween(220, easing = SuggestEase)),
    ) {
        Row(Modifier.padding(top = 14.dp, start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            LineIcon(Glyphs.plane, readable(color, cs.surfaceContainerLow, dark), size = 16.dp, stroke = 1.8f)
            Text("Ongeveer ${time.orEmpty()} reizen", style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.onSurfaceVariant), modifier = Modifier.padding(start = 8.dp))
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant), modifier = Modifier.padding(top = 16.dp, bottom = 6.dp, start = 4.dp))
}

@Composable
private fun SheetField(value: String, onValue: (String) -> Unit, hint: String, modifier: Modifier = Modifier, capitals: Boolean = true) {
    val cs = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(hint, style = TextStyle(fontFamily = Inter, fontSize = 16.sp, color = cs.onSurfaceVariant.copy(alpha = 0.7f)))
            BasicTextField(
                value, onValue, singleLine = true,
                textStyle = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 16.sp, color = cs.onSurface),
                keyboardOptions = KeyboardOptions(capitalization = if (capitals) KeyboardCapitalization.Characters else KeyboardCapitalization.Words),
                cursorBrush = SolidColor(cs.primary),
                modifier = Modifier.fillMaxWidth().then(modifier),
            )
        }
    }
}

/** "Eindhoven (EIN)", or just the code for one the list does not know. */
private fun airportLabel(code: String): String = FlightAirports.byCode(code)?.let { "${it.city} (${it.iata})" } ?: code

/**
 * One airport: the chosen one as a chip, or, once tapped, a search whose suggestions are the only way to
 * choose. An exact code gets its suggestion too ("EIN" shows "Eindhoven (EIN)"), so typing alone never fills
 * the field. Leaving without a pick puts the chip that was there back.
 */
@Composable
private fun AirportField(code: () -> String?, onPick: (String?) -> Unit, hint: String) {
    val cs = MaterialTheme.colorScheme
    val chosen = code()
    var editing by remember { mutableStateOf(chosen == null) }
    var draft by remember { mutableStateOf("") }
    var focused by remember { mutableStateOf(false) }
    var wantFocus by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    // A short pause after the last key, then the search off the main thread; a newer key cancels the older search.
    val results by produceState(emptyList<FlightAirports.Airport>(), draft) {
        val q = draft.trim()
        if (q.length < 2) { value = emptyList(); return@produceState }
        delay(150)
        value = FlightAirports.search(q)
    }
    // Read live, not from this composition: a tapped suggestion has just chosen one when the focus goes.
    // With nothing chosen the typed text stays as it was, a draft; with a chip to go back to it goes.
    fun leave() { val now = code(); editing = now == null; if (now != null) draft = "" }
    fun edit() { editing = true; wantFocus = true }
    LaunchedEffect(wantFocus, editing) { if (wantFocus && editing) { runCatching { focus.requestFocus() }; wantFocus = false } }
    if (editing) {
        SheetField(
            draft, { draft = it.take(40) }, if (chosen != null) airportLabel(chosen) else hint,
            modifier = Modifier.focusRequester(focus).onFocusChanged {
                if (focused && !it.isFocused) leave()
                focused = it.isFocused
            },
            capitals = false,
        )
    } else if (chosen != null) {
        Row(
            Modifier.fillMaxWidth().height(54.dp).clip(RoundedCornerShape(18.dp)).background(cs.surfaceContainerHighest)
                .clickable { edit() }.padding(start = 8.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // The chosen airport as a chip: plainly picked, not text that might still be a half typed search.
            Box(Modifier.weight(1f)) { Row(
                Modifier.height(38.dp).clip(CircleShape).background(cs.secondaryContainer).padding(start = 12.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FlightAirports.byCode(chosen)?.let { FlagIcon(Remote.flag(it.country), 13.dp, Modifier.padding(end = 8.dp)) }
                Text(airportLabel(chosen), maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSecondaryContainer), modifier = Modifier.weight(1f, fill = false))
                Box(Modifier.padding(start = 4.dp).size(30.dp).clip(CircleShape).clickable { onPick(null); draft = ""; edit() }, contentAlignment = Alignment.Center) {
                    LineIcon(listOf(P("M6 6l12 12"), P("M18 6 6 18")), cs.onSecondaryContainer, size = 14.dp, stroke = 2.2f)
                }
            } }
            Text("Wijzigen", style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.primary), modifier = Modifier.padding(horizontal = 8.dp))
        }
    }
    val shown = editing && results.isNotEmpty()
    AnimatedVisibility(
        shown,
        enter = fadeIn(tween(180)) + expandVertically(tween(260, easing = SuggestEase), expandFrom = Alignment.Top),
        exit = fadeOut(tween(120)) + shrinkVertically(tween(200, easing = SuggestEase), shrinkTowards = Alignment.Top),
    ) {
        // The list changes length while typing; its height follows on the same calm curve instead of jumping.
        Column(Modifier.padding(top = 6.dp).animateContentSize(tween(200, easing = SuggestEase)), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            results.forEachIndexed { i, a ->
                key(a.iata) {
                    val top = if (i == 0) 18.dp else 6.dp
                    val bottom = if (i == results.lastIndex) 18.dp else 6.dp
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(top, top, bottom, bottom)).background(cs.surfaceContainer)
                            .clickable { onPick(a.iata); editing = false; draft = ""; focusManager.clearFocus() }
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("${a.city} (${a.iata})", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 15.sp, color = cs.onSurface))
                            val country = java.util.Locale("", a.country).getDisplayCountry(java.util.Locale.forLanguageTag("nl-NL"))
                            Text("${a.name} · $country", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontSize = 12.5.sp, color = cs.onSurfaceVariant))
                        }
                        FlagIcon(Remote.flag(a.country), 13.dp, Modifier.padding(start = 10.dp))
                    }
                }
            }
        }
    }
}

/** Animates a change of place in its parent from where it was to where it is now, while [active]; else it just goes there. */
private fun Modifier.glideToPlace(active: () -> Boolean): Modifier = composed {
    val scope = rememberCoroutineScope()
    var target by remember { mutableStateOf<IntOffset?>(null) }
    val anim = remember { mutableStateOf<Animatable<IntOffset, androidx.compose.animation.core.AnimationVector2D>?>(null) }
    val spec = MaterialTheme.motionScheme.defaultSpatialSpec<IntOffset>()
    this
        .onPlaced { c ->
            val p = c.positionInParent()
            target = IntOffset(p.x.toInt(), p.y.toInt())
        }
        .offset {
            val t = target ?: return@offset IntOffset.Zero
            val a = anim.value ?: Animatable(t, IntOffset.VectorConverter).also { anim.value = it }
            // Only a reorder glides; a stop folding away above already moves the rest smoothly by itself.
            if (a.targetValue != t) scope.launch { if (active() || a.isRunning) a.animateTo(t, spec) else a.snapTo(t) }
            a.value - t
        }
}

@Composable
private fun UndoPill(name: String?, onUndo: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().clip(CircleShape).background(cs.inverseSurface).padding(start = 18.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("${name ?: "Stop"} verwijderd", maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 14.sp, color = cs.inverseOnSurface), modifier = Modifier.weight(1f))
        androidx.compose.material3.TextButton(onClick = onUndo) { Text("Ongedaan maken", color = cs.inversePrimary, style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(650), fontSize = 14.sp)) }
    }
}

/*
 * Swipe to remove, ported from PixelPlayer's queue (SwipeToActionRow with
 * SongSwipeActionGestureHandler and removesRow): the same phases, springs,
 * thresholds, haptics, panel and collapse, to the left only.
 */

private enum class SwipePhase { Idle, Tension, Snapping, FreeDrag }

private class SwipeRemove(private val scope: CoroutineScope, private val density: Density, private val view: View, private val onRemove: () -> Unit) {
    val offset = Animatable(0f)
    /** 1 is the full height; folds to 0 while a removing swipe flings off, so the gap closes smoothly. */
    val collapse = Animatable(1f)
    var width by mutableFloatStateOf(0f)
    /** Latched while the row is away from rest, so the bounce past 0 never flashes a panel on the other side. */
    var active by mutableStateOf(false)
        private set
    private var phase = SwipePhase.Idle
    private var dragged = 0f
    private var inZone = false


    fun start() {
        phase = SwipePhase.Tension
        dragged = 0f
        inZone = false
        scope.launch { offset.stop() }
    }

    fun drag(amount: Float) {
        if (width <= 0f) return
        dragged += amount
        if (dragged != 0f) active = dragged < 0f
        // Only to the left: a swipe the other way stays put.
        if (dragged > 0f) { dragged = 0f; scope.launch { offset.snapTo(0f) }; return }
        val dir = sign(dragged)
        when (phase) {
            SwipePhase.Tension -> {
                // The first 60 dp move the row at most 20 dp, so a scroll that drifts sideways never removes anything.
                val threshold = 60f * density.density
                if (abs(dragged) < threshold) {
                    val fraction = (abs(dragged) / threshold).coerceIn(0f, 1f)
                    scope.launch { offset.snapTo(dir * 20f * density.density * fraction) }
                } else phase = SwipePhase.Snapping
            }
            SwipePhase.Snapping -> {
                view.haptic(Haptic.ThresholdOn)
                scope.launch { offset.animateTo(dragged, spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessLow)) }
                phase = SwipePhase.FreeDrag
            }
            SwipePhase.FreeDrag -> {
                val now = abs(dragged) > width * 0.40f
                if (now != inZone) {
                    inZone = now
                    view.haptic(if (now) Haptic.ThresholdOn else Haptic.ThresholdOff)
                }
                scope.launch { offset.animateTo(dragged, spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessHigh)) }
            }
            SwipePhase.Idle -> Unit
        }
    }

    fun end() {
        val committed = abs(dragged) > width * 0.40f && dragged < 0f
        phase = SwipePhase.Idle
        inZone = false
        if (committed) {
            view.haptic(Haptic.GestureEnd)
            dragged = 0f
            // Flung off to the left while the height folds in step; only then is it removed.
            scope.launch { collapse.animateTo(0f, tween(260, easing = FastOutSlowInEasing)) }
            scope.launch {
                offset.animateTo(-width * 1.1f, tween(260, easing = FastOutSlowInEasing))
                onRemove()
            }
            return
        }
        springBack()
    }

    fun cancel() { phase = SwipePhase.Idle; inZone = false; springBack() }

    private fun springBack() {
        dragged = 0f
        scope.launch {
            offset.animateTo(0f, spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessMedium))
            active = false
        }
    }
}

@Composable
private fun rememberSwipeRemove(onRemove: () -> Unit): SwipeRemove {
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val view = LocalView.current
    val latest = androidx.compose.runtime.rememberUpdatedState(onRemove)
    return remember { SwipeRemove(scope, density, view) { latest.value() } }
}

/** Folds the whole row (the road above a stop too) as its card flies off. */
private fun Modifier.swipeCollapse(state: SwipeRemove): Modifier = this
    .then(if (state.collapse.value < 1f) Modifier.clipToBounds() else Modifier)
    .layout { measurable, constraints ->
        val placeable = measurable.measure(constraints)
        layout(placeable.width, (placeable.height * state.collapse.value).roundToInt().coerceAtLeast(0)) { placeable.place(0, 0) }
    }

/** The card that slides, with PixelPlayer's panel growing from the right edge behind it: the trash and "Verwijderen". */
@Composable
private fun SwipeSurface(state: SwipeRemove, enabled: () -> Boolean, content: @Composable () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val density = LocalDensity.current
    var height by remember { mutableFloatStateOf(0f) }
    var labelWidth by remember { mutableIntStateOf(0) }
    Box(Modifier.fillMaxWidth().onSizeChanged { state.width = it.width.toFloat() }) {
        val off = state.offset.value
        if (state.active && off < 0f && height > 0f) {
            val reveal = -off
            val progress = (reveal / with(density) { 56.dp.toPx() }).coerceIn(0f, 1f)
            val committed = reveal > state.width * 0.40f
            val panel by animateColorAsState(if (committed) cs.errorContainer else cs.errorContainer.copy(alpha = 0.82f), tween(150), label = "panel")
            val iconAlpha by animateFloatAsState(progress * if (committed) 1f else 0.88f, tween(120), label = "icon")
            // The label waits until all of it fits, so it never shows cut off.
            val fits = labelWidth > 0 && reveal >= with(density) { (52.dp + 16.dp).toPx() } + labelWidth
            val textAlpha by animateFloatAsState(if (fits) iconAlpha else 0f, tween(120), label = "label")
            val h = with(density) { height.toDp() }
            Box(
                Modifier.align(Alignment.CenterEnd).height(h)
                    // Reaches under the card, so its round corners sit against the panel without a gap.
                    .width(with(density) { reveal.toDp() } + h / 2)
                    .clip(RoundedCornerShape(topEnd = 26.dp, bottomEnd = 26.dp))
                    .background(panel),
            ) {
                LineIcon(Glyphs.trash, cs.onErrorContainer, size = 22.dp, modifier = Modifier.align(Alignment.CenterEnd).padding(end = 18.dp).graphicsLayer { alpha = iconAlpha })
                Text(
                    "Verwijderen", maxLines = 1, softWrap = false,
                    style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onErrorContainer),
                    modifier = Modifier.align(Alignment.CenterEnd).padding(end = 52.dp)
                        .wrapContentWidthUnbounded()
                        .onSizeChanged { labelWidth = it.width }
                        .graphicsLayer { alpha = textAlpha },
                )
            }
        }
        Box(
            Modifier.fillMaxWidth()
                .onSizeChanged { height = it.height.toFloat() }
                .offset { IntOffset(state.offset.value.roundToInt(), 0) }
                .pointerInput(state) {
                    // The first clear movement decides: sideways is ours (every change consumed so the page cannot
                    // scroll under a swipe), up or down goes to the page, untouched.
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        var dx = 0f; var dy = 0f
                        var lock = 0
                        var started = false
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull { it.id == down.id }
                            if (change == null || !change.pressed) { if (started) state.end(); break }
                            // Held and lifted to be moved: the reorder owns this gesture.
                            if (!enabled()) { if (started) state.cancel(); break }
                            val delta = change.positionChange()
                            if (lock == 0) {
                                dx += delta.x; dy += delta.y
                                val slop = viewConfiguration.touchSlop
                                if (abs(dx) >= slop || abs(dy) >= slop) {
                                    if (abs(dx) > abs(dy)) {
                                        lock = 1; started = true
                                        state.start(); change.consume(); state.drag(dx)
                                    } else break
                                }
                            } else { change.consume(); state.drag(delta.x) }
                        }
                    }
                },
        ) { content() }
    }
}

private fun Modifier.wrapContentWidthUnbounded(): Modifier = wrapContentWidth(Alignment.End, unbounded = true)

/** Widens a row by [by] on both sides, past the padding of what holds it. */
private fun Modifier.bleedSides(by: androidx.compose.ui.unit.Dp): Modifier = layout { measurable, constraints ->
    val extra = by.roundToPx() * 2
    val placeable = measurable.measure(constraints.copy(minWidth = constraints.minWidth + extra, maxWidth = constraints.maxWidth + extra))
    layout(placeable.width - extra, placeable.height) { placeable.place(-extra / 2, 0) }
}

/**
 * Brings something into view above the keyboard. The page scrolls under the keyboard rather than above it,
 * so "in view" alone could leave it behind the keys: the request reaches the keyboard's height further down.
 */
private class AboveKeyboard(val modifier: Modifier, val keyboard: Boolean, val show: suspend () -> Unit)

@Composable
private fun rememberAboveKeyboard(): AboveKeyboard {
    val density = LocalDensity.current
    val ime = WindowInsets.ime.getBottom(density)
    val into = remember { BringIntoViewRequester() }
    var size by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    val imeNow = androidx.compose.runtime.rememberUpdatedState(ime)
    return AboveKeyboard(
        Modifier.bringIntoViewRequester(into).onSizeChanged { size = it },
        keyboard = ime > 0,
    ) { into.bringIntoView(androidx.compose.ui.geometry.Rect(0f, 0f, size.width.toFloat(), size.height + imeNow.value.toFloat())) }
}

