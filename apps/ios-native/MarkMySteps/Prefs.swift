import Foundation

/// Choices kept on this phone only, as Android's UiPrefs.
enum Prefs {
    private static let d = UserDefaults.standard

    /// Your airports, the first one home: the way there starts from it, and flights offer them first.
    static var airports: [String] {
        get { d.stringArray(forKey: "set.airports") ?? [] }
        set { d.set(newValue, forKey: "set.airports") }
    }

    // MARK: Figures on a trip's cover

    static let factIds = ["km", "days", "stops", "photos", "travellers", "countries"]
    static let factNames = ["km": "Afstand", "days": "Dagen", "stops": "Stops", "photos": "Foto's", "travellers": "Reisgenoten", "countries": "Landen"]
    static let factsMax = 4

    /// The figures picked for a trip in its settings, in the order picked; nil lets the page choose.
    static func facts(_ tripId: String) -> [String]? {
        guard let data = d.data(forKey: "tripFacts"), let all = try? JSONDecoder().decode([String: [String]].self, from: data) else { return nil }
        return all[tripId].flatMap { $0.isEmpty ? nil : $0 }
    }

    static func setFacts(_ tripId: String, _ ids: [String]?) {
        var all = (d.data(forKey: "tripFacts").flatMap { try? JSONDecoder().decode([String: [String]].self, from: $0) }) ?? [:]
        all[tripId] = (ids?.isEmpty ?? true) ? nil : ids
        d.set(try? JSONEncoder().encode(all), forKey: "tripFacts")
    }
}
