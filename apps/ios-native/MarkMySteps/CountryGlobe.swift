import SwiftUI

/*
 * The countries you have been to on a small globe that turns 7 degrees a
 * second, each in its flag's hue (made legible on light or dark), after the
 * web's CountryGlobe and Android's CountryGlobe.kt. It starts on the middle
 * of your countries and stops drawing when it is off screen.
 */

enum Countries {
    struct Shape {
        let code: String
        let hue: Color
        /// Rings as flat lon, lat pairs.
        let rings: [[Double]]
    }

    static let all: [Shape] = {
        guard let url = Bundle.main.url(forResource: "countries110", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list.compactMap { o in
            guard let code = o["c"] as? String, let polys = o["p"] as? [[[[Double]]]] else { return nil }
            let hex = (o["h"] as? String).flatMap { UInt32($0.dropFirst(), radix: 16) } ?? 0x8899AA
            return Shape(code: code.uppercased(), hue: Color(hex: hex), rings: polys.flatMap { $0 }.map { ring in ring.flatMap { $0 } })
        }
    }()

    /// The middle of a set of countries, as a point to start the globe on.
    static func middle(of codes: Set<String>) -> LonLat {
        var x = 0.0, y = 0.0, z = 0.0
        for shape in all where codes.contains(shape.code) {
            for ring in shape.rings {
                for i in stride(from: 0, to: ring.count - 1, by: 8) {
                    let lon = ring[i] * Geo.rad, lat = ring[i + 1] * Geo.rad
                    x += cos(lat) * cos(lon); y += cos(lat) * sin(lon); z += sin(lat)
                }
            }
        }
        if x == 0 && y == 0 && z == 0 { return LonLat(8, 38) }
        return LonLat(atan2(y, x) / Geo.rad, atan2(z, (x * x + y * y).squareRoot()) / Geo.rad)
    }
}

struct CountryGlobe: View {
    /// ISO codes of the countries to fill in.
    let codes: [String]
    @Environment(\.colorScheme) private var scheme
    @Environment(\.scenePhase) private var phase
    @State private var visible = true
    @State private var started = Date()

