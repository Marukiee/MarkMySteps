import SwiftUI

/// Reizen: the globe with every trip on it, the next trip, then the past ones by year.
struct HomeView: View {
    var onAvatar: () -> Void
    /// Bumped when Reizen is chosen again from another tab: the page starts at the top.
    var resetToken = 0
    @Environment(Store.self) private var store
    @State private var path: [String] = {
        guard let page = Launch.page, ["trip", "planner", "people"].contains(page) else { return [] }
        let fallback = page == "planner" ? "georgia" : "iceland"
        return [Store.shared.trip(for: Launch.trip ?? fallback, upcoming: page == "planner")?.id].compactMap { $0 }
    }()
    @State private var tab = 0
    @State private var readOnly = false
    /// Just the status bar: the globe runs up under it, the logo floats below it.
    @State private var topInset: CGFloat = 62
    @State private var scrolled = false
    @Namespace private var zoom

    var body: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        hero.id("top")
                        content.padding(.horizontal, 16)
                    }
                }
                .scrollIndicators(.hidden)
                .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { if $0 > 0 { topInset = $0 } }
                .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y + $0.contentInsets.top > 40 } action: { _, v in
                    withAnimation(.easeOut(duration: 0.2)) { scrolled = v }
                }
                .ignoresSafeArea(.container, edges: .top)
                .background(Brand.paper)
                // Behind the clock and the battery once the page scrolls under them; no bar otherwise.
                .overlay(alignment: .top) {
                    LinearGradient(stops: [.init(color: Brand.paper, location: 0), .init(color: Brand.paper, location: 0.7), .init(color: Brand.paper.opacity(0), location: 1)], startPoint: .top, endPoint: .bottom)
                        .frame(height: topInset + 14)
                        .ignoresSafeArea(.container, edges: .top)
                        .opacity(scrolled ? 1 : 0)
                        .allowsHitTesting(false)
                }
                .onAppear {
                    guard Launch.page == "trips" || Launch.page == nil, let anchor = Launch.scroll else { return }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { proxy.scrollTo(anchor, anchor: UnitPoint(x: 0.5, y: 0.13)) }
                }
                .onChange(of: resetToken) {
                    guard path.isEmpty else { return }
                    proxy.scrollTo("top", anchor: .top)
                }
            }
            .navigationTitle("Reizen")
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                if let trip = store.trips.first(where: { $0.id == id }) {
                    TripView(base: trip)
                        .navigationTransition(.zoom(sourceID: id, in: zoom))
                }
            }
            .alert("Alleen lezen", isPresented: $readOnly) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Deze testapp verandert niets aan je reizen. Een nieuwe reis maak je in de web-app.")
            }
        }
    }

    /// The globe edge to edge, up under the status bar, with the logo and your face floating on it.
    private var hero: some View {
        // Guest trips stay off the globe, as on the web.
        GlobeHero(trips: store.live ? store.own : store.trips, onOpen: { path.append($0) }) { zoom in
            HStack(spacing: 8) {
                // The compass needle turns with the globe's zoom, as on the web: (scale - 1) x 660 degrees.
                CompassLogo(size: 34, needle: Double(zoom - 1) * 660)
                Text("MarkMySteps").font(.outfit(23, 620)).tracking(-0.4).foregroundStyle(Brand.ink)
                Spacer()
                Button(action: onAvatar) { profileFace }
                    .buttonStyle(PressStyle(scale: 0.92))
                    .accessibilityLabel("Account en instellingen")
            }
            .padding(.horizontal, 16)
            .padding(.top, topInset + 4)
        }
        .frame(height: topInset + 360)
        .frame(maxWidth: .infinity)
        .overlay(alignment: .bottom) {
            LinearGradient(stops: [.init(color: Brand.paper.opacity(0), location: 0), .init(color: Brand.paper, location: 0.85)], startPoint: .top, endPoint: .bottom)
                .frame(height: 120)
                .allowsHitTesting(false)
        }
    }

    /// Your real photo in a plain circle; without one, your initial on a quiet disc.
    private var profileFace: some View {
        let name = store.me?.name.isEmpty == false ? store.me!.name : "Mark"
        return Avatar(userId: store.me?.id, hasAvatar: store.me?.hasAvatar ?? false, initial: String(name.prefix(1)),
                      color: Brand.raised, ink: Brand.accent, size: 42)
    }

    @ViewBuilder private var content: some View {
        if let error = store.error {
            // A failed reload says so, with a way to try again; the last trips stay on screen.
            HStack(spacing: 10) {
                Image(systemName: "wifi.exclamationmark").foregroundStyle(Brand.inkSoft)
                Text(error).font(.inter(14, 500)).foregroundStyle(Brand.ink).lineLimit(2)
                Spacer(minLength: 6)
                Button("Opnieuw") { Task { await store.load() } }
                    .font(.inter(14, 600))
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
            }
            .padding(12)
            .background(Brand.raised, in: .rect(cornerRadius: 18))
            .padding(.bottom, 12)
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
        HStack(alignment: .center) {
            Text("Reizen").font(.outfit(32, 650)).tracking(-0.6).foregroundStyle(Brand.ink)
            Spacer()
            Button { readOnly = true } label: {
                Label("Nieuwe reis", systemImage: "plus").font(.outfit(15, 600))
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(.top, 4)
        .arrive(0)

        let coming = store.coming
        if !coming.isEmpty {
            SectionTitle(text: "Aankomend & onderweg").padding(.top, 22).padding(.bottom, 12).arrive(1)
            VStack(spacing: 12) {
                ForEach(Array(coming.enumerated()), id: \.element.id) { i, trip in
                    NavigationLink(value: trip.id) {
                        NextTripCard(trip: trip) { menu(for: trip) }
                    }
                    .buttonStyle(PressStyle())
                    .matchedTransitionSource(id: trip.id, in: zoom) { $0.clipShape(.rect(cornerRadius: 30)) }
                    .arrive(2 + i)
                }
            }
        }

        Picker("Welke reizen", selection: $tab.animation(.snappy)) {
            Text("Afgelopen reizen  \(store.past.count)").tag(0)
            Text("Gedeeld  \(store.shared)").tag(1)
        }
        .pickerStyle(.segmented)
        .controlSize(.large)
        .padding(.top, 26)
        .arrive(3)

        Group {
            if tab == 0 { pastTrips } else { sharedTrips }
        }
        .transition(.opacity.combined(with: .offset(y: 12)))
        .padding(.bottom, 24)
    }

    @ViewBuilder private var pastTrips: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let first = store.past.first {
                NavigationLink(value: first.id) {
                    BigTripCard(trip: first) { menu(for: first) }
                }
                .buttonStyle(PressStyle())
                .matchedTransitionSource(id: first.id, in: zoom) { $0.clipShape(.rect(cornerRadius: 30)) }
                .padding(.top, 14)
                .arrive(4)
            }
            let rest = Array(store.past.dropFirst())
            let years = rest.map(\.year).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
            ForEach(Array(years.enumerated()), id: \.element) { i, year in
                SectionTitle(text: year, small: true).padding(.top, 20).padding(.bottom, 8).padding(.leading, 4)
                    .id(i == 0 ? "years" : year)
                TripGroup(trips: rest.filter { $0.year == year }, zoom: zoom, menu: menu(for:))
                    .arrive(5 + i)
            }
        }
    }

    @ViewBuilder private var sharedTrips: some View {
        let shared = store.sharedTrips
        if shared.isEmpty {
            Text("Nog niets met je gedeeld. Een reis die iemand met je deelt, staat hier vanzelf.")
                .font(.inter(15, 500))
                .foregroundStyle(Brand.inkSoft)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(Brand.raised, in: .rect(cornerRadius: 22))
                .padding(.top, 14)
        } else {
            TripGroup(trips: shared, zoom: zoom, menu: menu(for:)).padding(.top, 14)
        }
    }

    /// The trip menu: what this read-only test can do, and the rest greyed out with the reason.
    @ViewBuilder private func menu(for trip: Trip) -> some View {
        Menu {
            Button("Openen", systemImage: "arrow.up.forward.circle") { path.append(trip.id) }
            Section("Deze testapp leest alleen") {
                Button("Bewerken", systemImage: "pencil") {}.disabled(true)
                Button("Delen", systemImage: "person.badge.plus") {}.disabled(true)
                Button("Verwijderen", systemImage: "trash", role: .destructive) {}.disabled(true)
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 30, height: 30)
                .contentShape(.circle)
        }
        .accessibilityLabel("Meer voor \(trip.title)")
    }
}

