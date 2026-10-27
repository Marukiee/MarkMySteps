import Capacitor
import UIKit

/**
 * The app's yes-or-no questions as the iPhone's own alert.
 *
 * The page asks before anything that cannot be taken back: deleting a trip,
 * leaving it, wiping its route. Its own dialog was a card from the web; here
 * `confirm` puts up the system alert instead, with the red button iOS uses
 * for a destructive answer and Cancel where an iPhone has it. For the worst of
 * them the alert has a field the trip's name must be typed into, and its
 * button stays grey until it matches.
 *
 * Resolves once, with `confirmed`.
 */
@objc(MmsAlertPlugin)
public class MmsAlertPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MmsAlertPlugin"
    public let jsName = "MmsAlert"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "confirm", returnType: CAPPluginReturnPromise),
    ]

    @objc func confirm(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let message = call.getString("message")
        let confirmLabel = call.getString("confirm") ?? "OK"
        let cancelLabel = call.getString("cancel") ?? "Cancel"
        let destructive = call.getBool("destructive") ?? false
        let typeToConfirm = call.getString("typeToConfirm").flatMap { $0.isEmpty ? nil : $0 }
        let tint = call.getString("tint").flatMap(MmsTabBarPlugin.color(hex:))
        let dark = call.getBool("dark")

        DispatchQueue.main.async {
            guard var top = self.bridge?.viewController else {
                call.reject("No view to show the question from")
                return
            }
            while let shown = top.presentedViewController { top = shown }

            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            if let tint { alert.view.tintColor = tint }
            // The page's own light or dark, which may not be the phone's.
            if let dark { alert.overrideUserInterfaceStyle = dark ? .dark : .light }

            alert.addAction(UIAlertAction(title: cancelLabel, style: .cancel) { _ in
                call.resolve(["confirmed": false])
            })
            let confirm = UIAlertAction(title: confirmLabel, style: destructive ? .destructive : .default) { _ in
                call.resolve(["confirmed": true])
            }
            alert.addAction(confirm)

            if let typeToConfirm {
                confirm.isEnabled = false
                alert.addTextField { field in
                    field.placeholder = typeToConfirm
                    field.autocorrectionType = .no
                    field.autocapitalizationType = .none
                    field.spellCheckingType = .no
                    field.returnKeyType = .done
                    field.addAction(UIAction { _ in
                        confirm.isEnabled = field.text?.trimmingCharacters(in: .whitespacesAndNewlines) == typeToConfirm
                    }, for: .editingChanged)
                }
            } else if !destructive {
                // A safe answer may be the bold one; a destructive one never
                // is, so Cancel keeps that place, as in Apple's own alerts.
                alert.preferredAction = confirm
            }
            top.present(alert, animated: true)
        }
    }
}
