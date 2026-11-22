import MapKit
import SwiftUI

/// A trip, opened: the map, the name and facts, then Tijdlijn or Routeplanner.
/// The whole page is one List, so the planner's swipe and reorder are the system's own.
struct TripView: View {
    let base: Trip
    @Environment(Store.self) private var store
    @State private var trip: Trip
    @State private var media: [Media]?
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
    @State private var pastMap = false
    @State private var saver = PlanSaver()
    @Namespace private var ns

    enum TripTab: Hashable { case timeline, planner }

    init(base: Trip) {
        self.base = base
        _trip = State(initialValue: base)
        _tab = State(initialValue: Launch.page == "planner" ? .planner : .timeline)
        _plan = State(initialValue: PlanState(trip: base))
    }

    var body: some View {
        ScrollViewReader { proxy in
            let days = Timeline.days(trip, media)
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
                        FactsRow(trip: trip, photos: media?.count, tone: tone)
                    }
                }
                .plainRow(top: 16)

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
                    TimelineRows(trip: trip, media: media, days: days, ns: ns, hidden: nil) { item in
                        viewerCurrent = item.start.id
                        viewer = item
                    } onPlace: { name in
                        // A place tile goes to the first day spent there.
                        if let i = days.firstIndex(where: { $0.day.stop?.name == name }) {
                            withAnimation(.smooth) { proxy.scrollTo(i == 0 ? "days" : "day\(i)", anchor: UnitPoint(x: 0.5, y: 0.12)) }
                        }
                    }
                case .planner:
                    PlannerRows(trip: trip, plan: $plan, onFocusAdd: {
                        // Lift the field and its suggestions above the keyboard.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            withAnimation(.smooth) { proxy.scrollTo("add", anchor: .bottom) }
                        }
                    }, saver: saver)
                }

                Color.clear.frame(height: 28).plainRow()
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 0)
            .background(Brand.paper)
            .ignoresSafeArea(.container, edges: .top)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { pageHeight = $0 }
            // While the viewer pages, the timeline behind it keeps that photo in view.
            .onChange(of: viewerCurrent) {
                guard viewer != nil, let m = days.flatMap(\.photos).first(where: { $0.id == viewerCurrent }),
                      let row = Timeline.rowId(m, in: days) else { return }
                proxy.scrollTo(row, anchor: .center)
            }
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top > 300
            } action: { _, shown in
                withAnimation(.easeOut(duration: 0.2)) { titleShown = shown }
            }
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top > max(340, pageHeight * 0.5) + 80
            } action: { _, past in
                withAnimation(.calm) { pastMap = past }
            }
            .overlay(alignment: .bottomTrailing) {
                // Back to the top once the map has scrolled away.
                if pastMap && plan.pending == nil {
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
                        Text("\(pending.stop.name) verwijderd").font(.inter(15, 550)).foregroundStyle(Brand.ink).lineLimit(1)
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
            // Three round glass buttons as on the web: people, the map's style, the trip's settings.
            // They carry the label colour, like the back chevron; the accent is for primary actions.
            ToolbarItem(placement: .topBarTrailing) {
                Button { showPeople = true } label: { Image(systemName: "person.2") }
                    .tint(.primary).accessibilityLabel("Mensen en delen")
            }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItem(placement: .topBarTrailing) {
                Button { showMapStyle = true } label: { Image(systemName: "map") }
                    .tint(.primary).accessibilityLabel("Kaart")
            }
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings = true } label: { Image(systemName: "slider.horizontal.3") }
                    .tint(.primary).accessibilityLabel("Reisinstellingen")
            }
        }
        .sheet(isPresented: $showPeople) { PeopleSheet(trip: trip) }
        .sheet(isPresented: $showMapStyle) { MapStyleSheet() }
        .sheet(isPresented: $showSettings) { TripSettingsSheet(trip: trip) }
        .fullScreenCover(isPresented: $showMap) {
            FullMapView(trip: trip)
                .navigationTransition(.zoom(sourceID: "map", in: ns))
        }
        .fullScreenCover(item: $viewer) { item in
            PhotoViewer(item: item, current: $viewerCurrent)
                .navigationTransition(.zoom(sourceID: viewerCurrent, in: ns))
        }
        .task(id: "\(base.id)/\(store.version)") { await loadMore() }
        .onAppear {
            if Launch.photo, viewer == nil, let first = trip.demoDays.first {
                let photos = Demo.media(trip, day: 0, date: first.date)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { viewerCurrent = photos[0].id; viewer = ViewerItem(trip: trip, photos: photos, start: photos[0]) }
            }
        }
    }

    private var mapHeader: some View {
        TripMap(trip: trip)
            // The camera frames the trip below the floating bar, not under it.
            .safeAreaPadding(.top, 100)
            .safeAreaPadding(.bottom, 40)
            .safeAreaPadding(.horizontal, 24)
            .frame(height: max(340, pageHeight * 0.5))
            .overlay { Color.clear.contentShape(.rect).onTapGesture { showMap = true } }
            .overlay(alignment: .bottomTrailing) {
                Button { showMap = true } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(.large)
                .tint(.primary)
                .padding(12)
                .accessibilityLabel("Kaart vergroten")
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
        }
        media = (try? await Remote.media(base)) ?? []
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

/// Days, distance, stops and photos, joined to the cover above in the trip's tone;
/// before a trip, the days left and who comes. No distance is no tile, never "0 km".
struct FactsRow: View {
    let trip: Trip
    var photos: Int?
    var tone: Color? = nil
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let stops = trip.stops.count
        var items: [(String, String)] = []
        if trip.upcoming {
            if let d = trip.startsInDays { items.append(("\(d)", d == 1 ? "dag tot vertrek" : "dagen tot vertrek")) }
            let travellers = trip.remoteId != nil ? trip.people.count + 1 : trip.people.count + trip.extraPeople
            items += [("\(trip.days)", "dagen"), ("\(stops)", stops == 1 ? "stop" : "stops"), ("\(travellers)", travellers == 1 ? "reiziger" : "reizigers")]
        } else {
            if let km = trip.km, km > 0 { items.append((Format.number(km), "kilometer")) }
            items += [("\(trip.days)", "dagen"), ("\(stops)", stops == 1 ? "stop" : "stops"), (Format.number(photos ?? trip.photos), "foto's")]
        }
        let tile = (tone ?? trip.color).opacity(scheme == .dark ? 0.34 : 0.24)
        return HStack(spacing: 4) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.0)
                        .font(.outfit(21, 700))
                        .tracking(-0.4)
                        .foregroundStyle(Brand.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .contentTransition(.numericText())
                    Text(item.1).font(.inter(12, 500)).foregroundStyle(Brand.inkSoft).lineLimit(2)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .padding(12)
                .background { ZStack { Brand.raised; tile } }
                .clipShape(UnevenRoundedRectangle(
                    topLeadingRadius: 6, bottomLeadingRadius: i == 0 ? 22 : 6,
                    bottomTrailingRadius: i == items.count - 1 ? 22 : 6, topTrailingRadius: 6
                ))
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// The trip on MapKit: the route in the trip's colour (dotted before the trip),
/// flights as grey geodesic arcs, the stops as numbered dots.
struct TripMap: View {
    let trip: Trip
    var interactive = false
    var satellite = false
    var position: Binding<MapCameraPosition>?
    @Environment(\.colorScheme) private var scheme
    @AppStorage("mapStyle") private var look = MapLook.positron.rawValue

    var body: some View {
        Group {
            if let position {
                Map(position: position, interactionModes: interactive ? .all : []) { content }
            } else {
                Map(initialPosition: .rect(trip.mapRect()), interactionModes: interactive ? .all : []) { content }
            }
        }
        .mapStyle(satellite ? MapLook.satellite.style : (MapLook(rawValue: look) ?? .positron).style)
        .mapControlVisibility(.hidden)
    }

    @MapContentBuilder private var content: some MapContent {
        let color = Geo.legible(trip.color, dark: scheme == .dark || satellite)
        let pieces = trip.pieces
        ForEach(Array(pieces.runs.enumerated()), id: \.offset) { _, run in
            MapPolyline(coordinates: run.map(\.coordinate))
                .stroke(color, style: StrokeStyle(lineWidth: trip.upcoming ? 3 : 4, lineCap: .round, lineJoin: .round, dash: trip.upcoming ? [1, 8] : []))
        }
        ForEach(Array(pieces.gaps.enumerated()), id: \.offset) { _, gap in
            MapPolyline(coordinates: [gap.0.coordinate, gap.1.coordinate])
                .stroke(color.opacity(0.7), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, dash: [2, 7]))
        }
        ForEach(Array(pieces.bows.enumerated()), id: \.offset) { _, bow in
            MapPolyline(coordinates: Geo.flightArc(bow.0, bow.1).map(\.coordinate))
                .stroke(Color.gray.opacity(0.85), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [3, 6]))
        }
        ForEach(trip.mapStops, id: \.number) { item in
            Annotation(item.stop.name, coordinate: item.stop.at.coordinate, anchor: .center) {
                StopDot(number: item.number, color: color, upcoming: trip.upcoming)
            }
            .annotationTitles(interactive ? .automatic : .hidden)
        }
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

    /// The part of the world the trip covers, with room around it.
    func mapRect() -> MKMapRect {
        let points = (stops.isEmpty ? route : stops.map(\.at)).map { MKMapPoint($0.coordinate) }
        guard let first = points.first else { return MKMapRect.world }
        var rect = MKMapRect(origin: first, size: MKMapSize(width: 0, height: 0))
        for p in points.dropFirst() { rect = rect.union(MKMapRect(origin: p, size: MKMapSize(width: 0, height: 0))) }
        // A city trip still shows its surroundings: at least about 40 km across.
        let minSide = 40_000 * MKMapPointsPerMeterAtLatitude(first.coordinate.latitude)
        let w = max(rect.size.width, minSide) * 1.35
        let h = max(rect.size.height, minSide) * 1.35
        return MKMapRect(x: rect.midX - w / 2, y: rect.midY - h / 2, width: w, height: h)
    }
}

/// The map full screen: moving and zooming, map or satellite in one glass capsule, close in the corner.
struct FullMapView: View {
    let trip: Trip
    @State private var satellite = false
    @State private var position: MapCameraPosition
    @Environment(\.dismiss) private var dismiss
    @Namespace private var glass

    init(trip: Trip) {
        self.trip = trip
        _position = State(initialValue: .rect(trip.mapRect()))
    }

    var body: some View {
        TripMap(trip: trip, interactive: true, satellite: satellite, position: $position)
            .ignoresSafeArea()
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
                                withAnimation(.smooth) { position = .rect(trip.mapRect()) }
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
