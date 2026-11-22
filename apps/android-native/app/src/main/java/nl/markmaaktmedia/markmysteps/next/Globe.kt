package nl.markmaaktmedia.markmysteps.next

import android.content.Context
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableLongState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotateRad
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import org.json.JSONArray
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
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
 * The stops in between only get dots when a trip is open (the trip page), or
 * on the touring home globe for the trip on show.
 *
 * All of that is geography, so it is worked out once per list of trips
 * (GlobeScene); a frame only projects and paints. The motion of the touring
 * globe lives in GlobeTour.kt.
 */

/** A land ring with the cap around it, so rings on the far side are skipped unprojected. */
private class LandRing(val pts: DoubleArray, val vx: Double, val vy: Double, val vz: Double, val minDot: Double)

private val landCache = HashMap<String, List<LandRing>>()

private fun land(context: Context, file: String): List<LandRing> = landCache.getOrPut(file) {
    val text = context.assets.open(file).bufferedReader().use { it.readText() }
    val rings = JSONArray(text)
    List(rings.length()) { i -> landRing(rings.getJSONArray(i)) }
}

/**
 * Every country as its own rings (countries110.json), for a map that shows the
 * borders: filled like the land, outlined with a hairline, coast and borders
 * from the same set so they meet.
 */
private fun countryRings(context: Context): List<LandRing> = landCache.getOrPut("countries110.json") {
    val all = JSONArray(context.assets.open("countries110.json").bufferedReader().use { it.readText() })
    buildList {
        for (c in 0 until all.length()) {
            val polys = all.getJSONObject(c).getJSONArray("p")
            for (p in 0 until polys.length()) {
                val poly = polys.getJSONArray(p)
                for (r in 0 until poly.length()) add(landRing(poly.getJSONArray(r)))
            }
        }
    }
}

private fun landRing(ring: JSONArray): LandRing {
    val flat = DoubleArray(ring.length() * 2)
    var x = 0.0
    var y = 0.0
    var z = 0.0
    for (j in 0 until ring.length()) {
        val p = ring.getJSONArray(j)
        flat[j * 2] = p.getDouble(0)
        flat[j * 2 + 1] = p.getDouble(1)
        val la = flat[j * 2 + 1] * RAD
        val lo = flat[j * 2] * RAD
        x += cos(la) * cos(lo)
        y += cos(la) * sin(lo)
        z += sin(la)
    }
    val len = sqrt(x * x + y * y + z * z).takeIf { it > 0 } ?: 1.0
    x /= len
    y /= len
    z /= len
    var reach = 0.0
    for (j in 0 until ring.length()) {
        val la = flat[j * 2 + 1] * RAD
        val lo = flat[j * 2] * RAD
        val d = cos(la) * cos(lo) * x + cos(la) * sin(lo) * y + sin(la) * z
        reach = max(reach, acos(d.coerceIn(-1.0, 1.0)))
    }
    // Visible when some of it is within 90 degrees of the centre, two spare.
    return LandRing(flat, x, y, z, -sin(reach + 0.035))
}

private const val RAD = PI / 180.0
private const val FLIGHT_DEG = 6.0
private const val INTERCONTINENTAL_DEG = 16.0
private const val SAME_PLACE_DEG = 0.12
private const val AIRPORT_OF_CITY_DEG = 0.5
private const val HOME_AIRPORT_DEG = 0.4

/** Orthographic projection, reused every frame: results land in [px], [py]. */
internal class Ortho {
    var lon0 = 0.0
        private set
    var lat0 = 0.0
        private set
    var cx = 0f
        private set
    var cy = 0f
        private set
    var r = 0f
        private set
    private var sinLat0 = 0.0
    private var cosLat0 = 1.0
    var px = 0f
        private set
    var py = 0f
        private set

    fun set(lon0: Double, lat0: Double, cx: Float, cy: Float, r: Float) {
        this.lon0 = lon0
        this.lat0 = lat0
        this.cx = cx
        this.cy = cy
        this.r = r
        sinLat0 = sin(lat0 * RAD)
        cosLat0 = cos(lat0 * RAD)
    }

    /** True on the near side; a far point is put on the rim, which closes land shapes there. */
    fun project(lon: Double, lat: Double, lift: Double = 0.0): Boolean {
        val l = (lon - lon0) * RAD
        val p = lat * RAD
        val cosP = cos(p)
        val x = cosP * sin(l)
        val y = cosLat0 * sin(p) - sinLat0 * cosP * cos(l)
        val near = sinLat0 * sin(p) + cosLat0 * cosP * cos(l)
        if (near >= 0) {
            val k = 1 + lift
            px = cx + (x * r * k).toFloat()
            py = cy - (y * r * k).toFloat()
            return true
        }
        val len = max(1e-9, hypot(x, y))
        px = cx + (x / len * r).toFloat()
        py = cy - (y / len * r).toFloat()
        return false
    }

