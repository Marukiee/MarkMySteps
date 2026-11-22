import BackgroundTasks
import CoreLocation
import SwiftUI
import UserNotifications

/*
 * Route tracking and the notifications check, the two things the web app does on the phone in the background, as
 * Android's Tracking.kt. Tracking: Core Location keeps delivering positions with the screen off (the blue
 * indicator shows it), the app keeps one per interval that moved, and sends them to the trip in batches; without
 * network they wait in a file on the phone. A trip with "Automatisch tracken" starts it by itself while under way,
 * and it stops by itself after the trip's last day. Notifications: iOS lets the app look now and then, also when it
 * is closed, and what is new becomes a notification. Each asks for permission at the moment you switch it on, with
 * a word first on why.
 */

@Observable
final class Tracker: NSObject {
    static let shared = Tracker()
    private let manager = CLLocationManager()
    private let d = UserDefaults.standard

    private(set) var tripId: String?
    private(set) var tripTitle: String?
    /// The trip's last day, to stop by itself after it.
    private(set) var tripEnd: Date?
    /// The last position: where and when.
    private(set) var lastFix: (at: LonLat, time: Date)?
    private(set) var buffered = 0
    private(set) var lastError: String?
    /// Said once after tracking stopped by itself at the end of a trip.
    var autoStopped: String?
    private(set) var authorization: CLAuthorizationStatus
    /// Minutes between two kept positions.
    var minutes: Int { didSet { d.set(minutes, forKey: "track.minutes") } }
    private var lastKept: Date?
    private var waiting: CheckedContinuation<CLAuthorizationStatus, Never>?

    var active: Bool { tripId != nil }
    var hasPermission: Bool { authorization == .authorizedAlways || authorization == .authorizedWhenInUse }

    private override init() {
        authorization = manager.authorizationStatus
        minutes = UserDefaults.standard.object(forKey: "track.minutes") as? Int ?? 5
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 40
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
        tripId = d.string(forKey: "track.trip")
        tripTitle = d.string(forKey: "track.title")
        tripEnd = d.object(forKey: "track.end") as? Date
        if let p = d.string(forKey: "track.last")?.split(separator: ","), p.count == 3, let lon = Double(p[0]), let lat = Double(p[1]), let t = Double(p[2]) {
            lastFix = (LonLat(lon, lat), Date(timeIntervalSince1970: t))
        }
        buffered = readBuffer().count
    }

    // MARK: Permission

    /// Asks for location while in use, then for Always so the route goes on with the screen off. Answers what iOS said.
    func requestPermission() async -> CLAuthorizationStatus {
        if authorization == .notDetermined {
            authorization = await withCheckedContinuation { c in
                waiting = c
                manager.requestWhenInUseAuthorization()
            }
        }
        if authorization == .authorizedWhenInUse {
            manager.requestAlwaysAuthorization()
        }
        return authorization
    }

    // MARK: Start and stop

    func start(tripId: String, title: String, end: Date?) {
        guard hasPermission else { lastError = "Geen toegang tot je locatie"; return }
        self.tripId = tripId
        tripTitle = title
        tripEnd = end
        lastError = nil
        autoStopped = nil
        d.set(tripId, forKey: "track.trip")
        d.set(title, forKey: "track.title")
        d.set(end, forKey: "track.end")
        d.set(tripId, forKey: "track.bufferTrip")
        resume()
    }

    func stop() {
        tripId = nil
        tripTitle = nil
        tripEnd = nil
        for k in ["track.trip", "track.title", "track.end"] { d.removeObject(forKey: k) }
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        manager.showsBackgroundLocationIndicator = false
        flush()
    }

    /// Picks up again after a launch: tracking that was on stays on, and a trip that is over stops it.
    func resume() {
        guard tripId != nil else { return }
        if stopIfOver() { return }
        guard hasPermission else { lastError = "Geen toegang tot je locatie"; return }
        manager.allowsBackgroundLocationUpdates = authorization == .authorizedAlways
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        flush()
    }

    /// After the trip's last day tracking stops by itself, and says so once.
    @discardableResult
    private func stopIfOver() -> Bool {
        guard let end = tripEnd, end < Format.calendar.startOfDay(for: Date()) else { return false }
        let title = tripTitle ?? "je reis"
        stop()
        autoStopped = "Tracking is automatisch gestopt: \(title) is voorbij."
        Notices.post(id: "autostop", text: autoStopped!)
        return true
    }

