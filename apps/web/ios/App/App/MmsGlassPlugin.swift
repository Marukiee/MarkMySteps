import Capacitor
import UIKit

/**
 * Floating buttons in real Liquid Glass, over the page's own.
 *
 * The page keeps its buttons, unseen, and hands over where they are: groups of
 * buttons with their frames in points and an SF Symbol each. Here every group
 * becomes one glass capsule (a single button is a circle), the way iOS groups
 * related controls, and a tap comes back as `tap` with the button's id so the
 * page can press its own. An empty list puts them all away.
 *
 * Only on iOS 26 and later, where the system has the material; before that
 * `supported` says no and the page shows its own buttons.
 */
@objc(MmsGlassPlugin)
public class MmsGlassPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MmsGlassPlugin"
    public let jsName = "MmsGlass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "supported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    private var groups: [String: AnyObject] = [:]

    @objc func supported(_ call: CAPPluginCall) {
        if #available(iOS 26.0, *) {
            call.resolve(["supported": true])
        } else {
            call.resolve(["supported": false])
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else {
            call.resolve()
            return
        }
        let wanted = (call.getArray("groups") as? [[String: Any]] ?? []).compactMap(GroupSpec.init)
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view else {
                call.reject("No view to put the buttons in")
                return
            }
            let ids = Set(wanted.map(\.id))
            for (id, group) in self.groups where !ids.contains(id) {
                (group as? GlassGroup)?.leave()
                self.groups[id] = nil
            }
            for spec in wanted {
                let group = (self.groups[spec.id] as? GlassGroup) ?? {
                    let made = GlassGroup(in: host) { [weak self] item in
                        self?.notifyListeners("tap", data: ["id": item])
                    }
                    self.groups[spec.id] = made
                    return made
                }()
                group.apply(spec)
            }
            call.resolve()
        }
    }
}

private struct ItemSpec {
    let id: String
    let symbol: String
    let label: String
    let frame: CGRect
}

private struct GroupSpec {
    let id: String
    let frame: CGRect
    let items: [ItemSpec]

    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String, let frame = Self.rect(raw) else { return nil }
        self.id = id
        self.frame = frame
        items = (raw["items"] as? [[String: Any]] ?? []).compactMap { item in
            guard let id = item["id"] as? String,
                  let symbol = item["symbol"] as? String,
                  let frame = Self.rect(item) else { return nil }
            return ItemSpec(id: id, symbol: symbol, label: item["label"] as? String ?? "", frame: frame)
        }
    }

    private static func rect(_ raw: [String: Any]) -> CGRect? {
        guard let x = raw["x"] as? Double, let y = raw["y"] as? Double,
              let w = raw["w"] as? Double, let h = raw["h"] as? Double else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }
}

/** One capsule of glass with its buttons. */
@available(iOS 26.0, *)
private final class GlassGroup {
    private let glass: UIVisualEffectView
    private var buttons: [String: UIButton] = [:]
    private let onTap: (String) -> Void
    private var first = true

    init(in host: UIView, onTap: @escaping (String) -> Void) {
        self.onTap = onTap
        let effect = UIGlassEffect()
        effect.isInteractive = true
        glass = UIVisualEffectView(effect: effect)
        glass.cornerConfiguration = .capsule()
        glass.alpha = 0
        host.addSubview(glass)
    }

    func apply(_ spec: GroupSpec) {
        glass.frame = spec.frame
        let ids = Set(spec.items.map(\.id))
        for (id, button) in buttons where !ids.contains(id) {
            button.removeFromSuperview()
            buttons[id] = nil
        }
        for item in spec.items {
            let button = buttons[item.id] ?? makeButton(item.id)
            var config = button.configuration ?? .plain()
            config.image = UIImage(
                systemName: item.symbol,
                withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .medium),
            )
            config.baseForegroundColor = .label
            button.configuration = config
            button.accessibilityLabel = item.label
            button.frame = item.frame.offsetBy(dx: -spec.frame.minX, dy: -spec.frame.minY)
        }
        if first {
            first = false
            // In the way the page's own buttons pop in: a short fade and grow.
            glass.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
            UIView.animate(
                withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.3,
                delay: 0,
                usingSpringWithDamping: 1,
                initialSpringVelocity: 0,
                options: [.allowUserInteraction],
                animations: {
                    self.glass.alpha = 1
                    self.glass.transform = .identity
                },
            )
        }
    }

    func leave() {
        let glass = glass
        UIView.animate(
            withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2,
            delay: 0,
            options: [.beginFromCurrentState],
            animations: {
                glass.alpha = 0
                glass.transform = CGAffineTransform(scaleX: 0.92, y: 0.92)
            },
            completion: { _ in glass.removeFromSuperview() },
        )
    }

    private func makeButton(_ id: String) -> UIButton {
        let button = UIButton(configuration: .plain())
        button.addAction(UIAction { [weak self] _ in self?.onTap(id) }, for: .touchUpInside)
        glass.contentView.addSubview(button)
        buttons[id] = button
        return button
    }
}
