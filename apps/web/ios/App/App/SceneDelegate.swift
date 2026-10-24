import Capacitor
import UIKit

/**
 * The window, under the scene lifecycle.
 *
 * iOS 27 no longer starts an app that only has an AppDelegate window, which is
 * what Capacitor's template still ships. The window itself comes from
 * Main.storyboard (UISceneStoryboardFile in Info.plist); this only passes links
 * that open the app on to Capacitor, as the AppDelegate used to.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity) { _ in }
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        NotifyPoller.schedule()
    }
}