    /// A trip with "Automatisch tracken" that is under way starts by itself when the app opens, as on the web, but only
    /// when location access was given before: the app never asks for it unprompted.
    func autoStart(_ trips: [Trip], me: String?) {
        if active { resume(); return }
        guard Api.shared.signedIn, hasPermission else { return }
        let today = Format.calendar.startOfDay(for: Date())
        guard let trip = trips.first(where: { t in
            guard t.autoTrack, t.remoteId != nil, let start = t.start else { return false }
            let end = Format.calendar.date(byAdding: .day, value: max(0, t.days - 1), to: start) ?? start
            let role = t.members.first { $0.userId == me }
            return start <= today && end >= today && role?.role != "GUEST" && (role?.canTrack ?? true)
        }), let rid = trip.remoteId, let first = trip.start else { return }
        self.start(tripId: rid, title: trip.title, end: Format.calendar.date(byAdding: .day, value: max(0, trip.days - 1), to: first))
    }

    // MARK: Positions

    /// A new position: kept once the interval has passed and it moved more than 40 m from the last one, then sent.
    private func record(_ loc: CLLocation) {
        if stopIfOver() { return }
        let now = loc.timestamp
        if let kept = lastKept, now.timeIntervalSince(kept) < Double(minutes * 60) - 5 { return }
        let prev = lastFix
        lastFix = (LonLat(loc.coordinate.longitude, loc.coordinate.latitude), now)
        d.set("\(loc.coordinate.longitude),\(loc.coordinate.latitude),\(now.timeIntervalSince1970)", forKey: "track.last")
        if let prev, buffered > 0 {
            // Standing still: one point, not a cloud of them (as the web merges a stay into one).
            let moved = CLLocation(latitude: prev.at.lat, longitude: prev.at.lon).distance(from: loc)
            if moved < 40 { return }
        }
        lastKept = now
        var buffer = readBuffer()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        buffer.append(["clientId": UUID().uuidString.lowercased(), "recordedAt": iso.string(from: now),
                       "latitude": loc.coordinate.latitude, "longitude": loc.coordinate.longitude])
        writeBuffer(buffer)
        flush()
    }

    private var flushing = false

    /// Sends what waits, 400 at a time; whatever does not get through waits for the next position.
    func flush() {
        guard !flushing, let id = d.string(forKey: "track.bufferTrip") ?? tripId else { return }
        let buffer = readBuffer()
        guard !buffer.isEmpty else { return }
        flushing = true
        let batch = Array(buffer.prefix(400))
        Task {
            defer { flushing = false }
            do {
                try await Api.shared.send("POST", "/api/trips/\(id)/points/batch", body: ["points": batch])
                writeBuffer(Array(readBuffer().dropFirst(batch.count)))
                lastError = nil
            } catch {
                lastError = "Wacht op netwerk"
            }
        }
    }

    private var bufferURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("mms-track-buffer.json")
    }

    private func readBuffer() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: bufferURL) else { return [] }
        return (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }

    private func writeBuffer(_ list: [[String: Any]]) {
        if let data = try? JSONSerialization.data(withJSONObject: list) { try? data.write(to: bufferURL, options: .atomic) }
        buffered = list.count
    }

    /// Your position for the dot on the homepage globe: only while tracking, with Voorkeuren › Eigen locatie on.
    static var selfDot: LonLat? {
        guard UserDefaults.standard.bool(forKey: "set.selfOnHome"), shared.active else { return nil }
        return shared.lastFix?.at
    }
}

extension Tracker: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated {
            authorization = status
            if status != .notDetermined, let w = waiting { waiting = nil; w.resume(returning: status) }
            if active {
                if hasPermission { resume() } else { lastError = "Geen toegang tot je locatie" }
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        MainActor.assumeIsolated { record(last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let code = (error as? CLError)?.code
        MainActor.assumeIsolated {
            if code == .denied { lastError = "Geen toegang tot je locatie" }
        }
    }
}

// MARK: Notifications

/// Every so often, also with the app closed, the app asks the server what is new and shows it as a notification.
enum Notices {
    static let task = "nl.markmaaktmedia.markmysteps.next.notices"
    private static let d = UserDefaults.standard

    static var enabled: Bool {
        get { d.bool(forKey: "set.notify") }
        set { d.set(newValue, forKey: "set.notify") }
    }

    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    static func permitted() async -> Bool {
        let s = await UNUserNotificationCenter.current().notificationSettings()
        return s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
    }

    /// The next look, at the earliest in a quarter of an hour; iOS decides when exactly.
    static func schedule() {
        guard enabled else { return }
        let request = BGAppRefreshTaskRequest(identifier: task)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do { try BGTaskScheduler.shared.submit(request) } catch { Api.log.error("notices schedule failed \(error.localizedDescription, privacy: .public)") }
    }

    static func cancel() { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: task) }

    /// Asks the server what is new and shows what was not shown before, as Android's NotifyJob.
    static func check() async {
        guard enabled, Api.shared.signedIn, await permitted(), let list = try? await Remote.notices() else { return }
        var seen = Set(d.stringArray(forKey: "notify.seen") ?? [])
        let fresh = list.filter { !$0.read && !seen.contains($0.id) }
        for n in fresh.prefix(5) {
            let who = n.actor ?? "Iemand", trip = n.trip ?? "een reis"
            let text: String? = switch n.kind {
            case "TRIP_ADDED": "\(who) voegde je toe aan \(trip)"
            case "ACCESS_REQUESTED": "\(who) wil meekijken met \(trip)"
            case "ACCESS_APPROVED": "Je mag meekijken met \(trip)"
            case "ACCESS_DENIED": "Je verzoek voor \(trip) is afgewezen"
            case "SECURITY_LOGIN_ATTEMPTS": "Er werd een paar keer geprobeerd in te loggen op je account"
            default: nil
            }
            if let text { post(id: n.id, text: text) }
        }
        seen.formUnion(fresh.map(\.id))
        d.set(Array(seen.suffix(300)), forKey: "notify.seen")
    }

    /// One notification on the phone.
    static func post(id: String, text: String) {
        let content = UNMutableNotificationContent()
        content.title = "MarkMySteps"
        content.body = text
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }
}

// MARK: Settings

/// Route tracking, your own position on the homepage and phone notifications, in Voorkeuren.
struct TrackingSettings: View {
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL
    @AppStorage("set.selfOnHome") private var selfOnHome = false
    @State private var tracker = Tracker.shared
    @State private var pickedTrip: String?
    @State private var explainLocation = false
    @State private var confirmStop = false
    @State private var denied: String?
    @State private var notify = Notices.enabled
    @State private var explainNotify = false
    @State private var custom = false

