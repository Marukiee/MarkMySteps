import MapKit
import SwiftUI

/// A trip, opened: the map, the name and facts, then Tijdlijn or Routeplanner.
/// The whole page is one List, so the planner's swipe and reorder are the system's own.
struct TripView: View {
    let base: Trip
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var trip: Trip
    @State private var media: [Media]?
    @State private var notes: [Remote.Note] = []
    @State private var comments: [Remote.Comment] = []
    @State private var storyEditor: StoryEditor?
    @State private var commentsDay: String?
    @State private var deletingNote: Remote.Note?
    @State private var tab: TripTab
    @State private var plan: PlanState
    @State private var showMap = Launch.map
    @State private var showPeople = Launch.page == "people"
    @State private var showMapStyle = Launch.page == "mapstyle"
    @State private var showSettings = Launch.page == "tripsettings"
    @State private var viewer: ViewerItem?
    /// The photo the viewer is on, so closing flies back into that one.
    @State private var viewerCurrent = ""
    @State private var titleShown = false
    @State private var pageHeight: CGFloat = 800
    @State private var topInset: CGFloat = 62
    @State private var pastMap = false
    /// The up button steps aside while the keyboard is up, so it never covers a field's suggestions.
    @State private var keyboardUp = false
    @State private var saver = PlanSaver()
    /// Whether the stops have been read from the server, so the figures can wait in their place until then.
    @State private var stopsKnown: Bool
    @State private var mapPosition: MapCameraPosition
    /// The day the map shows, nil for the whole trip; its own route once read from the server.
    @State private var mapDay: Date?
    @State private var dayRoute: [[LonLat]] = []
    @State private var serverDays: [(day: Date, points: Int, photos: Int)] = []
    @State private var mapSize: CGSize = .zero
    /// Room kept free on the map: the bar with the buttons on top, the sheet's edge, the day pill and the expand
    /// button below, and half a photo pin with its count on every side (as Android's 52 dp padding).
    private static let mapInsets = EdgeInsets(top: 146, leading: 48, bottom: 104, trailing: 48)
    @Namespace private var ns

    enum TripTab: Hashable { case timeline, planner }

    init(base: Trip) {
        self.base = base
        _trip = State(initialValue: base)
        _tab = State(initialValue: Launch.page == "planner" ? .planner : .timeline)
        _plan = State(initialValue: PlanState(trip: base))
        _stopsKnown = State(initialValue: base.remoteId == nil)
        _mapPosition = State(initialValue: .rect(base.mapRect()))
    }

    /// The map's height: as on Android a bit under half the screen, and low enough that the Tijdlijn and
    /// Routeplanner tabs stand clear above the floating tab bar when the trip opens.
    private var mapHeight: CGFloat { max(330, min(pageHeight * 0.46, pageHeight - 500)) }

