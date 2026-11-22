import CoreText
import SwiftUI
import UIKit

// MARK: Colours

extension UIColor {
    nonisolated convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(uiColor: UIColor(hex: hex, alpha: alpha))
    }

    /// One colour for light and one for dark, resolved by the system.
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: Color.dynamic(light: light, dark: dark))
    }

    /// Resolved by UIKit on whatever thread renders (SwiftUI resolves colours off the main thread too), so the
    /// provider must not be tied to the main actor.
    nonisolated private static func dynamic(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { @Sendable traits in traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) }
    }
}

/// The brand tokens of the web app, mapped onto iOS surfaces.
enum Brand {
    /// The logo is always the brand orange, also in dark mode.
    static let logo = Color(hex: 0xE8613C)
    static let accent = Color.accentColor
    /// Warm paper in light (Android's background), the web's dark paper in dark (a normal dark mode, not black).
    static let paper = Color(light: 0xFBF7F2, dark: 0x14181D)
    /// Cards and grouped rows. Never white on the light beige: a deeper warm tone, as Android's surface
    /// containers. No shadows anywhere: tone alone sets them off.
    static let raised = Color(light: 0xF0E8DB, dark: 0x222A33)
    /// Fields, chips and controls inside a card, a step deeper again so they stand off the card.
    static let sunken = Color(light: 0xE5DACA, dark: 0x2E3742)
    static let line = Color(light: 0xDCD1C0, dark: 0x3A444F)
    static let ink = Color(light: 0x1B2530, dark: 0xEEF1F4)
    static let inkSoft = Color(light: 0x5E6B77, dark: 0xA7B2BD)
}

// MARK: Fonts

/// The three variable fonts of the web app. They are registered at runtime,
/// because a generated Info.plist cannot list UIAppFonts.
enum Fonts {
    private static var bases: [String: CTFontDescriptor] = [:]
    private static var cache: [String: UIFont] = [:]

    static func register() {
        for (family, file) in [("Outfit", "outfit_var"), ("Inter", "inter_var"), ("Fraunces", "fraunces_var")] {
            guard let url = Bundle.main.url(forResource: file, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            // Keep a descriptor straight from the file, so the weight axis can be set exactly.
            if let list = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor], let first = list.first {
                bases[family] = first
            }
        }
    }

    /// A font at an exact point on the weight axis (400 regular, 700 bold).
    static func ui(_ family: String, _ size: CGFloat, _ weight: CGFloat) -> UIFont {
        let key = "\(family)/\(size)/\(weight)"
        if let hit = cache[key] { return hit }
        guard let base = bases[family] else { return .systemFont(ofSize: size) }
        let wght: UInt32 = 0x7767_6874 // 'wght'
        let varied = CTFontDescriptorCreateCopyWithVariation(base, NSNumber(value: wght), weight)
        let font = CTFontCreateWithFontDescriptor(varied, size, nil) as UIFont
        cache[key] = font
        return font
    }
}

extension Font {
    /// Headings, titles and big numbers.
    static func outfit(_ size: CGFloat, _ weight: CGFloat = 600) -> Font { Font(Fonts.ui("Outfit", size, weight)) }
    /// Body text.
    static func inter(_ size: CGFloat, _ weight: CGFloat = 450) -> Font { Font(Fonts.ui("Inter", size, weight)) }
    /// The day headings of the timeline.
    static func fraunces(_ size: CGFloat, _ weight: CGFloat = 560) -> Font { Font(Fonts.ui("Fraunces", size, weight)) }
}

// MARK: Logo

/// The MarkMySteps compass: a circle and the needle, stroked, nothing behind it.
/// The needle can turn on its own about the centre (the globe zoom, the spinner).
struct CompassLogo: View {
    var size: CGFloat = 34
    var color: Color = Brand.logo
    var lineWidth: CGFloat = 2.1
    /// Degrees the needle is turned from its north-east rest.
    var needle: Double = 0

    var body: some View {
        Canvas { ctx, box in
            let s = box.width / 24
            let style = StrokeStyle(lineWidth: lineWidth * s, lineCap: .round, lineJoin: .round)
            ctx.stroke(Path(ellipseIn: CGRect(x: (12 - 9.4) * s, y: (12 - 9.4) * s, width: 18.8 * s, height: 18.8 * s)), with: .color(color), style: style)
            var path = Path()
            path.move(to: CGPoint(x: 16.4 * s, y: 7.6 * s))
            path.addLine(to: CGPoint(x: 13.9 * s, y: 13.9 * s))
            path.addLine(to: CGPoint(x: 7.6 * s, y: 16.4 * s))
            path.addLine(to: CGPoint(x: 10.1 * s, y: 10.1 * s))
            path.closeSubpath()
            let c = CGPoint(x: 12 * s, y: 12 * s)
            let turn = CGAffineTransform(translationX: c.x, y: c.y).rotated(by: needle * .pi / 180).translatedBy(x: -c.x, y: -c.y)
            ctx.stroke(path.applying(turn), with: .color(color), style: style)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The app's own loading indicator, as on the web: the needle makes two turns every
/// 2.8 s, winding up and easing off (720t minus 52 sin 4 pi t), resting north-east.
struct CompassSpinner: View {
    var size: CGFloat = 36
    var color: Color = Brand.logo

    var body: some View {
        TimelineView(.animation) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.8) / 2.8
            CompassLogo(size: size, color: color, needle: 720 * t - 52 * sin(4 * .pi * t))
        }
        .accessibilityLabel("Bezig met laden")
    }
}

// MARK: Motion

/// A block arriving the first time a page shows: up a little and in, a beat after the one above.
struct Arrive: ViewModifier {
    let order: Int
    @State private var shown = Launch.shot

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 14)
            .onAppear {
                guard !shown else { return }
                withAnimation(.smooth(duration: 0.45).delay(Double(order) * 0.04)) { shown = true }
            }
    }
}

