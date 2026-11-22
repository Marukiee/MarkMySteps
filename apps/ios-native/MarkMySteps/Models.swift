import CoreLocation
import SwiftUI
import UIKit

/// A point as the API hands it: longitude first, then latitude.
struct LonLat: Hashable {
    var lon: Double
    var lat: Double
    init(_ lon: Double, _ lat: Double) { self.lon = lon; self.lat = lat }
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

struct Person: Hashable {
    let initial: String
    let color: Color
    var name = ""
    var username = ""
    var userId: String? = nil
    var hasAvatar = false
    /// OWNER, MEMBER (reisgenoot) or GUEST.
    var role = "MEMBER"
}

/// How a leg is travelled.
enum Mode: String, CaseIterable, Identifiable, Hashable {
    case car, train, bus, boat, flight
    var id: String { rawValue }

    var label: String {
        switch self {
        case .car: "Auto"
        case .train: "Trein"
        case .bus: "Bus"
        case .boat: "Boot"
        case .flight: "Vlucht"
        }
    }

    var symbol: String {
        switch self {
        case .car: "car.fill"
        case .train: "tram.fill"
        case .bus: "bus.fill"
        case .boat: "ferry.fill"
        case .flight: "airplane"
        }
    }
}

/// The way there or back.
struct Leg: Hashable {
    var mode: Mode
    let from: String
    let to: String
    let km: Int
    /// The way there and back are stops on the server too.
    var serverId: String? = nil
}

/// Drawn stand-ins for photos in the demo, see Landscape.swift.
enum Landscape: Int, CaseIterable, Hashable {
    case desert, sunsetSea, snow, coast, highlands, fjord, mountains
}

/// A place on the plan, with how long the trip stays there.
struct Stop: Hashable {
    let name: String
    let flag: String
    let at: LonLat
    var nights: Int
    let dates: String
    /// How the trip got here from the stop before.
    var mode: Mode = .car
    /// The first day there, known for a stop read from a server.
    var start: Date? = nil
    /// The stop's id on the server, for saving planner changes.
    var serverId: String? = nil
}

/// One trip, in the shape the API hands the app.
struct Trip: Identifiable, Hashable {
    let id: String
    let title: String
    let month: String
    let year: String
    let dates: String
    let days: Int
    let km: Int?
    let color: Color
    /// The colour as the server keeps it ("#E8613C"), when it has one.
    var colorHex: String? = nil
    /// The recorded route: what the globe draws as a line.
    let route: [LonLat]
    /// The route as the server keeps it: separate pieces, never joined into one line.
    var segments: [[LonLat]] = []
    var flights: [Flight] = []
    var stops: [Stop] = []
    var upcoming = false
    var startsInDays: Int? = nil
    var people: [Person] = []
    var extraPeople = 0
    var cover: Landscape? = nil
    var photos = 0
    var outbound: Leg? = nil
    var back: Leg? = nil
    /// You are a guest on it: it shows under Gedeeld, not as your own.
    var shared = false
    /// Everyone on the trip, guests included, for the people sheet.
    var members: [Person] = []
    var ownerId: String? = nil
    /// Set for a trip read from a server.
    var remoteId: String? = nil
    var coverId: String? = nil
    var start: Date? = nil

    struct Flight: Hashable {
        let from: LonLat
        let to: LonLat
    }

    var hasCover: Bool { cover != nil || coverId != nil }
}

/// A photo of a trip: from the server, or a drawn one in the demo.
struct Media: Identifiable, Hashable {
    let id: String
    let takenAt: Date
    let video: Bool
    /// Width over height.
    let ratio: Double
    var scene: Landscape? = nil
    /// Where it was taken, when the photo knows.
    var lat: Double? = nil
    var lon: Double? = nil
}

// MARK: Geometry, ported from Globe.kt

enum Geo {
    static let rad = Double.pi / 180

    /// The angle between two points on the sphere, in degrees.
    static func angle(_ a: LonLat, _ b: LonLat) -> Double {
        let p1 = a.lat * rad, p2 = b.lat * rad
        let d = sin(p1) * sin(p2) + cos(p1) * cos(p2) * cos((b.lon - a.lon) * rad)
        return acos(min(1, max(-1, d))) / rad
    }

    static func greatCircle(_ a: LonLat, _ b: LonLat, steps: Int) -> [LonLat] {
        let l1 = a.lon * rad, p1 = a.lat * rad, l2 = b.lon * rad, p2 = b.lat * rad
        let v1 = (cos(p1) * cos(l1), cos(p1) * sin(l1), sin(p1))
        let v2 = (cos(p2) * cos(l2), cos(p2) * sin(l2), sin(p2))
        let omega = acos(min(1, max(-1, v1.0 * v2.0 + v1.1 * v2.1 + v1.2 * v2.2)))
        if omega < 1e-6 { return [a, b] }
        return (0...steps).map { i in
            let t = Double(i) / Double(steps)
            let s1 = sin((1 - t) * omega) / sin(omega)
            let s2 = sin(t * omega) / sin(omega)
            let x = s1 * v1.0 + s2 * v2.0, y = s1 * v1.1 + s2 * v2.1, z = s1 * v1.2 + s2 * v2.2
            return LonLat(atan2(y, x) / rad, atan2(z, (x * x + y * y).squareRoot()) / rad)
        }
    }