    var body: some View {
        ScrollViewReader { proxy in
            let days = Timeline.days(trip, media, notes: notes)
            List {
                mapHeader
                    .id("top")
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)

                // The cover at the top, the figures joined underneath in its tone.
                CoverTone(trip: trip) { tone in
                    VStack(spacing: 4) {
                        CoverCard(trip: trip) { showPeople = true }
                        FactsRow(trip: trip, photos: media?.count, tone: tone, stopsKnown: stopsKnown)
                    }
                }
                .plainRow(top: 0)

                Picker("Weergave", selection: $tab.animation(.calm)) {
                    Text("Tijdlijn").tag(TripTab.timeline)
                    Text("Routeplanner").tag(TripTab.planner)
                }
                .pickerStyle(.segmented)
                .controlSize(.large)
                .plainRow(top: 18, bottom: 16)
                .id("tabs")

                switch tab {
                case .timeline:
                    TimelineRows(trip: trip, media: media, days: days, ns: ns, hidden: nil, onPhoto: { item in
                        viewerCurrent = item.start.id
                        viewer = item
                    }, onPlace: { name in
                        // A place tile goes to the first day spent there, its heading just under the solid bar. Rows
                        // further down only take their real height once they come near, so a second pass lands it
                        // exactly once the first one has brought them in.
                        guard let i = days.firstIndex(where: { $0.day.stop?.name == name }) else { return }
                        Haptic.tap()
                        let id = i == 0 ? "days" : "day\(i)"
                        let anchor = UnitPoint(x: 0.5, y: min(0.5, (topInset + 58 + 10) / max(pageHeight, 1)))
                        withAnimation(.smooth(duration: 0.5)) { proxy.scrollTo(id, anchor: anchor) }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.55) {
                            withAnimation(.smooth(duration: 0.25)) { proxy.scrollTo(id, anchor: anchor) }
                        }
                    }, stories: stories)
                case .planner:
                    PlannerRows(trip: trip, plan: $plan, onFocusAdd: {
                        // Lift the field and its suggestions above the keyboard.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            withAnimation(.smooth) { proxy.scrollTo("add", anchor: .bottom) }
                        }
                    }, saver: saver, onReveal: { id in
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                            withAnimation(.smooth) { proxy.scrollTo(id, anchor: .bottom) }
                        }
                    })
                }

                Color.clear.frame(height: 28).plainRow()
            }
            .listStyle(.plain)
            .listRowSpacing(0)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 0)
            .background(Brand.paper)
            // No soft blur of the system's scroll edge: over the map it drew a pale band behind the buttons, and
            // under it the day headings ran through the title. A solid bar comes in instead (below).
            .scrollEdgeEffectHidden(true, for: .top)
            .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { if $0 > 0 { topInset = $0 } }
            .ignoresSafeArea(.container, edges: .top)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { pageHeight = $0 }
            // While the viewer pages, the timeline behind it keeps that photo in view.
            .onChange(of: viewerCurrent) {
                guard viewer != nil, let m = days.flatMap(\.photos).first(where: { $0.id == viewerCurrent }),
                      let row = Timeline.rowId(m, in: days) else { return }
                proxy.scrollTo(row, anchor: .center)
            }
            // The bar turns solid, and the name comes into it, once the page's sheet reaches the bar; while the map
            // is under it there is no background at all.
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top > mapHeight - 30 - (topInset + 58)
            } action: { _, shown in
                withAnimation(.easeOut(duration: 0.2)) { titleShown = shown }
            }
            .overlay(alignment: .top) {
                // The bar behind the buttons: the page colour, closed at the bottom with a hairline, so nothing
                // runs through the title.
                Brand.paper
                    .frame(height: topInset + 58)
                    .overlay(alignment: .bottom) { Brand.line.frame(height: 0.5) }
                    .ignoresSafeArea(.container, edges: .top)
                    .opacity(titleShown ? 1 : 0)
                    .allowsHitTesting(false)
            }
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top > mapHeight + 80
            } action: { _, past in
                withAnimation(.calm) { pastMap = past }
            }
            .overlay(alignment: .bottomTrailing) {
                // Back to the top once the map has scrolled away.
                if pastMap && plan.pending == nil && !keyboardUp {
                    Button { withAnimation(.smooth) { proxy.scrollTo("top", anchor: .top) } } label: {
                        Image(systemName: "chevron.up").font(.system(size: 17, weight: .semibold)).frame(width: 30, height: 30)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
                    .tint(.primary)
                    .padding(.trailing, 16)
                    .padding(.bottom, 8)
                    .transition(.scale(scale: 0.85).combined(with: .opacity).combined(with: .offset(y: 10)))
                    .accessibilityLabel("Naar boven")
                }
            }
            .overlay(alignment: .bottom) {
                // A removed stop can come back for 7 seconds.
                if let pending = plan.pending {
                    HStack(spacing: 12) {
                        Text("\(pending.name) verwijderd").font(.inter(15, 550)).foregroundStyle(Brand.ink).lineLimit(1)
                        Button("Ongedaan maken") { saver.undo($plan) }
                            .font(.inter(15, 650))
                            .foregroundStyle(Brand.accent)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .background(Brand.paper, in: .capsule)
                    .overlay { Capsule().strokeBorder(Brand.line, lineWidth: 1) }
                    .contentShape(.capsule)
                    // The whole pill answers, so a slightly missed tap still brings the stop back.
                    .onTapGesture { saver.undo($plan) }
                    // Clear of the tab bar's own touch area.
                    .padding(.bottom, 64)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .onAppear {
                if let anchor = Launch.scroll, Launch.page == "trip" || Launch.page == "planner" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { proxy.scrollTo(anchor, anchor: UnitPoint(x: 0.5, y: 0.13)) }
                }
            }
        }
        .navigationTitle(trip.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The name comes into the bar only once the map has scrolled away.
            ToolbarItem(placement: .principal) {
                Text(trip.title)
                    .font(.outfit(17, 620))
                    .lineLimit(1)
                    .opacity(titleShown ? 1 : 0)
                    .offset(y: titleShown ? 0 : 8)
            }
            // The trip's own buttons as on the web and Android: people, the map's style, the trip's settings, as one
            // connected glass group. The one whose panel is open is lit in the accent until the panel closes.
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 2) {
                    topButton("person.2", "Mensen en delen", open: showPeople) { showPeople = true }
                    topButton("map", "Kaartstijl", open: showMapStyle) { showMapStyle = true }
                    topButton("slider.horizontal.3", "Reisinstellingen", open: showSettings) { showSettings = true }
                }
                .animation(.calm, value: [showPeople, showMapStyle, showSettings])
            }
        }
        .sheet(item: $plan.flight) { target in
            FlightSheet(target: target) { number, from, to, via in
                saver.saveFlight(trip, $plan, target, send: PlannerRows.saves(trip, me: store.me?.id), number: number, from: from, to: to, via: via)
            }
        }
        .sheet(item: $storyEditor) { editor in StorySheet(editor: editor) { text in await saveStory(editor, text) } }
        .sheet(isPresented: Binding(get: { commentsDay != nil }, set: { if !$0 { commentsDay = nil } })) {
            CommentsSheet(trip: trip, mediaId: nil, day: commentsDay, comments: $comments)
        }
        .confirmationDialog("Je verhaal van deze dag verwijderen?", isPresented: Binding(get: { deletingNote != nil }, set: { if !$0 { deletingNote = nil } }), titleVisibility: .visible) {
            Button("Verwijderen", role: .destructive) {
                guard let note = deletingNote else { return }
                let before = notes
                withAnimation(.calm) { notes.removeAll { $0.id == note.id } }
                Task { do { try await Remote.deleteNote(trip, note.id) } catch { notes = before } }
            }
        } message: { Text("Dit kan niet ongedaan worden gemaakt.") }
        .sheet(isPresented: $showPeople) { PeopleSheet(trip: trip) }
        .sheet(isPresented: $showMapStyle) { MapStyleSheet() }
        .navigationDestination(isPresented: $showSettings) {
            TripSettingsPage(trip: store.trips.first { $0.id == trip.id }.map { fresh in
                var t = fresh
                t.stops = trip.stops
                return t
            } ?? trip, onPeople: {
                showSettings = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { showPeople = true }
            }, onGone: {
                showSettings = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { dismiss() }
            })
        }
        .fullScreenCover(isPresented: $showMap) {
            FullMapView(trip: trip, photos: shownPhotos, focus: focus, days: mapDays, day: $mapDay) { m in
                // Out of the big map into the photo: the map closes, the viewer opens.
                showMap = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { openFromMap(m) }
            }
                .navigationTransition(.zoom(sourceID: "map", in: ns))
        }
        .fullScreenCover(item: $viewer) { item in
            PhotoViewer(item: item, current: $viewerCurrent)
                .navigationTransition(.zoom(sourceID: viewerCurrent, in: ns))
        }
        .task(id: "\(base.id)/\(store.version)") { await loadMore() }
        .onChange(of: mapDay) { _, day in Task { await showDay(day) } }
        .onAppear {
            // Screenshots only (`-menuPreview YES`): a demo trip shows a day story as yours, to see how it looks.
            if Launch.menuPreview, base.remoteId == nil, notes.isEmpty, let first = trip.demoDays.first?.date {
                notes = [Remote.Note(id: "demo", day: PlannerRemote.isoDay(first), title: nil,
                                     body: "Vroeg op voor de zonsopkomst boven de kliffen. Daarna koffie in het dorp en de hele middag gewandeld langs de kust.",
                                     authorId: nil, author: "Mark")]
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in withAnimation(.calm) { keyboardUp = true } }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in withAnimation(.calm) { keyboardUp = false } }
        .onAppear {
            if Launch.photo, viewer == nil, let first = trip.demoDays.first {
                let photos = Demo.media(trip, day: 0, date: first.date)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { viewerCurrent = photos[0].id; viewer = ViewerItem(trip: trip, photos: photos, start: photos[0]) }
            }
        }
    }

    private var role: String? { trip.members.first { $0.userId == store.me?.id }?.role ?? (trip.ownerId == store.me?.id ? "OWNER" : nil) }

    private var stories: DayStories {
        var counts: [String: Int] = [:]
        for c in comments where c.mediaId == nil { if let d = c.day { counts[d, default: 0] += 1 } }
        return DayStories(
            notes: notes, comments: counts, me: store.me?.id,
            canWrite: role == "OWNER" || role == "MEMBER" || Launch.menuPreview, canComment: role != nil || Launch.menuPreview,
            onWrite: { day, note in storyEditor = StoryEditor(day: day, note: note) },
            onDelete: { note in deletingNote = note },
            onComments: { day in commentsDay = day }
        )
    }

    /// Your story of a day, shown at once; the server's list replaces it when it sends one back.
    private func saveStory(_ editor: StoryEditor, _ text: String) async -> String? {
        let day = PlannerRemote.isoDay(editor.day)
        do {
            let fresh = try await Remote.saveNote(trip, day: day, body: text)
            withAnimation(.calm) {
                if let fresh { notes = fresh } else {
                    let name = store.me?.name ?? ""
                    let own = Remote.Note(id: editor.note?.id ?? UUID().uuidString, day: day, title: editor.note?.title, body: text.trimmingCharacters(in: .whitespacesAndNewlines),
                                          authorId: store.me?.id, author: name)
                    notes.removeAll { $0.id == own.id }
                    notes.append(own)
                }
            }
            Haptic.tap()
            return nil
        } catch {
            return (error as? Api.Failure)?.message ?? "Bewaren lukte niet"
        }
    }

    private func topButton(_ symbol: String, _ label: String, open: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(open ? Color.white : Brand.ink)
                .frame(width: 40, height: 34)
                .background { if open { Capsule().fill(Brand.accent) } }
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(open ? .isSelected : [])
    }

    /// Your photos where they were taken, for the map: the real ones once read, in the demo the drawn ones at
    /// the day's stop.
    private var mapPhotos: [Media] {
        if let media { return media.filter { $0.lat != nil && $0.lon != nil && !$0.video } }
        guard trip.remoteId == nil, !trip.upcoming else { return [] }
        return Timeline.days(trip, nil).flatMap { day -> [Media] in
            guard let at = day.day.stop?.at else { return [] }
            return day.photos.enumerated().map { k, m in
                var p = m
                // A little apart, as photos taken around a town are.
                p.lat = at.lat + Double((k * 7 + day.day.index * 3) % 9 - 4) * 0.012
                p.lon = at.lon + Double((k * 5 + day.day.index * 11) % 9 - 4) * 0.02
                return p
            }
        }
    }

    private func openFromMap(_ m: Media) {
        let all = media ?? Timeline.days(trip, nil).flatMap(\.photos)
        viewerCurrent = m.id
        viewer = ViewerItem(trip: trip, photos: all.isEmpty ? [m] : all, start: m)
    }

    /// The days the map can show on their own: those with photos on the map or, from the server, a recorded route.
    private var mapDays: [(day: Date, photos: Int)] {
        var counts: [Date: Int] = [:]
        for m in mapPhotos { counts[m.takenAt, default: 0] += 1 }
        for d in serverDays where d.points > 0 || d.photos > 0 { counts[d.day] = max(counts[d.day] ?? 0, d.photos) }
        return counts.keys.sorted().map { ($0, counts[$0] ?? 0) }
    }

    /// The photos on the map: all of them, or those of the day on show.
    private var shownPhotos: [Media] {
        guard let mapDay else { return mapPhotos }
        return mapPhotos.filter { $0.takenAt == mapDay }
    }

    private var focus: MapFocus? {
        mapDay.map { MapFocus(route: dayRoute, stops: Set(TripView.stops(trip, on: $0).map(\.name))) }
    }

    /// The stops whose stay covers a day (a stop without known dates: where the timeline puts that day).
    static func stops(_ trip: Trip, on day: Date) -> [Stop] {
        let cal = Format.calendar
        let covering = trip.stops.filter { s in
            guard let start = s.start, let end = cal.date(byAdding: .day, value: s.nights, to: start) else { return false }
            return start <= day && day <= end
        }
        return covering.isEmpty ? [Timeline.stopOn(trip, day)].compactMap { $0 } : covering
    }

    /// Picking a day frames that day's route and photos (or its stop); the whole trip again frames the whole trip.
    private func showDay(_ day: Date?) async {
        guard let day else {
            dayRoute = []
            withAnimation(.smooth(duration: 0.5)) { mapPosition = .rect(trip.fittedRect(size: mapSize, insets: TripView.mapInsets)) }
            return
        }
        let route = (try? await Remote.dayRoute(trip, day)) ?? []
        guard mapDay == day else { return }
        withAnimation(.calm) { dayRoute = route }
        let points = TripView.focusPoints(trip, day: day, route: route, photos: shownPhotos)
        withAnimation(.smooth(duration: 0.5)) { mapPosition = .rect(Trip.fitted(points, size: mapSize, insets: TripView.mapInsets, minMeters: 8000)) }
    }

    /// What a day on the map should fit: its route and photos, or else the stops of that day.
    static func focusPoints(_ trip: Trip, day: Date, route: [[LonLat]], photos: [Media]) -> [LonLat] {
        let shot = photos.compactMap { m -> LonLat? in
            guard let lat = m.lat, let lon = m.lon else { return nil }
            return LonLat(lon, lat)
        }
        let points = route.flatMap { $0 } + shot
        return points.isEmpty ? stops(trip, on: day).map(\.at) : points
    }

    private var mapHeader: some View {
        // The map moves under your finger without the page scrolling along, with your photos on it.
        TripMap(trip: trip, interactive: true, position: $mapPosition, photos: shownPhotos, focus: focus, onPhoto: openFromMap)
            .frame(height: mapHeight)
            // The camera frames the trip in the part of the map left free by the bar above and the sheet below.
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size in
                guard size != mapSize else { return }
                mapSize = size
                mapPosition = .rect(trip.fittedRect(size: size, insets: TripView.mapInsets))
            }
            // The page's sheet laps over the map's lower edge, as on Android; Apple's logo and the legal
            // link sit under that edge, out of the way.
            .overlay(alignment: .bottom) {
                UnevenRoundedRectangle(topLeadingRadius: 30, topTrailingRadius: 30)
                    .fill(Brand.paper)
                    .frame(height: 30)
                    .overlay(alignment: .top) {
                        Capsule().fill(Brand.line).frame(width: 36, height: 4).padding(.top, 10)
                    }
            }
            .overlay(alignment: .bottomTrailing) {
                Button { showMap = true } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Brand.ink)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(.large)
                .padding(.trailing, 14)
                .padding(.bottom, 42)
                .accessibilityLabel("Kaart vergroten")
            }
            .overlay(alignment: .bottomLeading) {
                // The day on the map, level with the expand button, as on Android.
                if mapDays.count >= 2 {
                    MapDayPill(days: mapDays, day: $mapDay)
                        .padding(.leading, 14)
                        .padding(.bottom, 42)
                }
            }
            .matchedTransitionSource(id: "map", in: ns)
    }

    /// A trip from the server brings its stops and photos in only when it is opened.
    private func loadMore() async {
        guard base.remoteId != nil else { return }
        if let (stops, outbound, back) = try? await Remote.stops(base) {
            var t = base
            t.stops = stops
            t.outbound = outbound
            t.back = back
            trip = t
            plan = PlanState(trip: t)
            withAnimation(.calm) { mapPosition = .rect(t.fittedRect(size: mapSize, insets: TripView.mapInsets)) }
        }
        withAnimation(.calm) { stopsKnown = true }
        media = (try? await Remote.media(base)) ?? []
        // Which days have a route or photos, for the day pill on the map.
        serverDays = (try? await Remote.mapDays(base)) ?? []
        // The day stories and the comments on them, after the photos.
        async let n = Remote.notes(base)
        async let c = Remote.comments(base)
        notes = (try? await n) ?? notes
        comments = (try? await c) ?? comments
    }
}

