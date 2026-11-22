package nl.markmaaktmedia.markmysteps.next

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/*
 * The home globe's motion, after GlobeBackdrop.tsx: the camera springs, the
 * idle sweep, the auto tour (a wide overview, then one trip framed while a
 * light runs its journey, then back out) and the tapped trip. Plain state,
 * stepped once per frame by Globe.kt, which does all the drawing.
 */

internal const val CENTER_LAT = 38.0
/** How far a pinch goes; the tour itself never passes about 3.4. */
private const val MAX_ZOOM = 12.0
private const val IDLE_MS = 1400.0
private const val OVERVIEW_MS = 6000.0
private const val FOCUS_MS = 6500.0
/** Gentle idle sweep, in degrees per 60 Hz frame as on the web. */
private const val SWEEP = 0.02
/** Standing still after landing somewhere: two rings' worth on the web. */
private const val AIR_ARRIVAL_MS = 2700.0
private const val TAKEOFF_MS = 800.0
private const val LAYOVER_MS = 450.0
private const val END_MS = 1500.0
/** Shorter than this a journey is a city trip: rings instead of a light. */
internal const val RIBBON_MIN_DEG = 1.2
private const val PAUSE_DEG = 1.2
private const val LEG_JOIN_DEG = 0.8
private const val FLY_GAP_DEG = 3.5
/** Moved further than this (dp) it was a drag, not a tap. */
internal const val TAP_SLOP_DP = 8f

internal sealed class JourneyLeg {
    abstract val len: Double
}

internal class GroundLeg(val pts: List<LonLat>, val cum: DoubleArray, override val len: Double) : JourneyLeg()

internal class FlightLeg(val a: LonLat, val b: LonLat, override val len: Double, val layoverAfter: Boolean) : JourneyLeg()

private fun groundLeg(pts: List<LonLat>): GroundLeg {
    val cum = DoubleArray(pts.size)
    for (i in 1 until pts.size) cum[i] = cum[i - 1] + angle(pts[i - 1], pts[i])
    return GroundLeg(pts, cum, cum.last())
}

private fun JourneyLeg.start(): LonLat = if (this is GroundLeg) pts.first() else (this as FlightLeg).a
private fun JourneyLeg.end(): LonLat = if (this is GroundLeg) pts.last() else (this as FlightLeg).b

/** Closes the gaps between legs so the light never jumps; a wide one was flown. */
private fun stitch(legs: List<JourneyLeg>): List<JourneyLeg> {
    val out = ArrayList<JourneyLeg>()
    for (leg in legs) {
        val prev = out.lastOrNull()
        if (prev != null) {
            val from = prev.end()
            val to = leg.start()
            val gap = angle(from, to)
            if (gap > FLY_GAP_DEG) out += FlightLeg(from, to, gap, false)
            else if (gap > 0.05) out += groundLeg(listOf(from, to))
        }
        out += leg
    }
    return out
}

private class Arrival(val at: Double, val ms: Double)

/** A point on the great circle from [a] to [b], [f] of the way along. */
internal fun slerp(a: LonLat, b: LonLat, f: Double, out: DoubleArray) {
    val rad = PI / 180
    val l1 = a.first * rad
    val p1 = a.second * rad
    val l2 = b.first * rad
    val p2 = b.second * rad
    val x1 = cos(p1) * cos(l1)
    val y1 = cos(p1) * sin(l1)
    val z1 = sin(p1)
    val x2 = cos(p2) * cos(l2)
    val y2 = cos(p2) * sin(l2)
    val z2 = sin(p2)
    val omega = acos((x1 * x2 + y1 * y2 + z1 * z2).coerceIn(-1.0, 1.0))
    if (omega < 1e-9) {
        out[0] = a.first
        out[1] = a.second
        return
    }
    val s1 = sin((1 - f) * omega) / sin(omega)
    val s2 = sin(f * omega) / sin(omega)
    val x = s1 * x1 + s2 * x2
    val y = s1 * y1 + s2 * y2
    val z = s1 * z1 + s2 * z2
    out[0] = atan2(y, x) / rad
    out[1] = atan2(z, sqrt(x * x + y * y)) / rad
}

