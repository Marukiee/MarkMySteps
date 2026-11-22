import Foundation

/// Every airport with scheduled flights and an IATA code, the same list the web searches (OurAirports, made by
/// apps/web/scripts/build-airports.mjs), read from the app's bundle the first time a flight needs it.
actor FlightAirports {
    struct Airport: Hashable, Sendable {
        let iata: String
        let name: String
        let city: String
        let country: String
        let lat: Double
        let lon: Double
        let size: Character
    }

    static let shared = FlightAirports()
    private var list: [Airport] = []
    private var folded: [(city: String, name: String, any: String)] = []
    /// Read on the main thread for labels; filled once the list is in.
    @MainActor static private(set) var byCode: [String: Airport] = [:]

    private static func fold(_ s: String) -> String { s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .init(identifier: "en")) }

    func load() async {
        guard list.isEmpty, let url = Bundle.main.url(forResource: "airports", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        var rows: [Airport] = []
        var f: [(String, String, String)] = []
        for line in text.split(separator: "\n") {
            let p = line.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
            guard p.count >= 7, let lat = Double(p[4]), let lon = Double(p[5]) else { continue }
            let a = Airport(iata: p[0], name: p[1], city: p[2], country: p[3], lat: lat, lon: lon, size: p[6].first ?? "S")
            rows.append(a)
            let words = p.count > 7 ? p[7] : ""
            f.append((Self.fold(a.city), Self.fold(a.name), Self.fold("\(a.iata) \(a.city) \(a.name) \(words)")))
        }
        list = rows
        folded = f
        let map = Dictionary(rows.map { ($0.iata, $0) }, uniquingKeysWith: { a, _ in a })
        await MainActor.run { FlightAirports.byCode = map }
    }

    /// As the web scores a search: the code, then the city, then the name, then anything else it is known by.
    func search(_ query: String, limit: Int = 6) async -> [Airport] {
        await load()
        let q = Self.fold(query.trimmingCharacters(in: .whitespaces))
        guard !q.isEmpty else { return [] }
        var scored: [(Airport, Int)] = []
        for (i, a) in list.enumerated() {
            let (city, name, any) = folded[i]
            var score = 0
            if a.iata.lowercased() == q { score = 100 }
            else if city == q { score = 80 }
            else if city.hasPrefix(q) { score = 60 }
            else if name.hasPrefix(q) { score = 50 }
            else if any.contains(" " + q) { score = 40 }
            else if any.contains(q) { score = 20 }
            score += a.size == "L" ? 3 : a.size == "M" ? 1 : 0
            if score > 3 { scored.append((a, score)) }
        }
        return scored.sorted { $0.1 > $1.1 }.prefix(limit).map(\.0)
    }

    /// The airport for a city within about 250 km, a hub counting as closer than it is (web nearestAirport).
    func nearest(_ at: LonLat?) async -> Airport? {
        await load()
        guard let at else { return nil }
        var best: Airport?
        var bestScore = Double.greatestFiniteMagnitude
        for a in list {
            let km = hypot((a.lon - at.lon) * cos(at.lat * .pi / 180), a.lat - at.lat) * 111
            if km > 250 { continue }
            let score = km * (a.size == "L" ? 1 : a.size == "M" ? 3 : 6)
            if score < bestScore { bestScore = score; best = a }
        }
        return best
    }

    /// "Eindhoven (EIN)", or just the code for one the list does not know.
    @MainActor static func label(_ code: String) -> String { byCode[code].map { "\($0.city) (\($0.iata))" } ?? code }

    /// Great circle distance between two airports, in km.
    @MainActor static func km(_ from: String?, _ to: String?) -> Int? {
        guard let from, let to, let a = byCode[from], let b = byCode[to] else { return nil }
        return Int(Geo.km(LonLat(a.lon, a.lat), LonLat(b.lon, b.lat)).rounded())
    }

    /// "5u 38m" for a flight, from the distance along its airports (layovers included), as the web estimates it.
    @MainActor static func flightTime(_ codes: [String]) -> String? {
        guard codes.count >= 2 else { return nil }
        var total = 0
        for i in 1..<codes.count {
            guard let km = km(codes[i - 1], codes[i]) else { return nil }
            total += km
        }
        return estimateDuration(total, .flight, legs: codes.count - 1)
    }

    /// A rough travel time for a distance, as the web's estimateDuration: an average speed plus time at the terminal.
    static func estimateDuration(_ km: Int, _ mode: Mode, legs: Int = 1) -> String {
        let (kmh, overhead): (Double, Int) = switch mode {
        case .car: (75, 0)
        case .train: (110, 15)
        case .bus: (65, 15)
        case .boat: (35, 30)
        case .flight: (750, 90)
        }
        let total = Int((Double(km) / kmh * 60).rounded()) + overhead * max(1, legs)
        return total >= 60 ? "\(total / 60)u \(total % 60)m" : "\(total)m"
    }
}