    /** Dot of the view centre with a unit vector: above minus sin(reach) it can show. */
    fun facing(vx: Double, vy: Double, vz: Double): Double {
        val lo = lon0 * RAD
        return cosLat0 * cos(lo) * vx + cosLat0 * sin(lo) * vy + sinLat0 * vz
    }

    /** The place under a screen point, or null off the disc. */
    fun invert(x: Float, y: Float): LonLat? {
        val sx = ((x - cx) / r).toDouble()
        val sy = ((cy - y) / r).toDouble()
        val rho = hypot(sx, sy)
        if (rho > 1) return null
        if (rho < 1e-9) return lon0 to lat0
        val c = asin(rho)
        val lat = asin((cos(c) * sinLat0 + sy * sin(c) * cosLat0 / rho).coerceIn(-1.0, 1.0))
        val lon = lon0 + atan2(sx * sin(c), rho * cos(c) * cosLat0 - sy * sin(c) * sinLat0) / RAD
        return ((lon + 540) % 360 - 180) to lat / RAD
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

/** How high a flight's bow is [t] along it: an orthographic point at height R sits R times as far out. */
private fun bowLift(span: Double, t: Double): Double = min(0.22, span / 180.0 * 0.9) * sin(PI * t)

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

/** recede(): a trip stepping back behind the one on show loses colour, not opacity. */
private fun recede(c: Color, dark: Boolean, f: Float): Color {
    if (f <= 0.001f) return c
    val hsl = rgbToHsl(c)
    val target = if (dark) 46f else 58f
    val s = hsl[1] * (1 - 0.72f * f)
    val l = hsl[2] + (target - hsl[2]) * 0.6f * f
    return Color.hsl(hsl[0], (s / 100f).coerceIn(0f, 1f), (l / 100f).coerceIn(0f, 1f), c.alpha)
}

data class GlobeStyle(
    val sphere: Color,
    val land: Color,
    val dark: Boolean,
    /** Route width in dp (1.9 on the web). */
    val routeWidth: Float = 1.9f,
    /** Country borders as hairlines in this colour (a map that says where you are), or none. */
    val borders: Color? = null,
    /** The flights as grey dashed bows with their airports; a poster of the route itself leaves them out. */
    val flights: Boolean = true,
)

private data class Place(val at: LonLat, val members: MutableList<Trip>)

/** One unbroken run of a trip's route, sampled along great circles as lon, lat pairs. */
private class SceneRun(val trip: Trip, val pts: DoubleArray)

/** One flight bow, with the lift at each sample and every trip that flew it. */
private class SceneBow(val pts: DoubleArray, val lift: DoubleArray, val tripIds: List<String>)

/** Everything about the trips that does not depend on where the globe is looking. */
private class GlobeScene(
    val trips: List<Trip>,
    val colors: Map<String, Color>,
    val runs: List<SceneRun>,
    val bows: List<SceneBow>,
    val airports: DoubleArray,
    val places: List<Place>,
    /** Where a trip's name card sits: its start, snapped to a dot of its own. */
    val labelAt: Map<String, LonLat>,
    /** Stops without a full dot on top of them, for the trip on show. */
    val freeStops: Map<String, List<LonLat>>,
)

private fun flatten(points: List<LonLat>) = DoubleArray(points.size * 2).also { out ->
    points.forEachIndexed { i, p ->
        out[i * 2] = p.first
        out[i * 2 + 1] = p.second
    }
}

private fun buildScene(trips: List<Trip>, dark: Boolean): GlobeScene {
    val colors = trips.associate { it.id to legibleColor(it.color, dark) }
    val runs = mutableListOf<SceneRun>()
    val bows = mutableListOf<Triple<LonLat, LonLat, String>>()
    val airports = mutableListOf<LonLat>()

    // --- Routes, split where a jump is a flight ---
    for (trip in trips) {
        val run = mutableListOf<LonLat>()
        fun flush() {
            if (run.size >= 2) {
                val samples = run.zipWithNext().flatMap { (a, b) -> greatCircle(a, b, max(2, (angle(a, b) / 1.5).toInt())) }
                runs += SceneRun(trip, flatten(samples))
            }
            run.clear()
        }
        // Each recorded piece on its own (Trip.segments): joined end to start they drew a straight line
        // between two pieces, such as from Marrakesh to Rabat beside the train ride that was recorded.
        for (piece in trip.segments.ifEmpty { listOf(trip.route) }) {
            piece.forEachIndexed { i, b ->
                if (i == 0) {
                    run += b
                    return@forEachIndexed
                }
                val a = piece[i - 1]
                val gap = angle(a, b)
                val flown = trip.flights.any { (s, e) ->
                    (angle(s, a) < 1.2 && angle(e, b) < 1.2) || (angle(s, b) < 1.2 && angle(e, a) < 1.2)
                }
                when {
                    gap > FLIGHT_DEG && flown -> { flush(); run += b }
                    gap > INTERCONTINENTAL_DEG -> { flush(); bows += Triple(a, b, trip.id); airports += a; airports += b; run += b }
                    else -> run += b
                }
            }
            flush()
        }
        // The same legs the plane flies (with a layover as its own hop), so it always flies over its line.
        val hops = trip.flightLegs.flatMap { it.zipWithNext() }.ifEmpty { trip.flights }
        for (f in hops) {
            bows += Triple(f.first, f.second, trip.id)
            airports += f.first
            airports += f.second
        }
    }

    // --- Flights: grey dashed bows, one per route however many trips flew it ---
    val bowKeys = LinkedHashMap<String, Pair<Triple<LonLat, LonLat, String>, MutableList<String>>>()
    for (bow in bows) {
        val (a, b, id) = bow
        val key = listOf(a, b).map { "${(it.first / 1.2).roundToInt()},${(it.second / 1.2).roundToInt()}" }.sorted().joinToString("|")
        val held = bowKeys.getOrPut(key) { bow to mutableListOf() }
        if (id !in held.second) held.second += id
    }
    val sceneBows = bowKeys.values.map { (bow, ids) ->
        val (a, b) = bow
        val span = angle(a, b)
        val pts = greatCircle(a, b, max(12, (span / 1.2).toInt()))
        SceneBow(flatten(pts), DoubleArray(pts.size) { i -> bowLift(span, i.toDouble() / (pts.size - 1)) }, ids)
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
        // A spot picked by hand in the trip's settings is its one dot, as on the web: snapped onto the nearest
        // point of the recorded line, so it always sits on the route and never on empty land.
        trip.marker?.let { mk ->
            addEndpoint(trip.segments.flatten().minByOrNull { angle(it, mk) } ?: mk, trip)
            continue
        }
        val points = mutableListOf<LonLat>()
        // A track that starts or ends at one of your home airports (the phone already on at Schiphol) does
        // not make that airport a place of the trip: its dot is where the trip itself begins and ends.
        trip.route.firstOrNull { !AirportPref.isHome(it, HOME_AIRPORT_DEG) }?.let { points += it }
        trip.route.lastOrNull { !AirportPref.isHome(it, HOME_AIRPORT_DEG) }?.let { points += it }
        for ((s, e) in trip.flights) {
            if (!AirportPref.isHome(s, HOME_AIRPORT_DEG)) points += s
            if (!AirportPref.isHome(e, HOME_AIRPORT_DEG)) points += e
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
    val shownAirports = mutableListOf<LonLat>()
    for (ap in airports) {
        val k = "${(ap.first / 1.2).roundToInt()},${(ap.second / 1.2).roundToInt()}"
        if (!airportSeen.add(k)) continue
        if (dotted.any { angle(it, ap) < AIRPORT_OF_CITY_DEG }) continue
        shownAirports += ap
    }

    val labelAt = trips.associate { trip ->
        // The name goes where the trip begins, never on the home airport the track happened to start at.
        val want = trip.marker ?: trip.segments.flatten().firstOrNull { !AirportPref.isHome(it, HOME_AIRPORT_DEG) } ?: trip.route.firstOrNull { !AirportPref.isHome(it, HOME_AIRPORT_DEG) } ?: trip.stops.firstOrNull()?.at ?: trip.route.firstOrNull() ?: HomeAirport
        trip.id to (places.filter { trip in it.members }.minByOrNull { angle(it.at, want) }?.at ?: want)
    }
    val freeStops = trips.associate { trip ->
        trip.id to trip.stops.map { it.at }.ifEmpty { trip.stopPoints }.filter { s -> places.none { angle(it.at, s) < SAME_PLACE_DEG } }
    }
    return GlobeScene(trips, colors, runs, sceneBows, flatten(shownAirports), places, labelAt, freeStops)
}

/** Strokes and paths made once per density, reused every frame. */
private class Pens(d: Float, routeWidth: Float) {
    val land = Path().apply { fillType = PathFillType.EvenOdd }
    val path = Path()
    var scratch = FloatArray(4096)
    val route = Stroke(width = routeWidth * d, cap = StrokeCap.Round, join = StrokeJoin.Round)
    val upcoming = Stroke(
        width = 1.8f * d, cap = StrokeCap.Round, join = StrokeJoin.Round,
        pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f * d, 7f * d)),
    )
    val bow = Stroke(width = 1.2f * d, cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f * d, 5f * d)))
    val upRing = Stroke(2f * d)
    val rim = Stroke(1.2f * d)
    val stopRim = Stroke(1.1f * d)