/** A trip as the tour sees it: where to look, how far in, and its journey in order. */
internal class TourTrip(val trip: Trip) {
    val id = trip.id
    val segments: List<List<LonLat>> = trip.segments.ifEmpty { if (trip.route.size >= 2) listOf(trip.route) else emptyList() }
    val flights: List<List<LonLat>> = trip.flightLegs.ifEmpty { trip.flights.map { listOf(it.first, it.second) } }
    val anchor: LonLat = trip.route.firstOrNull() ?: trip.stops.firstOrNull()?.at ?: HomeAirport
    val size: Double = trip.km?.takeIf { it > 0 }?.toDouble() ?: (trip.days * 40.0)

    /** The middle of everything the trip touches, as unit vectors (safe across the date line). */
    val centre: LonLat
    val spread: Double

    init {
        val points = segments.flatten() + flights.flatten()
        if (points.isEmpty()) {
            centre = anchor
            spread = 0.0
        } else {
            val rad = PI / 180
            var x = 0.0
            var y = 0.0
            var z = 0.0
            for ((lng, lat) in points) {
                x += cos(lat * rad) * cos(lng * rad)
                y += cos(lat * rad) * sin(lng * rad)
                z += sin(lat * rad)
            }
            centre = atan2(y, x) / rad to atan2(z, hypot(x, y)) / rad
            spread = points.maxOf { angle(centre, it) }
        }
    }

    /** Path and flights chained by matching ends; the first leg is the one nothing ends at. */
    val legs: List<JourneyLeg> by lazy {
        val all = ArrayList<JourneyLeg>()
        for (seg in segments) if (seg.size >= 2) all += groundLeg(seg)
        for (it in flights) for (i in 1 until it.size) {
            all += FlightLeg(it[i - 1], it[i], angle(it[i - 1], it[i]), i < it.size - 1)
        }
        if (all.size <= 1) return@lazy all
        val rest = all.toMutableList()
        var first = rest.indexOfFirst { leg -> rest.all { o -> o === leg || angle(o.end(), leg.start()) > LEG_JOIN_DEG } }
        if (first < 0) first = 0
        val chain = arrayListOf(rest.removeAt(first))
        while (rest.isNotEmpty()) {
            val tail = chain.last().end()
            var best = 0
            var bestD = Double.MAX_VALUE
            rest.forEachIndexed { i, l ->
                val d = angle(tail, l.start())
                if (d < bestD) {
                    bestD = d
                    best = i
                }
            }
            chain += rest.removeAt(best)
        }
        stitch(chain)
    }

    val total: Double by lazy { legs.sumOf { it.len } }

    /** Where the light waits between legs: a landing, a layover, a take-off. */
    val arrivals: List<Arrival> by lazy {
        val out = ArrayList<Arrival>()
        var walked = 0.0
        var carriedAir = false
        for (i in 0 until legs.size - 1) {
            walked += legs[i].len
            if (legs[i + 1].len <= 0.25) {
                val hop = legs[i]
                if (hop is FlightLeg && !hop.layoverAfter) carriedAir = true
                continue
            }
            val here = legs[i]
            val layover = here is FlightLeg && here.layoverAfter
            val byAir = (here is FlightLeg && !layover) || carriedAir
            carriedAir = false
            val takingOff = legs[i + 1] is FlightLeg
            val ms = when {
                layover -> LAYOVER_MS
                byAir -> AIR_ARRIVAL_MS
                takingOff -> TAKEOFF_MS
                else -> 0.0
            }
            if (ms > 0) out += Arrival(walked, ms)
        }
        out
    }

    /** One pass for anything that shows itself as it goes, two for a plain A to B. */
    val runsNeeded: Int by lazy {
        if (legs.any { it is FlightLeg } || arrivals.size >= 2) 1 else if (total > 40) 1 else 2
    }

