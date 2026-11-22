package nl.markmaaktmedia.markmysteps.next

import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import org.json.JSONArray
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * The home page globe, after GlobeBackdrop.tsx: the same land (Natural Earth),
 * the same orthographic projection centred on latitude 38, the same colours,
 * line widths and dashes, and the same rules for what gets a dot:
 *
 *  - a dot only where a recorded route starts or ends, and at the far end of a
 *    flight (never at the home airport), an airport snapped onto the trip's own
 *    stop when that is within about 55 km;
 *  - places within about 13 km are one dot, shared by every trip that ends or
 *    passes there;
 *  - a finished trip's dot is solid with a light rim, an upcoming trip's dot has
 *    a white ring and its route is dotted;
 *  - a jump of more than 6 degrees that one of the trip's flights covers is a
 *    grey dashed bow, as is any jump of more than 16 degrees;
 *  - an airport with no dot of its own nearby gets a small grey point;
 *  - colours are made legible on the globe: darker on the light one, lighter on
 *    the dark one.
 *
 * The stops in between only get dots when a trip is open (the trip page).
 */

private val landCache = HashMap<String, List<DoubleArray>>()

private fun land(context: Context, file: String): List<DoubleArray> = landCache.getOrPut(file) {
    val text = context.assets.open(file).bufferedReader().use { it.readText() }
    val rings = JSONArray(text)
    List(rings.length()) { i ->
        val ring = rings.getJSONArray(i)
        DoubleArray(ring.length() * 2).also { flat ->
            for (j in 0 until ring.length()) {
                val p = ring.getJSONArray(j)
                flat[j * 2] = p.getDouble(0)
                flat[j * 2 + 1] = p.getDouble(1)
            }
        }
    }
}

private const val RAD = PI / 180.0
private const val FLIGHT_DEG = 6.0
private const val INTERCONTINENTAL_DEG = 16.0
private const val SAME_PLACE_DEG = 0.12
private const val AIRPORT_OF_CITY_DEG = 0.5
private const val HOME_AIRPORT_DEG = 0.4

private class Ortho(val lon0: Double, val lat0: Double, val cx: Float, val cy: Float, val r: Float) {
    private val sinLat0 = sin(lat0 * RAD)
    private val cosLat0 = cos(lat0 * RAD)

    fun project(lon: Double, lat: Double, lift: Double = 0.0): Triple<Float, Float, Boolean> {
        val l = (lon - lon0) * RAD
        val p = lat * RAD
        val cosP = cos(p)
        val x = cosP * sin(l)
        val y = cosLat0 * sin(p) - sinLat0 * cosP * cos(l)
        val near = sinLat0 * sin(p) + cosLat0 * cosP * cos(l)
        val k = 1 + lift
        if (near >= 0) return Triple(cx + (x * r * k).toFloat(), cy - (y * r * k).toFloat(), true)
        val len = max(1e-9, hypot(x, y))
        return Triple(cx + (x / len * r).toFloat(), cy - (y / len * r).toFloat(), false)
    }
}

fun angle(a: LonLat, b: LonLat): Double {
    val (l1, p1) = a.first * RAD to a.second * RAD
    val (l2, p2) = b.first * RAD to b.second * RAD
    val d = sin(p1) * sin(p2) + cos(p1) * cos(p2) * cos(l2 - l1)
    return acos(d.coerceIn(-1.0, 1.0)) / RAD
}

