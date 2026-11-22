import MapKit
import SwiftUI

/*
 * Reisinstellingen as a page of its own, as the web and Android have it: the cover, name and dates (saved by
 * themselves shortly after you stop), the colour, the figures on the cover, fetching the photos, the dot on the
 * globe, tracking, people, and everything that throws something away together at the bottom, from quiet red
 * wipes to one filled red button, each asking first.
 */

/// A trip's own settings as the server keeps them.
struct TripInfo: Equatable {
    var title: String
    var start: Date?
    var end: Date?
    var autoTrack: Bool
    var color: String?
    var ownerId: String?
    var marker: LonLat?
    var coverId: String?
}

enum TripSettingsRemote {
    static func info(_ id: String) async throws -> TripInfo {
        let o = try JSONSerialization.jsonObject(with: await Api.shared.get("/api/trips/\(id)")) as? [String: Any] ?? [:]
        let marker: LonLat? = {
            guard let lng = (o["markerLng"] as? NSNumber)?.doubleValue, let lat = (o["markerLat"] as? NSNumber)?.doubleValue else { return nil }
            return LonLat(lng, lat)
        }()
        return TripInfo(
            title: o["title"] as? String ?? "", start: Remote.day(o["startDate"]), end: Remote.day(o["endDate"]),
            autoTrack: o["autoTrack"] as? Bool ?? false, color: (o["color"] as? String).flatMap { $0.isEmpty ? nil : $0 },
            ownerId: o["ownerId"] as? String, marker: marker, coverId: (o["resolvedCoverId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        )
    }

    static func save(_ id: String, title: String, start: Date, end: Date, autoTrack: Bool) async throws {
        try await Api.shared.send("PATCH", "/api/trips/\(id)", body: [
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines), "startDate": PlannerRemote.isoDay(start),
            "endDate": PlannerRemote.isoDay(end), "autoTrack": autoTrack,
        ])
    }

    static func setMarker(_ id: String, _ p: LonLat?) async throws {
        try await Api.shared.send("PATCH", "/api/trips/\(id)", body: ["markerLng": p?.lon ?? NSNull(), "markerLat": p?.lat ?? NSNull()])
    }

    static func sync(_ id: String) async throws -> (users: Int, found: Int, added: Int) {
        let o = try JSONSerialization.jsonObject(with: await Api.shared.send("POST", "/api/trips/\(id)/sync")) as? [String: Any] ?? [:]
        func n(_ k: String) -> Int { (o[k] as? NSNumber)?.intValue ?? 0 }
        return (n("usersSynced"), n("assetsFound"), n("assetsAdded"))
    }

    /// Your own tracked points, all or of one day; answers how many went.
    static func wipeTracked(_ id: String, day: Date?) async throws -> Int {
        let path = "/api/trips/\(id)/tracked" + (day.map { "?day=\(PlannerRemote.isoDay($0))" } ?? "")
        let o = try JSONSerialization.jsonObject(with: await Api.shared.send("DELETE", path)) as? [String: Any]
        return (o?["deleted"] as? NSNumber)?.intValue ?? 0
    }

    static func wipeRouteFills(_ id: String) async throws -> Int {
        let o = try JSONSerialization.jsonObject(with: await Api.shared.send("DELETE", "/api/trips/\(id)/route-fill")) as? [String: Any]
        return (o?["deleted"] as? NSNumber)?.intValue ?? 0
    }
}

struct TripSettingsPage: View {
    let trip: Trip
    var onPeople: () -> Void = {}
    /// The trip is gone (deleted or left): back home.
    var onGone: () -> Void = {}
    @Environment(Store.self) private var store
    @State private var info: TripInfo?
    @State private var title: String
    @State private var start: Date?
    @State private var end: Date?
    @State private var autoTrack: Bool
    @State private var color: String?
    @State private var marker: LonLat?
    @State private var placing = false
    @State private var saving = false
    @State private var saved = false
    @State private var error: String?
    @State private var pickDates = false
    @State private var pickCover = false
    @State private var syncing = false
    @State private var syncNote: String?
    @State private var facts: [String]?
    @State private var explainTracking = false
    @State private var confirmStopTracking = false

    static let colours = ["#E8613C", "#E0993A", "#4CA05C", "#2A8F85", "#409EC5", "#5A6EE1", "#B054A8", "#DF5C78"]

    init(trip: Trip, onPeople: @escaping () -> Void = {}, onGone: @escaping () -> Void = {}) {
        self.trip = trip
        self.onPeople = onPeople
        self.onGone = onGone
        let end = (trip.start ?? trip.firstDay).flatMap { Format.calendar.date(byAdding: .day, value: max(0, trip.days - 1), to: $0) }
        _title = State(initialValue: trip.title)
        _start = State(initialValue: trip.start ?? trip.firstDay)
        _end = State(initialValue: end)
        _autoTrack = State(initialValue: trip.autoTrack)
        _color = State(initialValue: trip.colorHex)
        _marker = State(initialValue: trip.marker)
        _facts = State(initialValue: Prefs.facts(trip.id))
    }

    private var live: Bool { trip.remoteId != nil }
    private var me: String? { store.me?.id }
    private var isOwner: Bool { live ? (trip.ownerId != nil && trip.ownerId == me) : true }
    private var canEdit: Bool { isOwner || (trip.members.first { $0.userId == me }?.role).map { $0 != "GUEST" } == true }
    private var ended: Bool {
        guard let end else { return false }
        return end < Format.calendar.startOfDay(for: Date())
    }
    private var accent: Color { color.flatMap { UInt32($0.dropFirst(), radix: 16) }.map { Color(hex: $0) } ?? trip.color }
    private var dirty: Bool {
        guard let info else { return false }
        return title != info.title || start != info.start || end != info.end || autoTrack != info.autoTrack
    }

    var body: some View {
        Form {
            Group { content }
                // Rows in the raised tone, so they stand off the paper in light and dark.
                .listRowBackground(Brand.raised)
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Brand.paper)
        .navigationTitle("Reisinstellingen")
        .navigationBarTitleDisplayMode(.inline)
        .modifier(PageChrome(page: self))
    }

    @ViewBuilder private var content: some View {
            Section {
                header.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            if isOwner {
                Section("Reis") {
                    TextField("Naam", text: Binding(get: { title }, set: { title = String($0.prefix(120)) }))
                        .font(.inter(17))
                        .textInputAutocapitalization(.sentences)
                    Button { pickDates = true } label: {
                        HStack {
                            Label("Datums", systemImage: "calendar").foregroundStyle(Brand.ink)
                            Spacer()
                            Text(rangeText).foregroundStyle(Brand.inkSoft)
                        }
                    }
                    if let error { Text(error).font(.inter(14, 500)).foregroundStyle(.red) }
                }
                Section {
                    colourPicker
                } header: { Text("Kleur op de globe en de kaart") } footer: { Text("Auto kiest een kleur die past bij je andere reizen.") }
                Section {
                    FlowLayout(spacing: 8) {
                        factChip("Automatisch", on: facts == nil, enabled: true) { setFacts(nil) }
                        ForEach(Prefs.factIds, id: \.self) { f in
                            let on = facts?.contains(f) == true
                            let full = !on && (facts?.count ?? 0) >= Prefs.factsMax
                            factChip(Prefs.factNames[f] ?? f, on: on, enabled: !full) {
                                let now = facts ?? []
                                setFacts(on ? now.filter { $0 != f } : now + [f])
                            }
                        }
                    }
                    .padding(.vertical, 6)
                } header: { Text("Feitjes op de cover") } footer: { Text("Er is plek voor vier. Kies je niets, dan neemt de app de eerste vier die deze reis heeft.") }
            } else {
                Section {
                    Text(canEdit ? "Alleen de organisator kan de naam, datums en kleur wijzigen." : "Je bent gast op deze reis: je kunt hem bekijken, niet aanpassen.")
                        .font(.inter(15, 450)).foregroundStyle(Brand.inkSoft)
                }
            }

            if canEdit {
                Section {
                    Button { sync() } label: {
                        HStack {
                            Label("Foto's syncen", systemImage: "arrow.triangle.2.circlepath")
                            Spacer()
                            if syncing { ProgressView().controlSize(.small) }
                        }
                    }
                    .disabled(syncing || !live)
                } header: { Text("Foto's") } footer: {
                    Text(syncNote ?? "Kijkt in Immich welke foto's op de dagen van deze reis genomen zijn en zet ze in de tijdlijn; met een locatie ook op de kaart.")
                        .contentTransition(.opacity)
                }
            }

            if isOwner { markerSection }

            Section {
                Toggle(isOn: $autoTrack.animation(.calm)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Automatisch tracken")
                        Text(ended ? "Deze reis is afgelopen" : "Start route-tracking vanzelf zodra de reis begint, in de app op je telefoon")
                            .font(.inter(13, 450)).foregroundStyle(Brand.inkSoft)
                    }
                }
                .disabled(!isOwner || ended || (live && info == nil))
                .sensoryFeedback(.selection, trigger: autoTrack)
                trackNowRow
            } header: { Text("Tracking") }

            Section("Mensen") {
                Button(action: onPeople) {
                    HStack {
                        Label("Reisgenoten en delen", systemImage: "person.2").foregroundStyle(Brand.ink).lineLimit(1).layoutPriority(1)
                        Spacer()
                        Text("\(trip.members.filter { $0.role != "GUEST" }.count) reizigers · \(trip.members.filter { $0.role == "GUEST" }.count) gasten")
                            .font(.inter(14, 450)).foregroundStyle(Brand.inkSoft)
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Brand.inkSoft.opacity(0.6))
                    }
                }
            }

            DangerSection(trip: trip, isOwner: isOwner, canEdit: canEdit, live: live, onGone: onGone)
    }

    fileprivate func chrome(_ base: some View) -> some View {
        base
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                // Whether the last change is saved: an hourglass while it goes, a tick once it is there.
                Group {
                    if saving { Image(systemName: "hourglass").transition(.scale.combined(with: .opacity)) }
                    else if saved { Image(systemName: "checkmark").transition(.scale.combined(with: .opacity)) }
                }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Brand.accent)
                .animation(.calm, value: [saving, saved])
            }
        }
        .tint(accent)
        .animation(.easeInOut(duration: 0.5), value: color)
        .sheet(isPresented: $pickDates) { DatesSheet(start: $start, end: $end) }
        .alert("Locatie voor je route", isPresented: $explainTracking) {
            Button("Niet nu", role: .cancel) {}
            Button("Verder") { startTracking() }
        } message: {
            Text("Om je route bij te houden heeft de app je locatie nodig, ook als het scherm uit is. iOS vraagt je zo om toestemming: kies eerst Tijdens gebruik en daarna Altijd. Je locatie gaat alleen naar je eigen server.")
        }
        .alert("Stoppen met tracken?", isPresented: $confirmStopTracking) {
            Button("Annuleren", role: .cancel) {}
            Button("Stoppen", role: .destructive) { Tracker.shared.stop() }
        } message: { Text("De route van \(title) wordt niet verder bijgehouden. Wat al opgenomen is blijft staan.") }
        .sheet(isPresented: $pickCover) { CoverPicker(trip: trip, current: info?.coverId ?? trip.coverId) { reload() } }
        .task {
            guard let rid = trip.remoteId, let fresh = try? await TripSettingsRemote.info(rid) else { return }
            info = fresh
            title = fresh.title
            start = fresh.start ?? start
            end = fresh.end ?? end
            autoTrack = fresh.autoTrack
            color = fresh.color
            marker = fresh.marker
        }
        .task(id: "\(title)|\(String(describing: start))|\(String(describing: end))|\(autoTrack)") {
            // Saves by itself 700 ms after the last change, as on the web.
            guard dirty, isOwner, !title.trimmingCharacters(in: .whitespaces).isEmpty else { return }
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            await save()
        }
        .onDisappear {
            // Leaving the page sends what is left.
            if dirty && isOwner { Task { await save() } }
        }
    }

    private struct PageChrome: ViewModifier {
        let page: TripSettingsPage
        func body(content: Content) -> some View { page.chrome(content) }
    }

    /// Start or stop following your route for this trip right now, or why that cannot be.
    @ViewBuilder private var trackNowRow: some View {
        let mine = trip.members.first { $0.userId == me }
        let tracker = Tracker.shared
        if tracker.active && tracker.tripId == trip.remoteId {
            Button(role: .destructive) { confirmStopTracking = true } label: { Label("Stop met bijhouden", systemImage: "location.slash") }
        } else if ended {
            Text("Deze reis is afgelopen; er valt geen route meer bij te houden.").font(.inter(14, 450)).foregroundStyle(Brand.inkSoft)
        } else if mine?.role == "GUEST" {
            Text("Als gast kijk je mee; je route bijhouden doen de reisgenoten.").font(.inter(14, 450)).foregroundStyle(Brand.inkSoft)
        } else if mine?.canTrack == false {
            Text("De organisator heeft route-tracking voor jou uitgezet.").font(.inter(14, 450)).foregroundStyle(Brand.inkSoft)
        } else if live {
            Button { explainTracking = true } label: { Label("Route nu bijhouden", systemImage: "location.fill") }
        }
    }

    private func startTracking() {
        guard let rid = trip.remoteId else { return }
        Task {
            let status = await Tracker.shared.requestPermission()
            guard status == .authorizedAlways || status == .authorizedWhenInUse else {
                error = "MarkMySteps mag je locatie niet gebruiken. Zet het aan in Instellingen › MarkMySteps › Locatie."
                return
            }
            Tracker.shared.start(tripId: rid, title: title, end: end)
            Haptic.tap()
        }
    }

    private var rangeText: String {
        guard let start else { return "Kies de datums" }
        return Format.range(start, end ?? start, withYear: true)
    }

    // MARK: Cover

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomTrailing) {
                CoverView(trip: { var t = trip; t.coverId = info?.coverId ?? trip.coverId; return t }(), size: "preview")
                    .frame(height: 180)
                    .clipped()
                if isOwner && live {
                    Button { pickCover = true } label: {
                        Label("Cover kiezen", systemImage: "photo").font(.outfit(14, 600)).foregroundStyle(.white)
                            .padding(.horizontal, 14).frame(height: 38)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.tint(.black.opacity(0.25)).interactive(), in: .capsule)
                    .padding(12)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title.isEmpty ? trip.title : title).font(.fraunces(22, 600)).foregroundStyle(.white).lineLimit(1)
                Text(rangeText).font(.inter(13.5, 550)).foregroundStyle(.white.opacity(0.85))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
        }
        // Darkened a little, so the white name reads on every colour; the colour glides to a new pick.
        .background(accent.mix(with: .black, by: 0.3))
        .clipShape(.rect(cornerRadius: 28))
    }

    // MARK: Colour

    private var colourPicker: some View {
        let own = color.flatMap { c in Self.colours.contains { $0.caseInsensitiveCompare(c) == .orderedSame } ? nil : c }
        let all: [String?] = [nil] + (own.map { [$0] } ?? []) + Self.colours
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 12) {
            ForEach(all, id: \.self) { hex in
                let on = hex == nil ? color == nil : color?.caseInsensitiveCompare(hex!) == .orderedSame
                Button { pick(hex) } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: on ? 16 : 24, style: .continuous)
                            .fill(hex.flatMap { UInt32($0.dropFirst(), radix: 16) }.map { Color(hex: $0) } ?? Brand.sunken)
                            .frame(width: 48, height: 48)
                            .rotationEffect(.degrees(on ? 45 : 0))
                        if hex == nil && !on { Text("Auto").font(.outfit(12, 600)).foregroundStyle(Brand.ink) }
                        if on {
                            Image(systemName: "checkmark").font(.system(size: 18, weight: .bold))
                                .foregroundStyle(hex == nil ? Brand.ink : .white)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .scaleEffect(on ? 1.12 : 1)
                    .frame(width: 56, height: 56)
                    // The chosen one grows into a softer square with a tick, with a little life.
                    .animation(.spring(response: 0.4, dampingFraction: 0.62), value: on)
                }
                .buttonStyle(.plain)
                .disabled(!live && trip.remoteId != nil)
                .accessibilityLabel(hex == nil ? "Automatisch" : "Kleur \(hex!)")
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.vertical, 4)
    }

    private func pick(_ hex: String?) {
        guard hex != color else { return }
        Haptic.select()
        color = hex
        guard live else { return }
        Task {
            do { try await Remote.setTripColor(trip, hex); await store.load() } catch { self.error = (error as? Api.Failure)?.message ?? "Kleur opslaan mislukt" }
        }
    }

    // MARK: Facts

    private func factChip(_ label: String, on: Bool, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.select()
            withAnimation(.calm) { action() }
        } label: {
            HStack(spacing: 6) {
                if on { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).transition(.scale.combined(with: .opacity)) }
                Text(label).font(.outfit(14, 600))
            }
            .foregroundStyle(on ? Color.white : Brand.ink)
            .padding(.horizontal, 16)
            .frame(height: 40)
            .background(on ? accent : Brand.sunken, in: .capsule)
        }
        .buttonStyle(PressStyle(scale: 0.95))
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }

    private func setFacts(_ ids: [String]?) {
        facts = (ids?.isEmpty ?? true) ? nil : ids
        Prefs.setFacts(trip.id, facts)
    }

    // MARK: Globe dot

    @ViewBuilder private var markerSection: some View {
        Section {
            Text(marker != nil ? "Eigen plek ingesteld. Tik op de kaart om hem te verplaatsen."
                 : placing ? "Tik op de kaart om de plek te kiezen."
                 : "Op de globe staat deze reis met een bolletje op het begin en het eind. Kies hier één eigen plek, handig bij een rondreis.")
                .font(.inter(14.5, 450))
                .foregroundStyle(Brand.inkSoft)
                .contentTransition(.opacity)
                .animation(.calm, value: [marker != nil, placing])
            if marker != nil || placing {
                // Taller than its window and cut at the bottom, so Apple's logo and legal link stay out of sight.
                Color.clear.frame(height: 260)
                    .overlay(alignment: .top) {
                        MarkerMap(trip: trip, marker: marker, color: accent) { p in setMarker(p) }.frame(height: 300)
                    }
                    .clipShape(.rect(cornerRadius: 20))
                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
            }
            // One button at a time, each coming in and going out on its own.
            Group {
                if marker != nil {
                    Button("Terug naar automatisch", systemImage: "arrow.uturn.backward") { withAnimation(.calm) { placing = false }; setMarker(nil) }
                        .transition(.asymmetric(insertion: .push(from: .bottom), removal: .opacity))
                } else if placing {
                    Button("Annuleren") { withAnimation(.calm) { placing = false } }
                        .transition(.opacity)
                } else {
                    Button("Bolletje zelf plaatsen", systemImage: "mappin.and.ellipse") { withAnimation(.calm) { placing = true } }
                        .disabled(live && info == nil)
                        .transition(.opacity)
                }
            }
            .animation(.calm, value: marker != nil)
        } header: { Text("Bolletje op de globe") }
    }

    private func setMarker(_ p: LonLat?) {
        Haptic.tap()
        withAnimation(.calm) { marker = p }
        guard let rid = trip.remoteId else { return }
        Task {
            do { try await TripSettingsRemote.setMarker(rid, p); await store.load() } catch { self.error = (error as? Api.Failure)?.message ?? "Markering opslaan mislukt" }
        }
    }

    // MARK: Saving

    private func save() async {
        guard let rid = trip.remoteId, let start, !title.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let end = self.end ?? start
        saving = true
        error = nil
        do {
            try await TripSettingsRemote.save(rid, title: title, start: start, end: end, autoTrack: autoTrack)
            info?.title = title; info?.start = start; info?.end = end; info?.autoTrack = autoTrack
            withAnimation(.calm) { saved = true }
            await store.load()
            try? await Task.sleep(for: .seconds(1.6))
            withAnimation(.calm) { saved = false }
        } catch {
            self.error = (error as? Api.Failure)?.message ?? "Opslaan mislukt"
        }
        saving = false
    }

    private func sync() {
        guard let rid = trip.remoteId else { return }
        syncing = true
        syncNote = nil
        Task {
            do {
                let r = try await TripSettingsRemote.sync(rid)
                syncNote = "\(r.added) \(r.added == 1 ? "nieuwe foto" : "nieuwe foto's") (\(r.found) gevonden, \(r.users) \(r.users == 1 ? "reiziger" : "reizigers"))"
                await store.load()
            } catch {
                syncNote = (error as? Api.Failure)?.message ?? "Sync mislukt"
            }
            syncing = false
        }
    }

    private func reload() {
        guard let rid = trip.remoteId else { return }
        Task {
            if let fresh = try? await TripSettingsRemote.info(rid) { info?.coverId = fresh.coverId }
            await store.load()
        }
    }
}