    /**
     * Where the head is [d] degrees into the journey. Writes lon, lat, flying
     * (1 or 0), the fraction into its leg and the leg's index into [out].
     */
    fun at(d: Double, out: DoubleArray): Boolean {
        if (legs.isEmpty()) return false
        val want = d.coerceIn(0.0, total)
        var acc = 0.0
        for (i in legs.indices) {
            val leg = legs[i]
            if (want > acc + leg.len && i < legs.size - 1) {
                acc += leg.len
                continue
            }
            val f = if (leg.len > 0) ((want - acc) / leg.len).coerceIn(0.0, 1.0) else 0.0
            out[3] = f
            out[4] = i.toDouble()
            if (leg is GroundLeg) {
                val along = f * leg.len
                var k = 0
                while (k < leg.cum.size - 1 && leg.cum[k + 1] < along) k++
                val a = leg.pts[k]
                val b = leg.pts.getOrElse(k + 1) { a }
                val span = leg.cum.getOrElse(k + 1) { leg.cum[k] } - leg.cum[k]
                val g = if (span > 0) (along - leg.cum[k]) / span else 0.0
                out[0] = a.first + (b.first - a.first) * g
                out[1] = a.second + (b.second - a.second) * g
                out[2] = 0.0
            } else {
                leg as FlightLeg
                slerp(leg.a, leg.b, f, out)
                out[2] = 1.0
            }
            return true
        }
        return false
    }
}

/** Everything that moves on the home globe, stepped once per frame. */
internal class GlobeMotion(startLon: Double) {
    var now = 0.0
    var rotation = -startLon
    var tilt = 0.0
    var scale = 1.0
    private var targetScale = 1.0
    private var scaleV = 0.0
    private var tiltV = 0.0
    private var rotV = 0.0
    private var sweepDir = 1
    var dragging = false
    /** Long ago, so the globe starts out idle. */
    var lastInteract = -1e9
    // Inertia after a drag (not on the web, which simply stops).
    private var flingRot = 0.0
    private var flingTilt = 0.0

    private var tourPhase = 0
    private var phaseStart = 0.0
    private var tourIdx = 0
    private var lastFocusId: String? = null
    private val tourQueue = ArrayDeque<String>()
    var selectedId: String? = null

    var glowDist = 0.0
    private var glowRuns = 0
    private var glowRunsNeeded = 2
    private var holdUntil = 0.0
    private var glowTripId: String? = null

    /** The trip on show: the tapped one, else the one the tour frames. */
    var active: TourTrip? = null
        private set
    /** 0 = every trip equal, 1 = one shown and the rest stepped back. */
    var focus = 0f
        private set
    var recedeId: String? = null
        private set
    val stopReveal = HashMap<String, Float>()
    /** The plane's heading in degrees, eased; NaN while on the ground. */
    var planeAngle = Float.NaN

    // The name card: one trip at a time, faded out before the next fades in.
    var cardTripId: String? = null
        private set
    var cardOpacity = 0f
        private set

    /** Critically damped step toward a target; the new velocity lands in [easeV]. */
    private var easeV = 0.0
    private fun ease(value: Double, velocity: Double, target: Double, stiffness: Double, dt: Double): Double {
        val damping = 2 * sqrt(stiffness)
        val accel = -stiffness * (value - target) - damping * velocity
        easeV = velocity + accel * dt
        return value + easeV * dt
    }

    fun standing(id: String): Float = if (recedeId != null && id != recedeId) 1 - focus else 1f

    fun drag(dxDp: Float, dyDp: Float) {
        // Slower when zoomed in, so it stays controllable.
        rotation += dxDp * 0.25 / scale
        tilt = (tilt + dyDp * 0.25 / scale).coerceIn(-60.0, 60.0)
    }

    fun pinch(ratio: Float) {
        targetScale = (targetScale * ratio).coerceIn(1.0, MAX_ZOOM)
    }

    fun fling(vxDp: Float, vyDp: Float) {
        flingRot = (vxDp * 0.25 / scale).coerceIn(-240.0, 240.0)
        flingTilt = (vyDp * 0.25 / scale).coerceIn(-120.0, 120.0)
    }

    fun stopFling() {
        flingRot = 0.0
        flingTilt = 0.0
    }

    /** A tap at [hit]; off the globe or near no trip clears the selection, a second tap toggles. */
    fun tap(hit: LonLat?, trips: List<TourTrip>) {
        if (hit == null) {
            selectedId = null
            return
        }
        var best: TourTrip? = null
        var bestD = 6 / scale
        for (t in trips) {
            var d = angle(hit, t.anchor)
            for (seg in t.segments) for (p in seg) d = min(d, angle(hit, p))
            if (d < bestD) {
                bestD = d
                best = t
            }
        }
        selectedId = if (best == null || selectedId == best.id) null else best.id
    }

