import Foundation
import UIKit
import OSLog
import Security
import SwiftUI

/// Tokens live in the Keychain, never in UserDefaults.
enum Keychain {
    private static let service = "nl.markmaaktmedia.markmysteps.next"

    static func get(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ account: String, _ value: String?) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status != errSecSuccess { Api.log.error("keychain write \(account, privacy: .public) failed status=\(status, privacy: .public)") }
    }

    /// Debug: `-keychaintest YES` writes, reads and removes a dummy item and logs the outcome.
    static func selfTest() {
        set("selftest", "ok")
        Api.log.notice("keychain selftest read=\(get("selftest") ?? "nil", privacy: .public)")
        set("selftest", nil)
    }
}

/// The test app's line to a real MarkMySteps server: sign in, then read the
/// trips, their stops and their photos. It only ever reads.
final class Api {
    static let shared = Api()
    static let log = Logger(subsystem: "nl.markmaaktmedia.markmysteps.next", category: "net")

    /// Debug: `-nettest <host>` asks https://<host>/api/auth/status once at launch and logs
    /// what came back (status, or the URLError code), to tell a network problem from an app one.
    static func netTest(_ host: String) async {
        guard let url = URL(string: "https://\(host)/api/auth/status") else { return }
        let started = Date()
        do {
            let (_, response) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15))
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            log.notice("nettest host=\(host, privacy: .public) status=\(status, privacy: .public) seconds=\(Date().timeIntervalSince(started), privacy: .public)")
        } catch {
            let code = (error as? URLError)?.code.rawValue ?? 0
            log.error("nettest host=\(host, privacy: .public) urlError=\(code, privacy: .public) seconds=\(Date().timeIntervalSince(started), privacy: .public) \(error.localizedDescription, privacy: .public)")
        }
    }

    private(set) var base: String
    private var access: String?
    private var refresh: String?
    /// One refresh at a time, however many requests found their token expired.
    private var renewing: Task<Renewal, Never>?

    /// How a token refresh went. Only a refresh the server turns down ends the session; no network (a train,
    /// a tunnel, a timeout) keeps the tokens and the last trips, so nobody is ever signed out by a bad connection.
    private enum Renewal { case renewed, rejected, unreachable }

    private init() {
        // The Keychain outlives a reinstall; the app's own settings do not. A fresh install starts signed out,
        // so tokens of an earlier install never come back.
        if !UserDefaults.standard.bool(forKey: "installed") {
            Keychain.set("access", nil)
            Keychain.set("refresh", nil)
            UserDefaults.standard.set(true, forKey: "installed")
        }
        base = UserDefaults.standard.string(forKey: "server") ?? ""
        access = Keychain.get("access")
        refresh = Keychain.get("refresh")
    }

    var signedIn: Bool { access != nil && !base.isEmpty }
    /// A new account that waits for the server's admin: its token opens nothing but the status, so the app shows
    /// the waiting page instead of loading trips. Read from the token's own "pending" flag, as Android does, so it
    /// also holds after signing in with a password while still waiting.
    var pending: Bool {
        guard signedIn, let part = access?.split(separator: ".").dropFirst().first else { return false }
        var b64 = part.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return o["pending"] as? Bool ?? false
    }

    /// The server as shown to people: without the scheme.
    var host: String { base.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "") }

    struct Failure: LocalizedError {
        let message: String
        var status = 0
        var errorDescription: String? { message }
    }

    enum Login {
        case done
        case needsCode(String)
    }

    func login(server: String, identifier: String, password: String) async throws -> Login {
        var b = server.trimmingCharacters(in: .whitespacesAndNewlines)
        while b.hasSuffix("/") { b.removeLast() }
        if !b.hasPrefix("http") { b = "https://" + b }
        base = b
        UserDefaults.standard.set(b, forKey: "server")
        let answer = try json(await request("POST", "/api/auth/login", body: ["identifier": identifier.trimmingCharacters(in: .whitespaces), "password": password], auth: false))
        if answer["mfaRequired"] as? Bool == true, let token = answer["mfaToken"] as? String { return .needsCode(token) }
        try tokens(answer)
        return .done
    }

    func loginCode(mfaToken: String, code: String) async throws {
        let answer = try json(await request("POST", "/api/auth/login/mfa", body: ["mfaToken": mfaToken, "code": code.trimmingCharacters(in: .whitespaces)], auth: false))
        try tokens(answer)
    }

    /// Asks the server for an account (POST /api/auth/register), as Android and the web. The first account of a
    /// server is in at once; anyone after waits for the admin. Never sent in test mode.
    func register(server: String, email: String, username: String, displayName: String, password: String) async throws -> String {
        if Api.dryRun {
            Api.log.notice("dryRun: POST /api/auth/register not sent")
            throw Failure(message: "Testmodus: er is niets verstuurd en geen account gemaakt.")
        }
        var b = server.trimmingCharacters(in: .whitespacesAndNewlines)
        while b.hasSuffix("/") { b.removeLast() }
        if !b.hasPrefix("http") { b = "https://" + b }
        base = b
        UserDefaults.standard.set(b, forKey: "server")
        let answer = try json(await request("POST", "/api/auth/register", body: [
            "email": email.trimmingCharacters(in: .whitespaces), "username": username.trimmingCharacters(in: .whitespaces),
            "displayName": displayName.trimmingCharacters(in: .whitespaces), "password": password,
        ], auth: false))
        try tokens(answer)
        return answer["status"] as? String ?? "PENDING"
    }

    /// Where a waiting account stands (GET /api/auth/status): PENDING, APPROVED or REJECTED.
    func approval() async throws -> String {
        try json(await request("GET", "/api/auth/status"))["status"] as? String ?? "PENDING"
    }

    /// Approved: a fresh token without the waiting flag, so the rest of the server opens.
    func upgrade() async -> Bool { await renew() == .renewed }

    /// Another server, from Diensten: the login page then opens on it. Tokens belong to the old one, so sign out after.
    func setServer(_ address: String) {
        // The tokens go first, so they are never stored next to a server they do not belong to.
        access = nil
        refresh = nil
        Keychain.set("access", nil)
        Keychain.set("refresh", nil)
        var b = address.trimmingCharacters(in: .whitespacesAndNewlines)
        while b.hasSuffix("/") { b.removeLast() }
        base = b
        UserDefaults.standard.set(b, forKey: "server")
    }

    func signOut() {
        // The server ends this session too, so the token is worthless even if a copy was left somewhere. Sent
        // and not waited for: signing out works the same without a connection.
        if let r = refresh, base.hasPrefix("https://"), !Api.dryRun, let url = URL(string: base + "/api/auth/logout") {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["refreshToken": r])
            URLSession.shared.dataTask(with: req).resume()
        }
        access = nil
        refresh = nil
        Keychain.set("access", nil)
        Keychain.set("refresh", nil)
        ImageLoader.shared.clear()
        // Photos and avatars the system kept on disk go as well.
        URLCache.shared.removeAllCachedResponses()
    }

    /// A secret on the clipboard (recovery codes, a 2FA key, a link password): only on this device, not
    /// synced to a Mac or iPad, and gone after two minutes.
    static func copySecret(_ text: String) {
        UIPasteboard.general.setItems([["public.utf8-plain-text": text]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
    }

    func get(_ path: String) async throws -> Data { try await request("GET", path) }

    /// Test mode: started with `-dryRun YES`, every write is answered here and never leaves the phone, so a
    /// test can tap delete, rename or answer a request on real data without changing anything. Like Android's `Api.dryRun`.
    static let dryRun: Bool = UserDefaults.standard.bool(forKey: "dryRun")

    /// A change on the server, only ever from something the person tapped.
    @discardableResult
    func send(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Data {
        if Api.dryRun && method != "GET" {
            // Only the names of the fields: a body can hold a password, a code or a key, and the log is no place for them.
            let bare = path.split(separator: "?").first.map(String.init) ?? path
            let fields = body.map { "{" + $0.keys.sorted().joined(separator: ",") + "}" } ?? ""
            Api.log.notice("MmsDryRun \(method, privacy: .public) \(bare, privacy: .public) \(fields, privacy: .public)")
            return Data("{}".utf8)
        }
        return try await request(method, path, body: body)
    }

    /// An image from the server, with the token; nil when it cannot be had.
    func bytes(_ path: String) async -> Data? { try? await request("GET", path, accept: "image/*") }

    /// A whole file from the server (an original photo or a film), streamed to a temporary file instead of held in
    /// memory, with the token and one retry after a refresh. Answers the file and the server's response.
    func file(_ path: String, retried: Bool = false) async throws -> (URL, HTTPURLResponse) {
        guard let url = URL(string: base + path) else { throw Failure(message: "Dat serveradres klopt niet") }
        var req = URLRequest(url: url, timeoutInterval: 120)
        req.setValue("*/*", forHTTPHeaderField: "Accept")
        if let access { req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
        let (temp, response): (URL, URLResponse)
        do { (temp, response) = try await URLSession.shared.download(for: req) } catch { throw Failure(message: "Kan de server niet bereiken") }
        guard let http = response as? HTTPURLResponse else { throw Failure(message: "Onverwacht antwoord van de server") }
        if http.statusCode == 401 && !retried, await renew() == .renewed { return try await file(path, retried: true) }
        guard (200..<300).contains(http.statusCode) else { throw Failure(message: "De server gaf \(http.statusCode)", status: http.statusCode) }
        // The system removes its own temporary file once this call returns: moved somewhere that stays.
        let kept = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.moveItem(at: temp, to: kept)
        return (kept, http)
    }

    /// A file sent as multipart form data (an avatar, a Polarsteps zip, a track). Test mode stops it here like `send`.
    @discardableResult
    func upload(_ path: String, field: String = "file", filename: String, mime: String, data: Data) async throws -> Data {
        if Api.dryRun {
            Api.log.notice("MmsDryRun POST \(path, privacy: .public) {multipart:\(field, privacy: .public)}")
            return Data("{}".utf8)
        }
        return try await multipart(path, field: field, filename: filename, mime: mime, data: data, retried: false)
    }

    private func multipart(_ path: String, field: String, filename: String, mime: String, data: Data, retried: Bool) async throws -> Data {
        guard let url = URL(string: base + path) else { throw Failure(message: "Dat serveradres klopt niet") }
        let boundary = "mms-\(UUID().uuidString)"
        var req = URLRequest(url: url, timeoutInterval: 300)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let access { req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
        var body = Data()
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(field)\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let (answer, response): (Data, URLResponse)
        do { (answer, response) = try await URLSession.shared.upload(for: req, from: body) } catch { throw Failure(message: "Kan de server niet bereiken") }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 && !retried, await renew() == .renewed {
            return try await multipart(path, field: field, filename: filename, mime: mime, data: data, retried: true)
        }
        guard (200..<300).contains(code) else {
            let message = (try? JSONSerialization.jsonObject(with: answer) as? [String: Any])?["message"] as? String
            throw Failure(message: message.flatMap { $0.isEmpty ? nil : $0 } ?? "De server gaf \(code)", status: code)
        }
        return answer
    }

    private func tokens(_ o: [String: Any]) throws {
        guard let a = o["accessToken"] as? String, let r = o["refreshToken"] as? String else { throw Failure(message: "Onverwacht antwoord van de server") }
        access = a
        refresh = r
        Keychain.set("access", a)
        Keychain.set("refresh", r)
    }

    private func renew() async -> Renewal {
        if let renewing { return await renewing.value }
        let task = Task<Renewal, Never> {
            guard let r = refresh else { return .rejected }
            do {
                try tokens(json(await request("POST", "/api/auth/refresh", body: ["refreshToken": r], auth: false)))
                return .renewed
            } catch let failure as Failure {
                // 400, 401 or 403: the refresh token itself is no good any more. Anything else (no answer, 5xx)
                // says nothing about the session.
                return [400, 401, 403].contains(failure.status) ? .rejected : .unreachable
            } catch {
                return .unreachable
            }
        }
        renewing = task
        let outcome = await task.value
        renewing = nil
        if outcome == .rejected { Api.log.notice("session refresh rejected") }
        return outcome
    }

    private func json(_ data: Data) throws -> [String: Any] {
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure(message: "Onverwacht antwoord van de server") }
        return o
    }

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil, auth: Bool = true, accept: String = "application/json", retried: Bool = false) async throws -> Data {
        guard let url = URL(string: base + path) else { throw Failure(message: "Dat serveradres klopt niet") }
        // Signing in answers quickly or not at all: 15 seconds, then a clear message instead of a spinner.
        var req = URLRequest(url: url, timeoutInterval: auth ? 30 : 15)
        req.httpMethod = method
        req.setValue(accept, forHTTPHeaderField: "Accept")
        if auth, let access { req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            // Only the host and the error code are logged: never the path's query, a password or a token.
            let code = (error as? URLError)?.code.rawValue ?? 0
            Api.log.error("request failed host=\(url.host() ?? "?", privacy: .public) urlError=\(code, privacy: .public) \(error.localizedDescription, privacy: .public)")
            throw Failure(message: "Kan de server niet bereiken")
        }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 401 && auth && !retried {
            switch await renew() {
            case .renewed: return try await request(method, path, body: body, auth: auth, accept: accept, retried: true)
            case .unreachable: throw Failure(message: "Kan de server niet bereiken")
            case .rejected: break
            }
        }
        guard (200..<300).contains(code) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
            throw Failure(message: message.flatMap { $0.isEmpty ? nil : $0 } ?? "De server gaf \(code)", status: code)
        }
        return data
    }
}

/// Reads the signed-in account's trips into the same shapes the demo uses.
enum Remote {
    struct Me: Hashable {
        let id: String
        let name: String
        let username: String
        var hasAvatar = false
        var admin = false
    }

    /// Your travelling in numbers, as the web's Reizigers page shows it.
    struct Stats: Hashable {
        let trips: Int
        let days: Int
        let countries: [String]
        let places: Int
        let flights: Int
        let km: Int
        let photos: Int
    }

    struct Friend: Identifiable, Hashable {
        let id: String
        let name: String
        let username: String
        let hasAvatar: Bool
        let sharedTrips: Int
    }

    static func stats(_ userId: String) async throws -> Stats {
        let data = try await Api.shared.get("/api/users/\(userId)/stats")
        Cache.save("stats", data)
        return parseStats(data)
    }

    static func parseStats(_ data: Data) -> Stats {
        let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        func int(_ k: String) -> Int { (o[k] as? NSNumber)?.intValue ?? 0 }
        return Stats(
            trips: int("trips"), days: int("days"), countries: o["countries"] as? [String] ?? [], places: int("places"),
            // Companions' photos count unless Voorkeuren says only your own.
            flights: int("flights"), km: int("distanceKm"), photos: Prefs.ownPhotosOnly && o["ownPhotoCount"] != nil ? int("ownPhotoCount") : int("photoCount")
        )
    }

    static func friends() async throws -> [Friend] {
        let data = try await Api.shared.get("/api/users/friends")
        Cache.save("friends", data)
        return parseFriends(data)
    }

    static func parseFriends(_ data: Data) -> [Friend] {
        let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
        return list.compactMap { o in
            guard let id = o["id"] as? String else { return nil }
            return Friend(
                id: id, name: o["displayName"] as? String ?? "", username: o["username"] as? String ?? "",
                hasAvatar: o["hasAvatar"] as? Bool ?? false, sharedTrips: (o["sharedTrips"] as? NSNumber)?.intValue ?? 0
            )
        }
    }

    /// A country code as its Dutch name: "IS" becomes "IJsland".
    static func countryName(_ code: String) -> String {
        Format.dutch.localizedString(forRegionCode: code) ?? code
    }

    private static let palette: [UInt32] = [0xE8613C, 0x2BB6A8, 0xD08A2A, 0x7A5BD6, 0xE34B8A, 0x5B8DEF, 0xC9772E, 0x7DA7D9]

    static func me() async throws -> Me {
        let data = try await Api.shared.get("/api/users/me")
        Cache.save("me", data)
        return parseMe(data)
    }

    static func parseMe(_ data: Data) -> Me {
        let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        return Me(id: o["id"] as? String ?? "", name: o["displayName"] as? String ?? "", username: o["username"] as? String ?? "",
                  hasAvatar: o["hasAvatar"] as? Bool ?? false, admin: (o["role"] as? String) == "ADMIN")
    }

    /// "🇳🇱" back to "NL".
    static func code(fromFlag flag: String) -> String? {
        let scalars = flag.unicodeScalars.filter { (0x1F1E6...0x1F1FF).contains($0.value) }
        guard scalars.count == 2 else { return nil }
        return String(scalars.compactMap { Unicode.Scalar($0.value - 0x1F1E6 + 65) }.map(Character.init))
    }

    static func flag(_ code: String?) -> String {
        guard let code, code.count == 2 else { return "📍" }
        return code.uppercased().unicodeScalars.compactMap { Unicode.Scalar(0x1F1E6 + $0.value - 65) }.map { String($0) }.joined()
    }

    private static func points(_ any: Any?) -> [LonLat] {
        (any as? [[Double]] ?? (any as? [Any])?.compactMap { $0 as? [Double] } ?? []).compactMap { $0.count >= 2 ? LonLat($0[0], $0[1]) : nil }
    }

    static func day(_ any: Any?) -> Date? {
        guard let s = any as? String, s.count >= 10 else { return nil }
        let parts = s.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Format.calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    private static func color(_ any: Any?) -> Color? {
        guard let s = any as? String, s.hasPrefix("#"), s.count == 7, let v = UInt32(s.dropFirst(), radix: 16) else { return nil }
        return Color(hex: v)
    }

    static func trips(me: String) async throws -> [Trip] {
        let data = try await Api.shared.get("/api/trips")
        Cache.save("trips", data)
        return parseTrips(data, me: me)
    }

    static func parseTrips(_ data: Data, me: String) -> [Trip] {
        let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
        let cal = Format.calendar
        let today = cal.startOfDay(for: Date())
        return list.enumerated().compactMap { i, o -> Trip? in
            guard let id = o["id"] as? String, let start = day(o["startDate"]), let end = day(o["endDate"]) else { return nil }
            // Each piece of recorded route stays its own line; joining them draws lines across the gaps.
            let segments = (o["routePath"] as? [Any] ?? []).map { points($0) }.filter { $0.count >= 2 }
            let routes = segments.flatMap { $0 }
            let flights = (o["flightPath"] as? [Any] ?? []).compactMap { line -> Trip.Flight? in
                let p = points(line)
                return p.count >= 2 ? Trip.Flight(from: p[0], to: p[p.count - 1]) : nil
            }
            let rows = o["members"] as? [[String: Any]] ?? []
            let everyone = rows.map { m in
                let user = m["user"] as? [String: Any]
                let name = user?["displayName"] as? String ?? "?"
                return Person(
                    initial: String(name.prefix(1)).uppercased(), color: Person.color(for: m["userId"] as? String),
                    name: name, username: user?["username"] as? String ?? "", userId: m["userId"] as? String,
                    hasAvatar: user?["hasAvatar"] as? Bool ?? false, role: m["role"] as? String ?? "MEMBER",
                    canTrack: m["canTrack"] as? Bool ?? true, fromDate: day(m["fromDate"]), toDate: day(m["toDate"])
                )
            }
            // The faces are the travellers: owner first, then the companions, yourself included; not guests.
            let travellers = everyone.filter { $0.role != "GUEST" }
            let members = travellers.filter { $0.role == "OWNER" } + travellers.filter { $0.role != "OWNER" }
            // Shared with you only when you are a guest on it; as a companion it is your own trip.
            let mine = rows.first { ($0["userId"] as? String ?? ($0["user"] as? [String: Any])?["id"] as? String) == me }
            let guest = (mine?["role"] as? String) == "GUEST"
            let days = (cal.dateComponents([.day], from: start, to: end).day ?? 0) + 1
            let startsIn = cal.dateComponents([.day], from: today, to: start).day ?? 0
            let cover = o["resolvedCoverId"] as? String
            return Trip(
                id: id,
                title: o["title"] as? String ?? "Reis",
                month: Format.monthsLong[cal.component(.month, from: start) - 1],
                year: String(cal.component(.year, from: start)),
                dates: Format.range(start, end, withYear: true),
                days: days,
                // No measured distance is no distance, never "0 km".
                km: (o["distanceKm"] as? NSNumber).map { $0.intValue }.flatMap { $0 > 0 ? $0 : nil },
                color: color(o["color"]) ?? Color(hex: palette[i % palette.count]),
                colorHex: o["color"] as? String,
                route: routes.isEmpty ? points(o["stopPoints"]) : routes,
                segments: segments,
                flights: flights,
                upcoming: end >= today,
                startsInDays: startsIn > 0 ? startsIn : nil,
                people: members,
                extraPeople: 0,
                shared: guest,
                members: everyone,
                ownerId: o["ownerId"] as? String,
                remoteId: id,
                coverId: (cover?.isEmpty ?? true) ? nil : cover,
                start: start,
                marker: {
                    guard let lng = (o["markerLng"] as? NSNumber)?.doubleValue, let lat = (o["markerLat"] as? NSNumber)?.doubleValue else { return nil }
                    return LonLat(lng, lat)
                }(),
                autoTrack: o["autoTrack"] as? Bool ?? false
            )
        }
        .sorted { ($0.start ?? .distantPast) > ($1.start ?? .distantPast) }
    }

    /// The planned stops with their day trips under them, and the way there and back, with their dates worked out
    /// from the trip's start.
    static func stops(_ trip: Trip) async throws -> (stops: [Stop], outbound: Leg?, back: Leg?) {
        guard let rid = trip.remoteId else { return (trip.stops, trip.outbound, trip.back) }
        let list = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(rid)/stops")) as? [[String: Any]] ?? []
        func isChild(_ o: [String: Any]) -> Bool { !(o["parentStopId"] == nil || o["parentStopId"] is NSNull) }
        let rows = list.filter { !isChild($0) }.sorted { ($0["orderIndex"] as? Int ?? 0) < ($1["orderIndex"] as? Int ?? 0) }
        let children = Dictionary(grouping: list.filter(isChild), by: { $0["parentStopId"] as? String ?? "" })
        let cal = Format.calendar
        var day = trip.start ?? cal.startOfDay(for: Date())
        var stops: [Stop] = []
        var outbound: Leg?
        var back: Leg?
        func text(_ o: [String: Any], _ k: String) -> String? { (o[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }
        func point(_ o: [String: Any]) -> LonLat? {
            guard let lat = (o["latitude"] as? NSNumber)?.doubleValue, let lon = (o["longitude"] as? NSNumber)?.doubleValue else { return nil }
            return LonLat(lon, lat)
        }
        for (index, o) in rows.enumerated() {
            let mode: Mode = switch o["travelMode"] as? String {
            case "FLIGHT": .flight
            case "TRAIN": .train
            case "BUS": .bus
            case "BOAT": .boat
            default: .car
            }
            let nights = o["nights"] as? Int ?? 0
            let name = o["name"] as? String ?? ""
            let via = (o["viaAirports"] as? [String] ?? []).filter { !$0.isEmpty }
            // The way there and back are stops of their own with no nights, at the ends.
            if nights == 0 && (index == 0 || index == rows.count - 1) && (name.hasPrefix("Heen") || name.hasPrefix("Terug")) {
                let from = text(o, "fromAirport") ?? "Thuis"
                let leg = Leg(mode: mode, from: from, to: text(o, "toAirport") ?? "", km: 0, serverId: o["id"] as? String,
                              flightNumber: text(o, "flightNumber"), fromAirport: text(o, "fromAirport"), toAirport: text(o, "toAirport"), via: via)
                if index == 0 { outbound = leg } else { back = leg }
                continue
            }
            // The server's own dates when it gives them, so gaps in the plan do not shift everything after.
            let from = Remote.day(o["arrivalDate"]) ?? day
            day = Remote.day(o["departureDate"]) ?? cal.date(byAdding: .day, value: nights, to: from) ?? from
            let at = point(o) ?? trip.route.first ?? LonLat(0, 0)
            let outings = (children[o["id"] as? String ?? ""] ?? []).compactMap { c -> DayTrip? in
                guard let p = point(c) else { return nil }
                return DayTrip(name: c["name"] as? String ?? "", flag: flag(c["countryCode"] as? String), at: p,
                               day: Remote.day(c["dayTripDate"]) ?? Remote.day(c["arrivalDate"]), serverId: c["id"] as? String,
                               cover: text(c, "coverMediaId"))
            }.sorted { ($0.day ?? .distantPast) < ($1.day ?? .distantPast) }
            stops.append(Stop(
                name: name, flag: flag(o["countryCode"] as? String), at: at, nights: nights,
                dates: nights == 0 ? Format.shortDay(from) : Format.range(from, day, withYear: false),
                mode: mode, start: from, serverId: o["id"] as? String,
                flightNumber: text(o, "flightNumber"), fromAirport: text(o, "fromAirport"), toAirport: text(o, "toAirport"), via: via,
                dayTrips: outings, cover: text(o, "coverMediaId")
            ))
        }
        return (stops, outbound, back)
    }

    // MARK: People and sharing

    struct ShareLink: Identifiable, Hashable {
        let id: String
        let slug: String
        let hasPassword: Bool
        /// What the server says, usually a path; the server address goes in front.
        var path: String = ""
        var url: String {
            let p = path.isEmpty ? "/s/" + slug : path
            return p.hasPrefix("http") ? p : Api.shared.base + p
        }
    }

    static func shareLinks(_ trip: Trip) async throws -> [ShareLink] {
        guard let rid = trip.remoteId else { return [] }
        let list = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(rid)/share")) as? [[String: Any]] ?? []
        return list.compactMap { o in
            guard let id = o["id"] as? String, let slug = o["slug"] as? String else { return nil }
            return ShareLink(id: id, slug: slug, hasPassword: o["hasPassword"] as? Bool ?? false, path: o["url"] as? String ?? "")
        }
    }

    static func createShareLink(_ trip: Trip, password: String? = nil) async throws {
        guard let rid = trip.remoteId else { return }
        var body: [String: Any] = [:]
        if let password, !password.isEmpty { body["password"] = password }
        try await Api.shared.send("POST", "/api/trips/\(rid)/share", body: body)
    }

    /// Sets, changes or (with nil) removes a link's password.
    static func setLinkPassword(_ trip: Trip, _ link: ShareLink, _ password: String?) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("PATCH", "/api/trips/\(rid)/share/\(link.id)", body: ["password": password ?? NSNull()])
    }

    static func revokeShareLink(_ trip: Trip, _ link: ShareLink) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("DELETE", "/api/trips/\(rid)/share/\(link.id)")
    }

    static func suggestions(_ query: String) async throws -> [Friend] {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return parseFriends(try await Api.shared.get("/api/users/suggestions?q=\(q)&limit=8"))
    }

    static func addMembers(_ trip: Trip, usernames: [String]) async throws {
        guard let rid = trip.remoteId, !usernames.isEmpty else { return }
        try await Api.shared.send("POST", "/api/trips/\(rid)/members", body: ["usernames": usernames])
    }

    /// Only what is given changes; a date of nil means the trip's own first or last day.
    static func updateMember(_ trip: Trip, userId: String, role: String? = nil, canTrack: Bool? = nil, days: (from: Date?, to: Date?)? = nil) async throws {
        guard let rid = trip.remoteId else { return }
        var body: [String: Any] = [:]
        if let role { body["role"] = role }
        if let canTrack { body["canTrack"] = canTrack }
        if let days {
            body["fromDate"] = days.from.map { PlannerRemote.isoDay($0) } ?? NSNull()
            body["toDate"] = days.to.map { PlannerRemote.isoDay($0) } ?? NSNull()
        }
        try await Api.shared.send("PATCH", "/api/trips/\(rid)/members/\(userId)", body: body)
    }

    /// A link's password read back; nil with recoverable false for a link from before passwords were kept readable.
    static func linkPassword(_ trip: Trip, _ link: ShareLink) async throws -> (password: String?, recoverable: Bool) {
        guard let rid = trip.remoteId else { return (nil, false) }
        let o = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(rid)/share/\(link.id)/password")) as? [String: Any] ?? [:]
        return ((o["password"] as? String).flatMap { $0.isEmpty ? nil : $0 }, o["recoverable"] as? Bool ?? false)
    }

    static func setRole(_ trip: Trip, userId: String, role: String) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("PATCH", "/api/trips/\(rid)/members/\(userId)", body: ["role": role])
    }

    static func removeMember(_ trip: Trip, userId: String) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("DELETE", "/api/trips/\(rid)/members/\(userId)")
    }

    // MARK: Comments and reactions

    struct Comment: Identifiable, Hashable {
        let id: String
        let mediaId: String?
        /// Set for a comment under a day's story ("2026-05-04") instead of under a photo.
        var day: String? = nil
        let author: String
        let body: String
        let at: Date
        /// Your own, or as the trip's organiser anyone's.
        var canDelete = false
    }

    static let reactionKinds = ["heart", "laugh", "wow", "love", "clap"]
    static let reactionEmoji = ["heart": "❤️", "laugh": "😂", "wow": "😮", "love": "😍", "clap": "👏"]

    struct Reactions {
        var counts: [String: [String: Int]] = [:]
        var mine: [String: String] = [:]
        /// Who gave what, per target, when the server says.
        var names: [String: [(kind: String, name: String)]] = [:]
    }

    private static func parseComment(_ o: [String: Any]) -> Comment? {
        guard let id = o["id"] as? String else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return Comment(
            id: id, mediaId: o["mediaId"] as? String, day: (o["day"] as? String).map { String($0.prefix(10)) },
            author: o["authorName"] as? String ?? "", body: o["body"] as? String ?? "",
            at: (o["createdAt"] as? String).flatMap { iso.date(from: $0) } ?? Date(), canDelete: o["canDelete"] as? Bool ?? false
        )
    }

    static func comments(_ trip: Trip) async throws -> [Comment] {
        guard let rid = trip.remoteId else { return [] }
        let list = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(rid)/comments")) as? [[String: Any]] ?? []
        return list.compactMap(parseComment)
    }

    static func deleteComment(_ trip: Trip, _ id: String) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("DELETE", "/api/trips/\(rid)/comments/\(id)")
    }

    static func reactions(_ trip: Trip) async throws -> Reactions {
        guard let rid = trip.remoteId else { return Reactions() }
        let o = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(rid)/reactions")) as? [String: Any] ?? [:]
        var out = Reactions()
        for c in o["counts"] as? [[String: Any]] ?? [] {
            guard let target = c["target"] as? String, let kind = c["kind"] as? String else { continue }
            out.counts[target, default: [:]][kind] = (c["count"] as? NSNumber)?.intValue ?? 0
        }
        out.mine = o["mine"] as? [String: String] ?? [:]
        for (target, list) in o["names"] as? [String: [[String: Any]]] ?? [:] {
            out.names[target] = list.compactMap { n in
                guard let kind = n["kind"] as? String, let name = n["name"] as? String else { return nil }
                return (kind, name)
            }
        }
        return out
    }

    /// The comment as the server made it; nil when the answer holds none (test mode answers "{}").
    @discardableResult
    static func addComment(_ trip: Trip, mediaId: String, body: String) async throws -> Comment? {
        guard let rid = trip.remoteId else { return nil }
        let data = try await Api.shared.send("POST", "/api/trips/\(rid)/media/\(mediaId)/comments", body: ["body": body])
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]).flatMap(parseComment)
    }

    /// A comment under a day's story.
    @discardableResult
    static func addDayComment(_ trip: Trip, day: String, body: String) async throws -> Comment? {
        guard let rid = trip.remoteId else { return nil }
        let data = try await Api.shared.send("POST", "/api/trips/\(rid)/days/\(day)/comments", body: ["body": body])
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]).flatMap(parseComment)
    }

    static func setReaction(_ trip: Trip, mediaId: String, kind: String?) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("PUT", "/api/trips/\(rid)/media/\(mediaId)/reaction", body: ["kind": kind ?? NSNull()])
    }

    // MARK: Planner, trip settings, notifications, videos

    private static func modeName(_ m: Mode) -> String {
        switch m { case .car: "GROUND"; case .train: "TRAIN"; case .bus: "BUS"; case .boat: "BOAT"; case .flight: "FLIGHT" }
    }

    static func updateStop(_ trip: Trip, _ stopId: String, nights: Int? = nil, mode: Mode? = nil) async throws {
        guard let rid = trip.remoteId else { return }
        var body: [String: Any] = [:]
        if let nights { body["nights"] = nights }
        if let mode { body["travelMode"] = modeName(mode) }
        try await Api.shared.send("PATCH", "/api/trips/\(rid)/stops/\(stopId)", body: body)
    }

    static func deleteStop(_ trip: Trip, _ stopId: String) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("DELETE", "/api/trips/\(rid)/stops/\(stopId)")
    }

    static func reorderStops(_ trip: Trip, _ ids: [String]) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("PUT", "/api/trips/\(rid)/stops/order", body: ["stopIds": ids])
    }

    struct Place: Hashable, Identifiable {
        let name: String
        let region: String
        let countryCode: String?
        let at: LonLat
        var id: String { name + region }
        var flag: String { Remote.flag(countryCode) }
    }

    static func addStop(_ trip: Trip, id: String, place: Place, nights: Int, afterStopId: String? = nil) async throws {
        guard let rid = trip.remoteId else { return }
        var body: [String: Any] = ["id": id, "name": place.name, "nights": nights, "latitude": place.at.lat, "longitude": place.at.lon]
        if let c = place.countryCode { body["countryCode"] = c }
        // Before the way back, never after it.
        if let afterStopId { body["afterStopId"] = afterStopId }
        try await Api.shared.send("POST", "/api/trips/\(rid)/stops", body: body)
    }

    /// Towns by name, from Photon like the web app; only what was typed leaves the phone.
    static func searchPlaces(_ query: String) async -> [Place] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2, let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://photon.komoot.io/api/?limit=8&lang=en&osm_tag=place&q=\(enc)") else { return [] }
        guard let (data, _) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 8)),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
        var seen = Set<String>()
        return (o["features"] as? [[String: Any]] ?? []).compactMap { f -> Place? in
            guard let p = f["properties"] as? [String: Any], let name = p["name"] as? String, !name.isEmpty,
                  let c = (f["geometry"] as? [String: Any])?["coordinates"] as? [Double], c.count >= 2 else { return nil }
            let region = [p["state"] as? String, p["country"] as? String].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
            let place = Place(name: name, region: region, countryCode: (p["countrycode"] as? String)?.uppercased(), at: LonLat(c[0], c[1]))
            return seen.insert(place.id).inserted ? place : nil
        }.prefix(6).map { $0 }
    }

    static func setTripColor(_ trip: Trip, _ hex: String?) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("PATCH", "/api/trips/\(rid)", body: ["color": hex ?? NSNull()])
    }

    static func renameTrip(_ trip: Trip, _ title: String) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("PATCH", "/api/trips/\(rid)", body: ["title": title.trimmingCharacters(in: .whitespacesAndNewlines)])
    }

    static func deleteTrip(_ trip: Trip) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("DELETE", "/api/trips/\(rid)")
    }

    /// Leaving a trip someone else made: you take yourself off its members.
    static func leaveTrip(_ trip: Trip, me: String) async throws {
        guard let rid = trip.remoteId, !me.isEmpty else { return }
        try await Api.shared.send("DELETE", "/api/trips/\(rid)/members/\(me)")
    }

    static func syncPhotos(_ trip: Trip) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("POST", "/api/trips/\(rid)/sync")
    }

    static func createTrip(title: String, start: Date, end: Date) async throws -> String? {
        let f = DateFormatter()
        f.calendar = Format.calendar; f.timeZone = Format.calendar.timeZone; f.dateFormat = "yyyy-MM-dd"
        let data = try await Api.shared.send("POST", "/api/trips", body: ["title": title, "startDate": f.string(from: start), "endDate": f.string(from: end)])
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["id"] as? String
    }

    /// A playable address for a video: the server hands out a short-lived token in the URL.
    static func videoURL(_ mediaId: String) async throws -> URL? {
        let o = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/media/\(mediaId)/video-url")) as? [String: Any]
        guard let path = o?["url"] as? String else { return nil }
        return URL(string: path.hasPrefix("http") ? path : Api.shared.base + path)
    }

    struct Notice: Identifiable, Hashable {
        let id: String
        let kind: String
        let at: Date
        let read: Bool
        let actorId: String?
        let actor: String?
        let actorAvatar: Bool
        let tripId: String?
        let trip: String?
        let requestId: String?
        let requestStatus: String?
        let detail: String?
    }

    static func noticeCount() async throws -> Int {
        let o = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/notifications/count")) as? [String: Any] ?? [:]
        return ((o["unread"] as? NSNumber)?.intValue ?? 0) + ((o["pending"] as? NSNumber)?.intValue ?? 0)
    }

    static func notices() async throws -> [Notice] {
        let list = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/notifications")) as? [[String: Any]] ?? []
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return list.compactMap { o in
            guard let id = o["id"] as? String else { return nil }
            let actor = o["actor"] as? [String: Any], trip = o["trip"] as? [String: Any], req = o["request"] as? [String: Any]
            return Notice(
                id: id, kind: o["kind"] as? String ?? "", at: (o["createdAt"] as? String).flatMap { iso.date(from: $0) } ?? Date(),
                read: o["read"] as? Bool ?? false, actorId: actor?["id"] as? String, actor: actor?["displayName"] as? String,
                actorAvatar: actor?["hasAvatar"] as? Bool ?? false, tripId: trip?["id"] as? String, trip: trip?["title"] as? String,
                requestId: req?["id"] as? String, requestStatus: req?["status"] as? String, detail: o["detail"] as? String
            )
        }
    }

    static func markNoticesRead() async throws { try await Api.shared.send("POST", "/api/notifications/read") }

    /// Takes one line off the list; an unanswered request itself stays open, as on the web.
    static func dismissNotice(_ id: String) async throws { try await Api.shared.send("DELETE", "/api/notifications/\(id)") }

    /// Let someone look along as a guest, or turn them down.
    static func answerAccess(_ requestId: String, approve: Bool) async throws {
        try await Api.shared.send("POST", "/api/access-requests/\(requestId)/\(approve ? "approve" : "deny")", body: approve ? ["role": "GUEST"] : nil)
    }

    /// The days of a trip with something on the map, as Android's MapRemote.days: how many route points and photos.
    static func mapDays(_ trip: Trip) async throws -> [(day: Date, points: Int, photos: Int)] {
        guard let rid = trip.remoteId else { return [] }
        let list = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(rid)/days")) as? [[String: Any]] ?? []
        return list.compactMap { o in
            guard let d = day(o["day"]) else { return nil }
            return (d, (o["points"] as? NSNumber)?.intValue ?? 0, (o["photos"] as? NSNumber)?.intValue ?? 0)
        }
        .sorted { $0.day < $1.day }
    }

    /// The recorded route of one day, every traveller's line as its own piece (GeoJSON from /route?day=).
    static func dayRoute(_ trip: Trip, _ date: Date) async throws -> [[LonLat]] {
        guard let rid = trip.remoteId else { return [] }
        let o = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(rid)/route?day=\(PlannerRemote.isoDay(date))")) as? [String: Any]
        let features = o?["features"] as? [[String: Any]] ?? []
        return features.compactMap { f in
            let line = points((f["geometry"] as? [String: Any])?["coordinates"])
            return line.count >= 2 ? line : nil
        }
    }

    static func media(_ trip: Trip) async throws -> [Media] {
        guard let rid = trip.remoteId else { return [] }
        let list = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(rid)/media")) as? [[String: Any]] ?? []
        return list.compactMap { o -> Media? in
            // The day it was taken where it was taken (PhotoDay), else its UTC date.
            guard let id = o["id"] as? String, let taken = PhotoDay.of(takenAt: o["takenAt"] as? String, takenAtLocal: o["takenAtLocal"] as? String) else { return nil }
            let w = o["width"] as? Double ?? 0, h = o["height"] as? Double ?? 0
            // Where it was taken, for the photos on the trip map.
            let lat = (o["latitude"] as? NSNumber)?.doubleValue, lon = (o["longitude"] as? NSNumber)?.doubleValue
            let asset = (o["immichAssetId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return Media(id: id, takenAt: taken, video: (o["assetType"] as? String) == "VIDEO", ratio: w > 0 && h > 0 ? w / h : 1, lat: lat, lon: lon,
                         userId: o["userId"] as? String, immichAssetId: asset)
        }
        // By day; within a day the server's order stands, which is the order they were taken in.
        .enumerated().sorted { ($0.element.takenAt, $0.offset) < ($1.element.takenAt, $1.offset) }.map(\.element)
    }
}

