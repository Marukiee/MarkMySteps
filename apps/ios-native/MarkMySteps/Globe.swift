import SwiftUI
import UIKit

/*
 * The home page globe, after Globe.kt and GlobeBackdrop.tsx: the same land
 * (Natural Earth), the same orthographic projection centred on latitude 38,
 * the same colours, line widths and dashes, and the same dot rules:
 *
 *  - a dot only where a recorded route starts or ends, and at the far end of a
 *    flight (never at the home airport), an airport snapped onto the trip's own
 *    stop when that is within about 55 km;
 *  - places within about 13 km are one dot, shared by every trip there;
 *  - a finished trip's dot is solid with a light rim, an upcoming trip's dot
 *    has a white ring and its route is dotted;
 *  - a flown jump is a grey dashed bow, lifted off the surface;
 *  - an airport with no dot of its own nearby gets a small grey point.
 */

enum Land {
    /// Rings as flat lon, lat pairs, read once.
    static let rings: [[Double]] = {
        guard let url = Bundle.main.url(forResource: "land110", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [[[Double]]] else { return [] }
        return raw.map { ring in ring.flatMap { $0 } }
    }()
}

struct GlobeStyle {
    var sphere: Color
    var land: Color
    var dark: Bool
    var routeWidth: CGFloat = 1.9

    static func home(dark: Bool) -> GlobeStyle {
        GlobeStyle(sphere: dark ? Color(hex: 0x1E2630) : Color(hex: 0xEADFCE), land: dark ? Color(hex: 0x34404C) : Color(hex: 0xD8C9AD), dark: dark)
    }
}

struct Ortho {
    let lon0: Double, cx: CGFloat, cy: CGFloat, r: CGFloat
    let sinLat0: Double, cosLat0: Double

    init(lon0: Double, lat0: Double, cx: CGFloat, cy: CGFloat, r: CGFloat) {
        self.lon0 = lon0; self.cx = cx; self.cy = cy; self.r = r
        sinLat0 = sin(lat0 * Geo.rad); cosLat0 = cos(lat0 * Geo.rad)
    }

    /// The point on screen, and whether it is on the near side.
    func project(_ lon: Double, _ lat: Double, lift: Double = 0) -> (CGPoint, Bool) {
        let l = (lon - lon0) * Geo.rad, p = lat * Geo.rad
        let cosP = cos(p)
        let x = cosP * sin(l)
        let y = cosLat0 * sin(p) - sinLat0 * cosP * cos(l)
        let near = sinLat0 * sin(p) + cosLat0 * cosP * cos(l)
        let k = 1 + lift
        if near >= 0 { return (CGPoint(x: cx + CGFloat(x * k) * r, y: cy - CGFloat(y * k) * r), true) }
        let len = max(1e-9, (x * x + y * y).squareRoot())
        return (CGPoint(x: cx + CGFloat(x / len) * r, y: cy - CGFloat(y / len) * r), false)
    }
}

/// Draws the globe for a camera: land, routes, flights and dots, plus the tour's light.
struct GlobeCanvas {
    var trips: [Trip]
    var style: GlobeStyle

    /// The projection for a canvas size and camera, shared by drawing and tap tests.
    static func projection(_ size: CGSize, lon: Double, lat: Double, zoom: CGFloat) -> Ortho {
        let inset: CGFloat = 10
        let radius = (min(size.width, size.height) / 2 - 2 - inset) * zoom
        return Ortho(lon0: lon, lat0: lat, cx: size.width / 2, cy: size.height / 2 + inset, r: radius)
    }

