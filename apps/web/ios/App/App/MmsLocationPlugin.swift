import Capacitor
import CoreLocation
import UIKit
import UserNotifications

/**
 * Route tracking, with the same interface as the Android plugin.
 *
 * The web side does the bookkeeping (stays, the upload buffer); this side only
 * produces one position per interval and keeps it until the app collects it
 * with drain(), so nothing is lost while the WebView is away.
 */
@objc(MmsLocationPlugin)
public class MmsLocationPlugin: CAPPlugin, CAPBridgedPlugin, MmsTrackerSink {
    public let identifier = "MmsLocationPlugin"
    public let jsName = "MmsLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "permissionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "backgroundStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise),
    ]

    private var tracker: MmsTracker { MmsTracker.shared }

    override public func load() {
        DispatchQueue.main.async { self.tracker.sink = self }
    }

    @objc func start(_ call: CAPPluginCall) {
        let interval = max(60, (call.getDouble("intervalMs") ?? 300_000) / 1000)
        let startService = call.getBool("startService") ?? true
        DispatchQueue.main.async {
            self.tracker.askForeground { granted in
                guard granted else {
                    call.reject("Locatietoestemming geweigerd")
                    return
                }
                // "Always" is a second, separate question. Saying no to it only
                // costs tracking with the screen off, so carry on either way.
                self.tracker.askAlways {
                    if !startService {
                        call.resolve(["granted": true, "background": self.tracker.hasAlways])
                        return
                    }
                    self.tracker.start(interval: interval)
                    call.resolve()
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tracker.stop()
            call.resolve()
        }
    }

    /** Exactly one question per call: "location", "background" or "notifications". */
    @objc func requestPermission(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "location"
        DispatchQueue.main.async {
            switch type {
            case "background":
                guard self.tracker.hasForeground else {
                    call.reject("Vraag eerst de gewone locatietoestemming")
                    return
                }
                self.tracker.askAlways { self.resolvePermissions(call) }
            case "notifications":
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
                    self.resolvePermissions(call)
                }
            default:
                self.tracker.askForeground { _ in self.resolvePermissions(call) }
            }
        }
    }

    @objc func permissionStatus(_ call: CAPPluginCall) {
        resolvePermissions(call)
    }

    @objc func backgroundStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["granted": self.tracker.hasAlways, "foreground": self.tracker.hasForeground])
        }
    }

    @objc func currentPosition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.tracker.hasForeground else {
                call.reject("Geen locatietoestemming")
                return
            }
            self.tracker.oneFix { location in
                if let location {
                    call.resolve(MmsTracker.toResult(location))
                } else {
                    call.reject("Geen positie gevonden")
                }
            }
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    @objc func drain(_ call: CAPPluginCall) {
        call.resolve(["fixes": MmsTracker.drainQueue()])
    }

    private func resolvePermissions(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                call.resolve([
                    "location": self.tracker.hasForeground,
                    "background": self.tracker.hasAlways,
                    "notifications": MmsNotifyPlugin.allowed(settings.authorizationStatus),
                ])
            }
        }
    }

    // MARK: MmsTrackerSink

    func trackerQueuedFix() {
        notifyListeners("location", data: [:])
    }

    func trackerStatus(_ state: String, _ message: String?) {
        notifyListeners("status", data: ["state": state, "message": message as Any])
    }
}

protocol MmsTrackerSink: AnyObject {
    func trackerQueuedFix()
    func trackerStatus(_ state: String, _ message: String?)
}

/**
 * The tracker itself, alive for as long as the app process is.
 *
 * iOS does not let an app sleep and wake itself on a timer, so a low-power
 * location stream (cell towers and Wi-Fi, three-kilometre accuracy) keeps the
 * app running in the background, and once per interval the GPS is switched on
 * for one good position, at most 45 seconds. While you are travelling the next
 * check comes sooner, as on Android, so a motorway keeps its corners.
 *
 * Significant-change monitoring runs alongside: if iOS ends the app, the next
 * few hundred metres of travel start it again in the background and tracking
 * carries on (AppDelegate calls resumeIfNeeded).
 *
 * Fixes are queued in UserDefaults before they are announced, so a fix taken
 * while no page is alive still reaches the route.
 */