    /** The web's airliner outline, half length 1, nose at +x. */
    val plane = Path().apply {
        val half = floatArrayOf(1f, 0f, 0.55f, 0.13f, 0.12f, 0.14f, -0.06f, 0.86f, -0.3f, 0.86f, -0.28f, 0.14f, -0.72f, 0.13f, -0.8f, 0.46f, -0.97f, 0.46f, -1f, 0.05f)
        moveTo(1f, 0f)
        for (i in half.indices step 2) lineTo(half[i], half[i + 1])
        for (i in half.size - 2 downTo 0 step 2) lineTo(half[i], -half[i + 1])
        close()
    }
}

/**
 * [zoom] 1 is the whole globe, as on the home page; the trip page zooms in on
 * a trip and shows all its stops ([showStops]), drawn from the finer land.
 *
 * With [tour] the globe behaves as on the web's home page: pinch to zoom, drag
 * to turn (with a little inertia), and when left alone it tours the trips,
 * framing one at a time while a light runs its journey. A tap on a trip frames
 * it and shows its name card; a tap on the card calls [onTripTap]. [onScale]
 * hears the zoom (1 = whole globe) whenever it changes.
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
    tour: Boolean = false,
    onTripTap: ((Trip) -> Unit)? = null,
    onScale: ((Float) -> Unit)? = null,
    /** Moves the globe's centre sideways, as a share of the width (room for a card beside it). */
    shiftX: Float = 0f,
    /** The same, up or down, as a share of the height. */
    shiftY: Float = 0f,
) {
    val context = LocalContext.current
    val density = LocalDensity.current.density
    val rings = remember(zoom, style.borders != null) { if (style.borders != null) countryRings(context) else land(context, if (zoom > 2f) "land50.json" else "land110.json") }
    val scene = remember(trips, style.dark) { buildScene(trips, style.dark) }
    val pens = remember(density, style.routeWidth) { Pens(density, style.routeWidth) }
    val proj = remember { Ortho() }

    if (tour) {
        TouringGlobe(trips, scene, rings, pens, proj, style, modifier, centerLon, showStops, onTripTap, onScale)
        return
    }

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
        proj.set(centerLon - drag - intro.value, centerLat, size.width * (0.5f + shiftX), size.height * (0.5f + shiftY) + inset, radius)
        clipRect {
            drawCircle(style.sphere, radius, Offset(proj.cx, proj.cy))
            drawLand(rings, proj, style.land, pens)
            style.borders?.let { drawPath(pens.land, it, style = Stroke(0.8f * density, join = StrokeJoin.Round)) }
            drawScene(scene, proj, style, pens, showStops, null)
        }
    }
}

