import Foundation

/// The language the app speaks, for the few texts the native side writes
/// itself: the errors a plugin hands back to the page, the tracker's status,
/// and the language the background check asks the server to write in.
///
/// The page says which language it chose (Settings can differ from the phone),
/// and it is kept here so the background check, which runs without the page,
/// still knows. Until the page has said anything, iOS picks as usual.
enum AppLang {
    private static let key = "mms.lang"

    static func set(_ lang: String) {
        UserDefaults.standard.set(lang, forKey: key)
    }

    private static var chosen: String? {
        guard let lang = UserDefaults.standard.string(forKey: key), !lang.isEmpty else { return nil }
        return lang
    }

    /// For the server, which writes the phone's notification in this language.
    static var header: String {
        chosen ?? Bundle.main.preferredLocalizations.first ?? "en"
    }

    /// The text for a key in Localizable.strings, in the app's language.
    static func text(_ key: String, _ args: CVarArg...) -> String {
        let bundle = chosen
            .flatMap { Bundle.main.path(forResource: $0, ofType: "lproj") }
            .flatMap { Bundle(path: $0) } ?? .main
        let format = bundle.localizedString(forKey: key, value: nil, table: nil)
        return args.isEmpty ? format : String(format: format, arguments: args)
    }
}