/// A small map of the trip: a tap puts the dot there.
private struct MarkerMap: View {
    let trip: Trip
    let marker: LonLat?
    let color: Color
    let onPlace: (LonLat) -> Void
    @State private var position: MapCameraPosition

    init(trip: Trip, marker: LonLat?, color: Color, onPlace: @escaping (LonLat) -> Void) {
        self.trip = trip
        self.marker = marker
        self.color = color
        self.onPlace = onPlace
        _position = State(initialValue: .rect(trip.mapRect()))
    }

    var body: some View {
        MapReader { proxy in
            Map(position: $position, interactionModes: [.pan, .zoom]) {
                if let marker {
                    Annotation("", coordinate: marker.coordinate, anchor: .center) {
                        Circle().fill(color).frame(width: 18, height: 18).padding(3).background(.white, in: .circle)
                    }
                    .annotationTitles(.hidden)
                }
            }
            .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll))
            .mapControlVisibility(.hidden)
            .onTapGesture { point in
                if let c = proxy.convert(point, from: .local) { onPlace(LonLat(c.longitude, c.latitude)) }
            }
        }
    }
}

/// The trip's dates in the app's own range calendar, the chosen days above it.
private struct DatesSheet: View {
    @Binding var start: Date?
    @Binding var end: Date?
    @State private var a: Date?
    @State private var b: Date?
    @Environment(\.dismiss) private var dismiss

