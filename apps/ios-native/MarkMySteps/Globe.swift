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

private struct Ortho {
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

/// The globe itself. Animatable, so the intro turn and a flick ease smoothly.
struct GlobeCanvas: View, Animatable {
    var trips: [Trip]
    var style: GlobeStyle
    var rotation: Double
    var centerLon = 8.0
    var centerLat = 38.0

    var animatableData: Double {
        get { rotation }
        set { rotation = newValue }
    }

    var body: some View {
        Canvas { ctx, size in
            let inset: CGFloat = 10
            let radius = min(size.width, size.height) / 2 - 2 - inset
            let proj = Ortho(lon0: centerLon - rotation, lat0: centerLat, cx: size.width / 2, cy: size.height / 2 + inset, r: radius)
            let circle = CGRect(x: proj.cx - radius, y: proj.cy - radius, width: radius * 2, height: radius * 2)
            ctx.fill(Path(ellipseIn: circle), with: .color(style.sphere))
            drawLand(&ctx, size, proj)
            drawTrips(&ctx, proj)
        }
        .accessibilityLabel("Wereldbol met je reizen")
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

    private func drawRoute(_ ctx: inout GraphicsContext, _ points: [LonLat], _ proj: Ortho, _ color: Color, upcoming: Bool) {
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
            ctx.stroke(path, with: .color(color.opacity(0.95)), style: StrokeStyle(lineWidth: style.routeWidth, lineCap: .round, lineJoin: .round))
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

/// The globe as a hero: it turns in on arrival, follows a sideways drag and coasts after a flick.
struct GlobeHero: View {
    let trips: [Trip]
    @Environment(\.colorScheme) private var scheme
    @State private var rotation: Double = Launch.shot ? 0 : -28
    /// The turn-in plays once; coming back to the page keeps where you left the globe.
    @State private var introduced = Launch.shot

    var body: some View {
        GlobeCanvas(trips: trips, style: .home(dark: scheme == .dark), rotation: rotation)
            .contentShape(Rectangle())
            .gesture(SidewaysPan(
                onChange: { dx in rotation += Double(dx) * 0.35 },
                onEnd: { vx in
                    withAnimation(.easeOut(duration: 0.9)) { rotation += Double(vx) * 0.35 * 0.25 }
                }
            ))
            .onAppear {
                guard !introduced else { return }
                introduced = true
                withAnimation(.easeOut(duration: 1.4)) { rotation = 0 }
            }
    }
}

/// A pan that only starts when the finger moves sideways, so the page keeps scrolling up and down.
struct SidewaysPan: UIGestureRecognizerRepresentable {
    var onChange: (CGFloat) -> Void
    var onEnd: (CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        return pan
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        switch pan.state {
        case .changed:
            let t = pan.translation(in: pan.view)
            pan.setTranslation(.zero, in: pan.view)
            onChange(t.x)
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