    func draw(_ ctx: inout GraphicsContext, _ size: CGSize, lon: Double, lat: Double, zoom: CGFloat, light: (LonLat, Color)?, selected: String?) {
        let proj = Self.projection(size, lon: lon, lat: lat, zoom: zoom)
        let circle = CGRect(x: proj.cx - proj.r, y: proj.cy - proj.r, width: proj.r * 2, height: proj.r * 2)
        ctx.fill(Path(ellipseIn: circle), with: .color(style.sphere))
        drawLand(&ctx, size, proj)
        drawTrips(&ctx, proj)
        if let selected, let trip = trips.first(where: { $0.id == selected }) {
            // The tapped trip drawn once more on top, a little bolder.
            let color = Geo.legible(trip.color, dark: style.dark)
            for run in trip.pieces.runs { drawRoute(&ctx, run, proj, color, upcoming: trip.upcoming, width: 3.2) }
        }
        if let (at, color) = light {
            let (pt, near) = proj.project(at.lon, at.lat)
            if near {
                // The light running the route: a soft halo round a bright core.
                ctx.fill(Path(ellipseIn: CGRect(x: pt.x - 11, y: pt.y - 11, width: 22, height: 22)), with: .radialGradient(
                    Gradient(colors: [color.opacity(0.55), color.opacity(0)]), center: pt, startRadius: 0, endRadius: 11))
                ctx.fill(Path(ellipseIn: CGRect(x: pt.x - 3.4, y: pt.y - 3.4, width: 6.8, height: 6.8)), with: .color(.white))
                ctx.stroke(Path(ellipseIn: CGRect(x: pt.x - 3.4, y: pt.y - 3.4, width: 6.8, height: 6.8)), with: .color(color), lineWidth: 1.4)
            }
        }
    }

    private func drawLand(_ ctx: inout GraphicsContext, _ size: CGSize, _ proj: Ortho) {
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

    private func drawTrips(_ ctx: inout GraphicsContext, _ proj: Ortho) {
        var bows: [(LonLat, LonLat)] = []
        var airports: [LonLat] = []

        // Routes, split where a jump is a flight.
        for trip in trips {
            let color = Geo.legible(trip.color, dark: style.dark)
            let pieces = trip.pieces
            for run in pieces.runs { drawRoute(&ctx, run, proj, color, upcoming: trip.upcoming) }
            // Ground nobody recorded: straight and dotted, so the line still runs from end to end.
            for gap in pieces.gaps { drawRoute(&ctx, [gap.0, gap.1], proj, color, upcoming: true) }
            bows += pieces.bows
            airports += pieces.airports
        }

        // Flights: grey dashed bows, one per route however many trips flew it.
        var seen = Set<String>()
        let bowColor = style.dark ? Color(red: 165 / 255, green: 175 / 255, blue: 187 / 255).opacity(0.9) : Color(red: 105 / 255, green: 115 / 255, blue: 128 / 255).opacity(0.85)
        for (a, b) in bows {
            let key = [a, b].map { "\(Int(($0.lon / 1.2).rounded())),\(Int(($0.lat / 1.2).rounded()))" }.sorted().joined(separator: "|")
            guard seen.insert(key).inserted else { continue }
            drawBow(&ctx, a, b, proj, bowColor)
        }

        // Places with a dot: route ends and far flight ends, snapped and merged.
        var places: [(at: LonLat, members: [Trip])] = []
        func add(_ p: LonLat, _ trip: Trip) {
            if let i = places.firstIndex(where: { Geo.angle($0.at, p) < 0.12 }) {
                if !places[i].members.contains(where: { $0.id == trip.id }) { places[i].members.append(trip) }
            } else {
                places.append((p, [trip]))
            }
        }
        for trip in trips {
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

        // Airports with no dot of their own nearby: a small grey point.
        let dotted = places.map(\.at) + trips.flatMap { $0.stops.map(\.at) }
        var airportSeen = Set<String>()
        let airportColor = style.dark ? Color(red: 150 / 255, green: 160 / 255, blue: 172 / 255).opacity(0.9) : Color(red: 120 / 255, green: 128 / 255, blue: 140 / 255).opacity(0.85)
        for ap in airports {
            let key = "\(Int((ap.lon / 1.2).rounded())),\(Int((ap.lat / 1.2).rounded()))"
            guard airportSeen.insert(key).inserted else { continue }
            if dotted.contains(where: { Geo.angle($0, ap) < 0.5 }) { continue }
            let (pt, near) = proj.project(ap.lon, ap.lat)
            if near { ctx.fill(Path(ellipseIn: circle(pt, 2.6)), with: .color(airportColor)) }
        }

        let dot: CGFloat = 4.5 * 0.75
        for place in places {
            let (pt, near) = proj.project(place.at.lon, place.at.lat)
            guard near, let trip = place.members.first else { continue }
            ctx.fill(Path(ellipseIn: circle(pt, dot)), with: .color(Geo.legible(trip.color, dark: style.dark)))
            if trip.upcoming {
                ctx.stroke(Path(ellipseIn: circle(pt, dot)), with: .color(style.dark ? Color(red: 235 / 255, green: 240 / 255, blue: 247 / 255) : .white), lineWidth: 2)
            } else {
                ctx.stroke(Path(ellipseIn: circle(pt, dot)), with: .color(style.dark ? Color(red: 20 / 255, green: 25 / 255, blue: 32 / 255).opacity(0.7) : Color.white.opacity(0.85)), lineWidth: 1.2)
            }
        }
    }

    private func circle(_ c: CGPoint, _ r: CGFloat) -> CGRect { CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2) }

    private func drawRoute(_ ctx: inout GraphicsContext, _ points: [LonLat], _ proj: Ortho, _ color: Color, upcoming: Bool, width: CGFloat? = nil) {
        var path = Path()
        var open = false
        for i in 1..<points.count {
            let a = points[i - 1], b = points[i]
            for p in Geo.greatCircle(a, b, steps: max(2, Int(Geo.angle(a, b) / 1.5))) {
                let (pt, near) = proj.project(p.lon, p.lat)
                if !near { open = false; continue }
                if open { path.addLine(to: pt) } else { path.move(to: pt) }
                open = true
            }
        }
        if upcoming {
            ctx.stroke(path, with: .color(color.opacity(0.6)), style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round, dash: [2, 7]))
        } else {
            ctx.stroke(path, with: .color(color.opacity(0.95)), style: StrokeStyle(lineWidth: width ?? style.routeWidth, lineCap: .round, lineJoin: .round))
        }
    }

