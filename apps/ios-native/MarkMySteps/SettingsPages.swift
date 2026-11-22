import SwiftUI
import UniformTypeIdentifiers

/*
 * The settings pages that talk to your server: Voorkeuren (on this phone), Diensten (the server and Immich),
 * Gegevens (backup, Polarsteps, route files, the photo cache) and, for an admin, Accounts.
 */

// MARK: Voorkeuren

struct PreferencesPage: View {
    @Environment(Store.self) private var store
    @AppStorage("set.globeStopsAlways") private var stopsAlways = false
    @AppStorage("set.ownPhotosOnly") private var ownPhotosOnly = false
    @State private var airports = Prefs.airports
    @State private var query = ""
    @State private var found: [FlightAirports.Airport] = []
    @State private var airportsIn = false

    var body: some View {
        let _ = airportsIn
        Form {
            Group {
                Section {
                    ForEach(Array(airports.enumerated()), id: \.element) { i, code in
                        HStack(spacing: 10) {
                            if let a = FlightAirports.byCode[code] { FlagView(flag: a.country, height: 13) }
                            Text(FlightAirports.label(code)).font(.inter(16, 500)).foregroundStyle(Brand.ink)
                            Spacer()
                            if i == 0 {
                                Text("Thuis").font(.outfit(13, 650)).foregroundStyle(Brand.accent)
                                    .padding(.horizontal, 10).padding(.vertical, 3).background(Brand.accent.opacity(0.12), in: .capsule)
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { remove(code) } label: { Label("Verwijderen", systemImage: "trash") }
                        }
                        .swipeActions(edge: .leading) {
                            if i > 0 { Button { makeFirst(code) } label: { Label("Thuis", systemImage: "house") }.tint(Brand.accent) }
                        }
                        .contextMenu {
                            if i > 0 { Button("Maak thuisvliegveld", systemImage: "house") { makeFirst(code) } }
                            Button("Verwijderen", systemImage: "trash", role: .destructive) { remove(code) }
                        }
                    }
                    HStack(spacing: 10) {
                        Image(systemName: "plus.magnifyingglass").foregroundStyle(Brand.inkSoft)
                        TextField("Vliegveld toevoegen, bv. Eindhoven", text: $query).autocorrectionDisabled()
                    }
                    ForEach(found.filter { !airports.contains($0.iata) }, id: \.iata) { a in
                        Button { add(a.iata) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("\(a.city) (\(a.iata))").font(.outfit(15, 600)).foregroundStyle(Brand.ink)
                                    Text("\(a.name) · \(Remote.countryName(a.country))").font(.inter(12.5, 450)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                                }
                                Spacer()
                                Image(systemName: "plus.circle.fill").foregroundStyle(Brand.accent)
                            }
                        }
                    }
                } header: { Text("Standaard vliegvelden") } footer: {
                    Text("De eerste is je thuisvliegveld: de heenvlucht vertrekt er en vluchten bieden ze als eerste aan. Veeg naar rechts om er een thuis te maken.")
                }
                Section {
                    Picker("Tussenstops", selection: $stopsAlways) {
                        Text("Bij uitlichten").tag(false)
                        Text("Altijd").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .sensoryFeedback(.selection, trigger: stopsAlways)
                } header: { Text("Tussenstops op de globe") } footer: {
                    Text("Bij uitlichten zie je de stops van de reis waar de globe naartoe draait; Altijd toont ze van elke reis.")
                }
                Section {
                    Toggle(isOn: Binding(get: { !ownPhotosOnly }, set: { ownPhotosOnly = !$0 })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Foto's van reisgenoten meetellen")
                            Text("Bij Reizigers telt een reis alle foto's van de dagen dat iemand mee was. Uit telt alleen wat jij zelf toevoegde.")
                                .font(.inter(13, 450)).foregroundStyle(Brand.inkSoft)
                        }
                    }
                    .sensoryFeedback(.selection, trigger: ownPhotosOnly)
                    .onChange(of: ownPhotosOnly) { Task { await store.load() } }
                } header: { Text("Foto's in je statistieken") }
                TrackingSettings()
            }
            .listRowBackground(Brand.raised)
        }
        .settingsPage("Voorkeuren")
        .animation(.calm, value: airports)
        .animation(.calm, value: found.map(\.iata))
        .task {
            await FlightAirports.shared.load()
            airportsIn = true
        }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { found = []; return }
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            found = await FlightAirports.shared.search(q, limit: 5)
        }
    }

    private func save() { Prefs.airports = airports }
    private func add(_ code: String) { Haptic.tap(); airports.append(code); query = ""; save() }
    private func remove(_ code: String) { airports.removeAll { $0 == code }; save() }
    private func makeFirst(_ code: String) { Haptic.select(); airports.removeAll { $0 == code }; airports.insert(code, at: 0); save() }
}