/// The last answers of the server, so a signed-in launch starts on your own trips
/// instead of flashing the demo first. Trip data only; tokens stay in the Keychain.
enum Cache {
    private static var dir: URL { FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0] }
    static func save(_ name: String, _ data: Data) { try? data.write(to: dir.appendingPathComponent("mms-\(name).json")) }
    static func load(_ name: String) -> Data? { try? Data(contentsOf: dir.appendingPathComponent("mms-\(name).json")) }
    static func clear() { for n in ["me", "trips", "stats", "friends", "planned"] { try? FileManager.default.removeItem(at: dir.appendingPathComponent("mms-\(n).json")) } }
}

/// Where the pages get their trips: the invented ones, or after signing in the account's own.
@Observable
final class Store {
    static let shared = Store()

    var trips: [Trip]
    var me: Remote.Me?
    var stats: Remote.Stats?
    var friends: [Remote.Friend] = []
    /// Whether the people have been read once, so the page can hold their place until then.
    var friendsLoaded = false
    var live: Bool
    var error: String?
    /// The server turned the session down (401 after a refresh): the app goes back to signing in, it never
    /// quietly carries on with the demo's trips and figures.
    var sessionExpired = false
    /// Countries of your own trips still to come that you have not been to yet (ISO codes), from the stops of
    /// those trips on the server; Reizigers shows them with an hourglass.
    var plannedCountries: [String] = []
    /// Bumped on every reload, so pages that read more per trip read it again.
    var version = 0

