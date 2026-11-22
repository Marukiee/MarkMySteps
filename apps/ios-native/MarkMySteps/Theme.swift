import CoreText
import SwiftUI
import UIKit

// MARK: Colours

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
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
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

/// The brand tokens of the web app, mapped onto iOS surfaces.
enum Brand {
    /// The logo is always the brand orange, also in dark mode.
    static let logo = Color(hex: 0xE8613C)
    static let accent = Color.accentColor
    /// Warm paper in light, the web's dark paper in dark (a normal dark mode, not black).
    /// A touch deeper than #FBF7F2 so white cards stand off it clearly.
    static let paper = Color(light: 0xF6F0E7, dark: 0x14181D)
    /// Cards and grouped rows. No shadows anywhere: tone alone sets them off.
    static let raised = Color(light: 0xFFFFFF, dark: 0x222A33)
    /// Fields, chips and controls inside a card.
    static let sunken = Color(light: 0xEFE7DB, dark: 0x2E3742)
    static let line = Color(light: 0xE2D9CB, dark: 0x3A444F)
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
struct CompassLogo: View {
    var size: CGFloat = 34
    var color: Color = Brand.logo
    var lineWidth: CGFloat = 2.1

    var body: some View {
        Canvas { ctx, box in
            let s = box.width / 24
            var path = Path()
            path.addEllipse(in: CGRect(x: (12 - 9.4) * s, y: (12 - 9.4) * s, width: 18.8 * s, height: 18.8 * s))
            path.move(to: CGPoint(x: 16.4 * s, y: 7.6 * s))
            path.addLine(to: CGPoint(x: 13.9 * s, y: 13.9 * s))
            path.addLine(to: CGPoint(x: 7.6 * s, y: 16.4 * s))
            path.addLine(to: CGPoint(x: 10.1 * s, y: 10.1 * s))
            path.closeSubpath()
            ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: lineWidth * s, lineCap: .round, lineJoin: .round))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
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
            .offset(y: shown ? 0 : 24)
            .onAppear {
                guard !shown else { return }
                withAnimation(.spring(duration: 0.5, bounce: 0.18).delay(Double(order) * 0.045)) { shown = true }
            }
    }
}

extension View {
    func arrive(_ order: Int) -> some View { modifier(Arrive(order: order)) }
}

/// Cards dip a little under the finger, on a quick spring.
struct PressStyle: ButtonStyle {
    var scale: CGFloat = 0.97
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.spring(duration: 0.25, bounce: 0.3), value: configuration.isPressed)
    }
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
