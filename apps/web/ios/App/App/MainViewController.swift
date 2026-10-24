import Capacitor
import UIKit
import WebKit

/**
 * The app's own bridge controller.
 *
 * Capacitor only finds plugins that come from npm packages by itself; the ones
 * that live in this app are registered here, under the same names the Android
 * app uses (MmsLocation, MmsGallery, ...), so the web code calls one interface
 * on both platforms.
 *
 * It also teaches the WebView the `mmsphoto:` scheme, which is how a photo from
 * the phone's own library reaches an <img>: iOS has no file path for it, only
 * an asset id, and the handler asks Photos for the picture itself.
 */
class MainViewController: CAPBridgeViewController {
    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.setURLSchemeHandler(PhotoSchemeHandler(), forURLScheme: PhotoSchemeHandler.scheme)
        return configuration
    }

    override open func capacitorDidLoad() {
        // Swiping in from the left edge goes back, as everywhere else on iOS;
        // the app's sheets and photo viewer listen to that same history step.
        webView?.allowsBackForwardNavigationGestures = true
        // A long press on a photo or link is the app's own gesture, not a preview.
        webView?.allowsLinkPreview = false
        bridge?.registerPluginInstance(MmsLocationPlugin())
        bridge?.registerPluginInstance(MmsGalleryPlugin())
        bridge?.registerPluginInstance(MmsNotifyPlugin())
        bridge?.registerPluginInstance(MmsHapticsPlugin())
        bridge?.registerPluginInstance(MmsExportPlugin())
        bridge?.registerPluginInstance(MmsDynamicColorPlugin())
    }
}
