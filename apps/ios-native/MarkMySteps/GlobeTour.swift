import SwiftUI
import UIKit

/*
 * The globe's tour, ported from Android's GlobeTour.kt and Globe.kt (after the web's GlobeBackdrop): a wide
 * overview sweeping across the trips, then one trip framed while its journey is travelled. Along the ground a
 * head of light with a fading ribbon; along a flight a grey contrail and a small plane flying the bow and
 * landing; a city trip gets breathing rings. The rest of the trips step back, the stops of the trip on show pop
 * in one after another, and its name card unfolds from its dot. One engine for every globe (the homepage and
 * the login page), and everything that does not move is worked out once, not every frame.
 */

private let centerLat = 38.0
private let maxZoom: CGFloat = 12
private let idleSeconds = 1.4
private let overviewSeconds = 6.0
private let focusSeconds = 6.5
/// Gentle idle sweep, degrees per 60 Hz frame as on the web.
private let sweep = 0.02
private let airArrival = 2.7
private let takeoff = 0.8
private let layover = 0.45
private let endHold = 1.5
/// Shorter than this a journey is a city trip: rings instead of a light.
private let ribbonMinDeg = 1.2
private let pauseDeg = 1.2
private let legJoinDeg = 0.8
private let flyGapDeg = 3.5

// MARK: Journey

enum JourneyLeg {
    case ground(pts: [LonLat], cum: [Double], len: Double)
    case flight(a: LonLat, b: LonLat, len: Double, layoverAfter: Bool)

    var len: Double {
        switch self {
        case .ground(_, _, let l): l
        case .flight(_, _, let l, _): l
        }
    }
    var start: LonLat {
        switch self {
        case .ground(let p, _, _): p[0]
        case .flight(let a, _, _, _): a
        }
    }
    var end: LonLat {
        switch self {
        case .ground(let p, _, _): p[p.count - 1]
        case .flight(_, let b, _, _): b
        }
    }
    var isFlight: Bool { if case .flight = self { true } else { false } }

    static func ground(_ pts: [LonLat]) -> JourneyLeg {
        var cum = [0.0]
        for i in pts.indices.dropFirst() { cum.append(cum[i - 1] + Geo.angle(pts[i - 1], pts[i])) }
        return .ground(pts: pts, cum: cum, len: cum.last ?? 0)
    }
}

/// A point on the great circle from a to b, f of the way along.
func slerp(_ a: LonLat, _ b: LonLat, _ f: Double) -> LonLat {
    let r = Geo.rad
    let x1 = cos(a.lat * r) * cos(a.lon * r), y1 = cos(a.lat * r) * sin(a.lon * r), z1 = sin(a.lat * r)
    let x2 = cos(b.lat * r) * cos(b.lon * r), y2 = cos(b.lat * r) * sin(b.lon * r), z2 = sin(b.lat * r)
    let omega = acos(min(1, max(-1, x1 * x2 + y1 * y2 + z1 * z2)))
    if omega < 1e-9 { return a }
    let s1 = sin((1 - f) * omega) / sin(omega), s2 = sin(f * omega) / sin(omega)
    let x = s1 * x1 + s2 * x2, y = s1 * y1 + s2 * y2, z = s1 * z1 + s2 * z2
    return LonLat(atan2(y, x) / r, atan2(z, (x * x + y * y).squareRoot()) / r)
}

/// How high a flight's bow is at t of the way: higher for a longer flight.
func bowLift(_ span: Double, _ t: Double) -> Double { min(0.22, span / 180 * 0.9) * sin(.pi * t) }

/// A trip as the tour sees it: where to look, how far in, and its journey in order.
final class TourTrip {
    let trip: Trip
    var id: String { trip.id }
    let segments: [[LonLat]]
    let flights: [[LonLat]]
    let anchor: LonLat
    let hitPoints: [LonLat]
    let centre: LonLat
    let spread: Double
    let legs: [JourneyLeg]
    let total: Double
    let arrivals: [(at: Double, seconds: Double)]
    let runsNeeded: Int

