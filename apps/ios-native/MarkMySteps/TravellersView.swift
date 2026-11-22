import SwiftUI

/*
 * Reizigers, as in the web app: your own figures first (they are why you open
 * the page), the countries you have been to, then the people on your trips.
 */

struct TravellersView: View {
    /// Bumped when another tab is chosen: next time the page opens at its top, the bell in view.
    var resetToken = 0
    var onOpenRequests: () -> Void = {}
    @Environment(Store.self) private var store
    @State private var path: NavigationPath = {
        var p = NavigationPath()
        if let f = Launch.friend.flatMap({ h in Demo.friends.first { $0.handle == h } }) { p.append(f) }
        return p
    }()
    @State private var requests = Launch.page == "notices"
    @State private var unread = 0
    @Namespace private var zoom

    var body: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        profile.arrive(0).id("top")
                        stats.padding(.top, 14)
                        countries
                        people
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .onAppear {
                    guard Launch.page == "travellers", let anchor = Launch.scroll else { return }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { proxy.scrollTo(anchor, anchor: UnitPoint(x: 0.5, y: 0.13)) }
                }
                .onChange(of: resetToken) {
                    // Out of sight: back to the list and its top without any animation. Coming back from a
                    // companion's page within the tab keeps the place, as that never bumps the token.
                    var quiet = Transaction()
                    quiet.disablesAnimations = true
                    withTransaction(quiet) {
                        path = NavigationPath()
                        requests = false
                        proxy.scrollTo("top", anchor: .top)
                    }
                }
            }
            .background(Brand.paper)
            .navigationTitle("Reizigers")
            .toolbar {
                // Requests to join a trip and invitations land here, where the people are.
                ToolbarItem(placement: .topBarTrailing) {
                    // The dot only when there really is something new.
                    let dot = store.live ? unread > 0 : true
                    Button { Haptic.tap(); requests = true } label: {
                        Image(systemName: dot ? "bell.badge" : "bell")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(Brand.accent, Brand.ink)
                    }
                    .tint(.primary)
                    .accessibilityLabel(dot ? "Meldingen, iets nieuws" : "Meldingen")
                    // A floating panel out of the bell's corner, not a sheet from the bottom.
                    .popover(isPresented: $requests, arrowEdge: .top) {
                        NoticesPanel(
                            demo: !store.live,
                            onChanged: { unread = 0 },
                            onOpenTrip: { id in
                                requests = false
                                if let trip = store.trips.first(where: { $0.id == id || $0.remoteId == id }) {
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { path.append(trip.id) }
                                }
                            },
                            onOpenRequests: {
                                requests = false
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { onOpenRequests() }
                            }
                        )
                        .presentationCompactAdaptation(.popover)
                    }
                }
            }
            .task(id: store.live) {
                if store.live { unread = (try? await Remote.noticeCount()) ?? 0 }
            }
            .navigationDestination(for: Demo.Friend.self) { FriendView(friend: $0, zoom: zoom) }
            .navigationDestination(for: Remote.Friend.self) { CompanionView(friend: $0) }
            .navigationDestination(for: String.self) { id in
                if let trip = store.trips.first(where: { $0.id == id }) {
                    TripView(base: trip).navigationTransition(.zoom(sourceID: id, in: zoom))
                }
            }
        }
    }

    private var name: String { store.me?.name.isEmpty == false ? store.me!.name : "Mark" }

    private var profile: some View {
        HStack(spacing: 14) {
            Avatar(userId: store.me?.id, hasAvatar: store.me?.hasAvatar ?? false, initial: String(name.prefix(1)),
                   color: Brand.accent.opacity(0.14), ink: Brand.accent, size: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.outfit(20, 650)).foregroundStyle(Brand.ink)
                Text("Jouw statistieken").font(.inter(13, 500)).foregroundStyle(Brand.inkSoft)
            }
        }
        .padding(.top, 4)
    }

    private var visited: [String] {
        store.past.flatMap { $0.stops.map(\.flag) }.reduce(into: []) { if !$0.contains($1) { $0.append($1) } }
    }

    private var stats: some View {
        let trips = store.past
        // Signed in: the server's own figures, as the web shows them.
        let items: [(Int, String, String, Color)] = store.live ? [
            (store.stats?.trips ?? 0, "reizen", "safari", Color(hex: 0xE8613C)),
            (store.stats?.countries.count ?? 0, "landen", "globe.europe.africa", Color(hex: 0x2A8F85)),
            // No measured distance is no "0 kilometer": then the places count instead.
            (store.stats?.km ?? 0) > 0 ? (store.stats?.km ?? 0, "kilometer", "ruler", Color(hex: 0xC98A1E)) : (store.stats?.places ?? 0, "plaatsen", "mappin.and.ellipse", Color(hex: 0xC98A1E)),
            (store.stats?.days ?? 0, "dagen op reis", "hourglass", Color(hex: 0x7A5BD6)),
            (store.stats?.photos ?? 0, "foto's", "camera", Color(hex: 0xD9467F)),
            (store.stats?.flights ?? 0, "vluchten", "airplane", Color(hex: 0x3F7FE0)),
        ] : [
            (trips.count, "reizen", "safari", Color(hex: 0xE8613C)),
            (visited.count, "landen", "globe.europe.africa", Color(hex: 0x2A8F85)),
            (trips.reduce(0) { $0 + ($1.km ?? 0) }, "kilometer", "ruler", Color(hex: 0xC98A1E)),
            (trips.reduce(0) { $0 + $1.days }, "dagen op reis", "hourglass", Color(hex: 0x7A5BD6)),
            (trips.reduce(0) { $0 + $1.photos }, "foto's", "camera", Color(hex: 0xD9467F)),
            (trips.reduce(0) { $0 + $1.flights.count }, "vluchten", "airplane", Color(hex: 0x3F7FE0)),
        ]
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                StatTile(value: item.0, label: item.1, symbol: item.2, tint: item.3, order: i)
                    .arrive(1 + i)
            }
        }
    }

    @ViewBuilder private var countries: some View {
        let all = store.live
            ? (store.stats?.countries ?? []).map { Remote.flag($0) }
            : store.trips.flatMap { $0.stops.map(\.flag) }.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let names: [String: String] = store.live
            ? Dictionary((store.stats?.countries ?? []).map { (Remote.flag($0), Remote.countryName($0)) }, uniquingKeysWith: { a, _ in a })
            : Demo.countryNames
        if !all.isEmpty {
            Header(text: "Landen").padding(.top, 26).id("countries")
            // The globe and the countries in one panel: your countries on a small globe that turns slowly, each in
            // its flag's hue, and below it the same countries by name.
            VStack(spacing: 14) {
            CountryGlobe(codes: all.compactMap { Remote.code(fromFlag: $0) }.filter { code in !store.live ? visited.contains(Remote.flag(code)) : true })
                .frame(maxWidth: 240)
                .frame(maxWidth: .infinity)
            FlowLayout(spacing: 8) {
                ForEach(all, id: \.self) { flag in
                    let planned = !store.live && !visited.contains(flag)
                    HStack(spacing: 8) {
                        FlagView(flag: flag, height: 16)
                        Text(names[flag] ?? "Land").font(.outfit(14, 600))
                            .foregroundStyle(planned ? Brand.inkSoft : Brand.ink)
                        if planned {
                            Image(systemName: "hourglass").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.inkSoft)
                                .accessibilityLabel("gepland")
                        }
                    }
                    .padding(.leading, 10)
                    .padding(.trailing, 14)
                    .frame(height: 38)
                    .background(planned ? Brand.raised : Brand.sunken, in: .capsule)
                    .overlay { if planned { Capsule().strokeBorder(Brand.line, style: StrokeStyle(lineWidth: 1, dash: [3, 3])) } }
                }
            }
            }
            .padding(.top, 16)
            .padding([.horizontal, .bottom], 14)
            .background(Brand.raised, in: .rect(cornerRadius: 26))
            .arrive(7)
        }
    }

    @ViewBuilder private var people: some View {
        Header(text: "Mensen op je reizen").padding(.top, 28)
        Text("Toevoegen doe je per reis: open een reis en tik op de mensen.")
            .font(.inter(13, 500))
            .foregroundStyle(Brand.inkSoft)
            .padding(.leading, 4)
            .padding(.bottom, 10)
        if store.live && !store.friendsLoaded {
            // The people are on their way: their place is kept, so the page does not jump.
            CompassSpinner()
                .frame(maxWidth: .infinity, minHeight: 190)
                .background(Brand.raised, in: .rect(cornerRadius: 22))
        } else if store.live && !store.friends.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(store.friends.enumerated()), id: \.element.id) { i, f in
                    NavigationLink(value: f) {
                    HStack(spacing: 14) {
                        Avatar(userId: f.id, hasAvatar: f.hasAvatar, initial: String(f.name.prefix(1)).uppercased(),
                               color: Color(hex: [0xD9A441, 0x5B8DEF, 0x2BB6A8, 0x7A5BD6, 0xE34B8A][i % 5]), size: 42)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(f.name).font(.outfit(17, 600)).foregroundStyle(Brand.ink).lineLimit(1)
                            Text("@\(f.username) · \(f.sharedTrips) \(f.sharedTrips == 1 ? "gedeelde reis" : "gedeelde reizen")")
                                .font(.inter(13, 500)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .contentShape(.rect)
                    }
                    .buttonStyle(PressStyle(scale: 0.98))
                    if i < store.friends.count - 1 { Divider().padding(.leading, 70) }
                }
            }
            .background(Brand.raised, in: .rect(cornerRadius: 22))
        } else if store.live {
            Text("Nog niemand op je reizen.")
                .font(.inter(15, 500))
                .foregroundStyle(Brand.inkSoft)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(Brand.raised, in: .rect(cornerRadius: 22))
        } else {
            VStack(spacing: 0) {
                ForEach(Array(Demo.friends.enumerated()), id: \.element.id) { i, f in
                    NavigationLink(value: f) {
                        HStack(spacing: 14) {
                            Text(String(f.name.prefix(1)))
                                .font(.outfit(17, 700))
                                .foregroundStyle(.white)
                                .frame(width: 42, height: 42)
                                .background(f.color, in: .circle)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.name).font(.outfit(17, 600)).foregroundStyle(Brand.ink)
                                Text("@\(f.handle) · \(f.shared) \(f.shared == 1 ? "gedeelde reis" : "gedeelde reizen")")
                                    .font(.inter(13, 500)).foregroundStyle(Brand.inkSoft)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(.tertiary)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .contentShape(.rect)
                    }
                    .buttonStyle(PressStyle(scale: 0.98))
                    if i < Demo.friends.count - 1 { Divider().padding(.leading, 70) }
                }
            }
            .background(Brand.raised, in: .rect(cornerRadius: 22))
            .arrive(8)
        }
    }
}

