import SwiftUI

/// Invented trips, the same as Demo.kt on Android and the demo account on the test server.
enum Demo {
    /// The home airport: a flight from here gets no dot of its own on the globe.
    static let homeAirport = LonLat(4.76, 52.31)

    static let sanne = Person(initial: "S", color: Color(hex: 0xD9A441), name: "Sanne", username: "sanne")
    static let joris = Person(initial: "J", color: Color(hex: 0x5B8DEF), name: "Joris", username: "joris")
    static let mark = Person(initial: "M", color: Color(hex: 0xE8613C), name: "Mark", username: "mark", role: "OWNER")

    static let upcoming = Trip(
        id: "georgia", title: "Georgië 2026", month: "december", year: "2026", dates: "4 t/m 12 dec 2026", days: 8, km: nil,
        color: Color(hex: 0x7DA7D9),
        route: [LonLat(44.79, 41.72), LonLat(44.0, 42.3), LonLat(42.7, 42.25), LonLat(41.64, 41.65)],
        flights: [.init(from: homeAirport, to: LonLat(44.95, 41.67))],
        stops: [
            Stop(name: "Tbilisi", flag: "🇬🇪", at: LonLat(44.79, 41.72), nights: 3, dates: "4 t/m 7 dec"),
            Stop(name: "Kazbegi", flag: "🇬🇪", at: LonLat(44.64, 42.66), nights: 2, dates: "7 t/m 9 dec"),
            Stop(name: "Koetaisi", flag: "🇬🇪", at: LonLat(42.7, 42.25), nights: 1, dates: "9 t/m 10 dec", mode: .bus),
            Stop(name: "Batoemi", flag: "🇬🇪", at: LonLat(41.64, 41.65), nights: 2, dates: "10 t/m 12 dec", mode: .train),
        ],
        upcoming: true, startsInDays: 34, people: [mark, sanne], extraPeople: 2,
        outbound: Leg(mode: .flight, from: "AMS", to: "TBS", km: 3020),
        back: Leg(mode: .flight, from: "BUS", to: "AMS", km: 2890)
    )

