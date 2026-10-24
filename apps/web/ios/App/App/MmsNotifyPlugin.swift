import BackgroundTasks
import Capacitor
import UserNotifications

/**
 * Notifications the app posts itself, plus the background "anything new?".
 *
 * Same interface as the Android plugin. There is no push service here either:
 * a background refresh task asks the server with a token of its own, and posts
 * the answer locally. iOS decides when that task runs (roughly as often as the
 * app is used), so it is less punctual than Android's quarter-hourly worker.
 *
 * iOS has no ongoing progress notification, so `progress` only speaks up when
 * the job is done, and there is no cancel button to read back.
 */
@objc(MmsNotifyPlugin)
public class MmsNotifyPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "MmsNotifyPlugin"
    public let jsName = "MmsNotify"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "progress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearProgress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeCancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enableBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disableBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "permission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePendingPath", returnType: CAPPluginReturnPromise),
    ]

    private static let progressId = "mms-progress"

    override public func load() {
        // The bridge owns the notification-centre delegate; it hands local
        // notifications to whoever registers here.
        bridge?.notificationRouter.localNotificationHandler = self
    }

    @objc func show(_ call: CAPPluginCall) {
        post(id: UUID().uuidString, title: call.getString("title") ?? "MarkMySteps", body: call.getString("body") ?? "")
        call.resolve()
    }

    @objc func progress(_ call: CAPPluginCall) {
        if call.getBool("done") ?? false {
            post(id: Self.progressId, title: call.getString("title") ?? "MarkMySteps", body: call.getString("body") ?? "")
        }
        call.resolve()
    }

    @objc func clearProgress(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [Self.progressId])
        call.resolve()
    }

    @objc func takeCancel(_ call: CAPPluginCall) {
        call.resolve(["cancelled": false])
    }

    @objc func enableBackground(_ call: CAPPluginCall) {
        guard let baseUrl = call.getString("baseUrl"), let token = call.getString("token") else {
            call.reject("baseUrl en token zijn nodig")
            return
        }
        NotifyPoller.configure(baseUrl: baseUrl, token: token)
        NotifyPoller.schedule()
        call.resolve()
    }

    @objc func disableBackground(_ call: CAPPluginCall) {
        NotifyPoller.configure(baseUrl: nil, token: nil)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: NotifyPoller.taskId)
        call.resolve()
    }

    @objc func permission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["granted": Self.allowed(settings.authorizationStatus)])
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            call.resolve(["granted": granted])
        }
    }

    @objc func takePendingPath(_ call: CAPPluginCall) {
        let defaults = UserDefaults.standard
        let path = defaults.string(forKey: NotifyPoller.pendingPathKey)
        defaults.removeObject(forKey: NotifyPoller.pendingPathKey)
        call.resolve(["path": path as Any])
    }

    static func allowed(_ status: UNAuthorizationStatus) -> Bool {
        status == .authorized || status == .provisional || status == .ephemeral
    }

    private func post(id: String, title: String, body: String) {
        NotifyPoller.post(id: id, title: title, body: body, path: nil)
    }

    // MARK: NotificationHandlerProtocol

    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    public func didReceive(response: UNNotificationResponse) {
        // Read back by the web app (takePendingPath), the same way Android
        // hands over the trip a tapped notification is about.
        if let path = response.notification.request.content.userInfo["mmsPath"] as? String, path.hasPrefix("/") {
            UserDefaults.standard.set(path, forKey: NotifyPoller.pendingPathKey)
        }
    }
}

/**
 * The background check itself, outside the WebView: GET
 * {baseUrl}/notifications/poll?token=…, and a notification when the latest
 * message is one we have not shown yet.
 */
enum NotifyPoller {
    static let taskId = "nl.markmaaktmedia.markmysteps.notify"
    static let pendingPathKey = "mms.notify.pendingPath"
    private static let baseUrlKey = "mms.notify.baseUrl"
    private static let tokenKey = "mms.notify.token"
    private static let lastIdKey = "mms.notify.lastId"

    static func configure(baseUrl: String?, token: String?) {
        let defaults = UserDefaults.standard
        defaults.set(baseUrl, forKey: baseUrlKey)
        defaults.set(token, forKey: tokenKey)
    }

    /** Registered once at launch, before the app finishes starting up. */
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskId, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return }
            handle(task)
        }
    }

    static func schedule() {
        guard UserDefaults.standard.string(forKey: tokenKey) != nil else { return }
        let request = BGAppRefreshTaskRequest(identifier: taskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func handle(_ task: BGAppRefreshTask) {
        schedule()
        let work = Task {
            await poll()
            task.setTaskCompleted(success: true)
        }
        task.expirationHandler = { work.cancel() }
    }

    static func poll() async {
        let defaults = UserDefaults.standard
        guard let base = defaults.string(forKey: baseUrlKey),
              let token = defaults.string(forKey: tokenKey),
              let encoded = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "\(base)/notifications/poll?token=\(encoded)") else { return }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let latest = json["latest"] as? [String: Any],
              let id = latest["id"] as? String, !id.isEmpty,
              id != defaults.string(forKey: lastIdKey) else { return }
        let tripId = latest["tripId"] as? String
        post(
            id: "mms-news",
            title: latest["title"] as? String ?? "MarkMySteps",
            body: latest["body"] as? String ?? "",
            path: tripId.map { "/trips/\($0)" } ?? "/friends")
        defaults.set(id, forKey: lastIdKey)
    }

    static func post(id: String, title: String, body: String, path: String?) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if let path { content.userInfo = ["mmsPath": path] }
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}
