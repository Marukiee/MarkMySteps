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
