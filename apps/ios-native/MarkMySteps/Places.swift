import Foundation

/// The places of a trip as tiles above the timeline, chosen by where the photos were taken rather than by date
/// (as Android's Places.kt). By date, a stop you only passed through never had a photo (its day belonged to the
/// stop after it), and a city you photographed without it being a stop had no tile at all. So a stop wears the
/// first photo taken at it, wherever that falls in the trip, and photos taken away from every stop are gathered
/// into places of their own, named after where they were taken.
enum TripPlaces {
    /// A photo this close to a stop was taken at it.
    static let atKm = 8.0
    /// Further out, still the stop's surroundings when nothing closer was taken (the web's STOP_NEAR_KM).
    static let aroundKm = 30.0
    /// Photos this close together, away from the stops, are one place.
    static let groupKm = 10.0
    /// A place of its own needs at least this many photos: a few shots from the road are not a visit.
    static let groupMin = 4

    struct Tile: Identifiable {
        let name: String
        let flag: String?
        /// The photos to show, the first that loads wins.
        let photos: [String]
        /// The day to jump to on a tap.
        let day: Date?
        /// Order in the trip: the index of its first photo, else where the stop sits.
        let order: Int
        var id: String { name }
    }

    struct Extra {
        let at: LonLat
        let photos: [Media]
        let order: Int
    }

    static func km(_ a: LonLat, _ b: LonLat) -> Double {
        let r = Double.pi / 180
        let dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r
        let h = pow(sin(dLat / 2), 2) + cos(a.lat * r) * cos(b.lat * r) * pow(sin(dLon / 2), 2)
        return 2 * 6371 * asin(sqrt(h))
    }

    private static func at(_ m: Media) -> LonLat? {
        guard let lat = m.lat, let lon = m.lon else { return nil }
        return LonLat(lon, lat)
    }

    /// The stops (and day trips you photographed) with the photos that show each, in trip order.
    static func stops(_ trip: Trip, _ media: [Media]) -> [Tile] {
        let stills = media.enumerated().filter { !$0.element.video }
        let located = stills.compactMap { e in at(e.element).map { (e.offset, e.element, $0) } }
        var out: [Tile] = []
        for (i, stop) in trip.mapStops.map(\.stop).enumerated() {
            var picks = located.filter { km($0.2, stop.at) <= atKm }.map { ($0.0, $0.1) }
            if picks.isEmpty {
                picks = located.map { ($0, km($0.2, stop.at)) }.filter { $0.1 <= aroundKm }.sorted { $0.1 < $1.1 }.map { ($0.0.0, $0.0.1) }
            }
            if picks.isEmpty {
                // Only photos that do not know where they were taken still go by the day.
                picks = stills.filter { at($0.element) == nil && Timeline.stopOn(trip, $0.element.takenAt)?.name == stop.name }.map { ($0.offset, $0.element) }
            }
            out.append(Tile(name: stop.name, flag: stop.flag, photos: picks.prefix(8).map(\.1.id), day: picks.first?.1.takenAt ?? stop.start, order: picks.first?.0 ?? i * 100_000))
            // A day trip earns a tile by a photo actually taken there.
            for d in stop.dayTrips where !out.contains(where: { $0.name == d.name }) {
                let near = located.filter { km($0.2, d.at) <= atKm }
                if let first = near.first {
                    out.append(Tile(name: d.name, flag: d.flag, photos: near.prefix(8).map(\.1.id), day: first.1.takenAt, order: first.0))
                }
            }
        }
        return out
    }

    /// Places where photos were taken away from every stop and day trip, in the order you were there.
    static func extras(_ trip: Trip, _ media: [Media]) -> [Extra] {
        let known = trip.stops.flatMap { s in [s.at] + s.dayTrips.map(\.at) }
        var groups: [[(Int, Media, LonLat)]] = []
        for (i, m) in media.enumerated() where !m.video {
            guard let p = at(m), !known.contains(where: { km($0, p) <= atKm }) else { continue }
            if let g = groups.firstIndex(where: { km($0[0].2, p) <= groupKm }) { groups[g].append((i, m, p)) } else { groups.append([(i, m, p)]) }
        }
        return groups.filter { $0.count >= groupMin }.map { g in Extra(at: g[0].2, photos: g.map(\.1), order: g[0].0) }
    }

    // MARK: Names of the extra places, kept on the phone so the row opens with them

    private static func key(_ p: LonLat) -> String { "place." + String(format: "%.2f,%.2f", p.lat, p.lon) }

    /// The city's name already known for a spot ("" for nowhere), without asking.
    static func knownName(_ p: LonLat) -> String? { UserDefaults.standard.string(forKey: key(p)) }

    /// The city's name for a spot (Photon, as the viewer's place line), nil when the lookup failed.
    static func name(_ p: LonLat) async -> String? {
        if let known = knownName(p) { return known }
        guard let full = try? await ViewerApi.placeName(lat: p.lat, lon: p.lon) else { return nil }
        let city = (full ?? "").components(separatedBy: ", ").first?.trimmingCharacters(in: .whitespaces) ?? ""
        UserDefaults.standard.set(city, forKey: key(p))
        return city
    }
}
