import SwiftUI

/*
 * Day stories and the weather in the timeline, as the web shows them: under a day what each traveller wrote
 * about it (yours to write, edit or delete), with the comments on that day under it, and the day's real
 * weather where you were from Open-Meteo.
 */

extension Remote {
    struct Note: Identifiable, Hashable {
        let id: String
        /// "2026-05-04"
        let day: String
        let title: String?
        let body: String
        let authorId: String?
        let author: String
    }

    private static func parseNotes(_ data: Data) -> [Note] {
        ((try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []).compactMap { o in
            guard let id = o["id"] as? String else { return nil }
            return Note(id: id, day: String((o["day"] as? String ?? "").prefix(10)), title: (o["title"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                        body: o["body"] as? String ?? "", authorId: o["authorId"] as? String, author: o["authorName"] as? String ?? "")
        }
    }

    static func notes(_ trip: Trip) async throws -> [Note] {
        guard let rid = trip.remoteId else { return [] }
        return parseNotes(try await Api.shared.get("/api/trips/\(rid)/notes"))
    }

    /// Your own story of a day, new or changed (one per author per day); answers the trip's stories when the server
    /// sends them back, nil in test mode.
    static func saveNote(_ trip: Trip, day: String, body: String) async throws -> [Note]? {
        guard let rid = trip.remoteId else { return nil }
        let data = try await Api.shared.send("PUT", "/api/trips/\(rid)/notes", body: ["day": day, "body": body.trimmingCharacters(in: .whitespacesAndNewlines)])
        return (try? JSONSerialization.jsonObject(with: data)) is [Any] ? parseNotes(data) : nil
    }

    static func deleteNote(_ trip: Trip, _ id: String) async throws {
        guard let rid = trip.remoteId else { return }
        try await Api.shared.send("DELETE", "/api/trips/\(rid)/notes/\(id)")
    }

    // MARK: Weather

    struct Weather: Hashable {
        let maxC: Int
        let code: Int

        var symbol: String {
            switch code {
            case 0, 1: "sun.max"
            case 2: "cloud.sun"
            case 71...77, 85, 86: "cloud.snow"
            case 95...99: "cloud.bolt"
            case 51...67, 80...82: "cloud.rain"
            default: "cloud"
            }
        }
    }

    @MainActor private static var weatherCache: [String: Weather?] = [:]

    /// A day's weather where you were: Open-Meteo, the archive for every day more than a week ago (the forecast API
    /// answers null for those, so recent stops had no weather). A day that is over is kept on the phone, so it is
    /// never asked twice.
    @MainActor static func weather(at: LonLat, day: Date) async -> Weather? {
        let iso = PlannerRemote.isoDay(day)
        let key = String(format: "%.2f,%.2f,", at.lat, at.lon) + iso
        if let hit = weatherCache[key] { return hit }
        if let kept = UserDefaults.standard.string(forKey: "w." + key)?.split(separator: ","), kept.count == 2, let t = Int(kept[0]), let c = Int(kept[1]) {
            let w = Weather(maxC: t, code: c)
            weatherCache[key] = w
            return w
        }
        let today = Format.calendar.startOfDay(for: Date())
        let ahead = Format.calendar.dateComponents([.day], from: today, to: day).day ?? 0
        guard ahead <= 14 else { return nil }
        let host = -ahead > 7 ? "archive-api.open-meteo.com/v1/archive" : "api.open-meteo.com/v1/forecast"
        guard let url = URL(string: "https://\(host)?latitude=\(at.lat)&longitude=\(at.lon)&daily=weather_code,temperature_2m_max,precipitation_sum,precipitation_hours&start_date=\(iso)&end_date=\(iso)&timezone=auto"),
              let (data, _) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 8)),
              let daily = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["daily"] as? [String: Any],
              let t = (daily["temperature_2m_max"] as? [Any])?.first as? Double,
              var code = ((daily["weather_code"] as? [Any])?.first as? NSNumber)?.intValue else {
            return nil
        }
        let mm = ((daily["precipitation_sum"] as? [Any])?.first as? Double) ?? 0
        let hours = ((daily["precipitation_hours"] as? [Any])?.first as? Double) ?? 0
        // Under half a millimetre nothing meaningful fell: the day was just clouded over (web dayCondition).
        if (51...86).contains(code) && !(71...77).contains(code) && !(85...86).contains(code) && (mm < 0.5 || hours < 1) { code = 3 }
        let w = Weather(maxC: Int(t.rounded()), code: code)
        weatherCache[key] = w
        if ahead <= -2 { UserDefaults.standard.set("\(w.maxC),\(w.code)", forKey: "w." + key) }
        return w
    }
}

/// The weather of a day, fading in once it is known; nothing in its place until then.
struct WeatherBadge: View {
    let at: LonLat
    let day: Date
    @State private var weather: Remote.Weather?