    init(start: Binding<Date?>, end: Binding<Date?>) {
        _start = start
        _end = end
        _a = State(initialValue: start.wrappedValue)
        _b = State(initialValue: end.wrappedValue)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Datums van de reis").font(.outfit(14, 600)).foregroundStyle(Brand.inkSoft)
                Text(a.map { Format.range($0, b ?? $0, withYear: true) } ?? "Kies de dagen")
                    .font(.outfit(21, 650)).foregroundStyle(Brand.ink)
                    .contentTransition(.opacity)
                    .animation(.calm, value: a)
                RangeCalendar(start: $a, end: $b).padding(.top, 12)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .background(Brand.paper)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuleren") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Klaar") {
                        start = a
                        end = b ?? a
                        dismiss()
                    }
                    .disabled(a == nil)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The trip's photos to pick the cover from; Automatisch lets the server choose.
private struct CoverPicker: View {
    let trip: Trip
    let current: String?
    let onPicked: () -> Void
    @State private var media: [Media]?
    @State private var chosen: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Tik een foto aan om hem de cover van deze reis te maken.").font(.inter(14, 450)).foregroundStyle(Brand.inkSoft)
                    if let media {
                        if media.isEmpty {
                            Text("Nog geen foto's in deze reis.").font(.inter(15, 500)).foregroundStyle(Brand.inkSoft)
                        }
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 3), spacing: 4) {
                            ForEach(media.filter { !$0.video }) { m in
                                let on = m.id == (chosen ?? current)
                                Button { choose(m.id) } label: {
                                    Color.clear.aspectRatio(1, contentMode: .fit)
                                        .overlay { RemotePhoto(id: m.id) }
                                        .clipShape(.rect(cornerRadius: on ? 22 : 10))
                                        .overlay(alignment: .topTrailing) {
                                            if on {
                                                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                                                    .frame(width: 26, height: 26).background(Brand.accent, in: .circle).padding(6)
                                            }
                                        }
                                }
                                .buttonStyle(PressStyle(scale: 0.96))
                            }
                        }
                    } else {
                        CompassSpinner().frame(maxWidth: .infinity, minHeight: 200)
                    }
                }
                .padding(16)
            }
            .background(Brand.paper)
            .navigationTitle("Coverfoto")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Automatisch") { choose(nil) } }
                ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() }.tint(.primary) }
            }
            .animation(.calm, value: chosen)
        }
        .task { media = (try? await Remote.media(trip)) ?? [] }
    }

    private func choose(_ id: String?) {
        Haptic.select()
        chosen = id
        Task {
            if (try? await ViewerApi.setTripCover(trip, mediaId: id)) != nil { onPicked() }
            dismiss()
        }
    }
}