// MARK: Diensten

struct ServicesPage: View {
    let onSignIn: () -> Void
    @Environment(Store.self) private var store
    @State private var url = Api.shared.base
    @State private var serverError: String?
    @State private var confirmServer: String?
    @State private var immich: SettingsRemote.Immich?
    @State private var immichLoaded = false
    @State private var serverUrl = ""
    @State private var publicUrl = ""
    @State private var apiKey = ""
    @State private var note: (String, Bool)?
    @State private var busy = false
    @State private var confirmOff = false

    var body: some View {
        Form {
            Group {
                if !store.live {
                    SignInFirst(text: "Je bekijkt de voorbeelden. Log in om je server en Immich te beheren.", onSignIn: onSignIn)
                } else {
                    serverSection
                    immichSection
                }
            }
            .listRowBackground(Brand.raised)
        }
        .settingsPage("Diensten")
        .alert("Andere server gebruiken?", isPresented: Binding(get: { confirmServer != nil }, set: { if !$0 { confirmServer = nil } })) {
            Button("Annuleren", role: .cancel) {}
            Button("Wisselen", role: .destructive) { switchServer() }
        } message: {
            Text("De app praat daarna met \(confirmServer ?? ""). Je wordt uitgelogd en logt daar opnieuw in. Reizen op de oude server blijven daar.")
        }
        .alert("Immich loskoppelen?", isPresented: $confirmOff) {
            Button("Annuleren", role: .cancel) {}
            Button("Verbreken", role: .destructive) { disconnect() }
        } message: { Text("Nieuwe foto's komen dan niet meer binnen. Wat al in je reizen staat blijft staan.") }
        .task {
            guard store.live else { return }
            do {
                immich = try await SettingsRemote.immich()
                serverUrl = immich?.serverUrl ?? ""
                publicUrl = immich?.publicUrl ?? ""
            } catch {
                note = ("Kon de Immich-status niet laden", true)
            }
            immichLoaded = true
        }
        .onDisappear { apiKey = "" }
    }

    private var trimmed: String {
        var u = url.trimmingCharacters(in: .whitespacesAndNewlines)
        while u.hasSuffix("/") { u.removeLast() }
        return u
    }

    private var serverSection: some View {
        Section {
            TextField("https://jouw-server.nl", text: $url)
                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            if trimmed != Api.shared.base {
                HStack {
                    Button("Herstellen") { url = Api.shared.base; serverError = nil }.buttonStyle(.borderless)
                    Spacer()
                    Button("Server wijzigen") { checkServer() }.buttonStyle(.borderless).fontWeight(.semibold)
                }
                .transition(.opacity)
            }
        } header: { Text("Server") } footer: {
            if let serverError { Text(serverError).foregroundStyle(.red) }
            else { Text("De server waarmee deze app praat. Een andere kiezen logt je uit; daarna log je daar opnieuw in.") }
        }
        .animation(.calm, value: trimmed == Api.shared.base)
    }

    private func checkServer() {
        guard let u = URL(string: trimmed), let host = u.host(), !host.isEmpty else {
            serverError = "Dat is geen geldig adres. Begin met https:// en vul een domein in."
            return
        }
        guard u.scheme == "https" || host == "localhost" else {
            serverError = "Gebruik https, anders reist je wachtwoord onversleuteld mee."
            return
        }
        serverError = nil
        confirmServer = "\(u.scheme ?? "https")://\(host)\(u.port.map { ":\($0)" } ?? "")"
    }

    private func switchServer() {
        // Never in test mode: signing out there cannot be undone from the test.
        if Api.dryRun {
            Api.log.notice("MmsDryRun server change [blocked]")
            return
        }
        UserDefaults.standard.set(trimmed, forKey: "server")
        onSignIn()
    }