    var body: some View {
        HStack(spacing: 5) {
            if let weather {
                Image(systemName: weather.symbol).font(.system(size: 14, weight: .medium))
                Text("\(weather.maxC)°").font(.inter(15, 500))
            }
        }
        .foregroundStyle(Brand.inkSoft)
        .padding(.leading, weather == nil ? 0 : 6)
        .animation(.easeOut(duration: 0.3), value: weather)
        .task(id: "\(at.lat),\(at.lon),\(day)") { weather = await Remote.weather(at: at, day: day) }
    }
}

/// The stories of a day under its heading: the others' as they wrote them, yours with a menu to edit or delete,
/// a quiet invitation to write one, and the comments on the day.
struct DayStoryRow: View {
    let day: Date
    let notes: [Remote.Note]
    let comments: Int
    let me: String?
    let canWrite: Bool
    let canComment: Bool
    let onWrite: (Remote.Note?) -> Void
    let onDelete: (Remote.Note) -> Void
    let onComments: () -> Void

    var body: some View {
        let own = notes.first { $0.authorId != nil && $0.authorId == me }
        VStack(alignment: .leading, spacing: 8) {
            ForEach(notes) { n in
                VStack(alignment: .leading, spacing: 4) {
                    if let title = n.title { Text(title).font(.outfit(16, 650)).foregroundStyle(Brand.ink) }
                    Text(n.body).font(.inter(15, 450)).foregroundStyle(Brand.ink).lineSpacing(3)
                    HStack {
                        Text(n.author).font(.inter(12.5, 500)).foregroundStyle(Brand.inkSoft)
                        Spacer()
                        if n.id == own?.id && canWrite {
                            Menu {
                                Button("Bewerken", systemImage: "pencil") { onWrite(n) }
                                Button("Verwijderen", systemImage: "trash", role: .destructive) { onDelete(n) }
                            } label: {
                                Image(systemName: "ellipsis").font(.system(size: 14, weight: .semibold)).foregroundStyle(Brand.inkSoft)
                                    .frame(width: 32, height: 24).contentShape(.rect)
                            }
                            .accessibilityLabel("Je verhaal bewerken of verwijderen")
                        }
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Brand.raised, in: .rect(cornerRadius: 20))
            }
            HStack(spacing: 8) {
                if canWrite && own == nil {
                    pill(Label("Verhaal schrijven", systemImage: "pencil")) { onWrite(nil) }
                }
                if canComment && (!notes.isEmpty || comments > 0) {
                    pill(Label(comments == 0 ? "Reageer" : "\(comments) \(comments == 1 ? "reactie" : "reacties")", systemImage: "bubble.left")) { onComments() }
                }
            }
        }
    }

    private func pill(_ label: some View, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            label.labelStyle(Tight()).font(.outfit(13.5, 600)).foregroundStyle(Brand.inkSoft)
                .padding(.horizontal, 12).frame(height: 32)
                .background(Brand.raised, in: .capsule)
                .contentShape(.capsule)
        }
        .buttonStyle(.borderless)
    }

    private struct Tight: LabelStyle {
        func makeBody(configuration: Configuration) -> some View {
            HStack(spacing: 5) { configuration.icon.font(.system(size: 12, weight: .semibold)); configuration.title }
        }
    }
}

/// Writing or changing your story of a day.
struct StoryEditor: Identifiable {
    let day: Date
    let note: Remote.Note?
    var id: String { PlannerRemote.isoDay(day) }
}

struct StorySheet: View {
    let editor: StoryEditor
    let onSave: (String) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    init(editor: StoryEditor, onSave: @escaping (String) async -> String?) {
        self.editor = editor
        self.onSave = onSave
        _text = State(initialValue: editor.note?.body ?? "")
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 10) {
                TextEditor(text: $text)
                    .font(.inter(17))
                    .focused($focused)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(Brand.raised, in: .rect(cornerRadius: 18))
                    .overlay(alignment: .topLeading) {
                        if text.isEmpty {
                            Text("Wat deed je, wat zag je?").font(.inter(17)).foregroundStyle(Brand.inkSoft.opacity(0.7))
                                .padding(.horizontal, 15).padding(.vertical, 18).allowsHitTesting(false)
                        }
                    }
                if let error { Text(error).font(.inter(14, 500)).foregroundStyle(.red) }
            }
            .padding(16)
            .background(Brand.paper)
            .navigationTitle(Format.dayHeading(editor.day))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuleren") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Bewaren") {
                            busy = true
                            Task {
                                if let failure = await onSave(text) { error = failure } else { dismiss() }
                                busy = false
                            }
                        }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { focused = true }
    }
}
