import Capacitor

/**
 * Wallpaper colours are an Android 12 feature; iOS has nothing to borrow from.
 *
 * Answering "not available" keeps the app on its own accent instead of the
 * call failing on a plugin that is not there.
 */
@objc(MmsDynamicColorPlugin)
public class MmsDynamicColorPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MmsDynamicColorPlugin"
    public let jsName = "MmsDynamicColor"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPalette", returnType: CAPPluginReturnPromise),
    ]

    @objc func getPalette(_ call: CAPPluginCall) {
        call.resolve(["available": false])
    }
}