extension View {
    /// A row of the trip page: on the page edge, no separator, no row background.
    func plainRow(top: CGFloat = 0, bottom: CGFloat = 0) -> some View {
        listRowInsets(EdgeInsets(top: top, leading: 16, bottom: bottom, trailing: 16))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

/// The trip's cover, as on the web: the photo, the name and the dates on it, the
/// people in the corner. Without a photo it is the trip's colour with the compass.
struct CoverCard: View {
    let trip: Trip
    var onPeople: () -> Void = {}

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            CoverView(trip: trip, size: "preview")
            if trip.hasCover {
                LinearGradient(stops: [.init(color: .clear, location: 0.35), .init(color: .black.opacity(0.62), location: 1)], startPoint: .top, endPoint: .bottom)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(trip.title).font(.outfit(32, 700)).tracking(-0.6).foregroundStyle(.white).lineLimit(2)
                Text(trip.dates).font(.inter(15, 500)).foregroundStyle(.white.opacity(0.88))
            }
            .padding(20)
        }
        .frame(height: 236)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .topTrailing) {
            Button(action: onPeople) {
                FaceStack(people: trip.people, extra: trip.extraPeople, ring: .white.opacity(0.9), size: 34)
            }
            .buttonStyle(PressStyle(scale: 0.92))
            .accessibilityLabel("Mensen en delen")
            .padding(14)
        }
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 30, bottomLeadingRadius: 6, bottomTrailingRadius: 6, topTrailingRadius: 30))
    }
}

