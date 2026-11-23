import Foundation
import Photos

/*
 * What the photo viewer asks for beyond the photos themselves, as the web's
 * viewer (viewerTools.ts) and Android's ViewerApi.kt do: the covers, the file
 * as it was taken, the link into Immich, and the name of the place a photo
 * was taken.
 */
enum ViewerApi {
    /// A stop as the server plans it, day trips included, with the days it covers.
    struct StopRow: Hashable {
        let id: String
        let name: String
        let lat: Double?
        let lon: Double?
        let arrival: Date?
        let departure: Date?
        let dayTrip: Bool
    }

    static func stops(_ trip: Trip) async throws -> [StopRow] {
        guard let rid = trip.remoteId else { return [] }
        let list = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(rid)/stops")) as? [[String: Any]] ?? []
        return list.sorted { ($0["orderIndex"] as? Int ?? 0) < ($1["orderIndex"] as? Int ?? 0) }.compactMap { o in
            guard let id = o["id"] as? String else { return nil }
            return StopRow(
                id: id, name: o["name"] as? String ?? "",
                lat: (o["latitude"] as? NSNumber)?.doubleValue, lon: (o["longitude"] as? NSNumber)?.doubleValue,
                // A day trip is one day: its dayTripDate when the row has no dates of its own.
                arrival: Remote.day(o["arrivalDate"]) ?? Remote.day(o["dayTripDate"]),
                departure: Remote.day(o["departureDate"]) ?? Remote.day(o["dayTripDate"]),
                dayTrip: !(o["parentStopId"] == nil || o["parentStopId"] is NSNull)
            )
        }
    }

    /// The stop a photo belongs to, as Android's and the web's: the place it was actually taken at (the nearest stop or
    /// day trip within 8 km; of two equally near, the one of its own day), else of the stops that cover its day the
    /// nearest within 30 km, else the nearest of all within 30 km, else the first stop (no day trip) that covers the
    /// day. Without the first step a photo taken in Monachil offered "Cover van Granada", 8 km away.
    static func stopFor(_ media: Media, _ stops: [StopRow]) -> StopRow? {
        let day = media.takenAt
        let covering = stops.filter { s in
            guard let a = s.arrival, let d = s.departure else { return false }
            return day >= a && day <= d
        }
        if let lat = media.lat, let lon = media.lon {
            func nearest(_ list: [StopRow]) -> (StopRow, Double)? {
                list.compactMap { s -> (StopRow, Double)? in
                    guard let slat = s.lat, let slon = s.lon else { return nil }
                    return (s, Geo.km(LonLat(lon, lat), LonLat(slon, slat)))
                }.min { $0.1 < $1.1 }
            }
            let at = stops.compactMap { s -> (StopRow, Double)? in
                guard let slat = s.lat, let slon = s.lon else { return nil }
                return (s, Geo.km(LonLat(lon, lat), LonLat(slon, slat)))
            }.filter { $0.1 <= 8 }.sorted { $0.1 < $1.1 }
            if let best = at.first {
                return (at.first { $0.1 <= best.1 + 1 && covering.contains($0.0) } ?? best).0
            }
            if let hit = nearest(covering), hit.1 <= 30 { return hit.0 }
            if let hit = nearest(stops), hit.1 <= 30 { return hit.0 }
        }
        return covering.first { !$0.dayTrip }
    }