@Composable
private fun TouringGlobe(
    trips: List<Trip>,
    scene: GlobeScene,
    rings: List<LandRing>,
    pens: Pens,
    proj: Ortho,
    style: GlobeStyle,
    modifier: Modifier,
    centerLon: Double,
    showStops: Boolean,
    onTripTap: ((Trip) -> Unit)?,
    onScale: ((Float) -> Unit)?,
) {
    val density = LocalDensity.current.density
    val motion = remember { GlobeMotion(centerLon) }
    // Trips the tour can frame: anything with a place on the map, biggest first.
    val tourTrips = remember(trips) { trips.filter { it.route.isNotEmpty() || it.stops.isNotEmpty() }.map(::TourTrip).sortedByDescending { it.size } }
    val currentTrips by rememberUpdatedState(tourTrips)
    val currentScene by rememberUpdatedState(scene)
    val currentOnScale by rememberUpdatedState(onScale)
    val currentOnTap by rememberUpdatedState(onTripTap)
    // Bumped once per frame; read only in draw and placement, so a frame never recomposes.
    val tick = remember { mutableLongStateOf(0L) }
    var cardTrip by remember { mutableStateOf<Trip?>(null) }
    var visible by remember { mutableStateOf(true) }
    val box = remember { FloatArray(2) }

    // Sets up the projection for this frame, the same in the loop and the draw.
    fun aim(w: Float, h: Float) {
        val inset = 10f * density
        val radius = min(w, h) / 2f - 2f * density - inset
        proj.set(-motion.rotation, CENTER_LAT + motion.tilt, w / 2f, h / 2f + inset, (radius * motion.scale).toFloat())
    }

    LaunchedEffect(Unit) {
        var last = System.nanoTime()
        var told = 1.0
        while (isActive) {
            // Scrolled out of sight: stop until it comes back, without a jump.
            if (!visible) {
                snapshotFlow { visible }.first { it }
                last = System.nanoTime()
            }
            withFrameNanos { }
            val nowNs = System.nanoTime()
            val dt = ((nowNs - last) / 1e9).coerceIn(0.001, 0.05)
            last = nowNs
            motion.step(nowNs / 1e6, dt, currentTrips)
            // Only a real change, so a still globe says nothing.
            if (abs(motion.scale - told) > 0.0002) {
                told = motion.scale
                currentOnScale?.invoke(motion.scale.toFloat())
            }
            // The card's dot, projected with this frame's camera.
            val id = motion.cardTripId
            if (id != null && box[0] > 0f) {
                aim(box[0], box[1])
                val at = currentScene.labelAt[id]
                motion.cardVisible = at != null && proj.project(at.first, at.second)
                motion.cardX = proj.px
                motion.cardY = proj.py
            }
            val shown = id?.let { i -> currentTrips.firstOrNull { it.id == i }?.trip }
            if (cardTrip != shown) cardTrip = shown
            tick.longValue++
        }
    }

    Box(
        modifier
            .onSizeChanged {
                box[0] = it.width.toFloat()
                box[1] = it.height.toFloat()
            }
            .onGloballyPositioned { c ->
                val b = c.boundsInWindow()
                val v = b.width > 1f && b.height > 1f
                if (v != visible) visible = v
            },
    ) {
        val haptics = rememberHaptics()
        Canvas(
            Modifier.fillMaxSize().pointerInput(Unit) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    motion.dragging = true
                    motion.stopFling()
                    motion.lastInteract = System.nanoTime() / 1e6
                    var moved = 0f
                    var pinched = false
                    var prevDist = 0f
                    val tracker = VelocityTracker()
                    tracker.addPosition(down.uptimeMillis, down.position)
                    while (true) {
                        val event = awaitPointerEvent()
                        motion.lastInteract = System.nanoTime() / 1e6
                        val pressed = event.changes.filter { it.pressed }
                        if (pressed.isEmpty()) break
                        if (pressed.size >= 2) {
                            pinched = true
                            val dist = (pressed[0].position - pressed[1].position).getDistance()
                            if (prevDist > 0f && dist > 0f) motion.pinch(dist / prevDist)
                            prevDist = dist
                        } else {
                            prevDist = 0f
                            val c = pressed[0]
                            val d = c.position - c.previousPosition
                            moved += (abs(d.x) + abs(d.y)) / density
                            motion.drag(d.x / density, d.y / density)
                            tracker.addPosition(c.uptimeMillis, c.position)
                        }
                        event.changes.forEach { it.consume() }
                    }
                    motion.dragging = false
                    motion.lastInteract = System.nanoTime() / 1e6
                    if (!pinched && moved <= TAP_SLOP_DP) {
                        aim(size.width.toFloat(), size.height.toFloat())
                        val before = motion.selectedId
                        motion.tap(proj.invert(down.position.x, down.position.y), currentTrips)
                        // A light tick as the name card moves to the trip that was tapped.
                        if (motion.selectedId != null && motion.selectedId != before) haptics(Haptic.Tick)
                    } else if (!pinched) {
                        val v = tracker.calculateVelocity()
                        motion.fling(v.x / density, v.y / density)
                    }
                }
            },
        ) {
            tick.longValue
            aim(size.width, size.height)
            clipRect {
                drawCircle(style.sphere, proj.r, Offset(proj.cx, proj.cy))
                drawLand(rings, proj, style.land, pens)
                drawScene(scene, proj, style, pens, showStops, motion)
                drawJourney(motion, proj, style, pens)
            }
        }
        cardTrip?.let { trip -> NameCard(trip, motion, tick, box) { currentOnTap?.invoke(trip) } }
    }
}