/// Danger at the bottom: wiping your tracked route or the drawn roads in a quiet red, deleting or leaving the trip
/// as the one filled red button. Each asks first.
private struct DangerSection: View {
    let trip: Trip
    let isOwner: Bool
    let canEdit: Bool
    let live: Bool
    let onGone: () -> Void
    @Environment(Store.self) private var store
    @State private var ask: Ask?
    @State private var day: Date?
    @State private var pickDay = false
    @State private var busy = false
    @State private var note: String?
    @State private var typed = ""

    enum Ask: Identifiable { case day, all, routes, delete, leave; var id: Self { self } }

    var body: some View {
        if canEdit {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Getrackte data wissen").font(.outfit(16, 650)).foregroundStyle(Brand.ink)
                    Text("Verwijdert jouw GPS-route; de reis en de foto's blijven. Kies een dag, of wis alles.").font(.inter(13.5, 450)).foregroundStyle(Brand.inkSoft)
                }
                HStack(spacing: 8) {
                    Button { pickDay = true } label: {
                        Label(day.map { Format.shortDay($0) } ?? "Kies een dag", systemImage: "calendar")
                            .font(.outfit(15, 600)).foregroundStyle(Brand.ink)
                            .frame(maxWidth: .infinity).frame(height: 44)
                            .background(Brand.sunken, in: .capsule)
                    }
                    .buttonStyle(.borderless)
                    quiet("Wis dag", enabled: day != nil) { ask = .day }
                }
                quiet("Alles wissen", enabled: true) { ask = .all }
            } header: { Text("Verwijderen") }
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Getekende routes wissen").font(.outfit(16, 650)).foregroundStyle(Brand.ink)
                    Text("Alleen de routes die je tekende via **Ingedrukt houden › Route via wegen**. Je eigen getrackte GPS blijft staan.")
                        .font(.inter(13.5, 450)).foregroundStyle(Brand.inkSoft)
                }
                quiet("Wissen", enabled: true) { ask = .routes }
            } footer: {
                if let note { Text(note) }
            }
        }
        Section {
            Button {
                typed = ""
                ask = isOwner ? .delete : .leave
            } label: {
                Label(isOwner ? "Reis verwijderen" : "Reis verlaten", systemImage: isOwner ? "trash" : "rectangle.portrait.and.arrow.right")
                    .font(.outfit(16, 650))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Color.red, in: .capsule)
            }
            .buttonStyle(PressStyle(scale: 0.97))
            .disabled(!live || busy)
            .opacity(live ? 1 : 0.5)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        } footer: {
            if !live { Text("In de voorbeelden verander je niets.") }
        }
        .alert(title, isPresented: Binding(get: { ask != nil }, set: { if !$0 { ask = nil } }), presenting: ask) { a in
            if a == .delete { TextField(trip.title, text: $typed) }
            Button("Annuleren", role: .cancel) {}
            Button(a == .leave ? "Verlaten" : a == .delete ? "Verwijderen" : "Wissen", role: .destructive) { confirm(a) }
                .disabled(a == .delete && typed.trimmingCharacters(in: .whitespaces) != trip.title.trimmingCharacters(in: .whitespaces))
        } message: { a in
            Text(message(a))
        }
        .sheet(isPresented: $pickDay) { DaySheet(trip: trip, day: $day) }
    }

    private var title: String {
        switch ask {
        case .day, .all: "Tracking wissen?"
        case .routes: "Getekende routes wissen?"
        case .delete: "Reis verwijderen?"
        case .leave: "Reis verlaten?"
        case nil: ""
        }
    }

    private func message(_ a: Ask) -> String {
        switch a {
        case .day: "Weet je zeker dat je de tracking van \(day.map { Format.shortDay($0) } ?? "deze dag") wilt verwijderen? Dit kan niet ongedaan worden gemaakt."
        case .all: "Weet je zeker dat je alle getrackte data van deze reis wilt verwijderen? Dit kan niet ongedaan worden gemaakt."
        case .routes: "Alleen de automatisch getekende routes worden verwijderd. Je eigen getrackte GPS blijft staan."
        case .delete: "\(trip.title) wordt verwijderd met alle stops, routes en notities. Je foto's blijven in Immich. Typ de naam van de reis om te bevestigen."
        case .leave: "Je verdwijnt uit \(trip.title). De organisator kan je later opnieuw toevoegen."
        }
    }

    /// A quiet red: red words on a tonal pill, the step below the one filled red button.
    private func quiet(_ label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.outfit(15, 600)).foregroundStyle(.red)
                .frame(maxWidth: .infinity).frame(height: 44)
                .background(Color.red.opacity(0.1), in: .capsule)
        }
        .buttonStyle(.borderless)
        .disabled(!enabled || busy || !live)
        .opacity(enabled && live ? 1 : 0.45)
    }

    private func confirm(_ a: Ask) {
        guard let rid = trip.remoteId else { return }
        busy = true
        note = nil
        Task {
            do {
                switch a {
                case .day:
                    let n = try await TripSettingsRemote.wipeTracked(rid, day: day)
                    note = "\(n) \(n == 1 ? "trackpunt" : "trackpunten") verwijderd."
                    day = nil
                case .all:
                    let n = try await TripSettingsRemote.wipeTracked(rid, day: nil)
                    note = "\(n) \(n == 1 ? "trackpunt" : "trackpunten") verwijderd."
                case .routes:
                    let n = try await TripSettingsRemote.wipeRouteFills(rid)
                    note = "\(n) \(n == 1 ? "routepunt" : "routepunten") verwijderd."
                case .delete:
                    try await Remote.deleteTrip(trip)
                    await store.load()
                    onGone()
                case .leave:
                    try await Remote.leaveTrip(trip, me: store.me?.id ?? "")
                    await store.load()
                    onGone()
                }
                Haptic.tap()
            } catch {
                note = (error as? Api.Failure)?.message ?? "Dat lukte niet"
            }
            busy = false
        }
    }
}

/// One day of the trip to wipe: the last tap wins, only days of the trip count.
private struct DaySheet: View {
    let trip: Trip
    @Binding var day: Date?
    @State private var a: Date?
    @State private var b: Date?
    @Environment(\.dismiss) private var dismiss

    private var first: Date { trip.start ?? trip.firstDay ?? Format.calendar.startOfDay(for: Date()) }
    private var last: Date { Format.calendar.date(byAdding: .day, value: max(0, trip.days - 1), to: first) ?? first }
    private var chosen: Date? {
        guard let d = b ?? a, d >= first, d <= last else { return nil }
        return d
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Dag om te wissen").font(.outfit(14, 600)).foregroundStyle(Brand.inkSoft)
                Text(chosen.map { Format.shortDay($0) } ?? "Kies een dag van de reis").font(.outfit(21, 650)).foregroundStyle(Brand.ink)
                RangeCalendar(start: $a, end: $b).padding(.top, 12)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .background(Brand.paper)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuleren") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Klaar") { day = chosen; dismiss() }.disabled(chosen == nil) }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { a = day ?? first }
    }
}
