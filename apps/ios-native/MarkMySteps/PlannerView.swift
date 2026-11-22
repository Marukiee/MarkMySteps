import SwiftUI

/*
 * The route planner, the second tab of a trip, as in the web app: how many of
 * the trip's nights are planned, the way there, every stop with its nights and
 * the road from the stop before, the way back, and a field to add a stop.
 * The stops are List rows: swipe to remove, hold or Wijzig to move, a native
 * Stepper for the nights and a menu for how the leg is travelled. On a real
 * trip every change is saved to the server like Android's Planner.kt; a removed
 * stop waits 7 seconds behind an undo pill before the server hears of it.
 */

/// One row of the plan, with a key that stays the same while it moves.
struct PlanStop: Identifiable, Hashable {
    let id: Int
    let name: String
    let flag: String
    let at: LonLat
    var nights: Int
    var mode: Mode
    var serverId: String? = nil
}

/// A removed stop that can still come back.
struct PendingDelete: Equatable {
    let stop: PlanStop
    let index: Int
    let at: Date
}

struct PlanState {
    var stops: [PlanStop]
    var outbound: Leg?
    var back: Leg?
    var nextKey: Int
    var query = ""
    var pending: PendingDelete?
    var error: String?

    init(trip: Trip) {
        stops = trip.stops.enumerated().map { i, s in PlanStop(id: i, name: s.name, flag: s.flag, at: s.at, nights: s.nights, mode: s.mode, serverId: s.serverId) }
        outbound = trip.outbound
        back = trip.back
        nextKey = trip.stops.count
    }
}

/// Sends planner changes to the server: nights after a short pause, the rest at once.
@Observable
final class PlanSaver {
    private var nightTasks: [Int: Task<Void, Never>] = [:]
    private var deleteTask: Task<Void, Never>?

    func run(_ plan: Binding<PlanState>, _ work: @escaping () async throws -> Void) {
        Task {
            do { try await work(); plan.wrappedValue.error = nil } catch {
                plan.wrappedValue.error = (error as? Api.Failure)?.message ?? "Opslaan lukte niet"
            }
        }
    }

    func nights(_ trip: Trip, _ plan: Binding<PlanState>, stop: PlanStop) {
        guard let id = stop.serverId else { return }
        nightTasks[stop.id]?.cancel()
        nightTasks[stop.id] = Task {
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            run(plan) { try await Remote.updateStop(trip, id, nights: stop.nights) }
        }
    }

    /// Removed for good once the undo pill has gone, 7 seconds later.
    func scheduleDelete(_ trip: Trip, _ plan: Binding<PlanState>, send: Bool) {
        deleteTask?.cancel()
        deleteTask = Task {
            try? await Task.sleep(for: .seconds(7))
            guard !Task.isCancelled, let pending = plan.wrappedValue.pending else { return }
            withAnimation(.snappy) { plan.wrappedValue.pending = nil }
            if send, let id = pending.stop.serverId { run(plan) { try await Remote.deleteStop(trip, id) } }
        }
    }

    func undo(_ plan: Binding<PlanState>) {
        deleteTask?.cancel()
        guard let p = plan.wrappedValue.pending else { return }
        withAnimation(.snappy) {
            plan.wrappedValue.stops.insert(p.stop, at: min(p.index, plan.wrappedValue.stops.count))
            plan.wrappedValue.pending = nil
        }
    }
}

struct PlannerRows: View {
    let trip: Trip
    @Binding var plan: PlanState
    /// Called when the add-a-stop field gets the keyboard, so the page can lift it into view.
    var onFocusAdd: () -> Void = {}
    var saver: PlanSaver
    @Environment(\.colorScheme) private var scheme
    @Environment(Store.self) private var store

    /// Real trips save; guests only look.
    private var saves: Bool {
        trip.remoteId != nil && (trip.members.first { $0.userId == store.me?.id }?.role ?? "MEMBER") != "GUEST"
    }

    private func legBinding(_ key: WritableKeyPath<PlanState, Leg?>) -> Binding<Leg> {
        Binding(get: { plan[keyPath: key]! }, set: { new in
            let old = plan[keyPath: key]
            plan[keyPath: key] = new
            if saves, old?.mode != new.mode, let id = new.serverId {
                saver.run($plan) { try await Remote.updateStop(trip, id, mode: new.mode) }
            }
        })
    }