    private var immichSection: some View {
        Section {
            if !immichLoaded {
                HStack { Text("Immich"); Spacer(); ProgressView().controlSize(.small) }
            } else {
                if let immich {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        Text("Verbonden").font(.inter(15, 600))
                        Spacer()
                        Text(immich.keyPreview).font(.system(size: 13, design: .monospaced)).foregroundStyle(Brand.inkSoft)
                    }
                    if let err = immich.lastError { Text(err).font(.inter(13.5, 450)).foregroundStyle(.red) }
                }
                TextField("Adres van je Immich, bv. http://immich:2283", text: $serverUrl)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Publiek adres (optioneel)", text: $publicUrl)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField(immich != nil ? "Nieuwe key om te vervangen" : "Immich API-key", text: $apiKey)
                HStack {
                    if immich != nil {
                        Button("Verbreken", role: .destructive) { confirmOff = true }.buttonStyle(.borderless).disabled(busy)
                    }
                    Spacer()
                    Button(immich != nil ? "Bijwerken" : "Verbinden") { connect() }
                        .buttonStyle(.borderless).fontWeight(.semibold)
                        .disabled(busy || serverUrl.trimmingCharacters(in: .whitespaces).isEmpty || (immich == nil && apiKey.isEmpty))
                    if busy { ProgressView().controlSize(.small) }
                }
            }
        } header: { Text("Immich") } footer: {
            if let note { Text(note.0).foregroundStyle(note.1 ? .red : Brand.inkSoft) }
            else { Text("Maak een API-key in **Immich › Accountinstellingen › API-keys**. Hij wordt versleuteld opgeslagen. Het publieke adres opent je foto's vanuit de fotoviewer.") }
        }
    }

    private func connect() {
        busy = true
        note = nil
        Task {
            do {
                let key = apiKey.isEmpty ? "" : apiKey
                let result = try await SettingsRemote.connectImmich(serverUrl: serverUrl, apiKey: key, publicUrl: publicUrl)
                immich = result ?? immich
                apiKey = ""
                note = ("Opgeslagen.", false)
                Haptic.tap()
            } catch {
                note = ((error as? Api.Failure)?.message ?? "Opslaan mislukt", true)
            }
            busy = false
        }
    }

    private func disconnect() {
        busy = true
        Task {
            do {
                try await SettingsRemote.disconnectImmich()
                immich = nil; serverUrl = ""; publicUrl = ""
                note = ("Verbinding verwijderd.", false)
            } catch {
                note = ((error as? Api.Failure)?.message ?? "Mislukt", true)
            }
            busy = false
        }
    }
}

// MARK: Gegevens

/// Bytes to hand to the system's save dialog.
struct DataFile: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

struct DataPage: View {
    let onSignIn: () -> Void
    @Environment(Store.self) private var store
    @State private var busy: String?
    @State private var progress: (Double, String)?
    @State private var backupNote: (String, Bool)?
    @State private var exportFile: DataFile?
    @State private var exportName = ""
    @State private var exportType: UTType = .json
    @State private var showExport = false
    @State private var importKind: ImportKind?
    @State private var pendingRestore: [String: Any]?
    @State private var askRestore = false
    @State private var polarNote: (String, Bool)?
    @State private var trackTrip: String?
    @State private var trackNote: (String, Bool)?
    @State private var askFormat = false
    @State private var cacheCleared = false

    enum ImportKind { case backup, polarsteps, track }

    private var trips: [Trip] { store.trips.filter { $0.remoteId != nil } }

    var body: some View {
        Form {
            Group {
                if !store.live {
                    SignInFirst(text: "Je bekijkt de voorbeelden. Log in om een back-up te maken, iets te importeren of route-bestanden te bewaren.", onSignIn: onSignIn)
                } else {
                    backupSection
                    polarstepsSection
                    trackSection
                }
                cacheSection
            }
            .listRowBackground(Brand.raised)
        }
        .settingsPage("Gegevens")
        .fileExporter(isPresented: $showExport, document: exportFile, contentType: exportType, defaultFilename: exportName) { result in
            if case .success = result { trackNote = trackNote ?? nil }
            exportFile = nil
        }
        .fileImporter(isPresented: Binding(get: { importKind != nil }, set: { if !$0 { importKind = nil } }), allowedContentTypes: allowed) { result in
            let kind = importKind
            importKind = nil
            guard case let .success(url) = result, let kind else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            handle(kind, data: data, name: url.lastPathComponent)
        }
        .alert("Back-up terugzetten?", isPresented: $askRestore) {
            Button("Annuleren", role: .cancel) { pendingRestore = nil }
            Button("Terugzetten") { restore() }
        } message: {
            let n = (pendingRestore?["trips"] as? [Any])?.count ?? 0
            Text("Deze back-up bevat \(n) \(n == 1 ? "reis" : "reizen"). Reizen die je al hebt blijven zoals ze zijn; de rest wordt toegevoegd.")
        }
        .confirmationDialog("Route exporteren als", isPresented: $askFormat, titleVisibility: .visible) {
            Button("GPX") { export("gpx") }
            Button("KML") { export("kml") }
        }
        .onAppear { if trackTrip == nil { trackTrip = trips.first?.remoteId } }
    }