    private init() {
        if Api.shared.signedIn {
            let me = Cache.load("me").map(Remote.parseMe)
            self.me = me
            trips = Cache.load("trips").map { Remote.parseTrips($0, me: me?.id ?? "") } ?? []
            stats = Cache.load("stats").map(Remote.parseStats)
            let cachedFriends = Cache.load("friends").map(Remote.parseFriends)
            friends = cachedFriends ?? []
            friendsLoaded = cachedFriends != nil
            plannedCountries = Cache.load("planned").flatMap { try? JSONDecoder().decode([String].self, from: $0) } ?? []
            live = true
        } else {
            trips = Demo.past + [Demo.upcoming]
            live = false
        }
    }

    /// Your own trips; one you are a guest on counts as shared.
    var own: [Trip] { trips.filter { !$0.shared } }
    var past: [Trip] { own.filter { !$0.upcoming } }
    /// Under way first, then the coming ones by how soon they start.
    var coming: [Trip] { own.filter(\.upcoming).sorted { ($0.startsInDays ?? 0) < ($1.startsInDays ?? 0) } }
    var next: Trip? { coming.first }
    /// Shared with you: on a real account the guest trips, in the demo two with company.
    var sharedTrips: [Trip] { live ? trips.filter(\.shared) : Array(past.filter { !$0.people.isEmpty }.prefix(Demo.sharedCount)) }
    var shared: Int { sharedTrips.count }

