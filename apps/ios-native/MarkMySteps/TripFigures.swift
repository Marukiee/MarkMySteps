import Foundation

/*
 * How a trip's figures are counted, by the same rules as the server, the web
 * and Android's TripFigures.kt, so a trip says the same number on every
 * screen. Foundation only, so Tests/run-trip-figures.sh can check it without
 * the app.
 */
enum TripFigures {
    /// The country you live in: not a country visited (the server's HOME_COUNTRY).
    static let homeCountry = "nl"

    /// "🇲🇦" to "ma"; a two-letter code stays as it is; anything else (the 📍 of a stop without a country) is nil.
    static func code(ofFlag flag: String?) -> String? {
        guard let flag else { return nil }
        if flag.count == 2, flag.allSatisfy({ $0.isASCII && $0.isLetter }) { return flag.lowercased() }
        let scalars = flag.unicodeScalars.filter { (0x1F1E6...0x1F1FF).contains($0.value) }
        guard scalars.count == 2 else { return nil }
        return String(scalars.compactMap { Unicode.Scalar($0.value - 0x1F1E6 + 97) }.map(Character.init))
    }

    /// How many countries a trip went to, as the server's trip stats count them: every country code of its stops,
    /// day trips included, once each; a stop without a country and the home country do not count.
    static func countryCount(codes: [String?]) -> Int {
        Set(codes.compactMap { $0?.lowercased() }.filter { $0.count == 2 && $0 != homeCountry }).count
    }

    /// How many places a plan covers, for the stops figure, as the server's countStopPlaces: every route stop, even
    /// a city slept in twice, and a day trip once per place (~100 m), however often it is made. The way there and
    /// back is not among the route stops (it is the trip's outbound and back leg).
    static func stopPlaceCount(route: [(lat: Double, lon: Double)], dayTrips: [(lat: Double, lon: Double)]) -> Int {
        var seen = Set<String>()
        var count = 0
        for p in route {
            seen.insert(spot(p))
            count += 1
        }
        for p in dayTrips where seen.insert(spot(p)).inserted { count += 1 }
        return count
    }

    private static func spot(_ p: (lat: Double, lon: Double)) -> String {
        String(format: "%.3f,%.3f", p.lat, p.lon)
    }
}
