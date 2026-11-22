package nl.markmaaktmedia.markmysteps.next

import androidx.compose.runtime.getValue
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.graphicsLayer

import android.graphics.Color as AColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.lineCap
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineDasharray
import org.maplibre.android.style.layers.PropertyFactory.lineJoin
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.atan
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.tan

/*
 * The trip's map: MapLibre with the same OpenFreeMap styles as the web app
 * (positron by day, dark at night), so it has the names, borders and roads.
 * On it the route in the trip's colour, flights as great-circle arcs, and a
 * dot per stop. An upcoming trip is drawn dashed, as on the web.
 */

private const val LIGHT = "https://tiles.openfreemap.org/styles/positron"
private const val DARK = "https://tiles.openfreemap.org/styles/dark"
/** Keyless Esri World Imagery, the web app's satellite style. */
private const val SATELLITE = """{"version":8,"sources":{"sat":{"type":"raster","tiles":["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],"tileSize":256,"maxzoom":19}},"layers":[{"id":"sat","type":"raster","source":"sat"}]}"""

@Composable
fun TripMap(trip: Trip, dark: Boolean, modifier: Modifier = Modifier, bottomInsetDp: Int = 60, topInsetDp: Int = 96, fadeIn: Boolean = false, photos: List<Media> = emptyList(), onPhoto: (Media) -> Unit = {}) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val density = LocalDensity.current.density
    val color = legibleColor(trip.color, dark).toArgb()
    val view = remember {
        MapLibre.getInstance(context)
        MapView(context, MapLibreMapOptions.createFromAttributes(context).textureMode(true).attributionEnabled(false).logoEnabled(false)
            // The empty map's colour before tiles arrive follows the theme, so dark mode never flashes light.
            .foregroundLoadColor(if (dark) 0xFF14181D.toInt() else 0xFFF3ECE2.toInt())).apply {
            onCreate(null)
        }
    }

    // The map follows the screen's life: running while visible, gone with the page.
    DisposableEffect(lifecycle, view) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> view.onStart()
                Lifecycle.Event.ON_RESUME -> view.onResume()
                Lifecycle.Event.ON_PAUSE -> view.onPause()
                Lifecycle.Event.ON_STOP -> view.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) view.onStart()
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) view.onResume()
        onDispose {
            lifecycle.removeObserver(observer)
            view.onPause(); view.onStop(); view.onDestroy()
        }
    }

    val styleId = MapStylePref.id
    val key = "${trip.id}/${trip.stops.size}/$dark/$styleId"
    // A map that opens on its own (full screen) waits for its first tiles and then fades in, so the route is
    // never drawn on an empty background.
    var ready by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(!fadeIn) }
    val shown by androidx.compose.animation.core.animateFloatAsState(if (ready) 1f else 0f, androidx.compose.material3.MaterialTheme.motionScheme.defaultEffectsSpec(), label = "mapIn")
    // Fitting again whenever the view changes size: a fit made before the view had its final size framed the
    // route wrongly, cut off at the edges.
    val fit = androidx.compose.runtime.remember { arrayOfNulls<() -> Unit>(1) }
    // The map takes the finger itself, also inside a scrolling page: a drag on it moves the map, not the page.
    DisposableEffect(view) {
        view.setOnTouchListener { v, e -> if (e.actionMasked == android.view.MotionEvent.ACTION_DOWN) v.parent?.requestDisallowInterceptTouchEvent(true); false }
        onDispose { view.setOnTouchListener(null) }
    }
    var mapRef by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<org.maplibre.android.maps.MapLibreMap?>(null) }
    var cameraTick by androidx.compose.runtime.remember { androidx.compose.runtime.mutableIntStateOf(0) }
    DisposableEffect(view) {
        val l = android.view.View.OnLayoutChangeListener { _, l, t, r, b, ol, ot, or, ob -> if (r - l != or - ol || b - t != ob - ot) fit[0]?.invoke() }
        view.addOnLayoutChangeListener(l)
        if (fadeIn) view.addOnDidFinishLoadingMapListener { ready = true }
        onDispose { view.removeOnLayoutChangeListener(l) }
    }
    androidx.compose.foundation.layout.Box(modifier.graphicsLayer { alpha = shown }) {
    AndroidView(factory = { view }, modifier = Modifier.matchParentSize(), update = { map ->
        if (map.tag == key) return@AndroidView
        map.tag = key
        map.getMapAsync { m ->
            if (mapRef == null) {
                mapRef = m
                m.addOnCameraMoveListener { cameraTick++ }
                m.addOnCameraIdleListener { cameraTick++ }
            }
            m.uiSettings.isRotateGesturesEnabled = false
            m.uiSettings.isTiltGesturesEnabled = false
            m.uiSettings.isCompassEnabled = false
            // The chosen style; in the dark a light vector style becomes the dark one, as on the web.
            val builder = when {
                styleId == "satellite" -> Style.Builder().fromJson(SATELLITE)
                dark -> Style.Builder().fromUri(DARK)
                else -> Style.Builder().fromUri("https://tiles.openfreemap.org/styles/$styleId")
            }
            m.setStyle(builder) { style ->
                dutchLabels(style)
                draw(style, trip, color, dark)
                // The flights' bows count too, so the whole route with its arcs fits on screen.
                val bowPoints = trip.flightLegs.ifEmpty { trip.flights.map { listOf(it.first, it.second) } }.flatMap { hops -> hops.zipWithNext().flatMap { (a, b) -> flightArc(a, b, 12) } }
                // The trip itself decides the view: its stops and the route travelled. The flights to and from home
                // are left out (they would shrink a trip in Morocco to a corner of Europe); only a trip that is
                // nothing but flights is framed by its bows.
                val own = trip.stops.map { it.at } + trip.route
                val points = (if (own.size >= 2) own else own + bowPoints).ifEmpty { listOf(HomeAirport) }
                // Room on every side, more at the bottom for the panel's corner and the expand button, so the
                // route sits nicely in the middle instead of against the edges.
                val pad = (44 * density).toInt()
                fit[0] = {
                    if (view.width > 0 && view.height > 0) {
                        if (points.size == 1) {
                            m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(points[0].second, points[0].first), 9.0))
                        } else {
                            val bounds = LatLngBounds.Builder().apply { points.forEach { include(LatLng(it.second, it.first)) } }.build()
                            m.moveCamera(CameraUpdateFactory.newLatLngBounds(bounds, pad, ((topInsetDp + 28) * density).toInt(), pad, ((bottomInsetDp + 56) * density).toInt()))
                            // A city trip opens at city level, not on a street corner.
                            if (m.cameraPosition.zoom > 11.5) m.moveCamera(CameraUpdateFactory.zoomTo(11.5))
                        }
                    }
                }
                fit[0]?.invoke()
            }
        }
    })
    PhotoMarkers(mapRef, cameraTick, photos, trip, onPhoto)
    }
}