    init(_ trip: Trip) {
        self.trip = trip
        // A server trip without a recorded route has no path, as on the web; demo trips only have `route`.
        if trip.remoteId != nil { segments = trip.segments }
        else if !trip.segments.isEmpty { segments = trip.segments }
        else if trip.route.count >= 2 { segments = [trip.route] }
        else { segments = [] }
        flights = trip.flights.map { [$0.from, $0.to] }
        anchor = trip.route.first ?? trip.stops.first?.at ?? Demo.homeAirport
        var hits = [anchor]
        for s in segments { hits += s }
        hits += trip.stops.map(\.at)
        for f in flights { for p in [f[0], f[f.count - 1]] where Geo.angle(p, Demo.homeAirport) >= 0.4 { hits.append(p) } }
        hitPoints = hits

        let points = segments.flatMap { $0 } + flights.flatMap { $0 }
        if points.isEmpty {
            centre = anchor
            spread = 0
        } else {
            var x = 0.0, y = 0.0, z = 0.0
            for p in points {
                x += cos(p.lat * Geo.rad) * cos(p.lon * Geo.rad); y += cos(p.lat * Geo.rad) * sin(p.lon * Geo.rad); z += sin(p.lat * Geo.rad)
            }
            let c = LonLat(atan2(y, x) / Geo.rad, atan2(z, (x * x + y * y).squareRoot()) / Geo.rad)
            centre = c
            spread = points.map { Geo.angle(c, $0) }.max() ?? 0
        }

        // Path and flights chained by matching ends; the first leg is the one nothing ends at.
        var all: [JourneyLeg] = []
        for seg in segments where seg.count >= 2 { all.append(.ground(seg)) }
        for f in flights { for i in f.indices.dropFirst() { all.append(.flight(a: f[i - 1], b: f[i], len: Geo.angle(f[i - 1], f[i]), layoverAfter: i < f.count - 1)) } }
        var chain: [JourneyLeg] = []
        if all.count <= 1 {
            chain = all
        } else {
            var rest = all
            var first = rest.indices.first { i in rest.indices.allSatisfy { o in o == i || Geo.angle(rest[o].end, rest[i].start) > legJoinDeg } } ?? 0
            if first >= rest.count { first = 0 }
            chain = [rest.remove(at: first)]
            while !rest.isEmpty {
                let tail = chain[chain.count - 1].end
                var best = 0, bestD = Double.greatestFiniteMagnitude
                for (i, l) in rest.enumerated() {
                    let d = Geo.angle(tail, l.start)
                    if d < bestD { bestD = d; best = i }
                }
                chain.append(rest.remove(at: best))
            }
            // Close the gaps so the light never jumps; a wide one was flown.
            var stitched: [JourneyLeg] = []
            for leg in chain {
                if let prev = stitched.last {
                    let gap = Geo.angle(prev.end, leg.start)
                    if gap > flyGapDeg { stitched.append(.flight(a: prev.end, b: leg.start, len: gap, layoverAfter: false)) }
                    else if gap > 0.05 { stitched.append(.ground([prev.end, leg.start])) }
                }
                stitched.append(leg)
            }
            chain = stitched
        }
        legs = chain
        total = chain.reduce(0) { $0 + $1.len }

        // Where the light waits between legs: a landing, a layover, a take-off.
        var out: [(Double, Double)] = []
        var walked = 0.0
        var carriedAir = false
        if chain.count > 1 {
            for i in 0..<(chain.count - 1) {
                walked += chain[i].len
                if chain[i + 1].len <= 0.25 {
                    if case .flight(_, _, _, let lay) = chain[i], !lay { carriedAir = true }
                    continue
                }
                var isLayover = false
                if case .flight(_, _, _, let lay) = chain[i] { isLayover = lay }
                let byAir = (chain[i].isFlight && !isLayover) || carriedAir
                carriedAir = false
                let takingOff = chain[i + 1].isFlight
                let seconds = isLayover ? layover : byAir ? airArrival : takingOff ? takeoff : 0
                if seconds > 0 { out.append((walked, seconds)) }
            }
        }
        arrivals = out.map { (at: $0.0, seconds: $0.1) }
        runsNeeded = (chain.contains { $0.isFlight } || out.count >= 2 || total > 40) ? 1 : 2
    }

    struct Head {
        var at: LonLat
        var flying: Bool
        var f: Double
        var leg: Int
    }

    /// Where the head is d degrees into the journey.
    func head(_ d: Double) -> Head? {
        guard !legs.isEmpty else { return nil }
        let want = min(total, max(0, d))
        var acc = 0.0
        for (i, leg) in legs.enumerated() {
            if want > acc + leg.len && i < legs.count - 1 { acc += leg.len; continue }
            let f = leg.len > 0 ? min(1, max(0, (want - acc) / leg.len)) : 0
            switch leg {
            case .ground(let pts, let cum, let len):
                let along = f * len
                var k = 0
                while k < cum.count - 1 && cum[k + 1] < along { k += 1 }
                let a = pts[k], b = k + 1 < pts.count ? pts[k + 1] : a
                let span = (k + 1 < cum.count ? cum[k + 1] : cum[k]) - cum[k]
                let g = span > 0 ? (along - cum[k]) / span : 0
                return Head(at: LonLat(a.lon + (b.lon - a.lon) * g, a.lat + (b.lat - a.lat) * g), flying: false, f: f, leg: i)
            case .flight(let a, let b, _, _):
                return Head(at: slerp(a, b, f), flying: true, f: f, leg: i)
            }
        }
        return nil
    }
}

// MARK: Scene

/// Everything about the trips that does not move, worked out once: routes, bows, dots, airports, stops.
final class GlobeScene {
    struct Run { let trip: Trip; let pts: [LonLat]; let dashed: Bool }
    struct Bow { let pts: [LonLat]; let lifts: [Double]; var tripIds: Set<String> }
    struct Place { let at: LonLat; var members: [Trip] }

    let key: String
    let trips: [Trip]
    let tour: [TourTrip]
    let runs: [Run]
    let bows: [Bow]
    let places: [Place]
    let airports: [LonLat]
    /// Per trip, its stops that have no dot of their own, in travel order.
    let freeStops: [String: [LonLat]]
    private var colors: [String: Color] = [:]

    static func key(_ trips: [Trip]) -> String {
        trips.map { "\($0.id):\($0.segments.count):\($0.flights.count):\($0.stops.count):\($0.marker.map { "\($0.lon),\($0.lat)" } ?? "")" }.joined(separator: ",")
    }

