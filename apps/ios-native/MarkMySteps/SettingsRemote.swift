import Foundation

/// The calls behind Instellingen and the account, the same endpoints and bodies the web app and Android use
/// (apps/api/src: users, auth/2fa, immich, admin, import). Every write goes through `Api.send` or `Api.upload`, so
/// test mode stops it on the phone, where a write answers "{}"; nothing here trusts a field to be in an answer.
enum SettingsRemote {
    private static func object(_ data: Data) -> [String: Any] { (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:] }
    private static func list(_ data: Data) -> [[String: Any]] { (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? [] }
    private static func text(_ o: [String: Any], _ k: String) -> String? { (o[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }

    // MARK: Account

    struct Account: Equatable {
        var id = ""
        var email = ""
        var username = ""
        var displayName = ""
        var admin = false
        var hasAvatar = false
    }

    static func account() async throws -> Account {
        let o = object(try await Api.shared.get("/api/users/me"))
        let a = Account(id: o["id"] as? String ?? "", email: o["email"] as? String ?? "", username: o["username"] as? String ?? "",
                        displayName: o["displayName"] as? String ?? "", admin: (o["role"] as? String) == "ADMIN", hasAvatar: o["hasAvatar"] as? Bool ?? false)
        UserDefaults.standard.set(a.admin, forKey: "cache.admin")
        return a
    }

    /// Whether the account was an admin when last asked, so the Accounts row is there at once.
    static var cachedAdmin: Bool { UserDefaults.standard.bool(forKey: "cache.admin") }

    /// The name always, the username only when it is meant to change.
    static func saveProfile(displayName: String, username: String?) async throws {
        var body: [String: Any] = ["displayName": displayName.trimmingCharacters(in: .whitespaces)]
        if let username { body["username"] = username.trimmingCharacters(in: .whitespaces) }
        try await Api.shared.send("PATCH", "/api/users/me", body: body)
    }

    /// Nil when the server could not say.
    static func usernameFree(_ name: String) async -> Bool? {
        let q = name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name
        guard let data = try? await Api.shared.get("/api/users/username-available?name=\(q)") else { return nil }
        return object(data)["available"] as? Bool
    }

    static func changePassword(current: String, new: String) async throws {
        try await Api.shared.send("POST", "/api/users/me/password", body: ["currentPassword": current, "newPassword": new])
    }

    static func uploadAvatar(_ jpeg: Data) async throws {
        try await Api.shared.upload("/api/users/me/avatar", filename: "avatar.jpg", mime: "image/jpeg", data: jpeg)
    }

    static func removeAvatar() async throws { try await Api.shared.send("DELETE", "/api/users/me/avatar") }

    // MARK: Two-step verification

    struct TwoFactor: Equatable { var enabled: Bool; var codesLeft: Int }

    static func twoFactor() async throws -> TwoFactor {
        let o = object(try await Api.shared.get("/api/auth/2fa"))
        return TwoFactor(enabled: o["enabled"] as? Bool ?? false, codesLeft: (o["recoveryCodesLeft"] as? NSNumber)?.intValue ?? 0)
    }

    /// The secret and the address for the authenticator's QR; nil when the answer holds none (as in test mode).
    static func twoFactorSetup(password: String) async throws -> (secret: String, uri: String)? {
        let o = object(try await Api.shared.send("POST", "/api/auth/2fa/setup", body: ["password": password]))
        guard let secret = text(o, "secret"), let uri = text(o, "otpauthUri") else { return nil }
        return (secret, uri)
    }

    static func twoFactorEnable(code: String) async throws -> [String] {
        let o = object(try await Api.shared.send("POST", "/api/auth/2fa/enable", body: ["code": code.filter { !$0.isWhitespace }]))
        return o["recoveryCodes"] as? [String] ?? []
    }

    static func twoFactorDisable(password: String, code: String) async throws {
        try await Api.shared.send("POST", "/api/auth/2fa/disable", body: ["password": password, "code": code.trimmingCharacters(in: .whitespaces)])
    }

    static func twoFactorNewCodes(password: String, code: String) async throws -> [String] {
        let o = object(try await Api.shared.send("POST", "/api/auth/2fa/recovery-codes", body: ["password": password, "code": code.trimmingCharacters(in: .whitespaces)]))
        return o["recoveryCodes"] as? [String] ?? []
    }

    // MARK: Immich

    struct Immich: Equatable {
        var serverUrl: String
        var publicUrl: String?
        var keyPreview: String
        var lastSync: String?
        var lastError: String?
    }

    private static func parseImmich(_ o: [String: Any]) -> Immich? {
        guard let url = text(o, "serverUrl") else { return nil }
        return Immich(serverUrl: url, publicUrl: text(o, "publicUrl"), keyPreview: o["apiKeyPreview"] as? String ?? "",
                      lastSync: text(o, "lastSyncAt"), lastError: text(o, "lastSyncError"))
    }

    /// Nil when not connected (the server answers 404).
    static func immich() async throws -> Immich? {
        do {
            return parseImmich(object(try await Api.shared.get("/api/immich/connection")))
        } catch let failure as Api.Failure where failure.status == 404 {
            return nil
        }
    }

    static func connectImmich(serverUrl: String, apiKey: String, publicUrl: String?) async throws -> Immich? {
        var body: [String: Any] = ["serverUrl": serverUrl.trimmingCharacters(in: .whitespaces), "apiKey": apiKey.trimmingCharacters(in: .whitespaces)]
        if let p = publicUrl?.trimmingCharacters(in: .whitespaces), !p.isEmpty { body["publicUrl"] = p }
        return parseImmich(object(try await Api.shared.send("PUT", "/api/immich/connection", body: body)))
    }

    static func disconnectImmich() async throws { try await Api.shared.send("DELETE", "/api/immich/connection") }

    // MARK: Accounts on this server (admins only)

    struct AdminUser: Identifiable, Equatable {
        let id: String
        let email: String
        let username: String
        let displayName: String
        let admin: Bool
        let status: String
        let tempPassword: Bool
        let trips: Int
        let twoFactor: Bool
    }

    static func adminUsers() async throws -> [AdminUser] {
        list(try await Api.shared.get("/api/admin/users")).compactMap { o in
            guard let id = o["id"] as? String else { return nil }
            return AdminUser(
                id: id, email: o["email"] as? String ?? "", username: o["username"] as? String ?? "", displayName: o["displayName"] as? String ?? "",
                admin: (o["role"] as? String) == "ADMIN", status: o["status"] as? String ?? "", tempPassword: o["mustChangePassword"] as? Bool ?? false,
                trips: (o["tripCount"] as? NSNumber)?.intValue ?? 0, twoFactor: o["twoFactor"] as? Bool ?? false
            )
        }
    }

    static func createUser(email: String, username: String, displayName: String, tempPassword: String) async throws {
        try await Api.shared.send("POST", "/api/admin/users", body: [
            "email": email.trimmingCharacters(in: .whitespaces), "username": username.trimmingCharacters(in: .whitespaces),
            "displayName": displayName.trimmingCharacters(in: .whitespaces), "tempPassword": tempPassword,
        ])
    }

    static func decide(_ id: String, approve: Bool) async throws { try await Api.shared.send("POST", "/api/admin/users/\(id)/\(approve ? "approve" : "reject")") }
    static func resetPassword(_ id: String, temp: String) async throws { try await Api.shared.send("POST", "/api/admin/users/\(id)/reset-password", body: ["tempPassword": temp]) }
    static func resetTwoFactor(_ id: String) async throws { try await Api.shared.send("POST", "/api/admin/users/\(id)/reset-2fa") }
    static func setRole(_ id: String, admin: Bool) async throws { try await Api.shared.send("POST", "/api/admin/users/\(id)/role", body: ["role": admin ? "ADMIN" : "USER"]) }
    static func deleteUser(_ id: String) async throws { try await Api.shared.send("DELETE", "/api/admin/users/\(id)") }

    /// A temporary password as the web makes one: twelve letters and digits that are hard to mix up.
    static func tempPassword() -> String {
        let chars = Array("abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return String((0..<12).map { _ in chars.randomElement()! })
    }

    // MARK: Data

    struct Imported: Hashable { let title: String; let start: String; let end: String; let points: Int }

    static func importPolarsteps(_ zip: Data) async throws -> [Imported] {
        list(try await Api.shared.upload("/api/import/polarsteps", filename: "polarsteps.zip", mime: "application/zip", data: zip)).map {
            Imported(title: $0["title"] as? String ?? "", start: $0["startDate"] as? String ?? "", end: $0["endDate"] as? String ?? "",
                     points: ($0["pointsImported"] as? NSNumber)?.intValue ?? 0)
        }
    }

    static func importTrack(tripId: String, filename: String, data: Data) async throws -> (found: Int, added: Int, outside: Int, undated: Int) {
        let mime = filename.lowercased().hasSuffix(".kml") ? "application/vnd.google-earth.kml+xml" : "application/gpx+xml"
        let o = object(try await Api.shared.upload("/api/trips/\(tripId)/import-track", filename: filename, mime: mime, data: data))
        func n(_ k: String) -> Int { (o[k] as? NSNumber)?.intValue ?? 0 }
        return (n("found"), n("added"), n("outsideTrip"), n("undated"))
    }

    /// The trip's route as a GPX or KML file, in a temporary file.
    static func exportTrack(tripId: String, format: String) async throws -> URL {
        try await Api.shared.file("/api/trips/\(tripId)/export/\(format)").0
    }

    /// The raw trip list, for the pickers and the backup.
    static func tripsRaw() async throws -> [[String: Any]] { list(try await Api.shared.get("/api/trips")) }

    /// Everything of one trip a backup holds, as the web's createBackup reads it.
    static func tripParts(_ id: String) async -> [String: Any] {
        func arr(_ path: String) async -> [Any] { ((try? await Api.shared.get(path)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [Any] }) ?? [] }
        return [
            "stops": await arr("/api/trips/\(id)/stops"), "media": await arr("/api/trips/\(id)/media"),
            "notes": await arr("/api/trips/\(id)/notes"), "points": await arr("/api/trips/\(id)/points"),
        ]
    }
}