final class MmsTracker: NSObject, CLLocationManagerDelegate {
    static let shared = MmsTracker()

    weak var sink: MmsTrackerSink?

    private static let pendingKey = "mms.tracking.pending"
    private static let runningKey = "mms.tracking.running"
    private static let intervalKey = "mms.tracking.interval"
    private static let maxPending = 1200
    private static let goodAccuracy: CLLocationAccuracy = 25
    private static let maxWindow: TimeInterval = 45
    private static let movingMetres: CLLocationDistance = 250
    private static let minMovingInterval: TimeInterval = 60

    private let manager = CLLocationManager()
    private var interval: TimeInterval = 300
    private var tickTimer: Timer?
    private var windowTimer: Timer?
    private var windowBest: CLLocation?
    private var windowOpen = false
    private var lastAccepted: CLLocation?
    private var moving = false
    private var active = false
    private var authWaiters: [() -> Void] = []
    private var fixWaiters: [(CLLocation?) -> Void] = []
    private var fixTimeout: Timer?

    override init() {
        super.init()
        manager.delegate = self
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .otherNavigation
    }

    var hasForeground: Bool {
        let status = manager.authorizationStatus
        return status == .authorizedWhenInUse || status == .authorizedAlways
    }

    var hasAlways: Bool { manager.authorizationStatus == .authorizedAlways }

    // MARK: Permissions

    func askForeground(_ done: @escaping (Bool) -> Void) {
        switch manager.authorizationStatus {
        case .notDetermined:
            waitForAuthorization { done(self.hasForeground) }
            manager.requestWhenInUseAuthorization()
        default:
            done(hasForeground)
        }
    }

