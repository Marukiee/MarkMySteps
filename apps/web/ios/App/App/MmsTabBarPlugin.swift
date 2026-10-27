import Capacitor
import UIKit

/**
 * The tab bar on the iPhone: the system's own, so it is Liquid Glass the way
 * the bar in every other app is, and not a frosted strip the page draws.
 *
 * The page still decides everything about it. It says which tab is on and
 * whether the bar is there at all (a sheet, the photo viewer or a trip on
 * "Automatisch" puts it away) through `set`; a tap comes back as `select`
 * with the tab's index, and the page follows its own link for that tab.
 */
@objc(MmsTabBarPlugin)
public class MmsTabBarPlugin: CAPPlugin, CAPBridgedPlugin, UITabBarDelegate {
    public let identifier = "MmsTabBarPlugin"
    public let jsName = "MmsTabBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    /** The same three tabs as the page, in the same order, as SF Symbols. */
    private static let symbols = ["safari", "person.2", "gearshape"]

    private var bar: UITabBar?
    private var shown = false

    @objc func set(_ call: CAPPluginCall) {
        let active = call.getInt("active") ?? -1
        let visible = call.getBool("visible") ?? false
        let titles = call.getArray("titles", String.self) ?? []
        let tint = call.getString("tint").flatMap(Self.color(hex:))
        DispatchQueue.main.async {
            guard let bar = self.ensureBar() else {
                call.reject("No view to put the tab bar in")
                return
            }
            for (index, item) in (bar.items ?? []).enumerated() where index < titles.count {
                if item.title != titles[index] { item.title = titles[index] }
            }
            if let tint { bar.tintColor = tint }
            let items = bar.items ?? []
            bar.selectedItem = items.indices.contains(active) ? items[active] : nil
            self.show(visible)
            call.resolve(["height": bar.frame.height])
        }
    }

    private func ensureBar() -> UITabBar? {
        if let bar { return bar }
        guard let host = bridge?.viewController?.view else { return nil }
        let bar = UITabBar()
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.delegate = self
        bar.items = Self.symbols.enumerated().map { index, name in
            UITabBarItem(
                title: nil,
                image: UIImage(systemName: name),
                selectedImage: UIImage(systemName: "\(name).fill"),
            ).with(tag: index)
        }
        bar.alpha = 0
        bar.isHidden = true
        host.addSubview(bar)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])
        host.layoutIfNeeded()
        self.bar = bar
        return bar
    }

    /** In and out the way the page's sheets move: a short slide and a fade. */
    private func show(_ visible: Bool) {
        guard let bar, visible != shown else { return }
        shown = visible
        let away = CGAffineTransform(translationX: 0, y: bar.bounds.height * 0.6)
        if visible {
            bar.isHidden = false
            if bar.alpha == 0 { bar.transform = away }
        }
        let reduce = UIAccessibility.isReduceMotionEnabled
        UIView.animate(
            withDuration: reduce ? 0 : (visible ? 0.28 : 0.22),
            delay: 0,
            usingSpringWithDamping: 1,
            initialSpringVelocity: 0,
            options: [.beginFromCurrentState, .allowUserInteraction],
            animations: {
                bar.alpha = visible ? 1 : 0
                bar.transform = visible ? .identity : away
            },
            completion: { _ in
                if !self.shown { bar.isHidden = true }
            },
        )
    }

    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        notifyListeners("select", data: ["index": item.tag])
    }

    /** `#rrggbb` or `rgb(r g b)` / `rgb(r, g, b)`, as getComputedStyle hands it over. */
    static func color(hex value: String) -> UIColor? {
        let text = value.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#"), text.count == 7, let rgb = Int(text.dropFirst(), radix: 16) {
            return UIColor(
                red: CGFloat((rgb >> 16) & 0xFF) / 255,
                green: CGFloat((rgb >> 8) & 0xFF) / 255,
                blue: CGFloat(rgb & 0xFF) / 255,
                alpha: 1,
            )
        }
        if text.hasPrefix("rgb") {
            let parts = text
                .drop(while: { $0 != "(" }).dropFirst()
                .prefix(while: { $0 != ")" && $0 != "/" })
                .split(whereSeparator: { $0 == " " || $0 == "," })
                .compactMap { Double($0) }
            if parts.count >= 3 {
                return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: 1)
            }
        }
        return nil
    }
}

private extension UITabBarItem {
    func with(tag: Int) -> UITabBarItem {
        self.tag = tag
        return self
    }
}
