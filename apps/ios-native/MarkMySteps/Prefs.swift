import Foundation

/// Choices kept on this phone only, as Android's UiPrefs.
enum Prefs {
    private static let d = UserDefaults.standard

    /// Your airports, the first one home: the way there starts from it, and flights offer them first.
    static var airports: [String] {
        get { d.stringArray(forKey: "set.airports") ?? [] }
        set { d.set(newValue, forKey: "set.airports") }
    }
}