    static let past: [Trip] = [
        Trip(
            id: "iceland", title: "IJsland rondom", month: "augustus", year: "2026", dates: "7 t/m 26 aug 2026", days: 19, km: 6616,
            color: Color(hex: 0x2BB6A8),
            route: [LonLat(-21.94, 64.15), LonLat(-19.0, 63.42), LonLat(-15.2, 64.25), LonLat(-14.4, 65.26), LonLat(-18.1, 65.68), LonLat(-21.94, 64.15)],
            flights: [.init(from: homeAirport, to: LonLat(-22.6, 63.98)), .init(from: LonLat(-22.6, 63.98), to: homeAirport)],
            stops: [
                Stop(name: "Reykjavík", flag: "🇮🇸", at: LonLat(-21.94, 64.15), nights: 2, dates: "7 t/m 9 aug"),
                Stop(name: "Vík", flag: "🇮🇸", at: LonLat(-19.0, 63.42), nights: 2, dates: "9 t/m 11 aug"),
                Stop(name: "Höfn", flag: "🇮🇸", at: LonLat(-15.2, 64.25), nights: 3, dates: "11 t/m 14 aug"),
                Stop(name: "Egilsstaðir", flag: "🇮🇸", at: LonLat(-14.4, 65.26), nights: 2, dates: "14 t/m 16 aug"),
                Stop(name: "Akureyri", flag: "🇮🇸", at: LonLat(-18.1, 65.68), nights: 4, dates: "16 t/m 20 aug"),
                Stop(name: "Snæfellsnes", flag: "🇮🇸", at: LonLat(-23.6, 64.85), nights: 3, dates: "20 t/m 23 aug"),
                Stop(name: "Reykjavík", flag: "🇮🇸", at: LonLat(-21.94, 64.15), nights: 3, dates: "23 t/m 26 aug"),
            ],
            people: [mark, sanne, joris], extraPeople: 5, cover: .highlands, photos: 412,
            outbound: Leg(mode: .flight, from: "AMS", to: "KEF", km: 2010), back: Leg(mode: .flight, from: "KEF", to: "AMS", km: 2010)
        ),
        Trip(
            id: "sweden", title: "Zomer in Zweden", month: "juli", year: "2026", dates: "4 t/m 22 jul 2026", days: 18, km: 2347,
            color: Color(hex: 0xD08A2A),
            route: [homeAirport, LonLat(8.6, 53.1), LonLat(10.0, 55.4), LonLat(12.6, 55.7), LonLat(13.0, 55.6), LonLat(15.6, 56.2), LonLat(18.07, 59.33), LonLat(17.1, 61.3), LonLat(14.6, 63.2)],
            stops: [
                Stop(name: "Kopenhagen", flag: "🇩🇰", at: LonLat(12.57, 55.68), nights: 2, dates: "5 t/m 7 jul"),
                Stop(name: "Kalmar", flag: "🇸🇪", at: LonLat(16.36, 56.66), nights: 3, dates: "7 t/m 10 jul"),
                Stop(name: "Stockholm", flag: "🇸🇪", at: LonLat(18.07, 59.33), nights: 4, dates: "10 t/m 14 jul", mode: .train),
                Stop(name: "Östersund", flag: "🇸🇪", at: LonLat(14.64, 63.18), nights: 7, dates: "14 t/m 21 jul"),
            ],
            people: [mark, joris], extraPeople: 2, cover: .sunsetSea, photos: 288,
            outbound: Leg(mode: .car, from: "Thuis", to: "Kopenhagen", km: 780), back: Leg(mode: .car, from: "Östersund", to: "Thuis", km: 1650)
        ),
        Trip(
            id: "sicily", title: "Sicilië rond", month: "mei", year: "2026", dates: "2 t/m 11 mei 2026", days: 9, km: 1243,
            color: Color(hex: 0xE8613C),
            route: [LonLat(13.36, 38.12), LonLat(12.5, 37.8), LonLat(13.6, 37.3), LonLat(14.7, 36.9), LonLat(15.09, 37.5), LonLat(15.29, 37.85)],
            flights: [.init(from: homeAirport, to: LonLat(13.09, 38.18)), .init(from: LonLat(15.07, 37.47), to: homeAirport)],
            stops: [
                Stop(name: "Palermo", flag: "🇮🇹", at: LonLat(13.36, 38.12), nights: 3, dates: "2 t/m 5 mei"),
                Stop(name: "Agrigento", flag: "🇮🇹", at: LonLat(13.58, 37.31), nights: 2, dates: "5 t/m 7 mei"),
                Stop(name: "Noto", flag: "🇮🇹", at: LonLat(15.07, 36.89), nights: 2, dates: "7 t/m 9 mei"),
                Stop(name: "Taormina", flag: "🇮🇹", at: LonLat(15.29, 37.85), nights: 2, dates: "9 t/m 11 mei"),
            ],
            cover: .coast, photos: 196,
            outbound: Leg(mode: .flight, from: "AMS", to: "PMO", km: 1930), back: Leg(mode: .flight, from: "CTA", to: "AMS", km: 2040)
        ),
        Trip(
            id: "lisbon", title: "Lissabon, lang weekend", month: "maart", year: "2026", dates: "13 t/m 16 mrt 2026", days: 4, km: 312,
            color: Color(hex: 0xE34B8A),
            route: [LonLat(-9.14, 38.72), LonLat(-9.39, 38.8), LonLat(-9.42, 38.69), LonLat(-9.14, 38.72)],
            flights: [.init(from: homeAirport, to: LonLat(-9.13, 38.77)), .init(from: LonLat(-9.13, 38.77), to: homeAirport)],
            stops: [Stop(name: "Lissabon", flag: "🇵🇹", at: LonLat(-9.14, 38.72), nights: 3, dates: "13 t/m 16 mrt")],
            cover: .coast, photos: 74
        ),
        Trip(
            id: "marrakech", title: "Marrakech", month: "februari", year: "2026", dates: "14 t/m 22 feb 2026", days: 8, km: 980,
            color: Color(hex: 0xC9772E),
            route: [LonLat(-7.99, 31.63), LonLat(-7.6, 31.0), LonLat(-6.9, 30.92), LonLat(-9.77, 31.51), LonLat(-7.99, 31.63)],
            flights: [.init(from: homeAirport, to: LonLat(-8.03, 31.61)), .init(from: LonLat(-8.03, 31.61), to: homeAirport)],
            stops: [
                Stop(name: "Marrakech", flag: "🇲🇦", at: LonLat(-7.99, 31.63), nights: 3, dates: "14 t/m 17 feb"),
                Stop(name: "Aït Benhaddou", flag: "🇲🇦", at: LonLat(-7.13, 31.05), nights: 1, dates: "17 t/m 18 feb"),
                Stop(name: "Essaouira", flag: "🇲🇦", at: LonLat(-9.77, 31.51), nights: 3, dates: "18 t/m 21 feb"),
            ],
            cover: .desert, photos: 155
        ),
        Trip(
            id: "norway", title: "Noorwegen tot de Lofoten", month: "juli", year: "2025", dates: "5 t/m 17 jul 2025", days: 12, km: 2140,
            color: Color(hex: 0x7A5BD6),
            route: [LonLat(5.32, 60.39), LonLat(6.1, 61.2), LonLat(7.7, 62.6), LonLat(10.4, 63.43), LonLat(14.4, 67.28), LonLat(13.9, 68.2)],
            flights: [.init(from: homeAirport, to: LonLat(5.22, 60.29)), .init(from: LonLat(14.37, 67.27), to: homeAirport)],
            stops: [
                Stop(name: "Bergen", flag: "🇳🇴", at: LonLat(5.32, 60.39), nights: 2, dates: "5 t/m 7 jul"),
                Stop(name: "Geiranger", flag: "🇳🇴", at: LonLat(7.2, 62.1), nights: 2, dates: "7 t/m 9 jul", mode: .boat),
                Stop(name: "Trondheim", flag: "🇳🇴", at: LonLat(10.4, 63.43), nights: 2, dates: "9 t/m 11 jul"),
                Stop(name: "Lofoten", flag: "🇳🇴", at: LonLat(13.9, 68.2), nights: 6, dates: "11 t/m 17 jul", mode: .train),
            ],
            cover: .fjord, photos: 341,
            outbound: Leg(mode: .flight, from: "AMS", to: "BGO", km: 960), back: Leg(mode: .flight, from: "BOO", to: "AMS", km: 1690)
        ),
    ]