    /// legibleColor(): nudged into a readable range on a light or dark background.
    static func legible(_ color: Color, dark: Bool) -> Color {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a)
        let mx = max(r, g, b), mn = min(r, g, b)
        let l = (mx + mn) / 2
        var h: CGFloat = 0, s: CGFloat = 0
        let d = mx - mn
        if d != 0 {
            s = d / (1 - abs(2 * l - 1))
            if mx == r { h = ((g - b) / d).truncatingRemainder(dividingBy: 6) }
            else if mx == g { h = (b - r) / d + 2 }
            else { h = (r - g) / d + 4 }
            h *= 60
            if h < 0 { h += 360 }
        }
        let s2 = min(0.96, max(s, 0.48))
        let l2 = dark ? min(0.80, max(l, 0.50)) : max(0.26, min(l, 0.54))
        return hsl(h, s2, l2)
    }

    private static func hsl(_ h: CGFloat, _ s: CGFloat, _ l: CGFloat) -> Color {
        let c = (1 - abs(2 * l - 1)) * s
        let x = c * (1 - abs((h / 60).truncatingRemainder(dividingBy: 2) - 1))
        let m = l - c / 2
        let (r, g, b): (CGFloat, CGFloat, CGFloat) = switch h {
        case ..<60: (c, x, 0)
        case ..<120: (x, c, 0)
        case ..<180: (0, c, x)
        case ..<240: (0, x, c)
        case ..<300: (x, 0, c)
        default: (c, 0, x)
        }
        return Color(red: r + m, green: g + m, blue: b + m)
    }
}

/// The trip's route cut where a jump is flown or nothing was recorded, as the
/// web's splitTrack does: each server segment on its own, a hop of more than
/// 400 km cut out; a planned flight gets its arc, a hole too big for the ground
/// gets one too, anything else is a straight dashed gap.
extension Trip {
    static let flightKm = 400.0
    static let intercontinentalKm = 1800.0

    struct Pieces {
        var runs: [[LonLat]] = []
        var gaps: [(LonLat, LonLat)] = []
        var bows: [(LonLat, LonLat)] = []
        var airports: [LonLat] = []
    }

    /// The pieces of route to draw: the server's segments, or the demo's one line.
    var routePieces: [[LonLat]] { segments.isEmpty ? (route.count >= 2 ? [route] : []) : segments }

    var pieces: Pieces {
        var out = Pieces()
        for segment in routePieces {
            var run: [LonLat] = segment.first.map { [$0] } ?? []
            for i in segment.indices.dropFirst() {
                let a = segment[i - 1], b = segment[i]
                let km = Geo.km(a, b)
                let flown = flights.contains { f in
                    (Geo.angle(f.from, a) < 1.2 && Geo.angle(f.to, b) < 1.2) || (Geo.angle(f.from, b) < 1.2 && Geo.angle(f.to, a) < 1.2)
                }
                if km > Trip.flightKm || flown {
                    if run.count >= 2 { out.runs.append(run) }
                    if flown {
                        // The plan draws this one.
                    } else if km > Trip.intercontinentalKm {
                        out.bows.append((a, b)); out.airports += [a, b]
                    } else {
                        out.gaps.append((a, b))
                    }
                    run = [b]
                } else {
                    run.append(b)
                }
            }
            if run.count >= 2 { out.runs.append(run) }
        }
        for f in flights {
            out.bows.append((f.from, f.to))
            out.airports += [f.from, f.to]
        }
        return out
    }
}

extension Geo {
    static func km(_ a: LonLat, _ b: LonLat) -> Double { angle(a, b) * rad * 6371 }

    /// A flight as the web draws it (lib/arc.ts flightArc): a great circle, bowed
    /// away from the ground in Mercator space, more for a long flight, always northward.
    static func flightArc(_ from: LonLat, _ to: LonLat, steps: Int = 48) -> [LonLat] {
        let deg = 1 / rad
        let lon1 = from.lon * rad, lat1 = from.lat * rad, lon2 = to.lon * rad, lat2 = to.lat * rad
        let h = pow(sin((lat2 - lat1) / 2), 2) + cos(lat1) * cos(lat2) * pow(sin((lon2 - lon1) / 2), 2)
        let d = 2 * asin(min(1, h.squareRoot()))
        if d < 1e-9 { return [from, to] }
        var base: [(Double, Double)] = (0...steps).map { i in
            let f = Double(i) / Double(steps)
            let a = sin((1 - f) * d) / sin(d), b = sin(f * d) / sin(d)
            let x = a * cos(lat1) * cos(lon1) + b * cos(lat2) * cos(lon2)
            let y = a * cos(lat1) * sin(lon1) + b * cos(lat2) * sin(lon2)
            let z = a * sin(lat1) + b * sin(lat2)
            return (atan2(y, x) * deg, atan2(z, (x * x + y * y).squareRoot()) * deg)
        }
        // Unwrapped, or a flight over the date line is drawn back across the whole map.
        for i in base.indices.dropFirst() {
            while base[i].0 - base[i - 1].0 > 180 { base[i].0 -= 360 }
            while base[i].0 - base[i - 1].0 < -180 { base[i].0 += 360 }
        }
        func mercY(_ lat: Double) -> Double { log(tan(.pi / 4 + max(-85, min(85, lat)) * rad / 2)) * deg }
        func unmercY(_ y: Double) -> Double { (2 * atan(exp(y * rad)) - .pi / 2) * deg }
        let ax = base[0].0, ay = mercY(base[0].1), bx = base[steps].0, by = mercY(base[steps].1)
        let chord = max(1e-9, ((bx - ax) * (bx - ax) + (by - ay) * (by - ay)).squareRoot())
        var nx = -(by - ay) / chord, ny = (bx - ax) / chord
        if ny < 0 { nx = -nx; ny = -ny }
        let bow = chord * (0.06 + 0.16 * min(1, (d * deg) / 70))
        return base.enumerated().map { i, p in
            let k = bow * sin(.pi * Double(i) / Double(steps))
            return LonLat(p.0 + nx * k, unmercY(mercY(p.1) + ny * k))
        }
    }
}