private struct Header: View {
    let text: String
    var body: some View {
        Text(text).font(.outfit(15, 600)).foregroundStyle(Brand.inkSoft).padding(.leading, 4).padding(.bottom, 10)
    }
}

/// A big number on a plain tile, rolling up when the page arrives, with its symbol.
private struct StatTile: View {
    let value: Int
    let label: String
    let symbol: String
    let tint: Color
    let order: Int
    @State private var shown: Int

    init(value: Int, label: String, symbol: String, tint: Color, order: Int) {
        self.value = value; self.label = label; self.symbol = symbol; self.tint = tint; self.order = order
        _shown = State(initialValue: Launch.shot ? value : 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 0)
            Text(Format.number(shown))
                .font(.outfit(34, 700))
                .tracking(-1)
                .foregroundStyle(Brand.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .contentTransition(.numericText(value: Double(shown)))
            Text(label).font(.inter(13, 600)).foregroundStyle(Brand.inkSoft)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 110)
        .padding(.horizontal, 16)
        .overlay(alignment: .topTrailing) {
            // The symbol on its own, in the text's colour: no disc or shape behind it.
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Brand.inkSoft)
                .frame(width: 24, height: 24)
                .padding(14)
        }
        .padding(.vertical, 2)
        .background(Brand.raised, in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(Format.number(value)) \(label)")
        .onAppear {
            guard shown != value else { return }
            withAnimation(.smooth(duration: 0.9).delay(0.1 + Double(order) * 0.06)) { shown = value }
        }
        .onChange(of: value) { _, v in withAnimation(.smooth) { shown = v } }
    }
}