    static let sharedCount = 2

    struct Friend: Identifiable, Hashable {
        let name: String
        let handle: String
        let color: Color
        let shared: Int
        var id: String { handle }
    }

    static let friends = [
        Friend(name: "Sanne", handle: "sanne", color: Color(hex: 0xD9A441), shared: 3),
        Friend(name: "Joris", handle: "joris", color: Color(hex: 0x5B8DEF), shared: 2),
        Friend(name: "Lotte", handle: "lotte", color: Color(hex: 0x2BB6A8), shared: 1),
        Friend(name: "Daan", handle: "daan", color: Color(hex: 0x7A5BD6), shared: 1),
    ]

    static let countryNames: [String: String] = [
        "🇮🇸": "IJsland", "🇩🇰": "Denemarken", "🇸🇪": "Zweden", "🇮🇹": "Italië", "🇵🇹": "Portugal",
        "🇲🇦": "Marokko", "🇳🇴": "Noorwegen", "🇬🇪": "Georgië",
    ]

    /// Places the add-a-stop field knows in this test.
    static let places: [(name: String, flag: String, at: LonLat)] = [
        ("Mestia", "🇬🇪", LonLat(42.73, 43.04)), ("Sighnaghi", "🇬🇪", LonLat(45.92, 41.62)), ("Borjomi", "🇬🇪", LonLat(43.39, 41.84)),
        ("Vardzia", "🇬🇪", LonLat(43.28, 41.38)), ("Gori", "🇬🇪", LonLat(44.11, 41.98)),
        ("Húsavík", "🇮🇸", LonLat(-17.34, 66.04)), ("Malmö", "🇸🇪", LonLat(13.0, 55.6)), ("Siracusa", "🇮🇹", LonLat(15.29, 37.07)),
        ("Sintra", "🇵🇹", LonLat(-9.39, 38.8)), ("Chefchaouen", "🇲🇦", LonLat(-5.26, 35.17)), ("Ålesund", "🇳🇴", LonLat(6.15, 62.47)),
    ]

    /// The weather of a day in this test: a mild, slightly wandering temperature per trip.
    static func weather(_ trip: Trip, day: Int) -> Int {
        let base = ["iceland": 11, "sweden": 21, "sicily": 24, "lisbon": 17, "marrakech": 22, "norway": 15, "georgia": 4][trip.id] ?? 18
        return base + ((day * 37) % 5) - 2
    }

    /// Photos of a demo day: drawn landscapes in the shapes a phone takes them.
    static func media(_ trip: Trip, day: Int, date: Date) -> [Media] {
        let ratios: [Double] = [1.5, 0.75, 1.333, 1.778, 0.667, 1.0, 1.5, 0.75, 2.2]
        let seed = day + trip.id.count
        let count = 3 + (day * 7 + trip.id.count) % 5
        return (0..<count).map { k in
            Media(
                id: "\(trip.id)-\(day)-\(k)", takenAt: date, video: false,
                ratio: ratios[(seed * 3 + k * 5) % ratios.count],
                scene: Landscape.allCases[(seed + k) % Landscape.allCases.count]
            )
        }
    }
}

/// One day of a trip: its date and the stop it was spent at.
struct TripDay: Identifiable, Hashable {
    let date: Date
    let stop: Stop?
    let index: Int
    var id: Date { date }
}

extension Trip {
    /// The first day: from the server, or worked out from the first stop's dates.
    var firstDay: Date? {
        if let start { return start }
        guard let first = stops.first else { return nil }
        let day = Int(first.dates.prefix { $0.isNumber }) ?? 1
        let monthName = first.dates.split(separator: " ").last.map(String.init) ?? "jan"
        let month = (Format.monthsShort.firstIndex(of: monthName) ?? 0) + 1
        return Format.calendar.date(from: DateComponents(year: Int(year) ?? 2026, month: month, day: day))
    }

    /// Day by day, each night at its stop.
    var demoDays: [TripDay] {
        guard var date = firstDay else { return [] }
        var out: [TripDay] = []
        for stop in stops {
            for _ in 0..<max(1, stop.nights) {
                out.append(TripDay(date: date, stop: stop, index: out.count))
                date = Format.calendar.date(byAdding: .day, value: 1, to: date) ?? date
            }
        }
        return out
    }
}