/** The name card of the trip on show: it unfolds from the trip's dot and opens the trip. */
@Composable
private fun NameCard(trip: Trip, motion: GlobeMotion, tick: MutableLongState, box: FloatArray, onTap: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val haptics = rememberHaptics()
    val density = LocalDensity.current.density
    val origin = remember { FloatArray(2) }
    // Which side of the dot the card goes: away from the rest of the trip, so a small trip stays visible
    // (its route runs east of the start: the card goes left). Chosen once when the card appears and then kept,
    // so it never jumps to the other side halfway; a long trip may still be partly covered, which is fine.
    val awayLeft = remember(trip.id) {
        val pts = trip.route.ifEmpty { trip.stops.map { it.at } }
        val start = trip.stops.firstOrNull()?.at ?: pts.firstOrNull()
        start != null && pts.isNotEmpty() && pts.map { it.first }.average() > start.first
    }
    val side = remember(trip.id) { intArrayOf(0) } // 0 = not chosen yet, 1 = right, -1 = left
    Column(
        Modifier
            .layout { measurable, constraints ->
                val p = measurable.measure(Constraints(maxWidth = (constraints.maxWidth * 0.7f).toInt()))
                layout(p.width, p.height) {
                    tick.longValue
                    // On the chosen side of the dot, kept inside the screen.
                    val margin = 6f * density
                    val w = box[0]
                    val h = box[1]
                    val cardX = motion.cardX
                    val cardY = motion.cardY
                    if (side[0] == 0) {
                        val fitsLeft = cardX - 9f * density - p.width >= margin
                        val fitsRight = cardX + 9f * density + p.width <= w - margin
                        side[0] = when {
                            awayLeft && fitsLeft -> -1
                            !awayLeft && fitsRight -> 1
                            fitsRight -> 1
                            else -> -1
                        }
                    }
                    var x = if (side[0] > 0) cardX + 9f * density else cardX - 9f * density - p.width
                    x = x.coerceIn(margin, max(margin, w - p.width - margin))
                    val y = (cardY - p.height / 2f).coerceIn(margin, max(margin, h - p.height - margin))
                    origin[0] = (cardX - x) / p.width
                    origin[1] = (cardY - y) / p.height
                    p.place(x.roundToInt(), y.roundToInt())
                }
            }
            .graphicsLayer {
                tick.longValue
                val o = motion.cardOpacity
                // Solid a little before it is full size.
                alpha = min(1f, o * 1.5f)
                val grow = 0.18f + 0.82f * o
                scaleX = grow
                scaleY = grow
                transformOrigin = TransformOrigin(origin[0], origin[1])
            }
            .clip(RoundedCornerShape(12.dp))
            .background(cs.surface.copy(alpha = 0.96f))
            .clickable(remember { MutableInteractionSource() }, indication = null) { if (motion.cardOpacity > 0.6f) { haptics(Haptic.Tap); onTap() } }
            .padding(horizontal = 11.dp, vertical = 7.dp),
    ) {
        Text(
            trip.title, maxLines = 1, overflow = TextOverflow.Ellipsis,
            style = TextStyle(fontFamily = Outfit, fontWeight = FontWeight(600), fontSize = 14.sp, color = cs.onSurface),
        )
        Text(
            "${trip.month} ${trip.year}", maxLines = 1,
            style = TextStyle(fontFamily = Inter, fontWeight = FontWeight(500), fontSize = 11.5.sp, color = cs.onSurfaceVariant),
        )
    }
}