    init(trips: [Trip]) {
        key = GlobeScene.key(trips)
        self.trips = trips
        tour = trips.map(TourTrip.init).filter { !$0.segments.isEmpty || !$0.flights.isEmpty }

        var runs: [Run] = []
        var rawBows: [(LonLat, LonLat, String)] = []
        var rawAirports: [LonLat] = []
        for trip in trips {
            let pieces = trip.pieces
            for run in pieces.runs { runs.append(Run(trip: trip, pts: GlobeScene.densify(run), dashed: trip.upcoming)) }
            // Ground nobody recorded: straight and dotted, so the line still runs from end to end.
            for gap in pieces.gaps { runs.append(Run(trip: trip, pts: GlobeScene.densify([gap.0, gap.1]), dashed: true)) }
            for b in pieces.bows { rawBows.append((b.0, b.1, trip.id)) }
            rawAirports += pieces.bows.flatMap { [$0.0, $0.1] }
        }
        self.runs = runs

        // Flights: one bow per route however many trips flew it.
        var bows: [Bow] = []
        var bowIndex: [String: Int] = [:]
        for (a, b, id) in rawBows {
            let key = [a, b].map { "\(Int(($0.lon / 1.2).rounded())),\(Int(($0.lat / 1.2).rounded()))" }.sorted().joined(separator: "|")
            if let i = bowIndex[key] { bows[i].tripIds.insert(id); continue }
            let span = Geo.angle(a, b)
            let pts = Geo.greatCircle(a, b, steps: max(12, Int(span / 1.2)))
            let lifts = pts.indices.map { bowLift(span, Double($0) / Double(max(1, pts.count - 1))) }
            bowIndex[key] = bows.count
            bows.append(Bow(pts: pts, lifts: lifts, tripIds: [id]))
        }
        self.bows = bows

        // Places with a dot: route ends and far flight ends, snapped onto a stop and merged.
        var places: [Place] = []
        func add(_ p: LonLat, _ trip: Trip) {
            if let i = places.firstIndex(where: { Geo.angle($0.at, p) < 0.12 }) {
                if !places[i].members.contains(where: { $0.id == trip.id }) { places[i].members.append(trip) }
            } else {
                places.append(Place(at: p, members: [trip]))
            }
        }
        for trip in trips {
            // A dot placed by hand in the trip's settings stands for the whole trip, as on the web.
            if let marker = trip.marker {
                add(marker, trip)
                continue
            }
            var points: [LonLat] = []
            if let f = trip.routePieces.first?.first { points.append(f) }
            if let l = trip.routePieces.last?.last { points.append(l) }
            for f in trip.flights {
                if Geo.angle(f.from, Demo.homeAirport) >= 0.4 { points.append(f.from) }
                if Geo.angle(f.to, Demo.homeAirport) >= 0.4 { points.append(f.to) }
            }
            for p in points {
                let snapped = trip.stops.map(\.at).filter { Geo.angle($0, p) < 0.5 }.min { Geo.angle($0, p) < Geo.angle($1, p) } ?? p
                add(snapped, trip)
            }
        }
        // A trip passing through a place another trip ends at joins that dot.
        for trip in trips {
            for p in trip.routePieces.joined() {
                if let i = places.firstIndex(where: { Geo.angle($0.at, p) < 0.12 }), !places[i].members.contains(where: { $0.id == trip.id }) {
                    places[i].members.append(trip)
                }
            }
        }
        self.places = places

        // Airports with no dot of their own nearby: a small grey point.
        let dotted = places.map(\.at) + trips.flatMap { $0.stops.map(\.at) }
        var seen = Set<String>()
        airports = rawAirports.filter { ap in
            let key = "\(Int((ap.lon / 1.2).rounded())),\(Int((ap.lat / 1.2).rounded()))"
            guard seen.insert(key).inserted else { return false }
            return !dotted.contains { Geo.angle($0, ap) < 0.5 }
        }

        var free: [String: [LonLat]] = [:]
        for trip in trips {
            free[trip.id] = trip.stops.map(\.at).filter { s in !places.contains { Geo.angle($0.at, s) < 0.12 } }
        }
        freeStops = free
    }

    private static func densify(_ points: [LonLat]) -> [LonLat] {
        guard points.count >= 2 else { return points }
        var out: [LonLat] = []
        for i in 1..<points.count {
            let a = points[i - 1], b = points[i]
            let seg = Geo.greatCircle(a, b, steps: max(2, Int(Geo.angle(a, b) / 1.5)))
            out += i == 1 ? seg : Array(seg.dropFirst())
        }
        return out
    }

    func color(_ trip: Trip, dark: Bool) -> Color {
        let key = trip.id + (dark ? "/d" : "/l")
        if let c = colors[key] { return c }
        let c = Geo.legible(trip.color, dark: dark)
        colors[key] = c
        return c
    }
}

// MARK: Motion

/// Everything that moves on the globe, stepped once per frame.
final class GlobeMotion {
    var lon = 8.0, lat = centerLat, zoom: CGFloat = 1
    private var targetZoom: CGFloat = 1
    private var zoomV = 0.0, latV = 0.0, lonV = 0.0
    private var sweepDir = 1.0
    var touching = false
    private var lastInteract = -1e9
    private var flingLon = 0.0, flingLat = 0.0
    private var now = 0.0
    private(set) var dt = 1.0 / 60

    private var tourPhase = 0
    private var phaseStart = 0.0
    private var tourIdx = 0
    private var lastFocusId: String?
    private var queue: [String] = []
    var selectedId: String?

    var glowDist = 0.0
    private var glowRuns = 0
    private var glowRunsNeeded = 2
    private var holdUntil = 0.0
    private var glowTripId: String?

    private(set) var active: TourTrip?
    /// 0 = every trip equal, 1 = one shown and the rest stepped back.
    private(set) var focus: Double = 0
    private(set) var recedeId: String?
    var stopReveal: [String: Double] = [:]
    /// The plane's heading in radians, eased; nil on the ground.
    var planeAngle: Double?

    private(set) var cardTripId: String?
    private(set) var cardOpacity: Double = 0
    /// Which side of its dot the card goes (+1 right, -1 left), chosen when it appears.
    var cardSide: CGFloat = 1
    var cardVisible = false

    init(intro: Bool) { if intro { lon = -20 } }

    var seconds: Double { now }

    func standing(_ id: String) -> Double { recedeId != nil && id != recedeId ? 1 - focus : 1 }

    func touched() { lastInteract = now }

    func drag(_ dx: CGFloat, _ dy: CGFloat) {
        // A quarter of a degree per point, slower when zoomed in; tilt stays within 60 degrees of the middle.
        lon -= Double(dx) * 0.25 / Double(zoom)
        lat = max(centerLat - 60, min(centerLat + 60, lat + Double(dy) * 0.25 / Double(zoom)))
        lastInteract = now
    }

    func fling(_ vx: CGFloat, _ vy: CGFloat) {
        flingLon = max(-240, min(240, -Double(vx) * 0.25 / Double(zoom)))
        flingLat = max(-120, min(120, Double(vy) * 0.25 / Double(zoom)))
    }