/// The figures of a trip, joined to the cover above in the trip's tone. As the web (lib/tripFacts.ts) and Android:
/// the first four that have something to say, in a fixed order: distance, days, stops (only for a route of two
/// or more), photos, travellers (more than you alone), countries. Before a trip: days to go, days, then the same
/// rules. While the server has not answered, the tiles wait in their place.
struct FactsRow: View {
    let trip: Trip
    var photos: Int?
    var tone: Color? = nil
    var stopsKnown = true
    @Environment(\.colorScheme) private var scheme
    /// The figures picked in trip settings; read here so a new pick shows at once.
    @AppStorage("tripFacts") private var factsData: Data?

    static func facts(_ trip: Trip, photos: Int?, stopsKnown: Bool) -> [(String?, String)] {
        let stops = trip.stops.count
        // The figures picked in the trip's settings, in their order; one still unknown waits as a quiet shape.
        if let chosen = Prefs.facts(trip.id) {
            let nonGuests = trip.members.filter { $0.role != "GUEST" }.count
            return chosen.map { f in
                switch f {
                // No "0 kilometer": a trip without a measured distance leaves the number empty.
                case "km": return (trip.km.flatMap { $0 > 0 ? Format.number($0) : nil }, "kilometer")
                case "days": return ("\(trip.days)", trip.days == 1 ? "dag" : "dagen")
                case "stops": return (stopsKnown ? "\(stops)" : nil, stops == 1 ? "stop" : "stops")
                case "photos": return (photos.map { Format.number($0) } ?? (trip.remoteId == nil ? "\(trip.photos)" : nil), "foto's")
                case "travellers": return ("\(nonGuests > 0 ? nonGuests : trip.people.count + trip.extraPeople)", "reizigers")
                default:
                    let n = Set(trip.stops.map(\.flag).filter { !$0.isEmpty && $0 != "📍" }).count
                    return (stopsKnown ? "\(n)" : nil, n == 1 ? "land" : "landen")
                }
            }
        }
        let nonGuests = trip.members.filter { $0.role != "GUEST" }.count
        let travellers = nonGuests > 0 ? nonGuests : trip.people.count + trip.extraPeople
        let countries = Set(trip.stops.map(\.flag).filter { !$0.isEmpty && $0 != "📍" }).count
        let countryFact: (String?, String)? = countries > 0 ? ("\(countries)", countries == 1 ? "land" : "landen") : nil
        if trip.upcoming {
            let list: [(String?, String)?] = [
                trip.startsInDays.map { ("\($0)", $0 == 1 ? "dag tot vertrek" : "dagen tot vertrek") },
                ("\(trip.days)", trip.days == 1 ? "dag" : "dagen"),
                !stopsKnown ? (nil, "stops") : (stops > 1 ? ("\(stops)", "stops") : nil),
                travellers > 1 ? ("\(travellers)", "reizigers") : nil,
                stopsKnown ? countryFact : nil,
            ]
            return Array(list.compactMap { $0 }.prefix(4))
        }
        // As on Android: while the page's own stops and photos are on their way, the tiles already stand with their
        // label, filled from what the trip list knows; only a number nobody knows yet waits as empty space.
        let photosWaiting = trip.remoteId != nil && photos == nil
        let shots = photos ?? trip.photos
        let list: [(String?, String)?] = [
            trip.km.flatMap { $0 > 0 ? (Format.number($0), "kilometer") : nil },
            trip.days > 0 ? ("\(trip.days)", trip.days == 1 ? "dag" : "dagen") : nil,
            !stopsKnown ? (nil, "stops") : (stops > 1 ? ("\(stops)", "stops") : nil),
            photosWaiting ? (trip.photos > 0 ? Format.number(trip.photos) : nil, trip.photos == 1 ? "foto" : "foto's")
                : (shots > 0 ? (Format.number(shots), shots == 1 ? "foto" : "foto's") : nil),
            travellers > 1 ? ("\(travellers)", "reizigers") : nil,
            stopsKnown ? countryFact : nil,
        ]
        return Array(list.compactMap { $0 }.prefix(4))
    }