private fun DrawScope.drawLand(rings: List<LandRing>, proj: Ortho, color: Color, pens: Pens) {
    val path = pens.land
    path.rewind()
    path.fillType = PathFillType.EvenOdd
    for (ring in rings) {
        if (proj.facing(ring.vx, ring.vy, ring.vz) <= ring.minDot) continue
        val n = ring.pts.size / 2
        if (pens.scratch.size < n * 2) pens.scratch = FloatArray(n * 2)
        val pts = pens.scratch
        var anyNear = false
        var anyOnScreen = false
        for (i in 0 until n) {
            if (proj.project(ring.pts[i * 2], ring.pts[i * 2 + 1])) anyNear = true
            val x = proj.px
            val y = proj.py
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

/** Dots grow a little with the zoom, far slower than the globe does. */
private fun dotScale(scale: Double) = min(1.12, 0.75 * scale.pow(0.21)).toFloat()

private fun DrawScope.drawScene(scene: GlobeScene, proj: Ortho, style: GlobeStyle, pens: Pens, showStops: Boolean, motion: GlobeMotion?) {
    val dark = style.dark
    val recedeId = motion?.recedeId
    fun stand(id: String) = motion?.standing(id) ?: 1f
    fun colorOf(trip: Trip): Color {
        val c = scene.colors[trip.id] ?: legibleColor(trip.color, dark)
        return if (recedeId == null) c else recede(c, dark, 1 - stand(trip.id))
    }

    // --- Routes; the trip on show goes last, so it lies on top ---
    for (pass in 0..1) for (run in scene.runs) {
        val mine = run.trip.id == recedeId
        if ((pass == 1) != mine) continue
        val path = pens.path
        path.rewind()
        var open = false
        val pts = run.pts
        for (i in 0 until pts.size / 2) {
            if (!proj.project(pts[i * 2], pts[i * 2 + 1])) {
                open = false
                continue
            }
            if (!open) path.moveTo(proj.px, proj.py) else path.lineTo(proj.px, proj.py)
            open = true
        }
        val fade = 0.34f + 0.66f * stand(run.trip.id)
        val color = colorOf(run.trip)
        if (run.trip.upcoming) drawPath(path, color.copy(alpha = 0.6f * fade), style = pens.upcoming)
        else drawPath(path, color.copy(alpha = 0.95f * fade), style = pens.route)
    }

    // --- Flights: grey dashed bows; a shared one is as present as its most present trip ---
    if (style.flights) for (pass in 0..1) for (bow in scene.bows) {
        val mine = recedeId != null && recedeId in bow.tripIds
        if ((pass == 1) != mine) continue
        val st = bow.tripIds.maxOf { stand(it) }
        val k = 0.3f + 0.7f * st
        val bowColor = if (dark) Color(165, 175, 187, (0.9f * k * 255).roundToInt()) else Color(105, 115, 128, (0.85f * k * 255).roundToInt())
        val path = pens.path
        path.rewind()
        var open = false
        for (i in bow.lift.indices) {
            if (!proj.project(bow.pts[i * 2], bow.pts[i * 2 + 1], bow.lift[i])) {
                open = false
                continue
            }
            if (!open) path.moveTo(proj.px, proj.py) else path.lineTo(proj.px, proj.py)
            open = true
        }
        drawPath(path, bowColor, style = pens.bow)
    }

    // Airports with no dot of their own nearby: a small grey point.
    val airportColor = if (dark) Color(150, 160, 172, (0.9f * 255).roundToInt()) else Color(120, 128, 140, (0.85f * 255).roundToInt())
    if (style.flights) for (i in 0 until scene.airports.size / 2) {
        if (proj.project(scene.airports[i * 2], scene.airports[i * 2 + 1])) drawCircle(airportColor, 2.6f * density, Offset(proj.px, proj.py))
    }

    val ds = if (motion == null) 0.75f else dotScale(motion.scale)

    // Instellingen › Voorkeuren › Globe › Altijd: every trip's stops, quietly, besides the one on show.
    if (!showStops && UiPrefs.globeStopsAlways) for (trip in scene.trips) {
        if ((motion?.stopReveal?.get(trip.id) ?: 0f) >= 0.012f) continue
        val stops = scene.freeStops[trip.id] ?: continue
        val color = colorOf(trip)
        val rimColor = if (dark) Color(20, 25, 32, 166) else Color(255, 255, 255, 230)
        for (s in stops) {
            if (!proj.project(s.first, s.second)) continue
            val at = Offset(proj.px, proj.py)
            drawCircle(color, 2.6f * density * ds, at, alpha = 0.9f)
            drawCircle(rimColor, 2.6f * density * ds, at, alpha = 0.9f, style = pens.stopRim)
        }
    }
    // Your own position while tracking (Instellingen › Voorkeuren › Eigen locatie › Ook op de homepage).
    val self = Tracker.lastFix
    if (UiPrefs.selfOnHome && Tracker.tripId != null && self != null && proj.project(self.first, self.second)) {
        val at = Offset(proj.px, proj.py)
        drawCircle(Color.White, 6.5f * density, at)
        drawCircle(Color(0xFF3B82F6), 4.6f * density, at)
    }
    // The stops in between, only on an open trip.
    if (showStops) for (trip in scene.trips) for (stop in trip.stops) {
        if (!proj.project(stop.at.first, stop.at.second)) continue
        val at = Offset(proj.px, proj.py)
        drawCircle(if (dark) Color(0xB3141920) else Color(0xD9FFFFFF), 3.6f * density, at)
        drawCircle(legibleColor(trip.color, dark), 2.4f * density, at)
    }
    // On the touring globe: the stops of the trip on show, one after another in travel order.
    else if (motion != null) for (trip in scene.trips) {
        val reveal = motion.stopReveal[trip.id] ?: continue
        if (reveal < 0.012f) continue
        val stops = scene.freeStops[trip.id] ?: continue
        if (stops.isEmpty()) continue
        val color = colorOf(trip)
        val rimColor = if (dark) Color(20, 25, 32, 166) else Color(255, 255, 255, 230)
        val head = reveal * ((stops.size - 1) * 0.06f + 0.45f)
        stops.forEachIndexed { i, s ->
            val local = ((head - i * 0.06f) / 0.45f).coerceIn(0f, 1f)
            if (local <= 0f || !proj.project(s.first, s.second)) return@forEachIndexed
            // Ease-out-back: it overshoots a touch and settles.
            val k = local - 1
            val pop = 1 + 2.3f * k * k * k + 1.5f * k * k
            val r = 3.1f * density * ds * pop
            val a = min(1f, local * 1.6f)
            val at = Offset(proj.px, proj.py)
            drawCircle(color, r, at, alpha = a)
            drawCircle(rimColor, r, at, alpha = a, style = pens.stopRim)
        }
    }

    val dotRadius = 4.5f * ds * density
    for (place in scene.places) {
        if (!proj.project(place.at.first, place.at.second)) continue
        // While a trip is on show, every dot it touches holds its colour.
        val trip = place.members.firstOrNull { it.id == motion?.active?.id } ?: place.members.first()
        val color = colorOf(trip)
        val at = Offset(proj.px, proj.py)
        drawCircle(color, dotRadius, at)
        if (trip.upcoming) {
            drawCircle(if (dark) Color(235, 240, 247, 250) else Color.White, dotRadius, at, style = pens.upRing)
        } else {
            drawCircle(if (dark) Color(20, 25, 32, 179) else Color(255, 255, 255, 217), dotRadius, at, style = pens.rim)
        }
    }
}

private val headScratch = DoubleArray(5)
private val ribbon = FloatArray(29 * 2)
private val ribbonT = FloatArray(29)
private val ribbonAir = BooleanArray(29)

/**
 * The trip on show, travelled: a head of light with a fading ribbon along the
 * ground, a grey contrail and a small plane along a flight, or two rings for a
 * city trip with no route to run.
 */
private fun DrawScope.drawJourney(motion: GlobeMotion, proj: Ortho, style: GlobeStyle, pens: Pens) {
    val act = motion.active ?: return
    val dark = style.dark
    val glow = legibleColor(act.trip.color, dark)
    val total = act.total
    if (act.legs.isEmpty() || total <= RIBBON_MIN_DEG) {
        drawCityRings(act, motion, proj, glow)
        return
    }
    val trail = motion.trailOf(act)
    val s = headScratch

    // Sampled head to tail; a sample off the route is dropped, so the ribbon slides on and off.
    var n = 0
    for (i in 0..28) {
        val t = i / 28.0
        val d = motion.glowDist - trail * t
        if (d < 0 || d > total) continue
        if (!act.at(d, s)) continue
        val flying = s[2] > 0.5
        val leg = act.legs[s[4].toInt()]
        val lift = if (flying) bowLift(leg.len, s[3]) else 0.0
        if (!proj.project(s[0], s[1], lift)) continue
        ribbon[n * 2] = proj.px
        ribbon[n * 2 + 1] = proj.py
        ribbonT[n] = t.toFloat()
        ribbonAir[n] = flying
        n++
    }
    // Behind a plane the trail is a contrail: grey and thin.
    val contrail = if (dark) Color(186, 195, 205) else Color(128, 137, 148)
    for (pass in 0..1) {
        val width = (if (pass == 0) 9f else 2.8f) * density
        val peak = if (pass == 0) 0.22f else 0.95f
        for (i in 1 until n) {
            val ax = ribbon[(i - 1) * 2]
            val ay = ribbon[(i - 1) * 2 + 1]
            val bx = ribbon[i * 2]
            val by = ribbon[i * 2 + 1]
            // A segment that leapt across the globe.
            if (hypot(bx - ax, by - ay) > 60 * density) continue
            val fade = (1 - ribbonT[i]) * (1 - ribbonT[i])
            val air = ribbonAir[i]
            val c = if (air) contrail else glow
            drawLine(c, Offset(ax, ay), Offset(bx, by), width, StrokeCap.Round, alpha = peak * fade * (if (air) 0.45f else 1f))
        }
    }

    // In the air the head is a plane, flying the bow it drew.
    if (motion.glowDist > total || !act.at(motion.glowDist, s) || s[2] < 0.5) {
        motion.planeAngle = Float.NaN
        return
    }
    val leg = act.legs[s[4].toInt()] as FlightLeg
    val f = s[3]
    if (!proj.project(s[0], s[1], bowLift(leg.len, f))) return
    val hx = proj.px
    val hy = proj.py
    // Heading from a step either way along the same curve.
    val fa = min(1.0, f + 0.01)
    val fb = max(0.0, f - 0.01)
    slerp(leg.a, leg.b, fa, s)
    val okA = proj.project(s[0], s[1], bowLift(leg.len, fa))
    val ax = proj.px
    val ay = proj.py
    slerp(leg.a, leg.b, fb, s)
    val okB = proj.project(s[0], s[1], bowLift(leg.len, fb))
    val target = if (okA && okB) atan2(ay - proj.py, ax - proj.px) else 0f
    val prev = motion.planeAngle
    motion.planeAngle = if (prev.isNaN()) target else {
        // The shortest way round, eased so it never twitches under the moving camera.
        val delta = ((target - prev + PI.toFloat() * 3) % (PI.toFloat() * 2)) - PI.toFloat()
        prev + delta * (1 - 0.0001.pow(motion.dt)).toFloat()
    }
    // Small at both gates, full size in the cruise, fading over the same stretch.
    val ends = min(f, 1 - f).toFloat()
    val size = 8f * density * (0.5f + 0.5f * min(1f, ends / 0.2f))
    val alpha = min(1f, ends / 0.07f)
    if (alpha <= 0.01f) return
    val planeColor = if (dark) Color(0xFFCDD5DE) else Color(0xFF79838F)
    translate(hx, hy) {
        rotateRad(motion.planeAngle, Offset.Zero) {
            scale(size, size, Offset.Zero) {
                // A soft shadow below lifts it off the map.
                translate(0f, 1.2f * density / size) { drawPath(pens.plane, Color(10, 14, 20), alpha = 0.22f * alpha) }
                drawPath(pens.plane, planeColor, alpha = alpha)
            }
        }
    }
}

/** A city trip: a breathing halo and two rings a beat apart. */
private fun DrawScope.drawCityRings(act: TourTrip, motion: GlobeMotion, proj: Ortho, glow: Color) {
    val spot = act.segments.firstOrNull()?.firstOrNull() ?: act.anchor
    if (!proj.project(spot.first, spot.second)) return
    val at = Offset(proj.px, proj.py)
    val period = 2800.0
    val breathe = (0.5 + 0.5 * sin(motion.now / period * PI * 2)).toFloat()
    val haloR = (14 + breathe * 5) * density
    drawCircle(
        Brush.radialGradient(
            0f to glow.copy(alpha = 0.26f + breathe * 0.12f), 0.55f to glow.copy(alpha = 0.1f), 1f to glow.copy(alpha = 0f),
            center = at, radius = haloR,
        ),
        haloR, at,
    )
    for (offset in doubleArrayOf(0.0, 0.5)) {
        val x = motion.now / period + offset
        val phase = (x - floor(x)).toFloat()
        // Ease-out quart: quick out of the dot, then drifting.
        val e = 1 - (1 - phase).pow(4)
        val r = (5.5f + e * 21f) * density
        val a = 0.6f * min(1f, phase * 3) * (1 - e)
        drawCircle(glow, r, at, alpha = a, style = Stroke(max(0.6f, 2.4f * (1 - e)) * density))
    }
}
