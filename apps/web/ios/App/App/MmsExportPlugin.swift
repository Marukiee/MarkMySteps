import Capacitor
import UIKit

/**
 * Writes a backup where you can get at it again.
 *
 * Android puts it in Downloads. iOS has no shared Downloads folder, so it goes
 * into the app's own Documents folder, which the Files app shows under
 * "On My iPhone > MarkMySteps" (UIFileSharingEnabled in Info.plist), with the
 * share sheet on top so it can go straight to iCloud Drive, Nextcloud or a
 * message.
 */
@objc(MmsExportPlugin)
public class MmsExportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MmsExportPlugin"
    public let jsName = "MmsExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
    ]

    @objc func save(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename"),
              let base64 = call.getString("base64"),
              let data = Data(base64Encoded: base64) else {
            call.reject(AppLang.text("export.invalid"))
            return
        }
        let share = call.getBool("share") ?? true
        // Only the last path component: a name is not allowed to climb out.
        let safeName = (filename as NSString).lastPathComponent
        let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = folder.appendingPathComponent(safeName)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject(AppLang.text("export.failed", error.localizedDescription))
            return
        }
        let result: [String: Any] = [
            "path": AppLang.text("export.path", safeName),
            "uri": url.absoluteString,
        ]
        guard share else {
            call.resolve(result)
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let controller = self?.bridge?.viewController else {
                call.resolve(result)
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // An iPad shows the sheet as a popover, which needs an anchor.
            sheet.popoverPresentationController?.sourceView = controller.view
            sheet.popoverPresentationController?.sourceRect = CGRect(
                x: controller.view.bounds.midX, y: controller.view.bounds.maxY - 40, width: 1, height: 1)
            controller.present(sheet, animated: true)
            call.resolve(result)
        }
    }
}
