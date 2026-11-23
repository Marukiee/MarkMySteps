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

    /// A place that can wear a tile: a stop, or a day trip from one.
    private struct Spot {
        let name: String, flag: String?, at: LonLat, cover: String?, start: Date?, dayTrip: Bool, fallbackOrder: Int
    }

    /// The stops (and day trips you photographed) with the photos that show each, in trip order, as Android's.
    ///
    /// Each photo that knows where it was taken belongs to the NEAREST place, so two places close together (Granada
    /// and Monachil, 8 km apart) each get their own photos instead of both wearing the first photo within 8 km. Of a
    /// place's own photos the one taken closest to its heart shows it; a cover the owner picked for the place in the
    /// viewer always wins.
    static func stops(_ trip: Trip, _ media: [Media]) -> [Tile] {
        let stills = media.enumerated().filter { !$0.element.video }
        let located = stills.compactMap { e in at(e.element).map { (e.offset, e.element, $0) } }
        let known = Set(media.map(\.id))
        var spots: [Spot] = []
        for (i, stop) in trip.mapStops.map(\.stop).enumerated() where !spots.contains(where: { $0.name == stop.name }) {
            spots.append(Spot(name: stop.name, flag: stop.flag, at: stop.at, cover: stop.cover, start: stop.start, dayTrip: false, fallbackOrder: i * 100_000))
            for d in stop.dayTrips where !spots.contains(where: { $0.name == d.name }) {
                spots.append(Spot(name: d.name, flag: d.flag, at: d.at, cover: d.cover, start: d.day, dayTrip: true, fallbackOrder: i * 100_000 + 1))
            }
        }
        // Every located photo to the nearest place within reach.
        var own: [[(Int, Media, Double)]] = Array(repeating: [], count: spots.count)
        for p in located {
            guard let best = spots.indices.map({ ($0, km(p.2, spots[$0].at)) }).min(by: { $0.1 < $1.1 }), best.1 <= aroundKm else { continue }
            own[best.0].append((p.0, p.1, best.1))
        }
        var out: [Tile] = []
        for (i, spot) in spots.enumerated() {
            let mine = own[i]
            let taken = mine.filter { $0.2 <= atKm }
            let chosen = spot.cover.flatMap { known.contains($0) ? $0 : nil }
            // A day trip earns a tile only by a photo actually taken there.
            if spot.dayTrip && taken.isEmpty && chosen == nil { continue }
            // Taken at it first, closest to its heart first; then its surroundings.
            var picks = (taken.isEmpty ? mine : taken).sorted { $0.2 < $1.2 }.map { ($0.0, $0.1) }
            if picks.isEmpty {
                // Only photos that do not know where they were taken still go by the day.
                picks = stills.filter { at($0.element) == nil && Timeline.stopOn(trip, $0.element.takenAt)?.name == spot.name }.map { ($0.offset, $0.element) }
            }
            let ids = Array(([chosen].compactMap { $0 } + picks.map(\.1.id).filter { $0 != chosen }).prefix(8))
            let firstThere = mine.min { $0.0 < $1.0 }.map { ($0.0, $0.1) } ?? picks.min { $0.0 < $1.0 }
            let chosenDay = chosen.flatMap { c in media.first { $0.id == c }?.takenAt }
            out.append(Tile(name: spot.name, flag: spot.flag, photos: ids, day: firstThere?.1.takenAt ?? chosenDay ?? spot.start, order: firstThere?.0 ?? spot.fallbackOrder))
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