struct SectionTitle: View {
    let text: String
    var small = false
    var body: some View {
        Text(text)
            .font(.outfit(small ? 15 : 21, 600))
            .tracking(small ? 0 : -0.2)
            .foregroundStyle(small ? Brand.inkSoft : Brand.ink)
    }
}

/// A trip under way: "onderweg" in green with a dot whose ring grows and fades every 1.8 s.
struct OngoingPill: View {
    var text = "onderweg"
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color(hex: 0x0A7D55))
                .frame(width: 7, height: 7)
                .background {
                    Circle()
                        .stroke(Color(hex: 0x0A7D55).opacity(pulse ? 0 : 0.5), lineWidth: pulse ? 1 : 3)
                        .frame(width: pulse ? 19 : 7, height: pulse ? 19 : 7)
                }
            Text(text).font(.inter(12.5, 650)).foregroundStyle(Color(hex: 0x0A7D55))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.white.opacity(0.94), in: .capsule)
        .onAppear {
            guard !Launch.shot else { return }
            withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) { pulse = true }
        }
    }
}

/// White text on a soft white capsule, for cards with colour or a photo behind them.
struct CardChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.inter(12.5, 600))
            .foregroundStyle(.white)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(.white.opacity(0.18), in: .capsule)
    }
}

/// The people of a trip as overlapping faces, their real photos when they have one,
/// two faces and then "+n" for the rest.
struct FaceStack: View {
    let people: [Person]
    let extra: Int
    var ring: Color
    var size: CGFloat = 32
    var max = 2
    var extraFill: Color = .white.opacity(0.92)
    var extraInk: Color = Color(hex: 0x1B2530)