    fun step(nowMs: Double, dt: Double, trips: List<TourTrip>) {
        now = nowMs
        val idle = !dragging && now - lastInteract > IDLE_MS

        if (!dragging && (flingRot != 0.0 || flingTilt != 0.0)) {
            rotation += flingRot * dt
            tilt = (tilt + flingTilt * dt).coerceIn(-60.0, 60.0)
            val decay = exp(-4.5 * dt)
            flingRot *= decay
            flingTilt *= decay
            if (abs(flingRot) < 0.05 && abs(flingTilt) < 0.05) stopFling()
        }

        // A tap counts as watching, not as interrupting.
        if (!idle && selectedId == null) {
            phaseStart = now
            tourPhase = 0
        } else if (trips.isNotEmpty()) {
            val dur = if (tourPhase == 0) OVERVIEW_MS else FOCUS_MS
            val tapped = selectedId?.let { id -> trips.indexOfFirst { it.id == id } } ?: -1
            if (tapped >= 0) {
                if (tourPhase != 1 || lastFocusId != selectedId) {
                    tourPhase = 1
                    tourIdx = tapped
                    lastFocusId = selectedId
                    glowDist = 0.0
                    glowRuns = 0
                    holdUntil = 0.0
                    phaseStart = now
                } else if (glowRuns >= glowRunsNeeded || now - phaseStart > dur * 5) {
                    // Its journey has been shown: let go and pull back out.
                    selectedId = null
                    tourPhase = 0
                    phaseStart = now
                }
            } else if (now - phaseStart > dur) {
                if (tourPhase == 0) {
                    tourPhase = 1
                    // A fresh shuffle each round, never opening with the trip it just closed with.
                    if (tourQueue.isEmpty()) {
                        val ids = trips.map { it.id }.shuffled().toMutableList()
                        if (ids.size > 1 && ids[0] == lastFocusId) ids[0] = ids[1].also { ids[1] = ids[0] }
                        tourQueue.addAll(ids)
                    }
                    val nextId = tourQueue.removeFirst()
                    tourIdx = trips.indexOfFirst { it.id == nextId }.coerceAtLeast(0)
                    lastFocusId = trips[tourIdx].id
                    selectedId = null
                    glowDist = 0.0
                    glowRuns = 0
                    holdUntil = 0.0
                    phaseStart = now
                } else if (glowRuns >= glowRunsNeeded || now - phaseStart > dur * 5) {
                    // Held until the light has run the whole route, with a ceiling.
                    tourPhase = 0
                    phaseStart = now
                }
            }

            if (tourPhase == 0) {
                // Overview: a pendulum sweep across all trips, easing back out.
                var lo = Double.MAX_VALUE
                var hi = -Double.MAX_VALUE
                for (t in trips) {
                    lo = min(lo, t.anchor.first)
                    hi = max(hi, t.anchor.first)
                }
                val centerLng = -rotation
                if (centerLng <= lo - 35) sweepDir = 1 else if (centerLng >= hi + 35) sweepDir = -1
                if (!dragging) rotation -= SWEEP * sweepDir * dt * 60
                targetScale = 1.0
                scale = ease(scale, scaleV, targetScale, 5.2, dt).also { scaleV = easeV }
                tilt = ease(tilt, tiltV, 0.0, 5.2, dt).also { tiltV = easeV }
            } else {
                // Focus: the middle of the whole trip, a zoom from how far it reaches.
                val trip = trips[min(tourIdx, trips.size - 1)]
                val zoom = max(1.5, min(3.4, 46 / (trip.spread + 9)))
                // The finger is in charge while it is down.
                if (!dragging) {
                    val shortest = ((-trip.centre.first - rotation + 540) % 360 + 360) % 360 - 180
                    rotation = ease(rotation, rotV, rotation + shortest, 2.4, dt).also { rotV = easeV }
                    // A touch above centre: the fade eats the lower third.
                    tilt = ease(tilt, tiltV, trip.centre.second - CENTER_LAT - 3, 5.2, dt).also { tiltV = easeV }
                }
                targetScale = zoom
                scale = ease(scale, scaleV, targetScale, 5.2, dt).also { scaleV = easeV }
            }
        }
        // Pinching sets the target directly; catch up quickly, the finger leads.
        if (!idle || trips.isEmpty()) scale = ease(scale, scaleV, targetScale, 26.0, dt).also { scaleV = easeV }

        val activeId = selectedId ?: if (idle && tourPhase == 1) trips.getOrNull(min(tourIdx, trips.size - 1))?.id else null
        active = activeId?.let { id -> trips.firstOrNull { it.id == id } }

        // The rest step back, eased, and come back the same way.
        if (activeId != null) recedeId = activeId
        focus += ((if (activeId != null) 1f else 0f) - focus) * (1 - 0.004.pow(dt)).toFloat()
        if (focus < 0.002f) recedeId = null

        stepGlow(activeId, dt)
        stepStops(trips, activeId, dt)
        stepCard(activeId, dt)
    }