/// Chips in rows, wrapping to the next line when a row is full.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { y += row + spacing; x = 0; row = 0 }
            x += size.width + spacing
            row = max(row, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { y += row + spacing; x = bounds.minX; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}

/// A person from your trips: who it is and the trips you share.
private struct FriendView: View {
    let friend: Demo.Friend
    let zoom: Namespace.ID
    @Environment(Store.self) private var store

    var body: some View {
        let initial = String(friend.name.prefix(1))
        let shared = store.trips.filter { $0.people.contains { $0.initial == initial } }
        ScrollView {
            VStack(spacing: 0) {
                Text(initial)
                    .font(.outfit(34, 700))
                    .foregroundStyle(.white)
                    .frame(width: 88, height: 88)
                    .background(friend.color, in: .circle)
                    .padding(.top, 8)
                Text(friend.name).font(.outfit(26, 650)).foregroundStyle(Brand.ink).padding(.top, 12)
                Text("@\(friend.handle)").font(.inter(15, 500)).foregroundStyle(Brand.inkSoft).padding(.top, 2)
                VStack(alignment: .leading, spacing: 0) {
                    Header(text: "Samen op reis").padding(.top, 28)
                    if shared.isEmpty {
                        Text("Nog geen gedeelde reizen in de voorbeelden.")
                            .font(.inter(15, 500)).foregroundStyle(Brand.inkSoft)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background(Brand.raised, in: .rect(cornerRadius: 22))
                    } else {
                        TripGroup(trips: shared, zoom: zoom) { _ in
                            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Brand.paper)
        .navigationTitle(friend.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
