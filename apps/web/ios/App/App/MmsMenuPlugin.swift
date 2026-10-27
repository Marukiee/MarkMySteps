import Capacitor
import UIKit

/**
 * The page's pull-down menus as the iPhone's own.
 *
 * A pill that opens a list, such as how a leg was travelled, hands over where
 * it is on the screen and what is in the list. The system menu then opens
 * from that spot, with the current choice ticked, as any iOS pull-down button
 * does. The list comes as `items`, or as `sections` when a line belongs
 * between groups of them. `show` resolves with the id that was picked, or
 * without one when the menu was put away.
 *
 * Needs iOS 17.4, the first that lets an app open a button's menu itself;
 * before that `show` rejects and the page opens its own.
 */
@objc(MmsMenuPlugin)
public class MmsMenuPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MmsMenuPlugin"
    public let jsName = "MmsMenu"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
    ]

    private weak var shown: MenuAnchor?

    @objc func show(_ call: CAPPluginCall) {
        guard #available(iOS 17.4, *) else {
            call.reject("This iOS cannot open a menu by itself")
            return
        }
        let frame = CGRect(
            x: call.getDouble("x") ?? 0,
            y: call.getDouble("y") ?? 0,
            width: max(1, call.getDouble("width") ?? 1),
            height: max(1, call.getDouble("height") ?? 1))
        let title = call.getString("title") ?? ""
        let sections = (call.getArray("sections") as? [[[String: Any]]]
            ?? [call.getArray("items") as? [[String: Any]] ?? []]
        ).map { $0.compactMap(MenuItem.init) }
        let tint = call.getString("tint").flatMap(MmsTabBarPlugin.color(hex:))
        let dark = call.getBool("dark")

        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view else {
                call.reject("No view to open the menu from")
                return
            }
            self.shown?.finish(nil)
            let anchor = MenuAnchor(frame: frame) { id in
                call.resolve(id.map { ["id": $0] } ?? [:])
            }
            if let tint { anchor.tintColor = tint }
            if let dark { anchor.overrideUserInterfaceStyle = dark ? .dark : .light }
            let groups = sections.map { section in
                UIMenu(options: .displayInline, children: section.map { item in
                    let action = UIAction(
                        title: item.title,
                        image: item.symbol.flatMap { UIImage(systemName: $0) },
                        attributes: item.destructive ? .destructive : [],
                        state: item.checked ? .on : .off
                    ) { [weak anchor] _ in anchor?.finish(item.id) }
                    if let subtitle = item.subtitle { action.subtitle = subtitle }
                    return action
                })
            }
            anchor.menu = UIMenu(title: title, children: groups.count == 1 ? groups[0].children : groups)
            host.addSubview(anchor)
            self.shown = anchor
            anchor.performPrimaryAction()
        }
    }
}

private struct MenuItem {
    let id: String
    let title: String
    let subtitle: String?
    let symbol: String?
    let checked: Bool
    let destructive: Bool

    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String, let title = raw["title"] as? String else { return nil }
        self.id = id
        self.title = title
        subtitle = raw["subtitle"] as? String
        symbol = raw["symbol"] as? String
        checked = raw["checked"] as? Bool ?? false
        destructive = raw["destructive"] as? Bool ?? false
    }
}

/**
 * An unseen button over the page's pill, there only to open the menu from:
 * iOS places a button's menu against the button, above or below as it fits.
 * Gone again once the menu is.
 */
private final class MenuAnchor: UIButton {
    private var done: ((String?) -> Void)?

    init(frame: CGRect, done: @escaping (String?) -> Void) {
        self.done = done
        super.init(frame: frame)
        backgroundColor = .clear
        showsMenuAsPrimaryAction = true
        isAccessibilityElement = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func finish(_ id: String?) {
        guard let done else { return }
        self.done = nil
        done(id)
        // Kept while the menu shrinks back into it, but no longer in the way
        // of a tap on the pill underneath.
        isUserInteractionEnabled = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.removeFromSuperview() }
    }

    override func contextMenuInteraction(
        _ interaction: UIContextMenuInteraction,
        willEndFor configuration: UIContextMenuConfiguration,
        animator: UIContextMenuInteractionAnimating?
    ) {
        super.contextMenuInteraction(interaction, willEndFor: configuration, animator: animator)
        // A pick has already been handed over by now: its action runs before
        // the menu starts to close. Anything else is the menu put away. Not on
        // the animator's completion, which a tap outside never calls.
        DispatchQueue.main.async { self.finish(nil) }
    }
}
