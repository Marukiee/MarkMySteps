import Capacitor
import UIKit

/**
 * The small ticks the app gives on a long press, a snap or a threshold.
 *
 * Same five styles as the Android plugin. iOS has no "clock tick" or
 * "confirm" constants, so each style maps to the generator that feels closest.
 */
@objc(MmsHapticsPlugin)
public class MmsHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MmsHapticsPlugin"
    public let jsName = "MmsHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "impact", returnType: CAPPluginReturnPromise),
    ]

    @objc func impact(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch style {
            case "threshold-on":
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            case "threshold-off":
                UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.6)
            case "end":
                UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
            case "long-press":
                UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            default:
                UISelectionFeedbackGenerator().selectionChanged()
            }
            call.resolve()
        }
    }
}