    /// A flight lifted off the surface: an orthographic point at height R sits R times as far from the centre.
    private func drawBow(_ ctx: inout GraphicsContext, _ a: LonLat, _ b: LonLat, _ proj: Ortho, _ color: Color) {
        let span = Geo.angle(a, b)
        let lift = min(0.22, span / 180 * 0.9)
        let pts = Geo.greatCircle(a, b, steps: max(12, Int(span / 1.2)))
        var path = Path()
        var open = false
        for (i, p) in pts.enumerated() {
            let t = Double(i) / Double(pts.count - 1)
            let (pt, near) = proj.project(p.lon, p.lat, lift: lift * sin(.pi * t))
            if !near { open = false; continue }
            if open { path.addLine(to: pt) } else { path.move(to: pt) }
            open = true
        }
        ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 1.2, lineCap: .round, dash: [2, 5]))
    }
}

/// The globe's camera and tour, stepped once per frame (after GlobeTour.kt and the web's
/// GlobeBackdrop): springs toward a target, a gentle idle sweep, and the auto tour, a wide
/// overview and then one trip framed while a light runs its journey.
final class GlobeMotion {
    var lon = 8.0, lat = 38.0, zoom: CGFloat = 1
    var targetLon = 8.0, targetLat = 38.0, targetZoom: CGFloat = 1
    private var last: Date?
    private var idleSince = Date()
    private var phaseStart = Date()
    private var focusIndex = -1
    var focus: Trip?
    var touching = false

    static let maxZoom: CGFloat = 12

    init(intro: Bool) { if intro { lon = -20 } }

    func touched() { idleSince = Date(); focus = nil; phaseStart = Date() }