    var body: some View {
        let set = Set(codes.map { $0.uppercased() })
        let centre = Countries.middle(of: set)
        let dark = scheme == .dark
        TimelineView(.animation(paused: !visible || phase != .active || Launch.shot)) { tl in
            let lon = centre.lon + tl.date.timeIntervalSince(started) * 7
            Canvas { ctx, size in
                let r = min(size.width, size.height) / 2 - 2
                let proj = Ortho(lon0: lon, lat0: max(-40, min(40, centre.lat)), cx: size.width / 2, cy: size.height / 2, r: r)
                let disc = CGRect(x: proj.cx - r, y: proj.cy - r, width: r * 2, height: r * 2)
                ctx.fill(Path(ellipseIn: disc), with: .color(dark ? Color(hex: 0x1E2630) : Color(hex: 0xE4EDF2)))
                var rest = Path()
                var mine: [(Path, Color)] = []
                for shape in Countries.all {
                    var path = Path()
                    for ring in shape.rings {
                        let n = ring.count / 2
                        guard n > 2 else { continue }
                        var pts: [CGPoint] = []
                        pts.reserveCapacity(n)
                        var anyNear = false
                        for i in 0..<n {
                            let (p, near) = proj.project(ring[i * 2], ring[i * 2 + 1])
                            if near { anyNear = true }
                            pts.append(p)
                        }
                        guard anyNear else { continue }
                        path.addLines(pts)
                        path.closeSubpath()
                    }
                    if set.contains(shape.code) { mine.append((path, Geo.legible(shape.hue, dark: dark))) } else { rest.addPath(path) }
                }
                ctx.fill(rest, with: .color(dark ? Color(hex: 0x34404C) : Color(hex: 0xD8CDB9)), style: FillStyle(eoFill: true))
                for (path, colour) in mine { ctx.fill(path, with: .color(colour), style: FillStyle(eoFill: true)) }
                // Lit from the upper left, as on the web.
                ctx.fill(Path(ellipseIn: disc), with: .radialGradient(
                    Gradient(colors: [.white.opacity(dark ? 0.08 : 0.22), .clear, .black.opacity(dark ? 0.25 : 0.10)]),
                    center: CGPoint(x: proj.cx - r * 0.45, y: proj.cy - r * 0.5), startRadius: 0, endRadius: r * 2.1))
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .onScrollVisibilityChange(threshold: 0.05) { visible = $0 }
        .onDisappear { visible = false }
        .onAppear { visible = true }
        .accessibilityLabel("Wereldbol met \(codes.count) landen")
    }
}

/// A companion's own page: their figures, their countries on the globe and as chips.
struct CompanionView: View {
    let friend: Remote.Friend
    @State private var stats: Remote.Stats?
    @State private var failed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 14) {
                    Avatar(userId: friend.id, hasAvatar: friend.hasAvatar, initial: String(friend.name.prefix(1)).uppercased(), color: Color(hex: 0x5B8DEF), size: 64)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(friend.name).font(.outfit(24, 650)).foregroundStyle(Brand.ink)
                        Text("@\(friend.username) · \(friend.sharedTrips) \(friend.sharedTrips == 1 ? "gedeelde reis" : "gedeelde reizen")")
                            .font(.inter(13.5, 500)).foregroundStyle(Brand.inkSoft)
                    }
                }
                .padding(.top, 8)
                if let stats {
                    StatsGrid(stats: stats).padding(.top, 18)
                    if !stats.countries.isEmpty {
                        Text("Landen").font(.outfit(15, 600)).foregroundStyle(Brand.inkSoft).padding(.leading, 4).padding(.top, 26).padding(.bottom, 10)
                        CountryGlobe(codes: stats.countries).frame(maxWidth: 260).frame(maxWidth: .infinity).padding(.bottom, 14)
                        FlowLayout(spacing: 8) {
                            ForEach(stats.countries, id: \.self) { code in CountryChip(code: code) }
                        }
                    }
                } else if failed {
                    Text("De cijfers van \(friend.name) zijn nu niet te laden.")
                        .font(.inter(15, 500)).foregroundStyle(Brand.inkSoft)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                        .background(Brand.raised, in: .rect(cornerRadius: 22)).padding(.top, 18)
                } else {
                    CompassSpinner().frame(maxWidth: .infinity, minHeight: 360)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Brand.paper)
        .navigationTitle(friend.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do { stats = try await Remote.stats(friend.id) } catch { failed = true }
        }
    }
}

/// A country as a chip: its flat flag and Dutch name.
struct CountryChip: View {
    let code: String
    var planned = false

    var body: some View {
        HStack(spacing: 8) {
            FlagView(flag: code, height: 16)
            Text(Remote.countryName(code)).font(.outfit(14, 600)).foregroundStyle(planned ? Brand.inkSoft : Brand.ink)
        }
        .padding(.leading, 10)
        .padding(.trailing, 14)
        .frame(height: 38)
        .background(planned ? Brand.sunken : Brand.raised, in: .capsule)
    }
}

/// Six figures in two columns, the same tiles as your own.
struct StatsGrid: View {
    let stats: Remote.Stats

    var body: some View {
        let items: [(Int, String, String)] = [
            (stats.trips, "reizen", "safari"),
            (stats.countries.count, "landen", "globe.europe.africa"),
            stats.km > 0 ? (stats.km, "kilometer", "ruler") : (stats.places, "plaatsen", "mappin.and.ellipse"),
            (stats.days, "dagen op reis", "hourglass"),
            (stats.photos, "foto's", "camera"),
            (stats.flights, "vluchten", "airplane"),
        ]
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 0) {
                    Spacer(minLength: 0)
                    Text(Format.number(item.0)).font(.outfit(34, 700)).tracking(-1).foregroundStyle(Brand.ink).lineLimit(1).minimumScaleFactor(0.7)
                    Text(item.1).font(.inter(13, 600)).foregroundStyle(Brand.inkSoft)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
                .frame(height: 118)
                .overlay(alignment: .topTrailing) {
                    Image(systemName: item.2).font(.system(size: 17, weight: .semibold)).foregroundStyle(Brand.inkSoft).frame(width: 24, height: 24).padding(16)
                }
                .background(Brand.raised, in: .rect(cornerRadius: 22))
            }
        }
    }
}