private fun greatCircle(a: LonLat, b: LonLat, steps: Int): List<LonLat> {
    val (l1, p1) = a.first * RAD to a.second * RAD
    val (l2, p2) = b.first * RAD to b.second * RAD
    val v1 = doubleArrayOf(cos(p1) * cos(l1), cos(p1) * sin(l1), sin(p1))
    val v2 = doubleArrayOf(cos(p2) * cos(l2), cos(p2) * sin(l2), sin(p2))
    val omega = acos((v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]).coerceIn(-1.0, 1.0))
    if (omega < 1e-6) return listOf(a, b)
    return (0..steps).map { i ->
        val t = i.toDouble() / steps
        val s1 = sin((1 - t) * omega) / sin(omega)
        val s2 = sin(t * omega) / sin(omega)
        val x = s1 * v1[0] + s2 * v2[0]
        val y = s1 * v1[1] + s2 * v2[1]
        val z = s1 * v1[2] + s2 * v2[2]
        atan2(y, x) / RAD to atan2(z, sqrt(x * x + y * y)) / RAD
    }
}

// --- Colour helpers, ported from GlobeBackdrop.tsx ---

private fun rgbToHsl(c: Color): FloatArray {
    val r = c.red
    val g = c.green
    val b = c.blue
    val mx = maxOf(r, g, b)
    val mn = minOf(r, g, b)
    val l = (mx + mn) / 2
    var h = 0f
    var s = 0f
    val d = mx - mn
    if (d != 0f) {
        s = d / (1 - abs(2 * l - 1))
        h = when (mx) {
            r -> ((g - b) / d) % 6
            g -> (b - r) / d + 2
            else -> (r - g) / d + 4
        } * 60
        if (h < 0) h += 360
    }
    return floatArrayOf(h, s * 100, l * 100)
}

/** legibleColor(): nudged into a readable range on the light or dark globe. */
fun legibleColor(c: Color, dark: Boolean): Color {
    val (h, s, l) = rgbToHsl(c).let { Triple(it[0], it[1], it[2]) }
    val s2 = min(96f, max(s, 48f))
    val l2 = if (dark) min(80f, max(l, 50f)) else max(26f, min(l, 54f))
    return Color.hsl(h, s2 / 100f, l2 / 100f)
}

data class GlobeStyle(
    val sphere: Color,
    val land: Color,
    val dark: Boolean,
    /** Route width in dp (1.9 on the web). */
    val routeWidth: Float = 1.9f,
)

private data class Place(val at: LonLat, val members: MutableList<Trip>)

/**
 * [zoom] 1 is the whole globe, as on the home page; the trip page zooms in on
 * a trip and shows all its stops ([showStops]), drawn from the finer land.
 */
@Composable
fun Globe(
    trips: List<Trip>,
    style: GlobeStyle,
    modifier: Modifier = Modifier,
    centerLon: Double = 8.0,
    centerLat: Double = 38.0,
    zoom: Float = 1f,
    showStops: Boolean = false,
    turnable: Boolean = true,
    /** Moves the globe's centre sideways, as a share of the width (room for a card beside it). */
    shiftX: Float = 0f,
) {
    val context = LocalContext.current
    val rings = remember(zoom) { land(context, if (zoom > 2f) "land50.json" else "land110.json") }
    var drag by remember { mutableFloatStateOf(0f) }
    val intro = remember { Animatable(if (zoom > 1f) 0f else -28f) }
    LaunchedEffect(Unit) { intro.animateTo(0f, tween(1400)) }

    Canvas(
        if (!turnable) modifier else modifier.pointerInput(Unit) {
            detectDragGestures { change, amount ->
                change.consume()
                drag += amount.x / density * 0.35f / zoom
            }
        },
    ) {
        val inset = if (zoom > 1f) 0f else 10f * density
        val radius = (min(size.width, size.height) / 2f - 2f * density - inset) * zoom
        val proj = Ortho(centerLon - drag - intro.value, centerLat, size.width * (0.5f + shiftX), size.height / 2f + inset, radius)
        clipRect {
            drawCircle(style.sphere, radius, Offset(proj.cx, proj.cy))
            drawLand(rings, proj, style.land)
            drawTrips(trips, proj, style, showStops)
        }
    }
}