    private var allowed: [UTType] {
        switch importKind {
        case .backup: [.json, .plainText, .data]
        case .polarsteps: [.zip, .data]
        case .track, nil: [UTType(filenameExtension: "gpx"), UTType(filenameExtension: "kml"), .xml, .data].compactMap { $0 }
        }
    }

    private var backupSection: some View {
        Section {
            if let progress, busy == "backup" || busy == "restore" {
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView(value: progress.0).tint(Brand.accent)
                    Text(progress.1.isEmpty ? "Verzamelen" : progress.1).font(.inter(13, 500)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                }
            }
            Button { makeBackup() } label: { Label("Back-up maken", systemImage: "arrow.down.doc") }.disabled(busy != nil)
            Button { importKind = .backup } label: { Label("Terugzetten", systemImage: "arrow.up.doc") }.disabled(busy != nil)
        } header: { Text("Back-up") } footer: {
            if let backupNote { Text(backupNote.0).foregroundStyle(backupNote.1 ? .red : Brand.inkSoft) }
            else { Text("Al je reizen, stops, routepunten en notities in één bestand, plus je instellingen. Foto's staan erin als verwijzing. Terugzetten voegt toe wat je nog niet hebt en laat bestaande reizen met rust.") }
        }
    }

    private var polarstepsSection: some View {
        Section {
            Button { importKind = .polarsteps } label: {
                HStack {
                    Label("Polarsteps-zip kiezen", systemImage: "square.and.arrow.down")
                    if busy == "polar" { Spacer(); ProgressView().controlSize(.small) }
                }
            }
            .disabled(busy != nil)
        } header: { Text("Polarsteps importeren") } footer: {
            if let polarNote { Text(polarNote.0).foregroundStyle(polarNote.1 ? .red : Brand.inkSoft) }
            else { Text("Vraag je export op via **polarsteps.com › Settings › Privacy › Download my data** en kies de zip hier. Elke reis erin wordt aangemaakt met de volledige GPS-route.") }
        }
    }

    private var trackSection: some View {
        Section {
            Picker("Reis", selection: $trackTrip) {
                ForEach(trips) { t in Text(t.title).tag(t.remoteId) }
            }
            Button { askFormat = true } label: {
                HStack {
                    Label("Exporteren", systemImage: "square.and.arrow.up")
                    if busy == "export" { Spacer(); ProgressView().controlSize(.small) }
                }
            }
            .disabled(trackTrip == nil || busy != nil)
            Button { importKind = .track } label: {
                HStack {
                    Label("GPX of KML importeren", systemImage: "plus")
                    if busy == "track" { Spacer(); ProgressView().controlSize(.small) }
                }
            }
            .disabled(trackTrip == nil || busy != nil)
        } header: { Text("Route-bestanden") } footer: {
            if let trackNote { Text(trackNote.0).foregroundStyle(trackNote.1 ? .red : Brand.inkSoft) }
            else { Text("Bewaar de route van een reis als GPX of KML, of voeg een track uit een ander apparaat toe aan een reis.") }
        }
    }

    private var cacheSection: some View {
        Section {
            Button(role: .destructive) {
                ImageLoader.shared.clear()
                cacheCleared = true
                Haptic.tap()
            } label: {
                Label(cacheCleared ? "Geleegd" : "Foto-cache legen", systemImage: cacheCleared ? "checkmark" : "trash")
                    .contentTransition(.symbolEffect(.replace))
            }
            .disabled(cacheCleared)
        } header: { Text("Foto-cache") } footer: {
            Text("Foto's worden bewaard zolang de app open is en opnieuw opgehaald als je ze bekijkt. Er gaat niets van je reizen verloren.")
        }
    }

    // MARK: Work