    /// The trip's cover (owner only), the field the server's UpdateTripDto takes.
    static func setTripCover(_ trip: Trip, mediaId: String?) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("PATCH", "/api/trips/\(rid)", body: ["coverMediaId": mediaId ?? NSNull()])
    }

    /// One stop's cover (owner only), as UpdateStopDto takes it.
    static func setStopCover(_ trip: Trip, stopId: String, mediaId: String) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("PATCH", "/api/trips/\(rid)/stops/\(stopId)", body: ["coverMediaId": mediaId])
    }

    private static var immich: String?
    private static var immichAsked = false

    /// Where your own Immich opens in a browser: only its public address (the one the server talks to can be a
    /// home-network name a phone cannot open). Nil hides "Openen in Immich"; not connected answers 404.
    static func immichUrl() async -> String? {
        if immichAsked { return immich }
        guard let data = try? await Api.shared.get("/api/immich/connection"),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        immichAsked = true
        var url = (o["publicUrl"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        while url.hasSuffix("/") { url.removeLast() }
        immich = url.isEmpty ? nil : url
        return immich
    }

    // MARK: The place a photo was taken

    private static var places: [String: String?] = [:]

    /// "City, Country" for a spot, as the web's reversePlaceName: Photon's nearest settlement first, then anything
    /// there, the country in Dutch from its code. A real answer is kept (also "nothing here"); a failed lookup
    /// throws and is asked again next time.
    static func placeName(lat: Double, lon: Double) async throws -> String? {
        let key = String(format: "%.2f,%.2f", lat, lon)
        if let hit = places[key] { return hit }
        let first = try await photon("lat=\(lat)&lon=\(lon)&limit=1&lang=en&osm_tag=place&radius=30")
        let name: String
        if let first { name = first } else { name = try await photon("lat=\(lat)&lon=\(lon)&limit=1&lang=en") ?? "" }
        let value: String? = name.isEmpty ? nil : name
        places[key] = .some(value)
        return value
    }

    /// The name already known for a spot, without asking.
    static func knownPlace(lat: Double, lon: Double) -> String?? { places[String(format: "%.2f,%.2f", lat, lon)] }

    /// One Photon reverse lookup: the name, "" for no result, nil when this variant found nothing to go on.
    private static func photon(_ query: String) async throws -> String? {
        guard let url = URL(string: "https://photon.komoot.io/reverse?\(query)") else { return nil }
        var req = URLRequest(url: url, timeoutInterval: 5)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let code = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(code) else { throw Api.Failure(message: "photon") }
        let o = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let p = (o?["features"] as? [[String: Any]])?.first?["properties"] as? [String: Any] else { return nil }
        func s(_ k: String) -> String? { (p[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }
        let city = s("city") ?? s("district") ?? s("locality") ?? s("name") ?? s("county") ?? s("state")
        // The country in Dutch from its code ("Marokko", not "Morocco"); Photon itself has no Dutch.
        let country = s("countrycode").flatMap { Format.dutch.localizedString(forRegionCode: $0.uppercased()) } ?? s("country")
        return [city, country].compactMap { $0 }.joined(separator: ", ")
    }

    // MARK: The file itself

    /// The original as it was taken, in a temporary file named as the server names it (from Immich), else the day
    /// and the start of the id, as the web names it.
    static func original(_ media: Media) async throws -> URL {
        let (temp, response) = try await Api.shared.file("/api/media/\(media.id)/thumbnail?size=original")
        let type = (response.value(forHTTPHeaderField: "Content-Type") ?? "").split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        let ext: String = switch type.split(separator: "/").last.map({ $0.lowercased() }) ?? "" {
        case "jpeg", "jpg": "jpg"
        case "png": "png"
        case "webp": "webp"
        case "heic": "heic"
        case "heif": "heif"
        case "avif": "avif"
        case "gif": "gif"
        case "tiff": "tiff"
        case "mp4": "mp4"
        case "quicktime": "mov"
        case "webm": "webm"
        default: media.video ? "mp4" : "jpg"
        }
        var name = filename(response.value(forHTTPHeaderField: "Content-Disposition") ?? "") ?? {
            let f = DateFormatter()
            f.calendar = Format.calendar; f.timeZone = Format.calendar.timeZone; f.dateFormat = "yyyy-MM-dd"
            return "\(f.string(from: media.takenAt))-\(media.id.prefix(8)).\(ext)"
        }()
        name = String(name.map { "\\/:*?\"<>|".contains($0) ? "_" : $0 }.prefix(120))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("shared", isDirectory: true)
        // One file at a time is enough: the last one handed over is the only one another app may still be reading.
        try? FileManager.default.removeItem(at: dir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let target = dir.appendingPathComponent(name)
        try FileManager.default.moveItem(at: temp, to: target)
        return target
    }

    private static func filename(_ disposition: String) -> String? {
        if let r = disposition.range(of: "filename\\*=UTF-8''([^;]+)", options: [.regularExpression, .caseInsensitive]) {
            let raw = disposition[r].replacingOccurrences(of: "filename*=UTF-8''", with: "", options: .caseInsensitive)
            if let decoded = raw.removingPercentEncoding, !decoded.isEmpty { return decoded }
        }
        if let r = disposition.range(of: "filename=\"?([^\";]+)\"?", options: [.regularExpression, .caseInsensitive]) {
            let raw = disposition[r].replacingOccurrences(of: "filename=", with: "", options: .caseInsensitive).trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
            if !raw.isEmpty { return raw }
        }
        return nil
    }

    enum SaveOutcome { case saved, denied, failed }

    /// The original into the phone's Photos, asking for permission to add (only to add) the first time.
    static func saveToPhotos(_ media: Media) async -> SaveOutcome {
        var status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        if status == .notDetermined { status = await PHPhotoLibrary.requestAuthorization(for: .addOnly) }
        guard status == .authorized || status == .limited else { return .denied }
        guard let file = try? await original(media) else { return .failed }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = file.lastPathComponent
                request.addResource(with: media.video ? .video : .photo, fileURL: file, options: options)
            }
            return .saved
        } catch {
            return .failed
        }
    }
}