extension View {
    func arrive(_ order: Int) -> some View { modifier(Arrive(order: order)) }
}

/// Cards dip a little under the finger and settle back without a wobble, as in Apple's own apps.
struct PressStyle: ButtonStyle {
    var scale: CGFloat = 0.98
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.smooth(duration: 0.22), value: configuration.isPressed)
    }
}

extension Animation {
    /// The app's one motion for content changes: Apple's smooth spring, no overshoot.
    static let calm = Animation.smooth(duration: 0.32)
}

/// Light, tasteful taps: a selection that changes, a switch, a pull to an action. Never on scrolling.
enum Haptic {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
    /// Past the end of a range, or something that cannot be done here: a short firm knock that says no.
    static func reject() { UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 0.75) }
}

// MARK: Text helpers

enum Format {
    static let dutch = Locale(identifier: "nl_NL")
    static let monthsShort = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
    static let monthsLong = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"]

    /// 6616 becomes "6.616", as written in the Netherlands.
    static func number(_ n: Int) -> String { n.formatted(.number.locale(dutch)) }

    static func km(_ n: Int) -> String { "\(number(n)) km" }

    static func shortMonth(_ month: String) -> String {
        if let i = monthsLong.firstIndex(of: month) { return monthsShort[i] }
        return String(month.prefix(3))
    }

    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    /// "Dinsdag 4 december"
    static func dayHeading(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = dutch
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEEE d MMMM"
        let s = f.string(from: date)
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// "4 t/m 12 dec", with the year when asked; never with a dash.
    static func range(_ a: Date, _ b: Date, withYear: Bool) -> String {
        let c = calendar
        let da = c.component(.day, from: a), db = c.component(.day, from: b)
        let ma = c.component(.month, from: a), mb = c.component(.month, from: b)
        let end = "\(db) \(monthsShort[mb - 1])" + (withYear ? " \(c.component(.year, from: b))" : "")
        return ma == mb ? "\(da) t/m \(end)" : "\(da) \(monthsShort[ma - 1]) t/m \(end)"
    }

    static func shortDay(_ d: Date) -> String {
        let c = calendar
        return "\(c.component(.day, from: d)) \(monthsShort[c.component(.month, from: d) - 1])"
    }
}

// MARK: Flags

/// A flat flag from the web's own set (Assets: Flags/<code>), 4:3 with softly rounded
/// corners and a hairline edge so white flags do not dissolve. The emoji only when a
/// country has no file.
struct FlagView: View {
    /// An emoji flag ("🇳🇱") or a two-letter code ("NL").
    let flag: String
    var height: CGFloat = 15

    private var code: String? {
        let scalars = flag.unicodeScalars.filter { (0x1F1E6...0x1F1FF).contains($0.value) }
        if scalars.count == 2 {
            return String(scalars.compactMap { Unicode.Scalar($0.value - 0x1F1E6 + 97) }.map(Character.init))
        }
        return flag.count == 2 ? flag.lowercased() : nil
    }

    var body: some View {
        if let code, UIImage(named: "Flags/\(code)") != nil {
            let radius = height * 0.17
            Image("Flags/\(code)")
                .resizable()
                .aspectRatio(4 / 3, contentMode: .fill)
                .frame(width: height * 4 / 3, height: height)
                .clipShape(.rect(cornerRadius: radius))
                .overlay { RoundedRectangle(cornerRadius: radius).strokeBorder(.black.opacity(0.1), lineWidth: 0.5) }
                .accessibilityHidden(true)
        } else {
            Text(flag).font(.system(size: height)).accessibilityHidden(true)
        }
    }
}

// MARK: Locked controls

/// Something you cannot change here (you are a guest, or only the organiser may): the control shows grey, and only a
/// tap on it says why, with a soft knock. Never a standing warning under it. `nil` leaves the control as it is.
struct LockedExplained: ViewModifier {
    let reason: String?
    var title = "Niet aan te passen"
    @State private var asked = false

    func body(content: Content) -> some View {
        content
            .disabled(reason != nil)
            .overlay {
                if reason != nil {
                    Color.clear
                        .contentShape(.rect)
                        .onTapGesture { Haptic.reject(); asked = true }
                }
            }
            .alert(title, isPresented: $asked) { Button("OK", role: .cancel) {} } message: { Text(reason ?? "") }
    }
}

extension View {
    func locked(_ reason: String?, title: String = "Niet aan te passen") -> some View {
        modifier(LockedExplained(reason: reason, title: title))
    }
}