    private func stopBinding(_ stop: Binding<PlanStop>) -> Binding<PlanStop> {
        Binding(get: { stop.wrappedValue }, set: { new in
            let old = stop.wrappedValue
            stop.wrappedValue = new
            guard saves else { return }
            if old.nights != new.nights { saver.nights(trip, $plan, stop: new) }
            if old.mode != new.mode, let id = new.serverId { saver.run($plan) { try await Remote.updateStop(trip, id, mode: new.mode) } }
        })
    }

    var body: some View {
        let color = Geo.legible(trip.color, dark: scheme == .dark)
        // A trip of 19 days has 18 nights; the demo's day counts are already nights.
        let total = max(1, trip.remoteId != nil ? trip.days - 1 : trip.days)
        let planned = plan.stops.reduce(0) { $0 + $1.nights }

        // Nights planned, out of the trip's: a ring that fills as stops get nights.
        HStack(spacing: 12) {
            NightsRing(share: Double(planned) / Double(total), color: color)
            Text("\(planned)/\(total) nachten gepland")
                .font(.outfit(15, 600))
                .foregroundStyle(Brand.ink)
                .contentTransition(.numericText(value: Double(planned)))
                .animation(.snappy, value: planned)
            Spacer()
            EditButton()
                .font(.outfit(15, 600))
                .buttonStyle(.borderless)
        }
        .plainRow(bottom: plan.error == nil ? 12 : 4)
        .id("planner")

        if let error = plan.error {
            Label(error, systemImage: "exclamationmark.circle.fill")
                .font(.inter(14, 550)).foregroundStyle(.red)
                .plainRow(bottom: 10)
        }

        if plan.outbound != nil {
            LegRow(name: "Heen", leg: legBinding(\.outbound))
                .plainRow(bottom: 0)
        }

        // Bound per stop by its id, so removing one mid-animation never reads past the end.
        ForEach($plan.stops) { $stop in
            let index = plan.stops.firstIndex { $0.id == stop.id } ?? 0
            StopRow(
                stop: stopBinding($stop),
                index: index,
                dates: dates(upTo: index),
                km: index > 0 ? distance(plan.stops[index - 1], stop) : nil,
                showConnector: index > 0 || plan.outbound != nil,
                color: color
            )
            .plainRow(bottom: 0)
        }
        // The system's own swipe to delete, which also lets go of the touch afterwards,
        // so the undo pill answers its first tap.
        .onDelete { offsets in
            guard let i = offsets.first, plan.stops.indices.contains(i) else { return }
            let row = plan.stops[i]
            // An earlier removal that is still waiting goes for good now.
            if let earlier = plan.pending, saves, let sid = earlier.stop.serverId {
                saver.run($plan) { try await Remote.deleteStop(trip, sid) }
            }
            withAnimation(.snappy) {
                plan.pending = PendingDelete(stop: row, index: i, at: Date())
                plan.stops.remove(at: i)
            }
            saver.scheduleDelete(trip, $plan, send: saves)
        }
        .onMove { from, to in
            withAnimation(.snappy) { plan.stops.move(fromOffsets: from, toOffset: to) }
            guard saves else { return }
            let ids = [plan.outbound?.serverId].compactMap { $0 } + plan.stops.compactMap(\.serverId) + [plan.back?.serverId].compactMap { $0 }
            saver.run($plan) { try await Remote.reorderStops(trip, ids) }
        }

        if plan.back != nil {
            LegRow(name: "Terug", leg: legBinding(\.back))
                .plainRow(top: 12)
        }

        AddStopCard(trip: trip, plan: $plan, saves: saves, saver: saver, onFocus: onFocusAdd)
            .plainRow(top: 20)
            .id("add")
    }

    /// "4 t/m 7 dec" for a stop, counted on from the trip's first day.
    private func dates(upTo index: Int) -> String {
        guard let first = trip.firstDay, plan.stops.indices.contains(index) else { return "" }
        let before = plan.stops.prefix(index).reduce(0) { $0 + $1.nights }
        let cal = Format.calendar
        let from = cal.date(byAdding: .day, value: before, to: first) ?? first
        let nights = plan.stops[index].nights
        if nights == 0 { return Format.shortDay(from) }
        let to = cal.date(byAdding: .day, value: nights, to: from) ?? from
        return Format.range(from, to, withYear: false)
    }

