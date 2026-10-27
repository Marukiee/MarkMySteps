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
 * A menu can open before all of it is known: with `pending` it ends in the
 * system's loading row, and `fill` puts what the page learnt in its place.
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
        CAPPluginMethod(name: "fill", returnType: CAPPluginReturnPromise),
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
        let pending = call.getBool("pending") ?? false
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
            var groups: [UIMenuElement] = sections.map { section in
                UIMenu(options: .displayInline, children: section.map(anchor.action))
            }
            if pending {
                groups.append(UIDeferredMenuElement { [weak anchor] completion in
                    anchor?.waitForMore(completion)
                })
            }
            let flat = groups.count == 1 ? (groups[0] as? UIMenu)?.children : nil
            anchor.menu = UIMenu(title: title, children: flat ?? groups)
            host.addSubview(anchor)
            self.shown = anchor
            anchor.performPrimaryAction()
        }
    }

    @objc func fill(_ call: CAPPluginCall) {
        let items = (call.getArray("items") as? [[String: Any]] ?? []).compactMap(MenuItem.init)
        DispatchQueue.main.async {
            self.shown?.more(items)
            call.resolve()
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
    /** The loading row's way to be replaced, once the menu has asked. */
    private var moreCompletion: (([UIMenuElement]) -> Void)?
    /** What `fill` brought before the menu asked for it. */
    private var moreItems: [MenuItem]?

    init(frame: CGRect, done: @escaping (String?) -> Void) {
        self.done = done
        super.init(frame: frame)
        backgroundColor = .clear
        showsMenuAsPrimaryAction = true
        isAccessibilityElement = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func action(_ item: MenuItem) -> UIAction {
        let action = UIAction(
            title: item.title,
            image: item.symbol.flatMap { UIImage(systemName: $0) },
            attributes: item.destructive ? .destructive : [],
            state: item.checked ? .on : .off
        ) { [weak self] _ in self?.finish(item.id) }
        if #available(iOS 16.0, *), let subtitle = item.subtitle { action.subtitle = subtitle }
        return action
    }

    func waitForMore(_ completion: @escaping ([UIMenuElement]) -> Void) {
        if let moreItems {
            completion(moreItems.map(action))
        } else {
            moreCompletion = completion
        }
    }

    func more(_ items: [MenuItem]) {
        if let moreCompletion {
            moreCompletion(items.map(action))
            self.moreCompletion = nil
        } else {
            moreItems = items
        }
    }

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