    var body: some View {
        let faces = Array(people.prefix(max))
        let rest = Swift.max(0, people.count - faces.count) + extra
        HStack(spacing: -size * 0.34) {
            ForEach(Array(faces.enumerated()), id: \.offset) { _, p in
                Avatar(userId: p.userId, hasAvatar: p.hasAvatar, initial: p.initial, color: p.color, size: size - 4)
                    .padding(2)
                    .background(ring, in: .circle)
            }
            if rest > 0 {
                Text("+\(rest)")
                    .font(.outfit(size * 0.36, 700))
                    .foregroundStyle(extraInk)
                    .frame(width: size - 4, height: size - 4)
                    .background(extraFill, in: .circle)
                    .padding(2)
                    .background(ring, in: .circle)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(people.count + extra) reizigers")
    }
}

/// The ellipsis menu on a card with colour or a photo behind it: real glass, floating on the picture.
struct CardMenu<M: View>: View {
    @ViewBuilder let menu: M
    var body: some View {
        menu
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .glassEffect(.regular.interactive(), in: .circle)
    }
}

/// The next trip: its colour edge to edge, the days left as a big number.
struct NextTripCard<M: View>: View {
    let trip: Trip
    @ViewBuilder let menu: M

    var body: some View {
        let deep = trip.color.mix(with: Color(hex: 0x1B2440), by: 0.55)
        ZStack(alignment: .topLeading) {
            if trip.coverId != nil {
                // A real cover photo behind the countdown, darkened so the white reads.
                CoverView(trip: trip, size: "preview")
                LinearGradient(colors: [.black.opacity(0.25), .black.opacity(0.6)], startPoint: .top, endPoint: .bottom)
            } else {
                LinearGradient(colors: [trip.color, deep], startPoint: .topLeading, endPoint: .bottomTrailing)
                CompassLogo(size: 170, color: .white, lineWidth: 1.3)
                    .rotationEffect(.degrees(-12))
                    .opacity(0.16)
                    .offset(x: 46, y: -22)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            }
            VStack(alignment: .leading, spacing: 0) {
                // Before the trip the days left; during it, which day of how many: "3e dag van 8".
                let left = trip.startsInDays
                let today = min(max((trip.start ?? trip.firstDay).map { (Format.calendar.dateComponents([.day], from: $0, to: Date()).day ?? 0) + 1 } ?? 1, 1), trip.days)
                HStack(alignment: .lastTextBaseline, spacing: 10) {
                    Text(left.map { "\($0)" } ?? "\(today)e")
                        .font(.outfit(60, 800))
                        .tracking(-1.8)
                        .foregroundStyle(.white)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(left == 1 || left == nil ? "dag" : "dagen").font(.outfit(17, 600)).foregroundStyle(.white)
                        Text(left == nil ? "van \(trip.days)" : "tot vertrek").font(.inter(13, 500)).foregroundStyle(.white.opacity(0.8))
                    }
                }
                Text(trip.title)
                    .font(.outfit(25, 600))
                    .tracking(-0.4)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .padding(.top, 22)
                HStack(spacing: 6) {
                    if trip.startsInDays == nil { OngoingPill() }
                    CardChip(text: "\(Format.shortMonth(trip.month)) \(trip.year)")
                    CardChip(text: "\(trip.days) dagen")
                    Spacer(minLength: 8)
                    FaceStack(people: trip.people, extra: trip.extraPeople, ring: trip.coverId != nil ? .black.opacity(0.35) : deep)
                }
                .padding(.top, 10)
            }
            .padding(20)
            CardMenu { menu }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .topTrailing)
        }
        .clipShape(.rect(cornerRadius: 30))
        .contentShape(.rect(cornerRadius: 30))
    }
}