    /// Roughly by road: a quarter more than as the crow flies; a flight is straight.
    private func distance(_ a: PlanStop, _ b: PlanStop) -> Int {
        Int((Geo.angle(a.at, b.at) * 111.2 * (b.mode == .flight ? 1 : 1.25)).rounded())
    }
}

private struct NightsRing: View {
    let share: Double
    let color: Color

    var body: some View {
        // A clear opening at the top, so a full ring never reads as an error state.
        let gap = 0.1
        let filled = min(1, max(0, share)) * (1 - gap)
        ZStack {
            Circle().trim(from: gap / 2, to: 1 - gap / 2).stroke(color.opacity(0.2), style: StrokeStyle(lineWidth: 4, lineCap: .round))
            Circle()
                .trim(from: gap / 2, to: gap / 2 + filled)
                .stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round))
        }
        .rotationEffect(.degrees(-90))
        .frame(width: 28, height: 28)
        .animation(.spring(duration: 0.5, bounce: 0.2), value: share)
        .accessibilityHidden(true)
    }
}

/// How a leg is travelled: a capsule that opens the system menu.
struct ModeMenu: View {
    @Binding var mode: Mode

    var body: some View {
        Menu {
            Picker("Vervoer", selection: $mode.animation(.snappy)) {
                ForEach(Mode.allCases) { m in
                    Label(m.label, systemImage: m.symbol).tag(m)
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: mode.symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 18)
                Text(mode.label).font(.outfit(13.5, 600))
            }
            .foregroundStyle(Brand.ink)
            .padding(.leading, 10)
            .padding(.trailing, 12)
            .frame(height: 32)
            .background(Brand.sunken, in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Vervoer: \(mode.label)")
    }
}

/// The way there or back: its name, how, where from and where to, and how far.
private struct LegRow: View {
    let name: String
    @Binding var leg: Leg

    var body: some View {
        HStack(spacing: 10) {
            Text(name).font(.outfit(17, 650)).foregroundStyle(Brand.ink).frame(width: 52, alignment: .leading)
            ModeMenu(mode: $leg.mode)
            HStack(spacing: 6) {
                Text(leg.from)
                Image(systemName: "arrow.right").font(.system(size: 12, weight: .bold)).foregroundStyle(Brand.inkSoft)
                Text(leg.to)
            }
            .font(.outfit(15, 600))
            .foregroundStyle(Brand.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            Spacer(minLength: 4)
            if leg.km > 0 {
                Text(Format.km(leg.km)).font(.inter(13, 500)).foregroundStyle(Brand.inkSoft).fixedSize()
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Brand.raised, in: .rect(cornerRadius: 22))
    }
}

private struct StopRow: View {
    @Binding var stop: PlanStop
    let index: Int
    let dates: String
    let km: Int?
    let showConnector: Bool
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showConnector {
                // Between two stops: the line in the trip's colour, how the road was travelled and how far.
                HStack(spacing: 0) {
                    Rectangle().fill(color.opacity(0.35)).frame(width: 2)
                    if index > 0 {
                        ModeMenu(mode: $stop.mode).padding(.leading, 18)
                        if let km {
                            Text(km < 5 ? "in de buurt" : Format.km(km))
                                .font(.inter(12.5, 500))
                                .foregroundStyle(Brand.inkSoft)
                                .padding(.leading, 10)
                                .contentTransition(.numericText())
                        }
                    }
                    Spacer()
                }
                .frame(height: index > 0 ? 52 : 14)
                .padding(.leading, 33)
            }
            HStack(spacing: 12) {
                Text("\(index + 1)")
                    .font(.outfit(17, 700))
                    .foregroundStyle(color)
                    .contentTransition(.numericText())
                    .frame(width: 44, height: 44)
                    .background(color.opacity(0.16), in: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 7) { FlagView(flag: stop.flag, height: 14); Text(stop.name).font(.outfit(17, 600)).foregroundStyle(Brand.ink).lineLimit(1) }
                    Text("\(dates) · \(stop.nights) \(stop.nights == 1 ? "nacht" : "nachten")")
                        .font(.inter(13, 500))
                        .foregroundStyle(Brand.inkSoft)
                        .lineLimit(1)
                        .contentTransition(.numericText(value: Double(stop.nights)))
                }
                Spacer(minLength: 6)
                Stepper("Nachten in \(stop.name)", value: $stop.nights.animation(.snappy), in: 0...60)
                    .labelsHidden()
                    .fixedSize()
            }
            .padding(12)
            .background(Brand.raised, in: .rect(cornerRadius: 22))
        }
        .contentShape(.rect)
    }
}

/// A field for a new stop; places that match open underneath, one tap adds it.
private struct AddStopCard: View {
    let trip: Trip
    @Binding var plan: PlanState
    var saves = false
    var saver: PlanSaver
    var onFocus: () -> Void = {}
    @FocusState private var focused: Bool
    @State private var found: [Remote.Place] = []