    func stopFling() { flingLon = 0; flingLat = 0 }

    func pinch(to value: CGFloat) {
        targetZoom = min(maxZoom, max(1, value))
        lastInteract = now
    }

    var pinchBase: CGFloat { targetZoom }

    /// A tap on a trip frames it and shows its card; a second tap on it lets go.
    func tap(_ id: String?) {
        selectedId = (id == nil || id == selectedId) ? nil : id
    }

    private var easeV = 0.0
    /// Critically damped step toward a target; the new velocity lands in easeV.
    private func ease(_ value: Double, _ velocity: Double, _ target: Double, _ stiffness: Double) -> Double {
        let damping = 2 * stiffness.squareRoot()
        let accel = -stiffness * (value - target) - damping * velocity
        easeV = velocity + accel * dt
        return value + easeV * dt
    }

    func step(_ date: Date, trips: [TourTrip], tour: Bool) {
        let t = date.timeIntervalSinceReferenceDate
        let first = now == 0
        dt = first ? 1.0 / 60 : min(0.05, max(0.001, t - now))
        now = t
        if first { phaseStart = now }
        let idle = tour && !touching && now - lastInteract > idleSeconds

        if !touching && (flingLon != 0 || flingLat != 0) {
            lon += flingLon * dt
            lat = max(centerLat - 60, min(centerLat + 60, lat + flingLat * dt))
            let decay = exp(-4.5 * dt)
            flingLon *= decay; flingLat *= decay
            if abs(flingLon) < 0.05 && abs(flingLat) < 0.05 { stopFling() }
        }

        if (!idle && selectedId == nil) || trips.isEmpty {
            phaseStart = now
            tourPhase = 0
        } else {
            let dur = tourPhase == 0 ? overviewSeconds : focusSeconds
            let tapped = selectedId.flatMap { id in trips.firstIndex { $0.id == id } } ?? -1
            if tapped >= 0 {
                if tourPhase != 1 || lastFocusId != selectedId {
                    tourPhase = 1; tourIdx = tapped; lastFocusId = selectedId
                    glowDist = 0; glowRuns = 0; holdUntil = 0; phaseStart = now
                } else if glowRuns >= glowRunsNeeded || now - phaseStart > dur * 5 {
                    // Its journey has been shown: let go and pull back out.
                    selectedId = nil; tourPhase = 0; phaseStart = now
                }
            } else if now - phaseStart > dur {
                if tourPhase == 0 {
                    tourPhase = 1
                    // A fresh shuffle each round, never opening with the trip it just closed with.
                    if queue.isEmpty {
                        var ids = trips.map(\.id).shuffled()
                        if ids.count > 1 && ids[0] == lastFocusId { ids.swapAt(0, 1) }
                        queue = ids
                    }
                    let next = queue.removeFirst()
                    tourIdx = max(0, trips.firstIndex { $0.id == next } ?? 0)
                    lastFocusId = trips[tourIdx].id
                    glowDist = 0; glowRuns = 0; holdUntil = 0; phaseStart = now
                } else if glowRuns >= glowRunsNeeded || now - phaseStart > dur * 5 {
                    // Held until the light has run the whole route, with a ceiling.
                    tourPhase = 0; phaseStart = now
                }
            }

            if tourPhase == 0 {
                // Overview: a pendulum sweep across all trips, easing back out.
                var lo = Double.greatestFiniteMagnitude, hi = -Double.greatestFiniteMagnitude
                for trip in trips { lo = min(lo, trip.anchor.lon); hi = max(hi, trip.anchor.lon) }
                if lon <= lo - 35 { sweepDir = 1 } else if lon >= hi + 35 { sweepDir = -1 }
                if !touching { lon += sweep * sweepDir * dt * 60 }
                targetZoom = 1
                zoom = CGFloat(ease(Double(zoom), zoomV, 1, 5.2)); zoomV = easeV
                lat = ease(lat, latV, centerLat, 5.2); latV = easeV
            } else {
                // Focus: the middle of the whole trip, a zoom from how far it reaches.
                let trip = trips[min(tourIdx, trips.count - 1)]
                let z = max(1.5, min(3.4, 46 / (trip.spread + 9)))
                if !touching {
                    var shortest = (trip.centre.lon - lon).truncatingRemainder(dividingBy: 360)
                    if shortest > 180 { shortest -= 360 }
                    if shortest < -180 { shortest += 360 }
                    lon = ease(lon, lonV, lon + shortest, 2.4); lonV = easeV
                    // A touch above centre: the fade eats the lower part.
                    lat = ease(lat, latV, trip.centre.lat - 3, 5.2); latV = easeV
                }
                targetZoom = CGFloat(z)
                zoom = CGFloat(ease(Double(zoom), zoomV, z, 5.2)); zoomV = easeV
            }
        }
        // Pinching sets the target directly; catch up quickly, the finger leads.
        if !idle || trips.isEmpty { zoom = CGFloat(ease(Double(zoom), zoomV, Double(targetZoom), 26)); zoomV = easeV }

        let activeId = selectedId ?? (idle && tourPhase == 1 && !trips.isEmpty ? trips[min(tourIdx, trips.count - 1)].id : nil)
        active = activeId.flatMap { id in trips.first { $0.id == id } }

        // The rest step back, eased, and come back the same way.
        if let activeId { recedeId = activeId }
        focus += ((activeId != nil ? 1 : 0) - focus) * (1 - pow(0.004, dt))
        if focus < 0.002 { recedeId = nil }

        stepGlow(activeId)
        stepStops(trips, activeId)
        stepCard(activeId)
    }

    func trail(_ act: TourTrip) -> Double { min(6, act.total * 0.22) }