    /// A trip to open from a test argument: that id, or on a real account a sensible one.
    func trip(for id: String?, upcoming: Bool) -> Trip? {
        if let id, let t = trips.first(where: { $0.id == id }) { return t }
        return upcoming ? (next ?? past.first) : (past.first ?? next)
    }

    func load() async {
        guard Api.shared.signedIn, !Api.shared.pending else { return }
        do {
            let me = try await Remote.me()
            self.me = me
            trips = try await Remote.trips(me: me.id)
            live = true
            error = nil
            version += 1
            // The figures and the people come after the trips; the page keeps their place meanwhile.
            if let s = try? await Remote.stats(me.id) { stats = s }
            if let f = try? await Remote.friends() { friends = f }
            friendsLoaded = true
            await loadPlanned()
        } catch let failure as Api.Failure {
            if failure.status == 401 {
                signOut()
                sessionExpired = true
            } else {
                error = failure.message
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The countries of the real upcoming trips' stops that the server's statistics do not count as visited yet.
    private func loadPlanned() async {
        let visited = Set((stats?.countries ?? []).map { $0.uppercased() })
        var codes: [String] = []
        for trip in coming {
            guard let stops = try? await Remote.stops(trip).stops else { continue }
            for code in stops.compactMap({ Remote.code(fromFlag: $0.flag) }) where !visited.contains(code) && !codes.contains(code) {
                codes.append(code)
            }
        }
        plannedCountries = codes
        if let data = try? JSONEncoder().encode(codes) { Cache.save("planned", data) }
    }

    func signOut() {
        // Nothing of this account keeps running: tracking stops, its waiting points go, the notifications check ends.
        Tracker.shared.reset()
        Notices.enabled = false
        Notices.cancel()
        Api.shared.signOut()
        Cache.clear()
        plannedCountries = []
        trips = Demo.past + [Demo.upcoming]
        me = nil
        stats = nil
        friends = []
        friendsLoaded = false
        live = false
        version += 1
    }
}