private fun DrawScope.drawLand(rings: List<DoubleArray>, proj: Ortho, color: Color) {
    val path = Path().apply { fillType = PathFillType.EvenOdd }
    for (ring in rings) {
        val n = ring.size / 2
        var anyNear = false
        var anyOnScreen = false
        val pts = FloatArray(n * 2)
        for (i in 0 until n) {
            val (x, y, near) = proj.project(ring[i * 2], ring[i * 2 + 1])
            if (near) anyNear = true
            if (x > -size.width && x < size.width * 2 && y > -size.height && y < size.height * 2) anyOnScreen = true
            pts[i * 2] = x
            pts[i * 2 + 1] = y
        }
        if (!anyNear || !anyOnScreen) continue
        path.moveTo(pts[0], pts[1])
        for (i in 1 until n) path.lineTo(pts[i * 2], pts[i * 2 + 1])
        path.close()
    }
    drawPath(path, color)
}

private fun DrawScope.drawTrips(trips: List<Trip>, proj: Ortho, style: GlobeStyle, showStops: Boolean) {
    val bows = mutableListOf<Pair<LonLat, LonLat>>()
    val airports = mutableListOf<LonLat>()

    // --- Routes, split where a jump is a flight ---
    for (trip in trips) {
        val color = legibleColor(trip.color, style.dark)
        val run = mutableListOf<LonLat>()
        fun flush() {
            if (run.size >= 2) drawRoute(run, proj, color, trip.upcoming, style)
            run.clear()
        }
        trip.route.forEachIndexed { i, b ->
            if (i == 0) {
                run += b
                return@forEachIndexed
            }
            val a = trip.route[i - 1]
            val gap = angle(a, b)
            val flown = trip.flights.any { (s, e) ->
                (angle(s, a) < 1.2 && angle(e, b) < 1.2) || (angle(s, b) < 1.2 && angle(e, a) < 1.2)
            }
            when {
                gap > FLIGHT_DEG && flown -> { flush(); run += b }
                gap > INTERCONTINENTAL_DEG -> { flush(); bows += a to b; airports += a; airports += b; run += b }
                else -> run += b
            }
        }
        flush()
        for (f in trip.flights) {
            bows += f
            airports += f.first
            airports += f.second
        }
    }

    // --- Flights: grey dashed bows, one per route however many trips flew it ---
    val seen = HashSet<String>()
    val bowColor = if (style.dark) Color(165, 175, 187, (0.9f * 255).roundToInt()) else Color(105, 115, 128, (0.85f * 255).roundToInt())
    for ((a, b) in bows) {
        val key = listOf(a, b).map { "${(it.first / 1.2).roundToInt()},${(it.second / 1.2).roundToInt()}" }.sorted().joinToString("|")
        if (!seen.add(key)) continue
        drawBow(a, b, proj, bowColor)
    }

    // --- Places with a dot: route ends and far flight ends, snapped and merged ---
    val places = mutableListOf<Place>()
    fun addEndpoint(p: LonLat, trip: Trip) {
        val g = places.firstOrNull { angle(it.at, p) < SAME_PLACE_DEG }
        if (g == null) places += Place(p, mutableListOf(trip)) else if (trip !in g.members) g.members += trip
    }
    fun snapToStop(trip: Trip, p: LonLat): LonLat =
        trip.stops.map { it.at }.filter { angle(it, p) < AIRPORT_OF_CITY_DEG }.minByOrNull { angle(it, p) } ?: p
    for (trip in trips) {
        val points = mutableListOf<LonLat>()
        trip.route.firstOrNull()?.let { points += it }
        trip.route.lastOrNull()?.let { points += it }
        for ((s, e) in trip.flights) {
            if (angle(s, HomeAirport) >= HOME_AIRPORT_DEG) points += s
            if (angle(e, HomeAirport) >= HOME_AIRPORT_DEG) points += e
        }
        points.forEach { addEndpoint(snapToStop(trip, it), trip) }
    }
    // A trip passing through a place another trip ends at joins that dot.
    for (trip in trips) for (p in trip.route) {
        places.firstOrNull { angle(it.at, p) < SAME_PLACE_DEG }?.let { if (trip !in it.members) it.members += trip }
    }

    // Airports with no dot of their own nearby: a small grey point.
    val dotted = places.map { it.at } + trips.flatMap { t -> t.stops.map { it.at } }
    val airportSeen = HashSet<String>()
    val airportColor = if (style.dark) Color(150, 160, 172, (0.9f * 255).roundToInt()) else Color(120, 128, 140, (0.85f * 255).roundToInt())
    for (ap in airports) {
        val k = "${(ap.first / 1.2).roundToInt()},${(ap.second / 1.2).roundToInt()}"
        if (!airportSeen.add(k)) continue
        if (dotted.any { angle(it, ap) < AIRPORT_OF_CITY_DEG }) continue
        val (x, y, near) = proj.project(ap.first, ap.second)
        if (near) drawCircle(airportColor, 2.6f * density, Offset(x, y))
    }

    // The stops in between, only on an open trip.
    if (showStops) for (trip in trips) for (stop in trip.stops) {
        val (x, y, near) = proj.project(stop.at.first, stop.at.second)
        if (!near) continue
        drawCircle(if (style.dark) Color(0xB3141920) else Color(0xD9FFFFFF), 3.6f * density, Offset(x, y))
        drawCircle(legibleColor(trip.color, style.dark), 2.4f * density, Offset(x, y))
    }

    val dotRadius = 4.5f * 0.75f * density
    for (place in places) {
        val (x, y, near) = proj.project(place.at.first, place.at.second)
        if (!near) continue
        val trip = place.members.first()
        val color = legibleColor(trip.color, style.dark)
        drawCircle(color, dotRadius, Offset(x, y))
        if (trip.upcoming) {
            drawCircle(if (style.dark) Color(235, 240, 247, 250) else Color.White, dotRadius, Offset(x, y), style = Stroke(2f * density))
        } else {
            drawCircle(if (style.dark) Color(20, 25, 32, 179) else Color(255, 255, 255, 217), dotRadius, Offset(x, y), style = Stroke(1.2f * density))
        }
    }
}