private fun lineOf(points: List<LonLat>) = LineString.fromLngLats(points.map { Point.fromLngLat(it.first, it.second) })

private fun draw(style: Style, trip: Trip, color: Int, dark: Boolean) {
    // As the web app (lib/mapRoute.ts splitTrack): the recorded line is cut wherever two
    // fixes lie more than 400 km apart. A jump the plan calls a flight is left to that
    // flight's bow, one too far for anything but a plane gets a bow of its own, and the
    // rest (a train through a tunnel) stays a plain line from one end to the other.
    val legs = trip.flightLegs.ifEmpty { trip.flights.map { listOf(it.first, it.second) } }
    val hops = legs.flatMap { it.zipWithNext() }
    fun near(a: LonLat, b: LonLat, km: Double) = angle(a, b) * 111.2 <= km
    fun planned(a: LonLat, b: LonLat): Boolean {
        val reach = maxOf(60.0, angle(a, b) * 111.2 * 0.25)
        return hops.any { (f, t) -> (near(a, f, reach) && near(b, t, reach)) || (near(a, t, reach) && near(b, f, reach)) }
    }
    val ground = mutableListOf<List<LonLat>>()
    // There and back between the same airports is one bow, not two on top of each other (with their dashes
    // out of step that read as one thick line); both bow the same way, to the north.
    val drawnHops = hops.fold(mutableListOf<Pair<LonLat, LonLat>>()) { acc, (a, b) ->
        if (acc.none { (f, t) -> (near(a, f, 30.0) && near(b, t, 30.0)) || (near(a, t, 30.0) && near(b, f, 30.0)) }) acc += a to b
        acc
    }
    val bows = drawnHops.map { (a, b) -> flightArc(a, b) }.toMutableList()
    val pieces = trip.segments.ifEmpty { listOf(trip.route.ifEmpty { trip.stops.map { it.at } }) }
    for (piece in pieces) {
        var run = mutableListOf<LonLat>()
        piece.forEachIndexed { i, b ->
            val a = piece.getOrNull(i - 1)
            if (a != null) {
                val km = angle(a, b) * 111.2
                if (km > 400 || planned(a, b) && km > 150) {
                    if (run.size >= 2) ground += run
                    if (!planned(a, b)) { if (km > 1800) bows += flightArc(a, b) else ground += listOf(a, b) }
                    run = mutableListOf()
                }
            }
            run += b
        }
        if (run.size >= 2) ground += run
    }
    val route = GeoJsonSource("route", FeatureCollection.fromFeatures(ground.map { Feature.fromGeometry(lineOf(it)) }))
    val flights = GeoJsonSource("flights", FeatureCollection.fromFeatures(bows.map { Feature.fromGeometry(lineOf(it)) }))
    val stops = GeoJsonSource("stops", FeatureCollection.fromFeatures(trip.stops.map { Feature.fromGeometry(Point.fromLngLat(it.at.first, it.at.second)) }))
    // Where a flight starts and ends, a small grey airport dot, as on the web, unless the city's own pin is
    // already there (within 55 km), so the bow never starts out of nowhere.
    val ends = bows.flatMap { listOfNotNull(it.firstOrNull(), it.lastOrNull()) }
        .distinctBy { "%.2f,%.2f".format(java.util.Locale.ROOT, it.first, it.second) }
        .filter { p -> trip.stops.none { haversineKm(it.at, p) <= 55.0 } }
    val airports = GeoJsonSource("airports", FeatureCollection.fromFeatures(ends.map { Feature.fromGeometry(Point.fromLngLat(it.first, it.second)) }))
    style.addSource(route); style.addSource(flights); style.addSource(stops); style.addSource(airports)

    // A soft wide band under the line keeps it readable on busy streets.
    style.addLayer(LineLayer("route-halo", "route").withProperties(
        lineColor(if (dark) AColor.BLACK else AColor.WHITE), lineWidth(7f), lineOpacity(0.7f),
        lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND),
    ))
    style.addLayer(LineLayer("route-line", "route").withProperties(
        lineColor(color), lineWidth(3.5f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND),
        *(if (trip.upcoming) arrayOf(lineDasharray(arrayOf(0.1f, 2.2f))) else emptyArray()),
    ))
    // A flight is a grey dashed bow, as on the web: the arc is drawn, not recorded, so it never takes the
    // trip's colour. Short dashes with clear gaps (a round cap adds half the width to each end), so it reads
    // as dashes and not as one line.
    val flightGrey = if (dark) AColor.parseColor("#9AA4B3") else AColor.parseColor("#8A94A3")
    style.addLayer(LineLayer("flight-line", "flights").withProperties(
        lineColor(flightGrey), lineWidth(2.2f), lineDasharray(arrayOf(1.2f, 3.4f)), lineCap(Property.LINE_CAP_ROUND),
    ))
    style.addLayer(CircleLayer("airport-dots", "airports").withProperties(
        circleRadius(4.5f), circleColor(flightGrey), circleStrokeColor(if (dark) AColor.BLACK else AColor.WHITE), circleStrokeWidth(2f),
    ))
    style.addLayer(CircleLayer("stop-dots", "stops").withProperties(
        circleRadius(6f), circleColor(color), circleStrokeColor(if (dark) AColor.BLACK else AColor.WHITE), circleStrokeWidth(2.5f),
    ))
}