    private func stepGlow(_ activeId: String?) {
        // Every highlight starts its trip over.
        if activeId != glowTripId {
            glowDist = 0; glowRuns = 0; holdUntil = 0; glowTripId = activeId; planeAngle = nil
        }
        guard let act = active else { return }
        if !act.legs.isEmpty && act.total > ribbonMinDeg {
            let total = act.total
            // A pace with a floor and a ceiling, in degrees per 60 Hz frame.
            let speed = min(0.14, max(0.07, total / (7 * 60)))
            glowRunsNeeded = act.runsNeeded
            if glowRuns < glowRunsNeeded && now >= holdUntil {
                // Away from a stop and up to speed, then off it again at the next.
                let legF = act.head(glowDist)?.f ?? 0.5
                let pace = glowDist >= total ? 1.5 : 0.28 + 0.72 * pow(max(0, sin(.pi * legF)), 0.55)
                let before = glowDist
                glowDist += speed * pace * (dt * 60)
                for arrival in act.arrivals where before < arrival.at && glowDist >= arrival.at {
                    glowDist = arrival.at
                    holdUntil = now + arrival.seconds
                    break
                }
                // The last stop is an arrival too.
                if before < total && glowDist > total {
                    glowDist = total
                    holdUntil = now + ((act.legs.last?.isFlight ?? false) ? airArrival : endHold)
                }
                if glowDist > total + trail(act) + pauseDeg {
                    if glowRuns + 1 < glowRunsNeeded { glowDist = 0 }
                    glowRuns += 1
                }
            }
        } else {
            // A city trip has no route to run: its rings play for a while instead.
            glowRunsNeeded = 2
            if now - phaseStart > 5.4 { glowRuns = glowRunsNeeded }
        }
    }

    private func stepStops(_ trips: [TourTrip], _ activeId: String?) {
        for t in trips where !t.trip.stops.isEmpty {
            let want: Double = t.id == activeId ? 1 : 0
            let cur = stopReveal[t.id] ?? 0
            if cur == want { continue }
            // Quicker to appear than to leave.
            let k = 1 - pow(want > cur ? 0.03 : 0.12, dt)
            var next = cur + (want - cur) * k
            if want == 0 && next < 0.005 { next = 0 }
            stopReveal[t.id] = next
        }
    }

    private func stepCard(_ activeId: String?) {
        func perFrame(_ k: Double) -> Double { 1 - pow(1 - k, dt * 60) }
        if activeId != cardTripId {
            // Fold the old card away first; the new one opens once it is gone.
            cardOpacity += (0 - cardOpacity) * perFrame(0.13)
            if cardOpacity < 0.03 { cardTripId = activeId; cardOpacity = 0; cardSide = 0 }
        } else if cardTripId != nil {
            let target: Double = cardVisible ? 1 : 0
            // Eases in slower than it fades out: appearing was a pop.
            cardOpacity += (target - cardOpacity) * perFrame(target > cardOpacity ? 0.055 : 0.13)
        }
    }
}

// MARK: Drawing

/// Draws the globe for a camera: land, routes, flights and dots, the trip on show travelled.
struct GlobeCanvas {
    let scene: GlobeScene
    var style: GlobeStyle

    /// The projection for a canvas size and camera, shared by drawing, the card and tap tests.
    static func projection(_ size: CGSize, lon: Double, lat: Double, zoom: CGFloat) -> Ortho {
        let inset: CGFloat = 10
        let radius = (min(size.width, size.height) / 2 - 2 - inset) * zoom
        return Ortho(lon0: lon, lat0: lat, cx: size.width / 2, cy: size.height / 2 + inset, r: radius)
    }