    private static let presets = [1, 5, 10, 15, 30]

    /// Your own trips under way or still to come, where you may track.
    private var candidates: [Trip] {
        store.coming.filter { t in
            // Tests only: in test mode with `-menuPreview YES` a demo trip can be tracked; every point stops in the log.
            if t.remoteId == nil { return Launch.menuPreview && Api.dryRun }
            let me = t.members.first { $0.userId == store.me?.id }
            return me?.role != "GUEST" && (me?.canTrack ?? true)
        }
    }

    var body: some View {
        Group {
            Section {
                if tracker.active {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Circle().fill(.green).frame(width: 9, height: 9)
                            Text("Actief voor \(tracker.tripTitle ?? "je reis")").font(.inter(16, 600)).foregroundStyle(Brand.ink).lineLimit(1)
                        }
                        TimelineView(.periodic(from: .now, by: 30)) { _ in
                            Text(detail).font(.inter(13.5, 450)).foregroundStyle(Brand.inkSoft)
                        }
                    }
                    Button(role: .destructive) { confirmStop = true } label: {
                        Text("Stop tracking").font(.outfit(15, 600)).foregroundStyle(.red)
                            .frame(maxWidth: .infinity).frame(height: 44).background(Color.red.opacity(0.1), in: .capsule)
                    }
                    .buttonStyle(.borderless)
                } else {
                    if candidates.isEmpty {
                        Text("Geen lopende of komende reizen").font(.inter(15, 450)).foregroundStyle(Brand.inkSoft)
                    } else {
                        Picker("Reis", selection: Binding(get: { pickedTrip ?? candidates.first.map { $0.remoteId ?? $0.id } }, set: { pickedTrip = $0 })) {
                            ForEach(candidates) { t in Text(t.title).tag(Optional(t.remoteId ?? t.id)) }
                        }
                        Button {
                            explainLocation = true
                        } label: {
                            Label("Start tracking", systemImage: "location.fill").font(.outfit(15, 650)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).frame(height: 46).background(Brand.accent, in: .capsule)
                        }
                        .buttonStyle(.borderless)
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Locatie opslaan elke").font(.outfit(14, 600)).foregroundStyle(Brand.inkSoft)
                    Picker("Interval", selection: Binding(get: { custom || !Self.presets.contains(tracker.minutes) ? 0 : tracker.minutes }, set: { v in
                        if v == 0 { custom = true } else { custom = false; tracker.minutes = v }
                    })) {
                        ForEach(Self.presets, id: \.self) { Text("\($0) min").tag($0) }
                        Text("Eigen").tag(0)
                    }
                    .pickerStyle(.segmented)
                    .sensoryFeedback(.selection, trigger: tracker.minutes)
                    if custom || !Self.presets.contains(tracker.minutes) {
                        Stepper("Elke \(tracker.minutes) minuten", value: Binding(get: { tracker.minutes }, set: { tracker.minutes = min(240, max(1, $0)) }), in: 1...240)
                            .font(.inter(15, 500))
                    }
                }
                .padding(.vertical, 4)
                if tracker.authorization == .authorizedWhenInUse {
                    Button("Zet locatie op Altijd in Instellingen", systemImage: "gear") { openSettings() }
                        .font(.inter(14.5, 550))
                }
            } header: { Text("Route-tracking") } footer: {
                if let msg = tracker.autoStopped { Text(msg) }
                else if tracker.authorization == .authorizedWhenInUse { Text("Met locatie op Tijdens gebruik stopt tracken als het scherm uit gaat. Zet hem op Altijd om je route ook in je zak bij te houden.") }
                else { Text("Houdt je route bij voor een reis, ook met het scherm uit. Een reis met Automatisch tracken begint vanzelf zodra hij begint en stopt na de laatste dag.") }
            }

            Section {
                Toggle(isOn: $selfOnHome) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Ook op de homepage")
                        Text("Je positie als stip op de globe, terwijl je een reis trackt. De app vraagt nooit los om je locatie.")
                            .font(.inter(13, 450)).foregroundStyle(Brand.inkSoft)
                    }
                }
                .sensoryFeedback(.selection, trigger: selfOnHome)
            } header: { Text("Eigen locatie") }