    private func makeBackup() {
        busy = "backup"
        backupNote = nil
        progress = (0.02, "")
        Task {
            do {
                let raw = try await SettingsRemote.tripsRaw()
                var out: [[String: Any]] = []
                for (i, t) in raw.enumerated() {
                    progress = (Double(i) / Double(max(1, raw.count)), t["title"] as? String ?? "")
                    guard let id = t["id"] as? String else { continue }
                    var parts = await SettingsRemote.tripParts(id)
                    parts["trip"] = t
                    out.append(parts)
                }
                let iso = ISO8601DateFormatter().string(from: Date())
                let file: [String: Any] = ["version": 1, "createdAt": iso, "app": "MarkMySteps", "trips": out, "settings": settingsSnapshot()]
                let data = try JSONSerialization.data(withJSONObject: file, options: [.prettyPrinted, .sortedKeys])
                exportFile = DataFile(data: data)
                exportType = .json
                exportName = "markmysteps-backup-\(PlannerRemote.isoDay(Date())).json"
                showExport = true
                backupNote = ("Back-up klaar · \(ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file))", false)
            } catch {
                backupNote = ((error as? Api.Failure)?.message ?? "Back-up mislukt", true)
            }
            busy = nil
            progress = nil
        }
    }

    /// The settings a backup carries, under the web's keys, so a file from any of the apps reads in the others.
    private func settingsSnapshot() -> [String: Any] {
        let d = UserDefaults.standard
        let airports = (try? JSONSerialization.data(withJSONObject: Prefs.airports)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return [
            "mms.theme": d.string(forKey: "theme") ?? "system",
            "mms.mapstyle": d.string(forKey: "mapStyle") ?? "positron",
            "mms.airports": airports,
            "mms.cardsize": CardSizes.shared.standard,
        ]
    }

    private func handle(_ kind: ImportKind, data: Data, name: String) {
        switch kind {
        case .backup:
            guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { backupNote = ("Dit is geen leesbaar back-upbestand.", true); return }
            guard o["app"] as? String == "MarkMySteps", o["trips"] is [Any] else { backupNote = ("Dit bestand komt niet van MarkMySteps.", true); return }
            guard ((o["version"] as? NSNumber)?.intValue ?? 1) <= 1 else { backupNote = ("Deze back-up komt van een nieuwere versie van de app.", true); return }
            pendingRestore = o
            askRestore = true
        case .polarsteps:
            busy = "polar"
            polarNote = nil
            Task {
                do {
                    let result = try await SettingsRemote.importPolarsteps(data)
                    polarNote = (result.isEmpty ? "Geïmporteerd." : "\(result.count) \(result.count == 1 ? "reis" : "reizen") geïmporteerd: " + result.map(\.title).joined(separator: ", "), false)
                    await store.load()
                } catch {
                    polarNote = ((error as? Api.Failure)?.message ?? "Import mislukt", true)
                }
                busy = nil
            }
        case .track:
            guard let id = trackTrip else { return }
            busy = "track"
            trackNote = nil
            Task {
                do {
                    let r = try await SettingsRemote.importTrack(tripId: id, filename: name, data: data)
                    var parts = ["\(r.added) van \(r.found) punten toegevoegd"]
                    if r.outside > 0 { parts.append("\(r.outside) buiten de reis") }
                    if r.undated > 0 { parts.append("\(r.undated) zonder tijd") }
                    trackNote = (parts.joined(separator: " · ") + ".", false)
                    await store.load()
                } catch {
                    trackNote = ((error as? Api.Failure)?.message ?? "Importeren mislukt", true)
                }
                busy = nil
            }
        }
    }

    private func export(_ format: String) {
        guard let id = trackTrip else { return }
        busy = "export"
        trackNote = nil
        Task {
            do {
                let file = try await SettingsRemote.exportTrack(tripId: id, format: format)
                let data = try Data(contentsOf: file)
                let title = trips.first { $0.remoteId == id }?.title ?? "route"
                exportFile = DataFile(data: data)
                exportType = UTType(filenameExtension: format) ?? .xml
                exportName = "\(title).\(format)"
                showExport = true
            } catch {
                trackNote = ("Exporteren lukte niet", true)
            }
            busy = nil
        }
    }

    /// Puts a backup back trip by trip, as the web's restoreBackup: a trip that is already here is left alone.
    private func restore() {
        guard let backup = pendingRestore, let entries = backup["trips"] as? [[String: Any]] else { return }
        pendingRestore = nil
        busy = "restore"
        backupNote = nil
        progress = (0.02, "")
        Task {
            let known = Set(((try? await SettingsRemote.tripsRaw()) ?? []).compactMap { $0["id"] as? String })
            var added = 0, skipped = 0, points = 0
            func value(_ o: [String: Any], _ k: String) -> Any? { o[k] is NSNull ? nil : o[k] }
            for (i, e) in entries.enumerated() {
                guard let trip = e["trip"] as? [String: Any], let id = trip["id"] as? String else { continue }
                progress = (Double(i) / Double(max(1, entries.count)), trip["title"] as? String ?? "")
                if known.contains(id) { skipped += 1; continue }
                do {
                    var body: [String: Any] = ["id": id, "title": trip["title"] as? String ?? "Reis", "startDate": trip["startDate"] as? String ?? "", "endDate": trip["endDate"] as? String ?? ""]
                    if let d = value(trip, "description") { body["description"] = d }
                    try await Api.shared.send("POST", "/api/trips", body: body)
                } catch { continue }
                _ = try? await Api.shared.send("PATCH", "/api/trips/\(id)", body: [
                    "color": value(trip, "color") ?? NSNull(), "markerLng": value(trip, "markerLng") ?? NSNull(),
                    "markerLat": value(trip, "markerLat") ?? NSNull(), "autoTrack": trip["autoTrack"] as? Bool ?? false,
                ])
                added += 1
                let all = e["stops"] as? [[String: Any]] ?? []
                let route = all.filter { value($0, "parentStopId") == nil }
                let dayTrips = all.filter { value($0, "parentStopId") != nil }
                for s in route + dayTrips {
                    var body: [String: Any] = ["id": s["id"] as? String ?? UUID().uuidString.lowercased(), "name": s["name"] as? String ?? "", "nights": s["nights"] as? Int ?? 0,
                                               "travelMode": s["travelMode"] as? String ?? "GROUND"]
                    for k in ["latitude", "longitude", "countryCode", "flightNumber", "fromAirport", "toAirport", "notes", "parentStopId"] { if let v = value(s, k) { body[k] = v } }
                    if let via = s["viaAirports"] as? [String], !via.isEmpty { body["viaAirports"] = via }
                    if value(s, "parentStopId") != nil { body["dayTripDate"] = String((s["arrivalDate"] as? String ?? "").prefix(10)) }
                    _ = try? await Api.shared.send("POST", "/api/trips/\(id)/stops", body: body)
                }
                if route.count > 1 { _ = try? await Api.shared.send("PUT", "/api/trips/\(id)/stops/order", body: ["stopIds": route.compactMap { $0["id"] as? String }]) }
                let pts = e["points"] as? [[String: Any]] ?? []
                var k = 0
                while k < pts.count {
                    let batch = pts[k..<min(k + 400, pts.count)].map { p -> [String: Any] in
                        ["clientId": p["id"] as? String ?? UUID().uuidString.lowercased(), "recordedAt": p["recordedAt"] as? String ?? "",
                         "latitude": p["latitude"] ?? 0, "longitude": p["longitude"] ?? 0]
                    }
                    _ = try? await Api.shared.send("POST", "/api/trips/\(id)/points/batch", body: ["points": batch])
                    points += batch.count
                    k += 400
                }
                for n in e["notes"] as? [[String: Any]] ?? [] {
                    _ = try? await Api.shared.send("PUT", "/api/trips/\(id)/notes", body: ["day": n["day"] as? String ?? "", "body": n["body"] as? String ?? ""])
                }
            }
            if let s = backup["settings"] as? [String: Any] {
                if let t = s["mms.theme"] as? String, ["light", "dark", "system"].contains(t) { UserDefaults.standard.set(t, forKey: "theme") }
                if let m = s["mms.mapstyle"] as? String, MapLook(rawValue: m) != nil { UserDefaults.standard.set(m, forKey: "mapStyle") }
                if let a = s["mms.airports"] as? String, let data = a.data(using: .utf8), let codes = try? JSONSerialization.jsonObject(with: data) as? [String] { Prefs.airports = codes }
            }
            backupNote = ([
                "\(added) \(added == 1 ? "reis" : "reizen") teruggezet",
                skipped > 0 ? "\(skipped) overgeslagen" : nil,
                points > 0 ? "\(points) \(points == 1 ? "routepunt" : "routepunten")" : nil,
            ].compactMap { $0 }.joined(separator: " · ") + ".", false)
            busy = nil
            progress = nil
            await store.load()
        }
    }
}

// MARK: Accounts (admin)

struct AdminAccountsPage: View {
    @State private var users: [SettingsRemote.AdminUser]?
    @State private var query = ""
    @State private var note: (String, Bool)?
    @State private var busy = false
    @State private var ask: (Ask, SettingsRemote.AdminUser)?
    @State private var temp = ""
    @State private var newEmail = ""
    @State private var newName = ""
    @State private var newUsername = ""
    @State private var newTemp = ""