    var body: some View {
        let _ = factsData
        let items = FactsRow.facts(trip, photos: photos, stopsKnown: stopsKnown)
        let tile = (tone ?? trip.color).opacity(scheme == .dark ? 0.34 : 0.24)
        return HStack(spacing: 4) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                VStack(alignment: .leading, spacing: 2) {
                    // Waiting for the server: empty space of the number's exact height, no grey block and never a
                    // wrong 0; the number fades in there the moment it is known.
                    Text(item.0 ?? "0")
                        .font(.outfit(21, 700))
                        .tracking(-0.4)
                        .foregroundStyle(Brand.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .opacity(item.0 == nil ? 0 : 1)
                        .contentTransition(.numericText())
                    Text(item.1).font(.inter(12, 500)).foregroundStyle(Brand.inkSoft).lineLimit(2)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(12)
                .background { ZStack { Brand.raised; tile } }
                .clipShape(UnevenRoundedRectangle(
                    topLeadingRadius: 6, bottomLeadingRadius: i == 0 ? 24 : 6,
                    bottomTrailingRadius: i == items.count - 1 ? 24 : 6, topTrailingRadius: 6
                ))
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .animation(.calm, value: items.map { ($0.0 ?? "") + $0.1 })
    }
}

/// The trip on MapKit: the route in the trip's colour (dotted before the trip), flights as grey dashed bows
/// with a small grey airport dot where one starts or ends away from a stop, the stops as numbered dots, and
/// your photos as round thumbnails grouped per zoom level (a tap opens one, a group zooms in).
struct TripMap: View {
    let trip: Trip
    var interactive = false
    var satellite = false
    var position: Binding<MapCameraPosition>?
    var photos: [Media] = []
    /// One day picked on the map: the rest of the trip goes faint under that day's own route and stops.
    var focus: MapFocus? = nil
    var onPhoto: (Media) -> Void = { _ in }
    @Environment(\.colorScheme) private var scheme
    @AppStorage("mapStyle") private var look = MapLook.positron.rawValue
    /// What the camera shows across, to group the photos the way MapLibre's zoom levels would.
    @State private var span: MKCoordinateSpan?
    @State private var width: CGFloat = 400

    var body: some View {
        Group {
            if let position {
                Map(position: position, interactionModes: interactive ? [.pan, .zoom] : []) { content }
            } else {
                Map(initialPosition: .rect(trip.mapRect()), interactionModes: interactive ? [.pan, .zoom] : []) { content }
            }
        }
        .mapStyle(satellite ? MapLook.satellite.style : (MapLook(rawValue: look) ?? .positron).style)
        .mapControlVisibility(.hidden)
        .onMapCameraChange(frequency: .onEnd) { ctx in span = ctx.region.span }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    private var flightGrey: Color { scheme == .dark || satellite ? Color(hex: 0x9AA4B3) : Color(hex: 0x8A94A3) }

    @MapContentBuilder private var content: some MapContent {
        let color = Geo.legible(trip.color, dark: scheme == .dark || satellite)
        let pieces = trip.pieces
        // With one day picked the whole trip stays as a faint guide under that day's own line.
        let faint = focus == nil ? 1.0 : 0.28
        ForEach(Array(pieces.runs.enumerated()), id: \.offset) { _, run in
            MapPolyline(coordinates: run.map(\.coordinate))
                .stroke(color.opacity(faint), style: StrokeStyle(lineWidth: trip.upcoming ? 3 : 4, lineCap: .round, lineJoin: .round, dash: trip.upcoming ? [1, 8] : []))
        }
        ForEach(Array(pieces.gaps.enumerated()), id: \.offset) { _, gap in
            MapPolyline(coordinates: [gap.0.coordinate, gap.1.coordinate])
                .stroke(color.opacity(0.7 * faint), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, dash: [2, 7]))
        }
        // A flight is drawn, not recorded, so it never takes the trip's colour: short grey dashes with clear gaps.
        ForEach(Array(pieces.bows.enumerated()), id: \.offset) { _, bow in
            MapPolyline(coordinates: Geo.flightArc(bow.0, bow.1).map(\.coordinate))
                .stroke(flightGrey.opacity(faint), style: StrokeStyle(lineWidth: 2.2, lineCap: .round, dash: [2.4, 7.5]))
        }
        if let focus {
            ForEach(Array(focus.route.enumerated()), id: \.offset) { _, line in
                MapPolyline(coordinates: line.map(\.coordinate))
                    .stroke(color, style: StrokeStyle(lineWidth: 4.5, lineCap: .round, lineJoin: .round))
            }
        }
        ForEach(Array(pieces.airports.enumerated()), id: \.offset) { _, at in
            Annotation("", coordinate: at.coordinate, anchor: .center) {
                Circle().fill(flightGrey).frame(width: 9, height: 9)
                    .padding(2)
                    .background(scheme == .dark || satellite ? Color.black : Color.white, in: .circle)
            }
            .annotationTitles(.hidden)
        }
        let groups = photoGroups
        ForEach(visibleStops(groups), id: \.number) { item in
            Annotation(item.stop.name, coordinate: item.stop.at.coordinate, anchor: .center) {
                StopDot(number: item.number, color: color, upcoming: trip.upcoming)
            }
            .annotationTitles(interactive ? .automatic : .hidden)
        }
        ForEach(groups, id: \.key) { group in
            Annotation("", coordinate: CLLocationCoordinate2D(latitude: group.first.lat ?? 0, longitude: group.first.lon ?? 0), anchor: .center) {
                PhotoPin(media: group.first, count: group.count, ring: color) { tapped(group) }
            }
            .annotationTitles(.hidden)
        }
    }

    private struct PhotoGroup {
        let key: String
        let first: Media
        let count: Int
    }

    /// Degrees across one photo pin and a little air at the camera's zoom level, rounded the way MapLibre's
    /// levels would be so a small pan or pinch never regroups anything.
    private var pinReach: Double {
        let delta = span?.longitudeDelta ?? trip.mapSpanDegrees
        let level = (log2(360 * Double(width) / (512 * max(delta, 1e-6)))).rounded()
        return 52 * 360 / (512 * pow(2, level))
    }

    private static func mercY(_ lat: Double) -> Double { log(tan(.pi / 4 + max(-85, min(85, lat)) * Geo.rad / 2)) / Geo.rad }

    /// The numbered stops, without the ones a photo pin would cover: a number half under a round photo (and its
    /// count) reads as a mistake, and the photo already marks the place.
    private func visibleStops(_ groups: [PhotoGroup]) -> [(number: Int, stop: Stop)] {
        let all = focus.map { f in trip.mapStops.filter { f.stops.contains($0.stop.name) } } ?? trip.mapStops
        guard !groups.isEmpty else { return all }
        // Half a pin, half a dot and the count badge, in points at the camera's real zoom (not the rounded
        // level of the grouping, which can make a pin count up to twice as wide).
        let delta = span?.longitudeDelta ?? trip.mapSpanDegrees
        let near = 38 * delta / Double(max(width, 1))
        let pins = groups.compactMap { g -> (Double, Double)? in
            guard let lat = g.first.lat, let lon = g.first.lon else { return nil }
            return (lon, TripMap.mercY(lat))
        }
        return all.filter { item in
            let x = item.stop.at.lon, y = TripMap.mercY(item.stop.at.lat)
            return !pins.contains { abs($0.0 - x) < near && abs($0.1 - y) < near }
        }
    }

    /// The photos grouped for the zoom level, the way MapLibre's levels would (rounded, so a small pan or pinch
    /// never regroups them): a photo joins the first group whose pin it would overlap, so the round
    /// thumbnails stand apart instead of piling up.
    private var photoGroups: [PhotoGroup] {
        guard !photos.isEmpty else { return [] }
        let reach = pinReach
        func mercY(_ lat: Double) -> Double { TripMap.mercY(lat) }
        var groups: [(x: Double, y: Double, first: Media, count: Int)] = []
        for m in photos {
            guard let lat = m.lat, let lon = m.lon else { continue }
            let x = lon, y = mercY(lat)
            if let i = groups.firstIndex(where: { abs($0.x - x) < reach && abs($0.y - y) < reach }) {
                groups[i].count += 1
            } else {
                groups.append((x, y, m, 1))
            }
        }
        return groups.map { PhotoGroup(key: $0.first.id, first: $0.first, count: $0.count) }
    }

    private func tapped(_ group: PhotoGroup) {
        Haptic.tap()
        guard group.count > 1, let position, let lat = group.first.lat, let lon = group.first.lon else {
            onPhoto(group.first)
            return
        }
        // A group zooms in to split it.
        let current = span ?? MKCoordinateSpan(latitudeDelta: trip.mapSpanDegrees, longitudeDelta: trip.mapSpanDegrees)
        let k = pow(2, 2.5)
        withAnimation(.smooth(duration: 0.45)) {
            position.wrappedValue = .region(MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                span: MKCoordinateSpan(latitudeDelta: max(current.latitudeDelta / k, 0.004), longitudeDelta: max(current.longitudeDelta / k, 0.004))
            ))
        }
    }
}

/// One day on the map: its own recorded route, and the names of the stops where it was spent.
struct MapFocus: Equatable {
    var route: [[LonLat]]
    var stops: Set<String>
}

/// "Hele reis" or the day the map shows, as on Android: a glass pill on the map, lit in the accent while one day
/// is picked, that unfolds the list of days (a menu shows one line per day, so without the photo counts).
struct MapDayPill: View {
    let days: [(day: Date, photos: Int)]
    @Binding var day: Date?