    /// One frame: the tour picks targets when idle, and the camera springs toward them.
    func step(_ now: Date, trips: [Trip], tour: Bool) {
        let dt = min(0.05, last.map { now.timeIntervalSince($0) } ?? 0)
        last = now
        if tour && !touching && now.timeIntervalSince(idleSince) > 1.4 {
            let tourable = trips.filter { $0.routePieces.contains { $0.count >= 2 } || !$0.flights.isEmpty }
            let inPhase = now.timeIntervalSince(phaseStart)
            if focus == nil {
                // Overview: the whole earth, turning slowly (0.02 degrees a frame on the web).
                targetZoom = 1
                targetLat = 38
                targetLon += 0.02 * 60 * dt
                if inPhase > 6, !tourable.isEmpty {
                    focusIndex = (focusIndex + 1) % tourable.count
                    focus = tourable[focusIndex]
                    phaseStart = now
                    if let f = focus { frame(f) }
                }
            } else if inPhase > 6.5 {
                focus = nil
                phaseStart = now
            }
        }
        let k = 1 - exp(-dt * 4.2)
        var dl = targetLon - lon
        while dl > 180 { dl -= 360 }
        while dl < -180 { dl += 360 }
        lon += dl * k
        lat += (targetLat - lat) * k
        zoom += (targetZoom - zoom) * CGFloat(k)
    }

    /// Frames a trip: its middle, close enough for its spread, never past about 3.4.
    func frame(_ trip: Trip) {
        let pts = trip.routePieces.joined() + trip.flights.flatMap { [$0.from, $0.to] } + trip.stops.map(\.at)
        guard !pts.isEmpty else { return }
        var x = 0.0, y = 0.0, z = 0.0
        for p in pts {
            x += cos(p.lat * Geo.rad) * cos(p.lon * Geo.rad); y += cos(p.lat * Geo.rad) * sin(p.lon * Geo.rad); z += sin(p.lat * Geo.rad)
        }
        let c = LonLat(atan2(y, x) / Geo.rad, atan2(z, (x * x + y * y).squareRoot()) / Geo.rad)
        let spread = max(1.5, pts.map { Geo.angle(c, $0) }.max() ?? 1.5)
        targetLon = c.lon
        targetLat = max(-60, min(60, c.lat))
        targetZoom = CGFloat(min(3.4, max(1.2, 40 / spread)))
    }

    /// Where the light is on the focused trip's journey, a share of the way along.
    func light(_ now: Date) -> (LonLat, Color)? {
        guard let focus else { return nil }
        let t = min(1, max(0, (now.timeIntervalSince(phaseStart) - 0.9) / 5.0))
        var path: [LonLat] = []
        if let out = focus.flights.first { path += Geo.greatCircle(out.from, out.to, steps: 24) }
        for seg in focus.routePieces { path += seg }
        if focus.flights.count > 1, let back = focus.flights.last { path += Geo.greatCircle(back.from, back.to, steps: 24) }
        guard path.count >= 2 else { return nil }
        var cum = [0.0]
        for i in 1..<path.count { cum.append(cum[i - 1] + Geo.angle(path[i - 1], path[i])) }
        let goal = t * (cum.last ?? 0)
        let i = max(1, cum.firstIndex { $0 >= goal } ?? (path.count - 1))
        let span = max(1e-9, cum[i] - cum[i - 1])
        let f = (goal - cum[i - 1]) / span
        let a = path[i - 1], b = path[i]
        return (LonLat(a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f), focus.color)
    }
}