    enum Ask { case reject, reset, twoFactor, delete }

    var body: some View {
        let pending = (users ?? []).filter { $0.status == "PENDING" }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = (users ?? []).filter { $0.status != "PENDING" && (q.isEmpty || "\($0.displayName) \($0.username) \($0.email)".lowercased().contains(q)) }
        Form {
            Group {
                if !pending.isEmpty {
                    Section("Aanvragen") {
                        ForEach(pending) { u in
                            VStack(alignment: .leading, spacing: 8) {
                                userLine(u)
                                HStack {
                                    Button("Afwijzen") { ask = (.reject, u) }.buttonStyle(.bordered).buttonBorderShape(.capsule)
                                    Spacer()
                                    Button("Toelaten", systemImage: "checkmark") { act("\(u.displayName) is toegelaten.") { try await SettingsRemote.decide(u.id, approve: true) } }
                                        .buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
                                }
                                .disabled(busy)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                Section {
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundStyle(Brand.inkSoft)
                        TextField("Naam, gebruikersnaam of e-mail", text: $query).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    if users == nil {
                        HStack { Spacer(); CompassSpinner(size: 28); Spacer() }.padding(.vertical, 8)
                    }
                    ForEach(shown) { u in
                        HStack {
                            userLine(u)
                            Spacer(minLength: 6)
                            Menu {
                                Button("Wachtwoord resetten", systemImage: "lock") { temp = SettingsRemote.tempPassword(); ask = (.reset, u) }
                                if u.twoFactor { Button("2FA resetten", systemImage: "shield.slash") { ask = (.twoFactor, u) } }
                                Button(u.admin ? "Geen admin meer" : "Maak admin", systemImage: "person.badge.key") {
                                    act(u.admin ? "@\(u.username) is geen admin meer." : "@\(u.username) is nu admin.") { try await SettingsRemote.setRole(u.id, admin: !u.admin) }
                                }
                                Divider()
                                Button("Account verwijderen", systemImage: "trash", role: .destructive) { ask = (.delete, u) }
                            } label: {
                                Image(systemName: "ellipsis").font(.system(size: 16, weight: .semibold)).foregroundStyle(Brand.ink).frame(width: 36, height: 36)
                            }
                            .disabled(busy)
                        }
                    }
                } header: { Text("Accounts") } footer: { if let note { Text(note.0).foregroundStyle(note.1 ? .red : Brand.inkSoft) } }
                Section {
                    TextField("E-mail", text: $newEmail).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("Naam", text: $newName).textInputAutocapitalization(.words)
                    HStack(spacing: 2) {
                        Text("@").foregroundStyle(Brand.inkSoft)
                        TextField("gebruikersnaam", text: Binding(get: { newUsername }, set: { newUsername = String($0.filter { !$0.isWhitespace }.prefix(30)) }))
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    HStack {
                        TextField("Tijdelijk wachtwoord", text: $newTemp).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .font(.system(size: 16, design: .monospaced))
                        Button("Genereer") { newTemp = SettingsRemote.tempPassword() }.buttonStyle(.bordered).buttonBorderShape(.capsule)
                    }
                    Button("Aanmaken") { create() }
                        .disabled(busy || newEmail.isEmpty || newName.isEmpty || newUsername.count < 3 || newTemp.count < 10)
                } header: { Text("Account aanmaken") } footer: {
                    Text(newTemp.isEmpty || newTemp.count >= 10 ? "Diegene kiest bij de eerste keer inloggen zelf een nieuw wachtwoord." : "Minstens 10 tekens")
                }
            }
            .listRowBackground(Brand.raised)
        }
        .settingsPage("Accounts")
        .refreshable { await load() }
        .task { await load() }
        .alert(askTitle, isPresented: Binding(get: { ask != nil }, set: { if !$0 { ask = nil } })) {
            if ask?.0 == .reset { TextField("Tijdelijk wachtwoord", text: $temp) }
            Button("Annuleren", role: .cancel) {}
            Button(askButton, role: ask?.0 == .reset ? nil : .destructive) { confirm() }
        } message: { Text(askMessage) }
    }

    private func userLine(_ u: SettingsRemote.AdminUser) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(u.displayName).font(.inter(16, 600)).foregroundStyle(Brand.ink).lineLimit(1)
                if u.admin { tag("admin", Brand.accent) }
                if u.tempPassword { tag("tijdelijk wachtwoord", .orange) }
                if u.status == "REJECTED" { tag("afgewezen", .red) }
            }
            Text("@\(u.username) · \(u.email)").font(.inter(13, 450)).foregroundStyle(Brand.inkSoft).lineLimit(1)
            if u.status != "PENDING" { Text("\(u.trips) \(u.trips == 1 ? "reis" : "reizen")\(u.twoFactor ? " · 2FA aan" : "")").font(.inter(12.5, 450)).foregroundStyle(Brand.inkSoft) }
        }
    }

    private func tag(_ text: String, _ tint: Color) -> some View {
        Text(text).font(.inter(11, 650)).foregroundStyle(tint).padding(.horizontal, 6).padding(.vertical, 1).background(tint.opacity(0.12), in: .capsule)
    }

    private var askTitle: String {
        guard let (a, u) = ask else { return "" }
        switch a {
        case .reject: return "Aanvraag van \(u.displayName) afwijzen?"
        case .reset: return "Nieuw tijdelijk wachtwoord"
        case .twoFactor: return "2FA resetten?"
        case .delete: return "Account verwijderen?"
        }
    }

    private var askMessage: String {
        guard let (a, u) = ask else { return "" }
        switch a {
        case .reject: return "Diegene kan niet inloggen. Het account blijft bestaan, zodat dezelfde naam en e-mail niet meteen opnieuw gebruikt worden."
        case .reset: return "@\(u.username) wordt overal uitgelogd en kiest bij de volgende keer inloggen zelf een nieuw wachtwoord. Minstens 10 tekens."
        case .twoFactor: return "@\(u.username) kan daarna weer inloggen met alleen een wachtwoord en wordt overal uitgelogd. Doe dit alleen als diegene telefoon en herstelcodes kwijt is."
        case .delete: return "Account @\(u.username) wordt verwijderd, samen met hun eigen reizen en routes."
        }
    }

    private var askButton: String {
        switch ask?.0 {
        case .reject: "Afwijzen"
        case .reset: "Resetten"
        case .twoFactor: "Resetten"
        case .delete: "Verwijderen"
        case nil: "OK"
        }
    }

    private func confirm() {
        guard let (a, u) = ask else { return }
        switch a {
        case .reject: act("Aanvraag van \(u.displayName) afgewezen.") { try await SettingsRemote.decide(u.id, approve: false) }
        case .reset:
            let t = temp
            guard t.count >= 10 else { note = ("Een tijdelijk wachtwoord heeft minstens 10 tekens.", true); return }
            act("Nieuw tijdelijk wachtwoord voor @\(u.username): \(t)") { try await SettingsRemote.resetPassword(u.id, temp: t) }
        case .twoFactor: act("2FA van @\(u.username) is gereset.") { try await SettingsRemote.resetTwoFactor(u.id) }
        case .delete: act("Account @\(u.username) is verwijderd.") { try await SettingsRemote.deleteUser(u.id) }
        }
    }

    private func create() {
        let (e, n, u, t) = (newEmail, newName, newUsername, newTemp)
        act("Account @\(u) aangemaakt. Tijdelijk wachtwoord: \(t)") {
            try await SettingsRemote.createUser(email: e, username: u, displayName: n, tempPassword: t)
            newEmail = ""; newName = ""; newUsername = ""; newTemp = ""
        }
    }

    private func act(_ done: String, _ work: @escaping () async throws -> Void) {
        busy = true
        note = nil
        Task {
            do { try await work(); note = (done, false); Haptic.tap(); await load() } catch { note = ((error as? Api.Failure)?.message ?? "Mislukt", true) }
            busy = false
        }
    }

    private func load() async {
        if let list = try? await SettingsRemote.adminUsers() { withAnimation(.calm) { users = list } } else if users == nil { users = [] }
    }
}