    private static let weekdays = ["zo", "ma", "di", "wo", "do", "vr", "za"]

    /// "di 7 jul": short enough for the pill, clear in the list.
    static func label(_ d: Date) -> String {
        "\(weekdays[(Format.calendar.component(.weekday, from: d) - 1) % 7]) \(Format.shortDay(d))"
    }

    var body: some View {
        Menu {
            Picker("Dag op de kaart", selection: Binding(get: { day }, set: { v in
                Haptic.select()
                withAnimation(.calm) { day = v }
            })) {
                Text("Hele reis").tag(Date?.none)
                ForEach(days, id: \.day) { d in
                    Text(MapDayPill.label(d.day)).tag(Optional(d.day))
                }
            }
            .pickerStyle(.inline)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "calendar").font(.system(size: 14, weight: .semibold))
                Text(day.map(MapDayPill.label) ?? "Hele reis").font(.outfit(15, 600)).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(day == nil ? Brand.ink : .white)
            .padding(.horizontal, 16)
            .frame(height: 48)
            .contentShape(.capsule)
        }
        .glassEffect(day == nil ? .regular.interactive() : .regular.tint(Brand.accent).interactive(), in: .capsule)
        .animation(.calm, value: day)
        .accessibilityLabel("Dag op de kaart")
    }
}