    private func circle(_ c: CGPoint, _ r: CGFloat) -> CGRect { CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2) }

    /// A colour stepping back: less saturated and toward a middle lightness, as Android's recede().
    private func recede(_ c: Color, _ f: Double) -> Color {
        guard f > 0.001 else { return c }
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(c).getHue(&h, saturation: &s, brightness: &b, alpha: &a)
        let target: CGFloat = style.dark ? 0.55 : 0.72
        return Color(hue: Double(h), saturation: Double(s * (1 - 0.72 * CGFloat(f))), brightness: Double(b + (target - b) * 0.6 * CGFloat(f)))
    }

    func draw(_ ctx: inout GraphicsContext, _ size: CGSize, motion: GlobeMotion) {
        let proj = Self.projection(size, lon: motion.lon, lat: motion.lat, zoom: motion.zoom)
        ctx.fill(Path(ellipseIn: CGRect(x: proj.cx - proj.r, y: proj.cy - proj.r, width: proj.r * 2, height: proj.r * 2)), with: .color(style.sphere))
        drawLand(&ctx, proj)
        drawScene(&ctx, proj, motion)
        drawJourney(&ctx, proj, motion)
    }

    private func drawLand(_ ctx: inout GraphicsContext, _ proj: Ortho) {
        var path = Path()
        for ring in Land.rings {
            let n = ring.count / 2
            guard n > 2 else { continue }
            var anyNear = false
            var points: [CGPoint] = []
            points.reserveCapacity(n)
            for i in 0..<n {
                let (pt, near) = proj.project(ring[i * 2], ring[i * 2 + 1])
                if near { anyNear = true }
                points.append(pt)
            }
            guard anyNear else { continue }
            path.addLines(points)
            path.closeSubpath()
        }
        ctx.fill(path, with: .color(style.land), style: FillStyle(eoFill: true))
    }

    private func drawScene(_ ctx: inout GraphicsContext, _ proj: Ortho, _ motion: GlobeMotion) {
        let dark = style.dark
        let recedeId = motion.recedeId
        func colorOf(_ trip: Trip) -> Color {
            let c = scene.color(trip, dark: dark)
            return recedeId == nil ? c : recede(c, 1 - motion.standing(trip.id))
        }

        // Routes; the trip on show goes last, so it lies on top.
        for pass in 0...1 {
            for run in scene.runs where (pass == 1) == (run.trip.id == recedeId) {
                var path = Path()
                var open = false
                for p in run.pts {
                    let (pt, near) = proj.project(p.lon, p.lat)
                    if !near { open = false; continue }
                    if open { path.addLine(to: pt) } else { path.move(to: pt) }
                    open = true
                }
                let fade = 0.34 + 0.66 * motion.standing(run.trip.id)
                let color = colorOf(run.trip)
                if run.dashed {
                    ctx.stroke(path, with: .color(color.opacity(0.6 * fade)), style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round, dash: [2, 7]))
                } else {
                    ctx.stroke(path, with: .color(color.opacity(0.95 * fade)), style: StrokeStyle(lineWidth: style.routeWidth, lineCap: .round, lineJoin: .round))
                }
            }
        }

        // Flights: grey dashed bows; a shared one is as present as its most present trip.
        for pass in 0...1 {
            for bow in scene.bows {
                let mine = recedeId.map { bow.tripIds.contains($0) } ?? false
                guard (pass == 1) == mine else { continue }
                let k = 0.3 + 0.7 * (bow.tripIds.map { motion.standing($0) }.max() ?? 1)
                let color = dark ? Color(red: 165 / 255, green: 175 / 255, blue: 187 / 255).opacity(0.9 * k) : Color(red: 105 / 255, green: 115 / 255, blue: 128 / 255).opacity(0.85 * k)
                var path = Path()
                var open = false
                for (i, p) in bow.pts.enumerated() {
                    let (pt, near) = proj.project(p.lon, p.lat, lift: bow.lifts[i])
                    if !near { open = false; continue }
                    if open { path.addLine(to: pt) } else { path.move(to: pt) }
                    open = true
                }
                ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 1.2, lineCap: .round, dash: [2, 5]))
            }
        }

        let airportColor = dark ? Color(red: 150 / 255, green: 160 / 255, blue: 172 / 255).opacity(0.9) : Color(red: 120 / 255, green: 128 / 255, blue: 140 / 255).opacity(0.85)
        for ap in scene.airports {
            let (pt, near) = proj.project(ap.lon, ap.lat)
            if near { ctx.fill(Path(ellipseIn: circle(pt, 2.6)), with: .color(airportColor)) }
        }

        let ds = CGFloat(min(1.12, 0.75 * pow(Double(motion.zoom), 0.21)))
        let rimColor = dark ? Color(red: 20 / 255, green: 25 / 255, blue: 32 / 255).opacity(0.65) : Color.white.opacity(0.9)
        // Voorkeuren › Globe › Altijd: every other trip's stops too, small and quiet.
        if Prefs.globeStopsAlways {
            for trip in scene.trips where (motion.stopReveal[trip.id] ?? 0) < 0.012 {
                let color = colorOf(trip)
                for s in scene.freeStops[trip.id] ?? [] {
                    let (pt, near) = proj.project(s.lon, s.lat)
                    guard near else { continue }
                    let r = 2.3 * ds
                    ctx.fill(Path(ellipseIn: circle(pt, r)), with: .color(color.opacity(0.85)))
                    ctx.stroke(Path(ellipseIn: circle(pt, r)), with: .color(rimColor.opacity(0.85)), lineWidth: 0.9)
                }
            }
        }
        // The stops of the trip on show, one after another in travel order, each popping in.
        for trip in scene.trips {
            guard let reveal = motion.stopReveal[trip.id], reveal >= 0.012, let stops = scene.freeStops[trip.id], !stops.isEmpty else { continue }
            let color = colorOf(trip)
            let head = reveal * (Double(stops.count - 1) * 0.06 + 0.45)
            for (i, s) in stops.enumerated() {
                let local = min(1, max(0, (head - Double(i) * 0.06) / 0.45))
                let (pt, near) = proj.project(s.lon, s.lat)
                guard local > 0, near else { continue }
                // Ease-out-back: it overshoots a touch and settles.
                let k = local - 1
                let pop = 1 + 2.3 * k * k * k + 1.5 * k * k
                let r = 3.1 * ds * CGFloat(pop)
                let a = min(1, local * 1.6)
                ctx.fill(Path(ellipseIn: circle(pt, r)), with: .color(color.opacity(a)))
                ctx.stroke(Path(ellipseIn: circle(pt, r)), with: .color(rimColor.opacity(a)), lineWidth: 1.1)
            }
        }

        let dot = 4.5 * ds
        for place in scene.places {
            let (pt, near) = proj.project(place.at.lon, place.at.lat)
            guard near else { continue }
            // While a trip is on show, every dot it touches holds its colour.
            let trip = place.members.first { $0.id == motion.active?.id } ?? place.members[0]
            ctx.fill(Path(ellipseIn: circle(pt, dot)), with: .color(colorOf(trip)))
            if trip.upcoming {
                ctx.stroke(Path(ellipseIn: circle(pt, dot)), with: .color(dark ? Color(red: 235 / 255, green: 240 / 255, blue: 247 / 255) : .white), lineWidth: 2)
            } else {
                ctx.stroke(Path(ellipseIn: circle(pt, dot)), with: .color(rimColor), lineWidth: 1.2)
            }
        }
    }

    /// The trip on show, travelled: a head of light with a fading ribbon along the ground, a grey contrail and a
    /// small plane along a flight, or breathing rings for a city trip with no route to run.
    private func drawJourney(_ ctx: inout GraphicsContext, _ proj: Ortho, _ motion: GlobeMotion) {
        guard let act = motion.active else { return }
        let glow = scene.color(act.trip, dark: style.dark)
        let total = act.total
        if act.legs.isEmpty || total <= ribbonMinDeg {
            drawCityRings(&ctx, proj, motion, act, glow)
            return
        }
        let trail = motion.trail(act)
        // Sampled head to tail; a sample off the route is dropped, so the ribbon slides on and off.
        var samples: [(CGPoint, Double, Bool)] = []
        for i in 0...28 {
            let t = Double(i) / 28
            let d = motion.glowDist - trail * t
            guard d >= 0, d <= total, let h = act.head(d) else { continue }
            let lift = h.flying ? bowLift(act.legs[h.leg].len, h.f) : 0
            let (pt, near) = proj.project(h.at.lon, h.at.lat, lift: lift)
            guard near else { continue }
            samples.append((pt, t, h.flying))
        }
        // Behind a plane the trail is a contrail: grey and thin.
        let contrail = style.dark ? Color(red: 186 / 255, green: 195 / 255, blue: 205 / 255) : Color(red: 128 / 255, green: 137 / 255, blue: 148 / 255)
        for pass in 0...1 {
            let width: CGFloat = pass == 0 ? 9 : 2.8
            let peak = pass == 0 ? 0.22 : 0.95
            for i in samples.indices.dropFirst() {
                let (a, _, _) = samples[i - 1]
                let (b, t, air) = samples[i]
                // A segment that leapt across the globe.
                if hypot(b.x - a.x, b.y - a.y) > 60 { continue }
                let fade = (1 - t) * (1 - t)
                var line = Path()
                line.move(to: a)
                line.addLine(to: b)
                ctx.stroke(line, with: .color((air ? contrail : glow).opacity(peak * fade * (air ? 0.45 : 1))), style: StrokeStyle(lineWidth: width, lineCap: .round))
            }
        }

        // In the air the head is a plane, flying the bow it drew.
        guard motion.glowDist <= total, let h = act.head(motion.glowDist), h.flying, case .flight(let la, let lb, let len, _) = act.legs[h.leg] else {
            motion.planeAngle = nil
            return
        }
        let f = h.f
        let (hp, near) = proj.project(h.at.lon, h.at.lat, lift: bowLift(len, f))
        guard near else { return }
        // Heading from a step either way along the same curve.
        let fa = min(1, f + 0.01), fb = max(0, f - 0.01)
        let pa = slerp(la, lb, fa), pb = slerp(la, lb, fb)
        let (A, okA) = proj.project(pa.lon, pa.lat, lift: bowLift(len, fa))
        let (B, okB) = proj.project(pb.lon, pb.lat, lift: bowLift(len, fb))
        let target = okA && okB ? atan2(Double(A.y - B.y), Double(A.x - B.x)) : 0
        if let prev = motion.planeAngle {
            // The shortest way round, eased so it never twitches under the moving camera.
            var delta = (target - prev + .pi * 3).truncatingRemainder(dividingBy: .pi * 2) - .pi
            if delta < -.pi { delta += .pi * 2 }
            motion.planeAngle = prev + delta * (1 - pow(0.0001, motion.dt))
        } else {
            motion.planeAngle = target
        }
        // Small at both gates, full size in the cruise, fading over the same stretch.
        let ends = min(f, 1 - f)
        let scale = 8 * (0.5 + 0.5 * min(1, ends / 0.2))
        let alpha = min(1, ends / 0.07)
        guard alpha > 0.01 else { return }
        let planeColor = style.dark ? Color(hex: 0xCDD5DE) : Color(hex: 0x79838F)
        let rotate = CGAffineTransform(rotationAngle: motion.planeAngle ?? 0).scaledBy(x: scale, y: scale)
        let shape = GlobeCanvas.plane.applying(rotate)
        ctx.fill(shape.applying(CGAffineTransform(translationX: hp.x, y: hp.y + 1.2)), with: .color(Color(red: 10 / 255, green: 14 / 255, blue: 20 / 255).opacity(0.22 * alpha)))
        ctx.fill(shape.applying(CGAffineTransform(translationX: hp.x, y: hp.y)), with: .color(planeColor.opacity(alpha)))
    }

    /// A city trip: a breathing halo and two rings a beat apart.
    private func drawCityRings(_ ctx: inout GraphicsContext, _ proj: Ortho, _ motion: GlobeMotion, _ act: TourTrip, _ glow: Color) {
        let spot = act.segments.first?.first ?? act.anchor
        let (at, near) = proj.project(spot.lon, spot.lat)
        guard near else { return }
        let period = 2.8
        let breathe = 0.5 + 0.5 * sin(motion.seconds / period * .pi * 2)
        let haloR = CGFloat(14 + breathe * 5)
        ctx.fill(Path(ellipseIn: circle(at, haloR)), with: .radialGradient(
            Gradient(stops: [.init(color: glow.opacity(0.26 + breathe * 0.12), location: 0), .init(color: glow.opacity(0.1), location: 0.55), .init(color: glow.opacity(0), location: 1)]),
            center: at, startRadius: 0, endRadius: haloR))
        for offset in [0.0, 0.5] {
            let x = motion.seconds / period + offset
            let phase = x - floor(x)
            // Ease-out quart: quick out of the dot, then drifting.
            let e = 1 - pow(1 - phase, 4)
            let r = CGFloat(5.5 + e * 21)
            let a = 0.6 * min(1, phase * 3) * (1 - e)
            ctx.stroke(Path(ellipseIn: circle(at, r)), with: .color(glow.opacity(a)), lineWidth: CGFloat(max(0.6, 2.4 * (1 - e))))
        }
    }

    /// The web's airliner outline, half length 1, nose at +x.
    static let plane: Path = {
        let half: [CGFloat] = [1, 0, 0.55, 0.13, 0.12, 0.14, -0.06, 0.86, -0.3, 0.86, -0.28, 0.14, -0.72, 0.13, -0.8, 0.46, -0.97, 0.46, -1, 0.05]
        var p = Path()
        p.move(to: CGPoint(x: 1, y: 0))
        for i in stride(from: 0, to: half.count, by: 2) { p.addLine(to: CGPoint(x: half[i], y: half[i + 1])) }
        for i in stride(from: half.count - 2, through: 0, by: -2) { p.addLine(to: CGPoint(x: half[i], y: -half[i + 1])) }
        p.closeSubpath()
        return p
    }()
}