/// The globe as a hero: it turns in on arrival, turns and tilts under a drag, pinches from
/// 1 to 12 times closer, shows a trip's name card on a tap (a tap on the card opens it),
/// and tours the trips when left alone. It stops drawing when it is off screen.
struct GlobeHero<Overlay: View>: View {
    let trips: [Trip]
    var tour = true
    var onOpen: ((String) -> Void)? = nil
    @ViewBuilder var overlay: (CGFloat) -> Overlay
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scenePhase) private var phase
    @State private var motion = GlobeMotion(intro: !Launch.shot)
    @State private var selected: String?
    @State private var visible = true
    @State private var pinchStart: CGFloat?
    @State private var size: CGSize = .zero

    var body: some View {
        let renderer = GlobeCanvas(trips: trips, style: .home(dark: scheme == .dark))
        TimelineView(.animation(paused: !visible || phase != .active)) { tl in
            let _ = motion.step(tl.date, trips: trips, tour: tour && selected == nil)
            ZStack(alignment: .top) {
                Canvas { ctx, size in
                    renderer.draw(&ctx, size, lon: motion.lon, lat: motion.lat, zoom: motion.zoom, light: motion.light(tl.date), selected: selected)
                }
                .clipped()
                overlay(motion.zoom)
            }
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
        .contentShape(Rectangle())
        .gesture(SidewaysPan(
            onBegin: { motion.touching = true; motion.touched() },
            onChange: { dx, dy in
                // A quarter of a degree per point, less when zoomed in; tilt stays within 60 degrees.
                motion.targetLon -= Double(dx) * 0.25 / Double(motion.zoom)
                motion.targetLat = max(-60, min(60, motion.targetLat + Double(dy) * 0.25 / Double(motion.zoom)))
                motion.lon = motion.targetLon
                motion.lat = motion.targetLat
            },
            onEnd: { vx in
                motion.targetLon -= Double(vx) * 0.25 * 0.25 / Double(motion.zoom)
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
                    motion.targetZoom = min(GlobeMotion.maxZoom, max(1, start * v.magnification))
                    motion.zoom = motion.targetZoom
                    motion.touched()
                }
                .onEnded { _ in pinchStart = nil; motion.touching = false; motion.touched() }
        )
        .simultaneousGesture(SpatialTapGesture().onEnded { v in tap(v.location) }, isEnabled: onOpen != nil)
        .overlay(alignment: .bottom) { card }
        .onScrollVisibilityChange(threshold: 0.05) { visible = $0 }
        .onAppear {
            visible = true
            if !Launch.shot { motion.targetLon = 8 }
        }
        .onDisappear { visible = false }
        .accessibilityLabel("Wereldbol met je reizen")
    }

    /// A tap near a trip's route or dots shows its card; a second tap hides it.
    private func tap(_ point: CGPoint) {
        motion.touched()
        let proj = GlobeCanvas.projection(size, lon: motion.lon, lat: motion.lat, zoom: motion.zoom)
        let reach = 22.0
        var best: (String, Double)?
        for trip in trips {
            let pts = trip.routePieces.joined() + trip.stops.map(\.at) + trip.flights.flatMap { [$0.from, $0.to] }.filter { Geo.angle($0, Demo.homeAirport) >= 0.4 }
            for p in pts {
                let (pt, near) = proj.project(p.lon, p.lat)
                guard near else { continue }
                let d = hypot(Double(pt.x - point.x), Double(pt.y - point.y))
                if d < reach && d < (best?.1 ?? .infinity) { best = (trip.id, d) }
            }
        }
        withAnimation(.snappy) { selected = (best?.0 == selected) ? nil : best?.0 }
    }

    @ViewBuilder private var card: some View {
        if let id = selected, let trip = trips.first(where: { $0.id == id }) {
            Button { onOpen?(id) } label: {
                HStack(spacing: 10) {
                    Circle().fill(trip.color).frame(width: 10, height: 10)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(trip.title).font(.outfit(16, 600)).foregroundStyle(Brand.ink).lineLimit(1)
                        Text(trip.dates).font(.inter(12.5, 500)).foregroundStyle(Brand.inkSoft)
                    }
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Brand.inkSoft)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
            .buttonStyle(.plain)
            .padding(.bottom, 135)
            .transition(.scale(scale: 0.85).combined(with: .opacity))
        }
    }
}

extension GlobeHero where Overlay == EmptyView {
    init(trips: [Trip], tour: Bool = true) {
        self.init(trips: trips, tour: tour, onOpen: nil) { _ in EmptyView() }
    }
}

/// A pan that only starts when the finger moves sideways, so the page keeps scrolling up and down.
struct SidewaysPan: UIGestureRecognizerRepresentable {
    var onBegin: () -> Void = {}
    var onChange: (CGFloat, CGFloat) -> Void
    var onEnd: (CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        return pan
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        switch pan.state {
        case .began:
            onBegin()
        case .changed:
            let t = pan.translation(in: pan.view)
            pan.setTranslation(.zero, in: pan.view)
            onChange(t.x, t.y)
        case .ended, .cancelled:
            onEnd(pan.velocity(in: pan.view).x)
        default:
            break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
            guard let pan = g as? UIPanGestureRecognizer else { return true }
            let v = pan.velocity(in: pan.view)
            return abs(v.x) > abs(v.y) * 1.2
        }
    }
}