/// A trip shown big: its photo edge to edge, the name and facts on it.
struct BigTripCard<M: View>: View {
    let trip: Trip
    @ViewBuilder let menu: M

    var body: some View {
        Color.clear
            .aspectRatio(16 / 11, contentMode: .fit)
            .overlay { CoverView(trip: trip, size: "preview") }
            .overlay {
                LinearGradient(stops: [.init(color: .clear, location: 0.35), .init(color: Color(hex: 0x10151B, alpha: 0.75), location: 1)], startPoint: .top, endPoint: .bottom)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(trip.title).font(.outfit(26, 600)).tracking(-0.4).foregroundStyle(.white).lineLimit(2)
                    HStack(spacing: 6) {
                        CardChip(text: "\(Format.shortMonth(trip.month)) \(trip.year)")
                        CardChip(text: "\(trip.days) dagen")
                        if let km = trip.km { CardChip(text: Format.km(km)) }
                        Spacer(minLength: 8)
                        FaceStack(people: trip.people, extra: trip.extraPeople, ring: Color(hex: 0x2A2F36))
                    }
                }
                .padding(20)
            }
            .overlay(alignment: .topTrailing) { CardMenu { menu }.padding(12) }
            .clipShape(.rect(cornerRadius: 30))
            .contentShape(.rect(cornerRadius: 30))
    }
}

/// A year's trips as one grouped card of rows, as iOS lists them.
struct TripGroup<M: View>: View {
    let trips: [Trip]
    let zoom: Namespace.ID
    let menu: (Trip) -> M

    var body: some View {
        // One slab of rows: outer corners round, inner ones tight, each row in its cover's tone.
        VStack(spacing: 3) {
            ForEach(Array(trips.enumerated()), id: \.element.id) { i, trip in
                CoverTone(trip: trip) { tone in
                    HStack(spacing: 0) {
                        NavigationLink(value: trip.id) {
                            HStack(spacing: 14) {
                                CoverView(trip: trip)
                                    .frame(width: 60, height: 60)
                                    .clipShape(.rect(cornerRadius: 14))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(trip.title).font(.outfit(17, 600)).foregroundStyle(Brand.ink).lineLimit(1)
                                    Text(subtitle(trip)).font(.inter(13, 500)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 10)
                            .padding(.leading, 10)
                            .contentShape(.rect)
                        }
                        .buttonStyle(PressStyle(scale: 0.98))
                        .matchedTransitionSource(id: trip.id, in: zoom) { $0.clipShape(.rect(cornerRadius: 14)) }
                        menu(trip)
                            .foregroundStyle(Brand.inkSoft)
                            .frame(width: 44, height: 44)
                            .padding(.trailing, 6)
                    }
                    .background { ZStack { Brand.raised; tone.opacity(0.16) } }
                    .clipShape(UnevenRoundedRectangle(
                        topLeadingRadius: i == 0 ? 22 : 6, bottomLeadingRadius: i == trips.count - 1 ? 22 : 6,
                        bottomTrailingRadius: i == trips.count - 1 ? 22 : 6, topTrailingRadius: i == 0 ? 22 : 6
                    ))
                }
            }
        }
    }

    private func subtitle(_ trip: Trip) -> String {
        // Short month, so the line fits beside the menu without being cut off.
        var parts = ["\(Format.shortMonth(trip.month)) \(trip.year)", "\(trip.days) dagen"]
        if let km = trip.km { parts.append(Format.km(km)) }
        return parts.joined(separator: " · ")
    }
}