private fun DrawScope.drawRoute(points: List<LonLat>, proj: Ortho, color: Color, upcoming: Boolean, style: GlobeStyle) {
    val path = Path()
    var open = false
    points.zipWithNext().forEach { (a, b) ->
        greatCircle(a, b, max(2, (angle(a, b) / 1.5).toInt())).forEach { p ->
            val (x, y, near) = proj.project(p.first, p.second)
            if (!near) {
                open = false
                return@forEach
            }
            if (!open) path.moveTo(x, y) else path.lineTo(x, y)
            open = true
        }
    }
    if (upcoming) {
        drawPath(
            path, color.copy(alpha = 0.6f),
            style = Stroke(
                width = 1.8f * density, cap = StrokeCap.Round, join = StrokeJoin.Round,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f * density, 7f * density)),
            ),
        )
    } else {
        drawPath(path, color.copy(alpha = 0.95f), style = Stroke(width = style.routeWidth * density, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/** A flight lifted off the surface: an orthographic point at height R sits R times as far from the centre. */
private fun DrawScope.drawBow(a: LonLat, b: LonLat, proj: Ortho, color: Color) {
    val span = angle(a, b)
    val lift = min(0.22, span / 180.0 * 0.9)
    val pts = greatCircle(a, b, max(12, (span / 1.2).toInt()))
    val path = Path()
    var open = false
    pts.forEachIndexed { i, p ->
        val t = i.toDouble() / (pts.size - 1)
        val (x, y, near) = proj.project(p.first, p.second, lift * sin(PI * t))
        if (!near) {
            open = false
            return@forEachIndexed
        }
        if (!open) path.moveTo(x, y) else path.lineTo(x, y)
        open = true
    }
    drawPath(
        path, color,
        style = Stroke(width = 1.2f * density, cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f * density, 5f * density))),
    )
}