/// A photo on the map: a round thumbnail with a ring in the trip's colour, and the count on a group.
struct PhotoPin: View {
    let media: Media
    let count: Int
    let ring: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            MediaView(media: media)
                .frame(width: 40, height: 40)
                .clipShape(.circle)
                .padding(3)
                .background(ring, in: .circle)
                .overlay(alignment: .topTrailing) {
                    if count > 1 {
                        Text(count > 99 ? "99+" : "\(count)")
                            .font(.outfit(11, 700))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(ring, in: .capsule)
                            .overlay { Capsule().strokeBorder(.white, lineWidth: 1.5) }
                            .offset(x: 8, y: -6)
                    }
                }
        }
        .buttonStyle(PressStyle(scale: 0.92))
        .accessibilityLabel(count > 1 ? "\(count) foto's, inzoomen" : "Foto openen")
    }
}

/// A numbered dot for a stop: the trip's colour with a white ring.
struct StopDot: View {
    let number: Int
    let color: Color
    var upcoming = false

    var body: some View {
        Text("\(number)")
            .font(.outfit(11, 700))
            .foregroundStyle(.white)
            .frame(width: 20, height: 20)
            .background(color, in: .circle)
            .padding(2)
            .background(.white, in: .circle)
    }
}

extension Trip {
    /// Each place once, numbered by its first visit.
    var mapStops: [(number: Int, stop: Stop)] {
        var seen = Set<String>()
        var out: [(Int, Stop)] = []
        for (i, s) in stops.enumerated() where seen.insert(s.name).inserted { out.append((i + 1, s)) }
        return out
    }

    /// What frames the map, as Android's framePoints: the trip itself decides the view. With two stops or more the
    /// stops alone (the recorded route usually starts and ends at home, the drive to the airport, which pulled
    /// Amsterdam in and left Morocco small in a corner); otherwise the stops and the route, and only a trip that is
    /// nothing but flights is framed by its bows.
    private var mapPoints: [LonLat] {
        let at = stops.map(\.at)
        let own = at.count >= 2 ? at : at + route
        if own.count >= 2 { return own }
        return own + pieces.bows.flatMap { Geo.flightArc($0.0, $0.1, steps: 12) }
    }

    /// The part of the world the trip covers, with room on every side; `bottomRoom` adds a share of the height at
    /// the bottom for what laps over the map there.
    func mapRect(bottomRoom: Double = 0) -> MKMapRect {
        let points = mapPoints.map { MKMapPoint($0.coordinate) }
        guard let first = points.first else { return MKMapRect.world }
        var rect = MKMapRect(origin: first, size: MKMapSize(width: 0, height: 0))
        for p in points.dropFirst() { rect = rect.union(MKMapRect(origin: p, size: MKMapSize(width: 0, height: 0))) }
        // A city trip still shows its surroundings: at least about 40 km across.
        let minSide = 40_000 * MKMapPointsPerMeterAtLatitude(first.coordinate.latitude)
        let w = max(rect.size.width, minSide) * 1.5
        let h = max(rect.size.height, minSide) * 1.5
        return MKMapRect(x: rect.midX - w / 2, y: rect.midY - h / 2, width: w, height: h * (1 + bottomRoom))
    }