    var body: some View {
        let query = plan.query.trimmingCharacters(in: .whitespaces)
        let taken = Set(plan.stops.map(\.name))
        let flag = trip.stops.first?.flag
        // A real trip searches real places (Photon, like the web); the demo knows a few.
        let matches: [Remote.Place] = trip.remoteId != nil
            ? found.filter { !taken.contains($0.name) }
            : Demo.places.filter { p in
                !taken.contains(p.name) && (query.isEmpty ? p.flag == flag : p.name.localizedCaseInsensitiveContains(query))
            }.prefix(4).map { Remote.Place(name: $0.name, region: "", countryCode: Remote.code(fromFlag: $0.flag), at: $0.at) }

        VStack(alignment: .leading, spacing: 10) {
            Text("Nieuwe stop").font(.outfit(17, 650)).foregroundStyle(Brand.ink).padding(.leading, 4)
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .medium)).foregroundStyle(Brand.inkSoft)
                TextField("Zoek een stad, bijv. Mestia", text: $plan.query)
                    .font(.inter(17))
                    .focused($focused)
                    .submitLabel(.done)
                    .autocorrectionDisabled()
                    .onChange(of: focused) { _, on in if on { onFocus() } }
                if !plan.query.isEmpty {
                    Button { plan.query = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Brand.inkSoft)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Wissen")
                    .transition(.opacity.combined(with: .scale))
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(Brand.sunken, in: .capsule)

            VStack(spacing: 0) {
                ForEach(Array(matches.enumerated()), id: \.element.id) { i, place in
                    Button {
                        add(place)
                    } label: {
                        HStack {
                            HStack(spacing: 8) {
                                FlagView(flag: place.flag, height: 13)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(place.name).font(.outfit(15, 600)).foregroundStyle(Brand.ink)
                                    if !place.region.isEmpty { Text(place.region).font(.inter(12.5, 450)).foregroundStyle(Brand.inkSoft).lineLimit(1) }
                                }
                            }
                            Spacer()
                            Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(Brand.accent)
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 10)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.borderless)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                    if i < matches.count - 1 { Divider().padding(.leading, 6) }
                }
            }
            .animation(.snappy, value: matches.map(\.id))

            if !query.isEmpty && matches.isEmpty && trip.remoteId == nil {
                Button {
                    add(Remote.Place(name: query, region: "", countryCode: flag.flatMap(Remote.code(fromFlag:)), at: trip.stops.last?.at ?? trip.route.first ?? LonLat(0, 0)))
                } label: {
                    Text("“\(query)” toevoegen").font(.outfit(15, 600))
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }
        }
        .padding(14)
        .background(Brand.raised, in: .rect(cornerRadius: 24))
        .animation(.snappy, value: query.isEmpty)
        .task(id: query) {
            guard trip.remoteId != nil else { return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            found = await Remote.searchPlaces(query)
        }
    }

    private func add(_ place: Remote.Place) {
        let serverId = saves ? UUID().uuidString.lowercased() : nil
        let after = plan.stops.last?.serverId ?? plan.outbound?.serverId
        withAnimation(.snappy) {
            plan.stops.append(PlanStop(id: plan.nextKey, name: place.name, flag: place.flag, at: place.at, nights: 1, mode: .car, serverId: serverId))
            plan.nextKey += 1
            plan.query = ""
        }
        focused = false
        if let serverId { saver.run($plan) { try await Remote.addStop(trip, id: serverId, place: place, nights: 1, afterStopId: after) } }
    }
}