/// What the route planner writes to the server beyond nights, order and new stops, as Android's PlannerRemote.
enum PlannerRemote {
    static func modeName(_ m: Mode) -> String {
        switch m { case .car: "GROUND"; case .train: "TRAIN"; case .bus: "BUS"; case .boat: "BOAT"; case .flight: "FLIGHT" }
    }

    static func cleanCode(_ code: String?) -> String? {
        guard let c = code?.trimmingCharacters(in: .whitespaces).uppercased(), c.range(of: "^[A-Z]{3,4}$", options: .regularExpression) != nil else { return nil }
        return c
    }

    static func cleanNumber(_ number: String?) -> String? {
        let n = String((number ?? "").uppercased().replacingOccurrences(of: " ", with: "").prefix(16))
        return n.isEmpty ? nil : n
    }

    /// Away from a flight the server clears the airports and the flight number by itself.
    static func setMode(_ trip: Trip, _ stopId: String, _ mode: Mode) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("PATCH", "/api/trips/\(rid)/stops/\(stopId)", body: ["travelMode": modeName(mode)])
    }

    /// A flight as filled in. Only what is valid goes along (3 or 4 letters for an airport, up to 16 characters for a
    /// number), so a half typed code never turns the whole save down. An emptied number is cleared.
    static func saveFlight(_ trip: Trip, _ stopId: String, number: String, from: String?, to: String?, via: [String]) async throws {
        guard let rid = trip.remoteId else { return }
        var body: [String: Any] = ["travelMode": "FLIGHT", "flightNumber": cleanNumber(number) ?? ""]
        if let f = cleanCode(from) { body["fromAirport"] = f }
        if let t = cleanCode(to) { body["toAirport"] = t }
        body["viaAirports"] = via.compactMap(cleanCode)
        try await Api.shared.send("PATCH", "/api/trips/\(rid)/stops/\(stopId)", body: body)
    }

    /// An excursion from a stop and back the same day: no nights, and never a leg of the route.
    static func addDayTrip(_ trip: Trip, id: String, parentId: String, place: Remote.Place, day: Date) async throws {
        guard let rid = trip.remoteId else { return }
        var body: [String: Any] = [
            "id": id, "name": String(place.name.prefix(120)), "nights": 0, "parentStopId": parentId, "dayTripDate": isoDay(day),
            "latitude": place.at.lat, "longitude": place.at.lon,
        ]
        if let c = place.countryCode { body["countryCode"] = c }
        try await Api.shared.send("POST", "/api/trips/\(rid)/stops", body: body)
    }

    /// The way there or back, a stop of its own with no nights, named as the web names it. The way there is added at
    /// the end like any stop and then moved to the front with the whole order.
    static func addLeg(_ trip: Trip, id: String, outbound: Bool, mode: Mode, order: [String]?) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("POST", "/api/trips/\(rid)/stops", body: [
            "id": id, "name": outbound ? "Heenreis" : "Terugreis", "nights": 0, "travelMode": modeName(mode),
        ])
        if let order { try await Remote.reorderStops(trip, order) }
    }

    static func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Format.calendar; f.timeZone = Format.calendar.timeZone; f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}