    private val scratch = DoubleArray(5)

    private fun stepGlow(activeId: String?, dt: Double) {
        // Every highlight starts its trip over.
        if (activeId != glowTripId) {
            glowDist = 0.0
            glowRuns = 0
            holdUntil = 0.0
            glowTripId = activeId
            planeAngle = Float.NaN
        }
        val act = active ?: return
        if (act.legs.isNotEmpty() && act.total > RIBBON_MIN_DEG) {
            val total = act.total
            val trail = trailOf(act)
            // A pace with a floor and a ceiling, in degrees per 60 Hz frame.
            val speed = min(0.14, max(0.07, total / (7 * 60)))
            glowRunsNeeded = act.runsNeeded
            if (glowRuns < glowRunsNeeded && now >= holdUntil) {
                // Away from a stop and up to speed, then off it again at the next.
                val legF = if (act.at(glowDist, scratch)) scratch[3] else 0.5
                val pace = if (glowDist >= total) 1.5 else 0.28 + 0.72 * max(0.0, sin(PI * legF)).pow(0.55)
                val before = glowDist
                glowDist += speed * pace * (dt * 60)
                for (arrival in act.arrivals) {
                    if (before < arrival.at && glowDist >= arrival.at) {
                        glowDist = arrival.at
                        holdUntil = now + arrival.ms
                        break
                    }
                }
                // The last stop is an arrival too.
                if (before < total && glowDist > total) {
                    glowDist = total
                    holdUntil = now + if (act.legs.last() is FlightLeg) AIR_ARRIVAL_MS else END_MS
                }
                if (glowDist > total + trail + PAUSE_DEG) {
                    if (glowRuns + 1 < glowRunsNeeded) glowDist = 0.0
                    glowRuns += 1
                }
            }
        } else {
            // A city trip has no route to run: its rings play for a while instead.
            glowRunsNeeded = 2
            if (now - phaseStart > 5400) glowRuns = glowRunsNeeded
        }
    }

    fun trailOf(act: TourTrip): Double = min(6.0, act.total * 0.22)

    private fun stepStops(trips: List<TourTrip>, activeId: String?, dt: Double) {
        for (t in trips) {
            if (t.trip.stops.isEmpty()) continue
            val want = if (t.id == activeId) 1f else 0f
            val cur = stopReveal[t.id] ?: 0f
            if (cur == want) continue
            // Quicker to appear than to leave.
            val k = (1 - (if (want > cur) 0.03 else 0.12).pow(dt)).toFloat()
            var next = cur + (want - cur) * k
            if (want == 0f && next < 0.005f) next = 0f
            stopReveal[t.id] = next
        }
    }

    /** Whether the card's dot is on the near side this frame, set by Globe.kt. */
    var cardVisible = false

    private fun stepCard(activeId: String?, dt: Double) {
        if (activeId != cardTripId) {
            // Fold the old card away first; the new one opens once it is gone.
            cardOpacity += (0f - cardOpacity) * perFrame(0.13, dt)
            if (cardOpacity < 0.03f) {
                cardTripId = activeId
                cardOpacity = 0f
            }
        } else if (cardTripId != null) {
            val target = if (cardVisible) 1f else 0f
            // Eases in slower than it fades out: appearing was a pop.
            cardOpacity += (target - cardOpacity) * perFrame(if (target > cardOpacity) 0.055 else 0.13, dt)
        }
    }

    /** A per-frame lerp factor from the web's 60 Hz loop, made frame-rate independent. */
    private fun perFrame(k: Double, dt: Double): Float = (1 - (1 - k).pow(dt * 60)).toFloat()
}
