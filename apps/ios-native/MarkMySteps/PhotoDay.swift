import Foundation

/*
 * The day a photo was taken, where it was taken, as the server, the web
 * (lib/photoDay.ts) and Android (PhotoDay.kt) decide it. takenAt is the moment
 * in UTC, and its date is the wrong day for a good part of the world: 05:30 in
 * Bangkok is 22:30 UTC the day before. The server also sends takenAtLocal, the
 * clock where the photo was taken written as if it were UTC (Immich's
 * localDateTime), so its date is the day you would call it there. A photo
 * synced before the server kept it has none until its next sync; its UTC date
 * stands in, as it always did. Foundation only, so Tests/run-trip-figures.sh
 * can check it without the app.
 */
enum PhotoDay {
    /// The photo's day as the app keeps days (midnight UTC, see Format.calendar); nil when takenAt is unreadable.
    static func of(takenAt: String?, takenAtLocal: String?) -> Date? {
        day(takenAtLocal) ?? day(takenAt)
    }

    /// "2026-04-02T05:30:00.000Z" to 2 April at midnight UTC; nil for nothing or nonsense.
    static func day(_ iso: String?) -> Date? {
        guard let iso, iso.count >= 10 else { return nil }
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