/// The bell's list as a floating panel out of the bell's corner, as on Android and the web: who did what and how
/// long ago, an × per line to take it away (for a request only the line goes, the request stays open),
/// Toelaten / Afwijzen for a request to look along, and a way straight to the trip or the account requests.
/// Opening it marks everything read.
struct NoticesPanel: View {
    var demo = false
    var onChanged: () -> Void = {}
    var onOpenTrip: (String) -> Void = { _ in }
    var onOpenRequests: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var notices: [Remote.Notice]?
    @State private var answered: [String: Bool] = [:]
    @State private var gone: Set<String> = []
    @State private var busy: String?

    var body: some View {
        let list = notices?.filter { !gone.contains($0.id) }
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Meldingen").font(.outfit(21, 650)).foregroundStyle(Brand.ink)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Brand.ink).frame(width: 30, height: 30)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel("Sluiten")
            }
            .padding(.leading, 18)
            .padding(.trailing, 12)
            .padding(.top, 14)
            .padding(.bottom, 10)

            Group {
                if list == nil {
                    // Three rows at the height real ones have, so the panel opens at its size.
                    VStack(spacing: 3) {
                        ForEach(0..<3, id: \.self) { i in
                            Brand.sunken.frame(height: 72).clipShape(slab(i, 3))
                        }
                    }
                    .padding(.horizontal, 12)
                } else if let list, list.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "bell").font(.system(size: 24, weight: .semibold)).foregroundStyle(Brand.inkSoft)
                            .frame(width: 54, height: 54).background(Brand.sunken, in: .circle)
                        Text("Niets nieuws. Hier komen verzoeken en uitnodigingen.")
                            .font(.inter(14, 500)).foregroundStyle(Brand.inkSoft).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 20)
                    .transition(.opacity)
                } else if let list {
                    ScrollView {
                        VStack(spacing: 3) {
                            ForEach(Array(list.enumerated()), id: \.element.id) { i, n in
                                row(n).clipShape(slab(i, list.count))
                                    .transition(.asymmetric(insertion: .opacity, removal: .opacity.combined(with: .scale(scale: 0.96))))
                            }
                        }
                        .padding(.horizontal, 12)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                    .frame(maxHeight: 460)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.bottom, 12)
        }
        .frame(width: 360)
        .animation(.calm, value: gone)
        .animation(.calm, value: answered)
        .animation(.calm, value: notices == nil)
        .task {
            if demo {
                notices = NoticesPanel.demoNotices
                return
            }
            notices = (try? await Remote.notices()) ?? []
            // Opening the list is reading it, except for questions still unanswered (the server keeps those).
            if (try? await Remote.markNoticesRead()) != nil { onChanged() }
        }
    }

    private func slab(_ i: Int, _ n: Int) -> UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: i == 0 ? 20 : 6, bottomLeadingRadius: i == n - 1 ? 20 : 6,
                               bottomTrailingRadius: i == n - 1 ? 20 : 6, topTrailingRadius: i == 0 ? 20 : 6)
    }

    private func text(_ n: Remote.Notice) -> String {
        let who = n.actor ?? "Iemand", trip = n.trip ?? "een reis"
        switch n.kind {
        case "TRIP_ADDED": return "\(who) heeft je toegevoegd aan \(trip)."
        case "ACCESS_REQUESTED": return "\(who) vraagt toegang tot \(trip)."
        case "ACCESS_APPROVED": return "\(who) heeft je toegelaten tot \(trip)."
        case "ACCESS_DENIED": return "\(who) heeft je verzoek voor \(trip) afgewezen."
        case "SECURITY_LOGIN_ATTEMPTS": return n.detail ?? "Er zijn veel mislukte inlogpogingen geweest."
        case "ACCOUNT_REQUESTED": return "\(who) wil een account op je server."
        default: return "\(who) · \(trip)"
        }
    }

    private func mark(_ kind: String) -> String {
        switch kind {
        case "ACCESS_REQUESTED": "person.2.fill"
        case "ACCESS_APPROVED": "checkmark"
        case "ACCESS_DENIED": "xmark"
        case "SECURITY_LOGIN_ATTEMPTS": "lock.shield.fill"
        case "ACCOUNT_REQUESTED": "person.fill"
        default: "safari"
        }
    }

    @ViewBuilder private func row(_ n: Remote.Notice) -> some View {
        let rid = n.requestId
        let done = rid.flatMap { answered[$0] }
        let pending = n.kind == "ACCESS_REQUESTED" && rid != nil && n.requestStatus == "PENDING" && done == nil
        let fill = n.read ? Brand.sunken : Brand.accent.opacity(0.14)
        HStack(alignment: .top, spacing: 12) {
            Avatar(userId: n.actorId, hasAvatar: n.actorAvatar, initial: String((n.actor ?? "?").prefix(1)).uppercased(), color: Color(hex: 0x2BB6A8), size: 40)
                .overlay(alignment: .bottomTrailing) {
                    // A small mark of what happened, on the corner of their photo.
                    Image(systemName: mark(n.kind))
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 18, height: 18)
                        .background(Brand.accent, in: .circle)
                        .padding(2)
                        .background(Brand.raised, in: .circle)
                        .offset(x: 5, y: 5)
                }
            VStack(alignment: .leading, spacing: 3) {
                Text(text(n)).font(.inter(14.5, 500)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
                Text(n.at.formatted(.relative(presentation: .named).locale(Format.dutch))).font(.inter(12.5, 450)).foregroundStyle(Brand.inkSoft)
                if pending, let rid {
                    HStack(spacing: 8) {
                        Button("Toelaten") { answer(rid, true) }.buttonStyle(.glassProminent)
                        Button("Afwijzen") { answer(rid, false) }.buttonStyle(.glass)
                    }
                    .font(.outfit(14, 600))
                    .controlSize(.small)
                    .disabled(busy != nil)
                    .padding(.top, 6)
                }
                if let done {
                    Label(done ? "\(n.actor ?? "Die persoon") kijkt nu mee als gast." : "Afgewezen.", systemImage: done ? "checkmark" : "xmark")
                        .font(.inter(13.5, 600)).foregroundStyle(Brand.inkSoft)
                        .padding(.top, 4)
                        .transition(.opacity)
                }
                if n.kind == "ACCOUNT_REQUESTED" {
                    link("Aanvragen bekijken") { onOpenRequests() }
                } else if let trip = n.tripId, n.kind != "ACCESS_DENIED", !pending {
                    link("Reis openen") { onOpenTrip(trip) }
                }
            }
            Spacer(minLength: 0)
            // Taking the line away: for a request only the line goes, the request itself stays open.
            Button { dismissLine(n) } label: {
                Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.inkSoft)
                    .frame(width: 36, height: 36).contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Melding weghalen")
        }
        .padding(.leading, 12)
        .padding(.vertical, 12)
        .padding(.trailing, 2)
        .background(fill)
    }

    private func link(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 3) {
                Text(label).font(.outfit(14, 600))
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(Brand.accent)
            .padding(.vertical, 4)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
    }

    private func dismissLine(_ n: Remote.Notice) {
        Haptic.tap()
        gone.insert(n.id)
        guard !demo else { return }
        Task { if (try? await Remote.dismissNotice(n.id)) != nil { onChanged() } }
    }

    private func answer(_ id: String, _ approve: Bool) {
        Haptic.tap()
        if demo { answered[id] = approve; return }
        busy = id
        Task {
            if (try? await Remote.answerAccess(id, approve: approve)) != nil { answered[id] = approve; onChanged() }
            busy = nil
        }
    }

    /// In the demo, what the bell can hold: a request to look along and a trip someone added you to.
    static let demoNotices: [Remote.Notice] = [
        Remote.Notice(id: "demo-1", kind: "ACCESS_REQUESTED", at: Date().addingTimeInterval(-3_600 * 2), read: false, actorId: nil, actor: "Lotte",
                      actorAvatar: false, tripId: "georgia", trip: "Georgië 2026", requestId: "demo-r1", requestStatus: "PENDING", detail: nil),
        Remote.Notice(id: "demo-2", kind: "TRIP_ADDED", at: Date().addingTimeInterval(-86_400 * 3), read: true, actorId: nil, actor: "Sanne",
                      actorAvatar: false, tripId: "iceland", trip: "IJsland", requestId: nil, requestStatus: nil, detail: nil),
    ]
}