            Section {
                Toggle(isOn: Binding(get: { notify }, set: { on in
                    if on { explainNotify = true } else {
                        notify = false
                        Notices.enabled = false
                        Notices.cancel()
                    }
                })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Scan op nieuwe meldingen")
                        Text("Verzoeken en uitnodigingen komen binnen als melding, ook als de app dicht is. iOS kiest wanneer de app even mag kijken.")
                            .font(.inter(13, 450)).foregroundStyle(Brand.inkSoft)
                    }
                }
                .sensoryFeedback(.selection, trigger: notify)
            } header: { Text("Meldingen op je telefoon") }
        }
        .alert("Locatie voor je route", isPresented: $explainLocation) {
            Button("Niet nu", role: .cancel) {}
            Button("Verder") { startTracking() }
        } message: {
            Text("Om je route bij te houden heeft de app je locatie nodig, ook als het scherm uit is. iOS vraagt je zo om toestemming: kies eerst Tijdens gebruik en daarna Altijd. Je locatie gaat alleen naar je eigen server.")
        }
        .alert("Meldingen toestaan?", isPresented: $explainNotify) {
            Button("Niet nu", role: .cancel) {}
            Button("Verder") { enableNotify() }
        } message: {
            Text("Dan kan de app je laten weten als iemand wil meekijken of je toevoegt aan een reis. iOS vraagt je zo om toestemming.")
        }
        .alert("Stoppen met tracken?", isPresented: $confirmStop) {
            Button("Annuleren", role: .cancel) {}
            Button("Stoppen", role: .destructive) { tracker.stop(); Haptic.tap() }
        } message: {
            Text("De route van \(tracker.tripTitle ?? "deze reis") wordt niet verder bijgehouden. Wat al opgenomen is blijft staan.")
        }
        .alert("Geen toestemming", isPresented: Binding(get: { denied != nil }, set: { if !$0 { denied = nil } })) {
            Button("Niet nu", role: .cancel) {}
            Button("Instellingen") { openSettings() }
        } message: { Text(denied ?? "") }
    }

    private var detail: String {
        var parts: [String] = []
        if let fix = tracker.lastFix {
            let s = Int(Date().timeIntervalSince(fix.time))
            parts.append(s < 60 ? "laatste positie zojuist" : s < 3600 ? "laatste positie \(s / 60) min geleden" : "laatste positie \(s / 3600) uur geleden")
        } else {
            parts.append("Wachten op de eerste positie")
        }
        if tracker.buffered > 0 { parts.append("\(tracker.buffered) \(tracker.buffered == 1 ? "punt wacht" : "punten wachten") op verzenden") }
        if let e = tracker.lastError { parts.append(e) }
        return parts.joined(separator: " · ")
    }

    private func startTracking() {
        guard let id = pickedTrip ?? candidates.first.map({ $0.remoteId ?? $0.id }), let trip = candidates.first(where: { ($0.remoteId ?? $0.id) == id }) else { return }
        Task {
            let status = await tracker.requestPermission()
            guard status == .authorizedAlways || status == .authorizedWhenInUse else {
                denied = "MarkMySteps mag je locatie niet gebruiken. Zet het aan in Instellingen › MarkMySteps › Locatie."
                return
            }
            let end = trip.start.flatMap { Format.calendar.date(byAdding: .day, value: max(0, trip.days - 1), to: $0) }
            tracker.start(tripId: id, title: trip.title, end: end)
            Haptic.tap()
        }
    }

    private func enableNotify() {
        Task {
            if await Notices.requestPermission() {
                notify = true
                Notices.enabled = true
                Notices.schedule()
                await Notices.check()
            } else {
                denied = "MarkMySteps mag geen meldingen sturen. Zet het aan in Instellingen › MarkMySteps › Meldingen."
            }
        }
    }

    private func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
    }
}