/**
 * A flight as the web app draws it (lib/arc.ts): the great circle, bowed away
 * from the ground in Mercator space, more for a long flight than a short hop,
 * always to the north so two flights along one corridor never cross.
 */
fun flightArc(from: LonLat, to: LonLat, steps: Int = 48, lift: Double = 1.0): List<LonLat> {
    val rad = Math.PI / 180
    val deg = 180 / Math.PI
    val lon1 = from.first * rad; val lat1 = from.second * rad
    val lon2 = to.first * rad; val lat2 = to.second * rad
    val d = 2 * asin(minOf(1.0, sqrt(sin((lat2 - lat1) / 2).let { it * it } + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2).let { it * it })))
    if (d < 1e-9) return listOf(from, to)
    val base = (0..steps).map { i ->
        val f = i.toDouble() / steps
        val a = sin((1 - f) * d) / sin(d)
        val b = sin(f * d) / sin(d)
        val x = a * cos(lat1) * cos(lon1) + b * cos(lat2) * cos(lon2)
        val y = a * cos(lat1) * sin(lon1) + b * cos(lat2) * sin(lon2)
        val z = a * sin(lat1) + b * sin(lat2)
        doubleArrayOf(atan2(y, x) * deg, atan2(z, sqrt(x * x + y * y)) * deg)
    }
    // Unwrapped, or a flight over the Pacific runs back across the whole map.
    for (i in 1 until base.size) {
        while (base[i][0] - base[i - 1][0] > 180) base[i][0] -= 360.0
        while (base[i][0] - base[i - 1][0] < -180) base[i][0] += 360.0
    }
    fun mercY(lat: Double) = ln(tan(Math.PI / 4 + (lat.coerceIn(-85.0, 85.0) * rad) / 2)) * deg
    fun unmercY(y: Double) = (2 * atan(exp(y * rad)) - Math.PI / 2) * deg
    val ax = base[0][0]; val ay = mercY(base[0][1])
    val bx = base[steps][0]; val by = mercY(base[steps][1])
    val chord = hypot(bx - ax, by - ay).takeIf { it > 0 } ?: 1.0
    var nx = -(by - ay) / chord
    var ny = (bx - ax) / chord
    if (ny < 0) { nx = -nx; ny = -ny }
    val bow = lift * chord * (0.06 + 0.16 * minOf(1.0, (d * deg) / 70))
    return base.mapIndexed { i, (lng, lat) ->
        val k = bow * sin(Math.PI * i / steps)
        (lng + nx * k) to unmercY(mercY(lat) + ny * k)
    }
}