// MARK: Hero

/// The globe as a hero, on the homepage and the login page alike: it turns in on arrival, turns and tilts under a
/// drag (with a little inertia), pinches from 1 to 12 times closer, and tours the trips when left alone. A tap on
/// a trip frames it and travels its journey; its name card unfolds from its dot and opens the trip.
struct GlobeHero<Overlay: View>: View {
    let trips: [Trip]
    var tour = true
    var onOpen: ((String) -> Void)? = nil
    @ViewBuilder var overlay: (CGFloat) -> Overlay
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scenePhase) private var phase
    @State private var motion = GlobeMotion(intro: !Launch.shot)
    @State private var scene: GlobeScene?
    @State private var visible = true
    @State private var pinchStart: CGFloat?
    @State private var size: CGSize = .zero

    var body: some View {
        let scene = currentScene
        let renderer = GlobeCanvas(scene: scene, style: .home(dark: scheme == .dark))
        TimelineView(.animation(paused: !visible || phase != .active)) { tl in
            let _ = motion.step(tl.date, trips: scene.tour, tour: tour)
            // This frame's camera captured by value, so the canvas redraws every frame with it.
            let frame = (tl.date, motion.lon, motion.lat, motion.zoom)
            ZStack(alignment: .top) {
                Canvas { ctx, size in
                    let _ = frame
                    renderer.draw(&ctx, size, motion: motion)
                }
                .clipped()
                overlay(motion.zoom)
                card(scene)
            }
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
        .onChange(of: GlobeScene.key(trips), initial: true) { _, key in
            if self.scene?.key != key { self.scene = GlobeScene(trips: trips) }
        }
        .contentShape(Rectangle())
        .gesture(SidewaysPan(
            onBegin: { motion.touching = true; motion.stopFling(); motion.touched() },
            onChange: { dx, dy in motion.drag(dx, dy) },
            onEnd: { vx in
                motion.fling(vx, 0)
                motion.touching = false
                motion.touched()
            }
        ))
        .simultaneousGesture(
            MagnifyGesture()
                .onChanged { v in
                    motion.touching = true
                    let start = pinchStart ?? motion.zoom
                    pinchStart = start
                    motion.pinch(to: start * v.magnification)
                }
                .onEnded { _ in pinchStart = nil; motion.touching = false; motion.touched() }
        )
        .simultaneousGesture(SpatialTapGesture().onEnded { v in tap(v.location, scene) })
        .onScrollVisibilityChange(threshold: 0.05) { visible = $0 }
        .onAppear {
            visible = true
            if !Launch.shot { motion.touched() }
        }
        .onDisappear { visible = false }
        .accessibilityLabel("Wereldbol met je reizen")
    }

    private var currentScene: GlobeScene {
        if let scene, scene.key == GlobeScene.key(trips) { return scene }
        return GlobeScene(trips: trips)
    }

    /// A tap near a trip's route or dots frames it; a second tap, or one beside every trip, lets go.
    private func tap(_ point: CGPoint, _ scene: GlobeScene) {
        let proj = GlobeCanvas.projection(size, lon: motion.lon, lat: motion.lat, zoom: motion.zoom)
        var best: (String, Double)?
        for trip in scene.tour {
            for p in trip.hitPoints {
                let (pt, near) = proj.project(p.lon, p.lat)
                guard near else { continue }
                let d = hypot(Double(pt.x - point.x), Double(pt.y - point.y))
                if d < 22 && d < (best?.1 ?? .infinity) { best = (trip.id, d) }
            }
        }
        if best != nil { Haptic.select() }
        motion.tap(best?.0)
    }

    /// The name card of the trip on show: it unfolds from the trip's dot, on the side away from the rest of the
    /// trip, and opens the trip on a tap.
    @ViewBuilder private func card(_ scene: GlobeScene) -> some View {
        if let id = motion.cardTripId, let tour = scene.tour.first(where: { $0.id == id }), size.width > 0 {
            let proj = GlobeCanvas.projection(size, lon: motion.lon, lat: motion.lat, zoom: motion.zoom)
            let at = scene.places.first { $0.members.contains { $0.id == id } }?.at ?? tour.anchor
            let (pt, near) = proj.project(at.lon, at.lat)
            let _ = motion.cardVisible = near
            let _ = {
                if motion.cardSide == 0 {
                    let (c, _) = proj.project(tour.centre.lon, tour.centre.lat)
                    motion.cardSide = c.x >= pt.x ? -1 : 1
                }
            }()
            let o = motion.cardOpacity
            let side = motion.cardSide == 0 ? 1 : motion.cardSide
            Button { if o > 0.6 { onOpen?(id) } } label: {
                HStack(spacing: 10) {
                    Circle().fill(scene.color(tour.trip, dark: scheme == .dark)).frame(width: 10, height: 10)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(tour.trip.title).font(.outfit(16, 600)).foregroundStyle(Brand.ink).lineLimit(1)
                        Text(tour.trip.dates).font(.inter(12.5, 500)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                    }
                    if onOpen != nil {
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Brand.inkSoft)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .glassEffect(.regular.interactive(), in: .capsule)
                .fixedSize()
            }
            .buttonStyle(.plain)
            .allowsHitTesting(onOpen != nil && o > 0.6)
            .opacity(o)
            .scaleEffect(0.86 + 0.14 * o, anchor: side > 0 ? .leading : .trailing)
            .alignmentGuide(.leading) { d in
                let x = side > 0 ? pt.x + 10 : pt.x - 10 - d.width
                return -min(max(8, x), max(8, size.width - d.width - 8))
            }
            .alignmentGuide(.top) { d in -min(max(8, pt.y - d.height / 2), size.height - d.height - 8) }
            .frame(width: size.width, height: size.height, alignment: .topLeading)
        }
    }
}

extension GlobeHero where Overlay == EmptyView {
    init(trips: [Trip], tour: Bool = true) {
        self.init(trips: trips, tour: tour, onOpen: nil) { _ in EmptyView() }
    }
}