    /// The whole view's rect for a map of `size`, so the trip sits exactly inside the part left free by
    /// `insets` (the floating bar on top, the sheet's edge below), with a little air on every side.
    func fittedRect(size: CGSize, insets: EdgeInsets) -> MKMapRect {
        guard !mapPoints.isEmpty, size.width > 0, size.height > 0 else { return mapRect() }
        return Trip.fitted(mapPoints, size: size, insets: insets)
    }

    /// Any set of places fitted the same way, e.g. one day's route; `minMeters` keeps a small spread from
    /// zooming in to the street.
    static func fitted(_ places: [LonLat], size: CGSize, insets: EdgeInsets, minMeters: Double = 40_000) -> MKMapRect {
        let points = places.map { MKMapPoint($0.coordinate) }
        guard let first = points.first, size.width > 0, size.height > 0 else { return .world }
        var rect = MKMapRect(origin: first, size: MKMapSize(width: 0, height: 0))
        for p in points.dropFirst() { rect = rect.union(MKMapRect(origin: p, size: MKMapSize(width: 0, height: 0))) }
        // A city trip still shows its surroundings: at least about 40 km across.
        let minSide = minMeters * MKMapPointsPerMeterAtLatitude(first.coordinate.latitude)
        let rw = max(rect.size.width, minSide), rh = max(rect.size.height, minSide)
        let innerW = max(40, size.width - insets.leading - insets.trailing)
        let innerH = max(40, size.height - insets.top - insets.bottom)
        let scale = max(rw / innerW, rh / innerH)
        let innerMidX = insets.leading + innerW / 2, innerMidY = insets.top + innerH / 2
        return MKMapRect(
            x: rect.midX - innerMidX * scale, y: rect.midY - innerMidY * scale,
            width: size.width * scale, height: size.height * scale
        )
    }

    /// Roughly how many degrees the opening map shows across, before the camera has reported.
    var mapSpanDegrees: Double {
        let r = mapRect()
        return max(0.05, r.size.width / MKMapSize.world.width * 360)
    }
}

/// The map full screen: moving and zooming, map or satellite in one glass capsule, close in the corner.
struct FullMapView: View {
    let trip: Trip
    var photos: [Media] = []
    var focus: MapFocus? = nil
    var days: [(day: Date, photos: Int)] = []
    var day: Binding<Date?>? = nil
    var onPhoto: (Media) -> Void = { _ in }
    @State private var satellite = false
    @State private var position: MapCameraPosition
    @State private var size: CGSize = .zero
    private static let insets = EdgeInsets(top: 130, leading: 36, bottom: 70, trailing: 36)
    @Environment(\.dismiss) private var dismiss
    @Namespace private var glass

    init(trip: Trip, photos: [Media] = [], focus: MapFocus? = nil, days: [(day: Date, photos: Int)] = [], day: Binding<Date?>? = nil,
         onPhoto: @escaping (Media) -> Void = { _ in }) {
        self.trip = trip
        self.photos = photos
        self.focus = focus
        self.days = days
        self.day = day
        self.onPhoto = onPhoto
        _position = State(initialValue: .rect(trip.mapRect()))
    }

    /// The whole trip, or the day on show.
    private var frame: MKMapRect {
        guard let d = day?.wrappedValue, let focus else { return trip.fittedRect(size: size, insets: FullMapView.insets) }
        return Trip.fitted(TripView.focusPoints(trip, day: d, route: focus.route, photos: photos), size: size, insets: FullMapView.insets, minMeters: 8000)
    }

    var body: some View {
        TripMap(trip: trip, interactive: true, satellite: satellite, position: $position, photos: photos, focus: focus, onPhoto: onPhoto)
            .ignoresSafeArea()
            .onGeometryChange(for: CGSize.self) { $0.size } action: { new in
                guard new != size else { return }
                size = new
                position = .rect(frame)
            }
            .onChange(of: focus) { withAnimation(.smooth(duration: 0.5)) { position = .rect(frame) } }
            .overlay(alignment: .bottomLeading) {
                if let day, days.count >= 2 {
                    MapDayPill(days: days, day: day)
                        .padding(.leading, 16)
                        .padding(.bottom, 8)
                }
            }
            .overlay(alignment: .top) {
                HStack(alignment: .top) {
                    GlassEffectContainer(spacing: 8) {
                        HStack(spacing: 8) {
                            HStack(spacing: 0) {
                                styleButton("Kaart", symbol: "map", on: !satellite) { satellite = false }
                                styleButton("Satelliet", symbol: "globe.europe.africa", on: satellite) { satellite = true }
                            }
                            .padding(3)
                            .glassEffect(.regular.interactive(), in: .capsule)

                            Button {
                                Haptic.tap()
                                withAnimation(.smooth) { position = .rect(frame) }
                            } label: {
                                Image(systemName: "scope").font(.system(size: 17, weight: .semibold)).frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                            .glassEffect(.regular.interactive(), in: .circle)
                            .accessibilityLabel("Hele reis tonen")
                        }
                    }
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 17, weight: .semibold)).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Sluiten")
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
            }
    }

    private func styleButton(_ label: String, symbol: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(.calm) { action() }
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 44, height: 38)
                .background {
                    if on { Capsule().fill(Color.primary.opacity(0.12)).matchedGeometryEffect(id: "on", in: glass) }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