/** Distance over the earth's surface in kilometres. */
private fun haversineKm(a: LonLat, b: LonLat): Double {
    val r = 6371.0
    val dLat = Math.toRadians(b.second - a.second); val dLon = Math.toRadians(b.first - a.first)
    val h = kotlin.math.sin(dLat / 2).let { it * it } + kotlin.math.cos(Math.toRadians(a.second)) * kotlin.math.cos(Math.toRadians(b.second)) * kotlin.math.sin(dLon / 2).let { it * it }
    return 2 * r * kotlin.math.asin(kotlin.math.sqrt(h))
}


/**
 * Your photos on the map, as on the web: round thumbnails where they were taken, grouped on a grid that
 * gets finer as you zoom in (the level rounded, so a pan never regroups them), with a count on a group. A
 * single photo opens it; a group zooms in to split it. Each sits on its first photo's own spot.
 */
@androidx.compose.runtime.Composable
private fun PhotoMarkers(map: org.maplibre.android.maps.MapLibreMap?, tick: Int, photos: List<Media>, trip: Trip, onPhoto: (Media) -> Unit) {
    val m = map ?: return
    val located = androidx.compose.runtime.remember(photos) { photos.filter { it.lat != null && it.lon != null && !it.video } }
    if (located.isEmpty()) return
    @Suppress("UNUSED_EXPRESSION") tick
    // The grouping only changes on a whole zoom step, so it is worked out once per step, not on every frame;
    // a frame only moves the markers to their places on screen.
    val level = kotlin.math.round(m.cameraPosition.zoom).toInt()
    val clusters = androidx.compose.runtime.remember(located, level) {
        val cell = 40.0 / Math.pow(2.0, level.toDouble())
        located.groupBy { "${kotlin.math.round(it.lat!! / cell)}:${kotlin.math.round(it.lon!! / cell)}" }.toList()
    }
    // A group that splits or merges does so softly: the new markers grow out of the spot of the group they came
    // from (or towards the one they join) instead of blinking in and out.
    val previous = androidx.compose.runtime.remember { mutableMapOf<String, LonLat>() }
    val density = androidx.compose.ui.platform.LocalDensity.current
    val cs = androidx.compose.material3.MaterialTheme.colorScheme
    val ring = legibleColor(trip.color, cs.background.luminance() < 0.5f)
    val motion = androidx.compose.material3.MaterialTheme.motionScheme
    clusters.forEach { (key, items) ->
        val first = items.first()
        val target = first.lon!! to first.lat!!
        androidx.compose.runtime.key(key) {
            // Where it starts: the nearest marker of the last grouping, so it slides out of (or into) it.
            val from = androidx.compose.runtime.remember { previous.values.minByOrNull { (it.first - target.first) * (it.first - target.first) + (it.second - target.second) * (it.second - target.second) } ?: target }
            val t = androidx.compose.runtime.remember { androidx.compose.animation.core.Animatable(if (from == target) 1f else 0f) }
            androidx.compose.runtime.LaunchedEffect(Unit) { t.animateTo(1f, motion.defaultSpatialSpec()) }
            val k = t.value
            val at = org.maplibre.android.geometry.LatLng(from.second + (target.second - from.second) * k, from.first + (target.first - from.first) * k)
            val p = m.projection.toScreenLocation(at)
            val size = 44.dp
            val half = with(density) { (size / 2).toPx() }
            androidx.compose.foundation.layout.Box(
                Modifier.offset { androidx.compose.ui.unit.IntOffset((p.x - half).toInt(), (p.y - half).toInt()) }.size(size)
                    .graphicsLayer { val sc = 0.6f + 0.4f * k; scaleX = sc; scaleY = sc; alpha = (0.3f + 0.7f * k).coerceIn(0f, 1f) }
                    .clip(androidx.compose.foundation.shape.CircleShape).background(cs.surfaceContainerHigh)
                    .border(3.dp, ring, androidx.compose.foundation.shape.CircleShape)
                    .clickable {
                        if (items.size == 1) onPhoto(first)
                        else m.animateCamera(org.maplibre.android.camera.CameraUpdateFactory.newLatLngZoom(org.maplibre.android.geometry.LatLng(first.lat, first.lon), (m.cameraPosition.zoom + 2.5).coerceAtMost(16.0)), 450)
                    },
            ) {
                RemotePhoto(first.id, Modifier.matchParentSize())
            }
            if (items.size > 1) androidx.compose.material3.Text(
                if (items.size > 99) "99+" else "${items.size}",
                style = androidx.compose.ui.text.TextStyle(fontFamily = Outfit, fontWeight = androidx.compose.ui.text.font.FontWeight(700), fontSize = 11.sp, color = cs.onPrimary),
                modifier = Modifier.offset { androidx.compose.ui.unit.IntOffset((p.x + half * 0.45f).toInt(), (p.y - half * 1.15f).toInt()) }
                    .graphicsLayer { alpha = k }
                    .clip(androidx.compose.foundation.shape.CircleShape).background(ring).padding(horizontal = 6.dp, vertical = 1.dp),
            )
        }
    }
    androidx.compose.runtime.SideEffect {
        previous.clear()
        clusters.forEach { (key, items) -> previous[key] = items.first().lon!! to items.first().lat!! }
    }
}

/** Place names in Dutch where the map knows them (name:nl), else the Latin spelling, else the local name. */
fun dutchLabels(style: Style) {
    for (layer in style.layers) {
        if (layer !is org.maplibre.android.style.layers.SymbolLayer) continue
        val field = runCatching { layer.textField.expression?.toString() ?: layer.textField.value?.toString() }.getOrNull() ?: continue
        if (!field.contains("name")) continue
        layer.setProperties(org.maplibre.android.style.layers.PropertyFactory.textField(
            org.maplibre.android.style.expressions.Expression.coalesce(
                org.maplibre.android.style.expressions.Expression.get("name:nl"),
                org.maplibre.android.style.expressions.Expression.get("name:latin"),
                org.maplibre.android.style.expressions.Expression.get("name"),
            ),
        ))
    }
}
