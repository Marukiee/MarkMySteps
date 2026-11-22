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
                .frame(height: 110)
                .padding(.horizontal, 16)
                .overlay(alignment: .topTrailing) {
                    Image(systemName: item.2).font(.system(size: 17, weight: .semibold)).foregroundStyle(Brand.inkSoft).frame(width: 24, height: 24).padding(14)
                }
                .padding(.vertical, 2)
                .background(Brand.raised, in: .rect(cornerRadius: 22))
            }
        }
    }
}

/// Notifications behind the bell: who added you, who asks to look along (approve as a
/// guest or turn down), answers to your own requests. Opening marks them read.
struct NoticesSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var notices: [Remote.Notice]?
    @State private var answered: [String: Bool] = [:]
    @State private var busy: String?
    var onRead: () -> Void = {}

    var body: some View {
        NavigationStack {
            List {
                if let notices {
                    if notices.isEmpty {
                        Text("Geen meldingen.").foregroundStyle(Brand.inkSoft)
                    }
                    ForEach(notices) { n in row(n) }
                } else {
                    CompassSpinner(size: 30).frame(maxWidth: .infinity, minHeight: 120).listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Brand.paper)
            .navigationTitle("Meldingen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() }.tint(.primary) } }
            .task {
                notices = (try? await Remote.notices()) ?? []
                try? await Remote.markNoticesRead()
                onRead()
            }
        }
        .presentationDetents([.medium, .large])
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

    @ViewBuilder private func row(_ n: Remote.Notice) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Avatar(userId: n.actorId, hasAvatar: n.actorAvatar, initial: String((n.actor ?? "?").prefix(1)).uppercased(), color: Color(hex: 0x2BB6A8), size: 36)
            VStack(alignment: .leading, spacing: 4) {
                Text(text(n)).font(.inter(15, n.read ? 450 : 600)).foregroundStyle(Brand.ink)
                Text(n.at.formatted(.relative(presentation: .named).locale(Format.dutch))).font(.inter(12.5, 450)).foregroundStyle(Brand.inkSoft)
                if n.kind == "ACCESS_REQUESTED", let rid = n.requestId, n.requestStatus == "PENDING" {
                    if let done = answered[rid] {
                        Text(done ? "\(n.actor ?? "Die persoon") kijkt nu mee als gast." : "Afgewezen.")
                            .font(.inter(13.5, 500)).foregroundStyle(Brand.inkSoft)
                    } else {
                        HStack(spacing: 8) {
                            Button("Toelaten als gast") { answer(rid, true) }.buttonStyle(.borderedProminent)
                            Button("Afwijzen") { answer(rid, false) }.buttonStyle(.bordered)
                        }
                        .buttonBorderShape(.capsule)
                        .font(.inter(14, 600))
                        .disabled(busy != nil)
                        .padding(.top, 2)
                    }
                }
            }
        }
        .listRowBackground(Brand.raised)
    }

    private func answer(_ id: String, _ approve: Bool) {
        busy = id
        Task {
            if (try? await Remote.answerAccess(id, approve: approve)) != nil { withAnimation(.snappy) { answered[id] = approve } }
            busy = nil
        }
    }
}