    /**
     * iOS shows the "Always" question once at most and says nothing when it
     * will not show it again, so a short timeout stands in for an answer.
     */
    func askAlways(_ done: @escaping () -> Void) {
        guard manager.authorizationStatus == .authorizedWhenInUse else {
            done()
            return
        }
        var finished = false
        let finish = {
            if finished { return }
            finished = true
            done()
        }
        waitForAuthorization(finish)
        manager.requestAlwaysAuthorization()
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: finish)
    }

    private func waitForAuthorization(_ done: @escaping () -> Void) {
        authWaiters.append(done)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager.authorizationStatus != .notDetermined else { return }
        let waiters = authWaiters
        authWaiters = []
        waiters.forEach { $0() }
        if UserDefaults.standard.bool(forKey: Self.runningKey) && !hasForeground {
            sink?.trackerStatus("permission", "Locatietoestemming ontbreekt")
        }
    }

    // MARK: Tracking

    func start(interval seconds: TimeInterval) {
        // The app calls start on every launch. Restarting a tracker that is
        // already running would throw away the GPS window in flight and reset
        // its cadence, so only a changed interval starts it over.
        let unchanged = active && seconds == interval
        interval = seconds
        let defaults = UserDefaults.standard
        defaults.set(true, forKey: Self.runningKey)
        defaults.set(seconds, forKey: Self.intervalKey)
        if unchanged {
            sink?.trackerStatus("running", "Eén meting per \(Int(seconds / 60)) min")
            return
        }
        active = true
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        idle()
        manager.startUpdatingLocation()
        manager.startMonitoringSignificantLocationChanges()
        sink?.trackerStatus("running", "Eén meting per \(Int(seconds / 60)) min")
        tick()
    }

    func stop() {
        active = false
        UserDefaults.standard.set(false, forKey: Self.runningKey)
        tickTimer?.invalidate()
        windowTimer?.invalidate()
        windowOpen = false
        manager.stopUpdatingLocation()
        manager.stopMonitoringSignificantLocationChanges()
        manager.allowsBackgroundLocationUpdates = false
    }

    /** After iOS relaunched the app for a location event, or a plain restart. */
    func resumeIfNeeded() {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: Self.runningKey), hasForeground else { return }
        let seconds = defaults.double(forKey: Self.intervalKey)
        start(interval: seconds > 0 ? seconds : 300)
    }

    /** Between checks: just enough to stay alive, cheaply. */
    private func idle() {
        manager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
        manager.distanceFilter = 500
    }

    private var currentInterval: TimeInterval {
        moving ? max(Self.minMovingInterval, min(interval, interval / 3)) : interval
    }

    /** Opens one GPS window; the next tick is armed when it closes. */
    private func tick() {
        tickTimer?.invalidate()
        guard UserDefaults.standard.bool(forKey: Self.runningKey) else { return }
        windowOpen = true
        windowBest = nil
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        windowTimer?.invalidate()
        windowTimer = Timer.scheduledTimer(withTimeInterval: Self.maxWindow, repeats: false) { [weak self] _ in
            self?.closeWindow()
        }
    }

    private func closeWindow() {
        guard windowOpen else { return }
        windowOpen = false
        windowTimer?.invalidate()
        idle()
        if let fix = windowBest {
            accept(fix)
        } else {
            sink?.trackerStatus("nofix", "Geen positie binnen \(Int(Self.maxWindow)) s")
        }
        let next = Timer(timeInterval: currentInterval, repeats: false) { [weak self] _ in self?.tick() }
        RunLoop.main.add(next, forMode: .common)
        tickTimer = next
    }

    private func accept(_ location: CLLocation) {
        if let last = lastAccepted {
            moving = location.distance(from: last) >= Self.movingMetres
        }
        lastAccepted = location
        Self.enqueue(location)
        sink?.trackerQueuedFix()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        if !fixWaiters.isEmpty && location.horizontalAccuracy <= 100 {
            finishOneFix(location)
        }
        guard windowOpen, location.horizontalAccuracy >= 0 else { return }
        // Cached positions from before the window opened are not this check.
        guard location.timestamp.timeIntervalSinceNow > -10 else { return }
        if windowBest == nil || location.horizontalAccuracy < windowBest!.horizontalAccuracy {
            windowBest = location
        }
        if location.horizontalAccuracy <= Self.goodAccuracy {
            closeWindow()
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if (error as? CLError)?.code == .denied {
            sink?.trackerStatus("permission", "Locatietoestemming ontbreekt")
        }
        if !fixWaiters.isEmpty && (error as? CLError)?.code != .locationUnknown {
            finishOneFix(nil)
        }
    }

    // MARK: One position, now

    func oneFix(_ done: @escaping (CLLocation?) -> Void) {
        if let known = manager.location, known.timestamp.timeIntervalSinceNow > -120 {
            done(known)
            return
        }
        fixWaiters.append(done)
        guard fixWaiters.count == 1 else { return }
        fixTimeout = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            self?.finishOneFix(self?.manager.location)
        }
        manager.requestLocation()
    }

    private func finishOneFix(_ location: CLLocation?) {
        fixTimeout?.invalidate()
        let waiters = fixWaiters
        fixWaiters = []
        waiters.forEach { $0(location) }
    }

    // MARK: Queue

    static func toResult(_ location: CLLocation) -> [String: Any] {
        var result: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "time": location.timestamp.timeIntervalSince1970 * 1000,
        ]
        if location.horizontalAccuracy >= 0 { result["accuracy"] = location.horizontalAccuracy }
        if location.verticalAccuracy >= 0 { result["altitude"] = location.altitude }
        return result
    }

    private static let queueLock = NSLock()

    static func enqueue(_ location: CLLocation) {
        queueLock.lock()
        defer { queueLock.unlock() }
        var pending = UserDefaults.standard.array(forKey: pendingKey) as? [[String: Any]] ?? []
        pending.append(toResult(location))
        if pending.count > maxPending { pending.removeFirst(pending.count - maxPending) }
        UserDefaults.standard.set(pending, forKey: pendingKey)
    }

    /** Every queued fix, handed over once. */
    static func drainQueue() -> [[String: Any]] {
        queueLock.lock()
        defer { queueLock.unlock() }
        let pending = UserDefaults.standard.array(forKey: pendingKey) as? [[String: Any]] ?? []
        UserDefaults.standard.removeObject(forKey: pendingKey)
        return pending
    }
}
