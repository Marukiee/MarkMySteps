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
    var flightNumber: String? = nil
    var fromAirport: String? = nil
    var toAirport: String? = nil
    var via: [String] = []
    var dayTrips: [PlanDayTrip] = []
}

/// A day trip on the plan, with a key of its own.
struct PlanDayTrip: Identifiable, Hashable {
    let id: Int
    var trip: DayTrip
}

/// Something removed that can still come back for 7 seconds: a stop, the way there or back, or a day trip.
struct PendingDelete: Equatable {
    enum Kind: Equatable {
        case stop(PlanStop, index: Int)
        case leg(outbound: Bool, Leg)
        case dayTrip(stop: Int, PlanDayTrip, index: Int)
    }
    let kind: Kind
    let name: String
    let serverId: String?
    let at: Date
}

/// Which flight the flight sheet fills in.
struct FlightTarget: Identifiable, Equatable {
    enum Kind: Equatable { case leg(outbound: Bool), stop(Int) }
    let id = UUID()
    let kind: Kind
    let title: String
    let subtitle: String?
    let number: String
    let from: String?
    let to: String?
    let via: [String]
    let nearFrom: LonLat?
    let nearTo: LonLat?
}

struct PlanState {
    var stops: [PlanStop]
    var outbound: Leg?
    var back: Leg?
    var nextKey: Int
    var query = ""
    var pending: PendingDelete?
    var error: String?
    var flight: FlightTarget?

    init(trip: Trip) {
        var key = trip.stops.count
        stops = trip.stops.enumerated().map { i, s in
            PlanStop(id: i, name: s.name, flag: s.flag, at: s.at, nights: s.nights, mode: s.mode, serverId: s.serverId,
                     flightNumber: s.flightNumber, fromAirport: s.fromAirport, toAirport: s.toAirport, via: s.via,
                     dayTrips: s.dayTrips.map { d in key += 1; return PlanDayTrip(id: key, trip: d) })
        }
        outbound = trip.outbound
        back = trip.back
        nextKey = key + 1
    }

    /// Every stop of the route in its order, the way there first and the way back last, as the server asks.
    var routeOrder: [String] {
        [outbound?.serverId].compactMap { $0 } + stops.compactMap(\.serverId) + [back?.serverId].compactMap { $0 }
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

    /// Takes something off the plan now, and off the server once the undo pill has gone, 7 seconds later. An earlier
    /// removal that is still waiting goes for good first.
    func remove(_ trip: Trip, _ plan: Binding<PlanState>, send: Bool, _ pending: PendingDelete, apply: () -> Void) {
        if let earlier = plan.wrappedValue.pending, send, let sid = earlier.serverId {
            run(plan) { try await Remote.deleteStop(trip, sid) }
        }
        withAnimation(.calm) {
            apply()
            plan.wrappedValue.pending = pending
        }
        deleteTask?.cancel()
        deleteTask = Task {
            try? await Task.sleep(for: .seconds(7))
            guard !Task.isCancelled, let pending = plan.wrappedValue.pending else { return }
            withAnimation(.calm) { plan.wrappedValue.pending = nil }
            if send, let id = pending.serverId { run(plan) { try await Remote.deleteStop(trip, id) } }
        }
    }

    func undo(_ plan: Binding<PlanState>) {
        deleteTask?.cancel()
        guard let p = plan.wrappedValue.pending else { return }
        withAnimation(.calm) {
            switch p.kind {
            case let .stop(stop, index):
                plan.wrappedValue.stops.insert(stop, at: min(index, plan.wrappedValue.stops.count))
            case let .leg(outbound, leg):
                if outbound { plan.wrappedValue.outbound = leg } else { plan.wrappedValue.back = leg }
            case let .dayTrip(key, dt, index):
                if let i = plan.wrappedValue.stops.firstIndex(where: { $0.id == key }) {
                    plan.wrappedValue.stops[i].dayTrips.insert(dt, at: min(index, plan.wrappedValue.stops[i].dayTrips.count))
                }
            }
            plan.wrappedValue.pending = nil
        }
    }

    /// The flight sheet's Opslaan: the plan shows it at once, the server hears it behind.
    func saveFlight(_ trip: Trip, _ plan: Binding<PlanState>, _ target: FlightTarget, send: Bool, number: String, from: String?, to: String?, via: [String]) {
        let n = PlannerRemote.cleanNumber(number)
        let f = PlannerRemote.cleanCode(from), t = PlannerRemote.cleanCode(to)
        let v = via.compactMap(PlannerRemote.cleanCode)
        var serverId: String?
        withAnimation(.calm) {
            switch target.kind {
            case let .leg(outbound):
                guard var leg = outbound ? plan.wrappedValue.outbound : plan.wrappedValue.back else { return }
                leg.mode = .flight; leg.flightNumber = n; leg.fromAirport = f; leg.toAirport = t; leg.via = v
                if let f { leg.from = f }
                if let t { leg.to = t }
                serverId = leg.serverId
                if outbound { plan.wrappedValue.outbound = leg } else { plan.wrappedValue.back = leg }
            case let .stop(key):
                guard let i = plan.wrappedValue.stops.firstIndex(where: { $0.id == key }) else { return }
                plan.wrappedValue.stops[i].mode = .flight
                plan.wrappedValue.stops[i].flightNumber = n
                plan.wrappedValue.stops[i].fromAirport = f
                plan.wrappedValue.stops[i].toAirport = t
                plan.wrappedValue.stops[i].via = v
                serverId = plan.wrappedValue.stops[i].serverId
            }
        }
        if send, let id = serverId { run(plan) { try await PlannerRemote.saveFlight(trip, id, number: number, from: f, to: t, via: v) } }
    }
}

struct PlannerRows: View {
    let trip: Trip
    @Binding var plan: PlanState
    /// Called when the add-a-stop field gets the keyboard, so the page can lift it into view.
    var onFocusAdd: () -> Void = {}
    var saver: PlanSaver
    /// Brings a row into view above the keyboard, by its id.
    var onReveal: (String) -> Void = { _ in }
    @Environment(\.colorScheme) private var scheme
    @Environment(Store.self) private var store
    /// The stop whose day trip panel is open.
    @State private var dayTripFor: Int?

    /// Real trips save; guests only look.
    static func saves(_ trip: Trip, me: String?) -> Bool {
        trip.remoteId != nil && (trip.members.first { $0.userId == me }?.role ?? "MEMBER") != "GUEST"
    }
    private var saves: Bool { Self.saves(trip, me: store.me?.id) }

    private func legBinding(_ key: WritableKeyPath<PlanState, Leg?>, outbound: Bool) -> Binding<Mode> {
        Binding(get: { plan[keyPath: key]?.mode ?? .car }, set: { mode in
            guard var leg = plan[keyPath: key] else { return }
            let old = leg.mode
            if old != mode {
                leg.mode = mode
                // Away from a flight the server forgets the airports; so does the screen.
                if mode != .flight { leg.flightNumber = nil; leg.fromAirport = nil; leg.toAirport = nil; leg.via = [] }
                plan[keyPath: key] = leg
                if saves, let id = leg.serverId { saver.run($plan) { try await PlannerRemote.setMode(trip, id, mode) } }
            }
            if mode == .flight { later { openLegFlight(outbound: outbound) } }
        })
    }

    private func stopBinding(_ stop: Binding<PlanStop>) -> Binding<PlanStop> {
        Binding(get: { stop.wrappedValue }, set: { new in
            var new = new
            let old = stop.wrappedValue
            if old.mode != new.mode && new.mode != .flight { new.flightNumber = nil; new.fromAirport = nil; new.toAirport = nil; new.via = [] }
            stop.wrappedValue = new
            if new.mode == .flight && old.mode != .flight { later { openStopFlight(new.id) } }
            guard saves else { return }
            if old.nights != new.nights { saver.nights(trip, $plan, stop: new) }
            if old.mode != new.mode, let id = new.serverId { saver.run($plan) { try await PlannerRemote.setMode(trip, id, new.mode) } }
        })
    }

    /// After the menu has folded away, so the sheet does not fight it.
    private func later(_ work: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: work) }

    private func openLegFlight(outbound: Bool) {
        guard let leg = outbound ? plan.outbound : plan.back else { return }
        let home = Prefs.airports.first
        plan.flight = FlightTarget(
            kind: .leg(outbound: outbound), title: outbound ? "Heenvlucht" : "Terugvlucht",
            subtitle: outbound ? plan.stops.first.map { "Naar \($0.name)" } : plan.stops.last.map { "Vanuit \($0.name)" },
            number: leg.flightNumber ?? "", from: leg.airportFrom ?? (outbound ? home : nil), to: leg.airportTo ?? (outbound ? nil : home), via: leg.via,
            nearFrom: outbound ? nil : plan.stops.last?.at, nearTo: outbound ? plan.stops.first?.at : nil
        )
    }

    private func openStopFlight(_ key: Int) {
        guard let i = plan.stops.firstIndex(where: { $0.id == key }) else { return }
        let stop = plan.stops[i]
        let prev = i > 0 ? plan.stops[i - 1] : nil
        plan.flight = FlightTarget(
            kind: .stop(key), title: "Vlucht naar \(stop.name)", subtitle: prev.map { "Vanuit \($0.name)" },
            number: stop.flightNumber ?? "", from: stop.fromAirport, to: stop.toAirport, via: stop.via,
            nearFrom: prev?.at, nearTo: stop.at
        )
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
                .animation(.calm, value: planned)
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

        if let leg = plan.outbound {
            LegRow(name: "Heen", leg: leg, mode: legBinding(\.outbound, outbound: true), color: color) { openLegFlight(outbound: true) }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) { removeLeg(outbound: true) } label: { Label("Verwijderen", systemImage: "trash") }
                }
                .plainRow(bottom: 0)
        } else {
            AddLegRow(label: "Heenreis toevoegen") { addLeg(outbound: true, mode: $0) }
                .plainRow(bottom: plan.stops.isEmpty ? 0 : 12)
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
                color: color,
                editable: trip.remoteId == nil || saves,
                dayTripOpen: dayTripFor == stop.id,
                onFlight: { openStopFlight(stop.id) },
                onDayTrip: {
                    withAnimation(.calm) { dayTripFor = dayTripFor == stop.id ? nil : stop.id }
                    if dayTripFor == stop.id { onReveal("stop\(stop.id)") }
                },
                onRemoveDayTrip: { dt in removeDayTrip(stop.id, dt) },
                panel: {
                    DayTripPanel(trip: trip, parent: stop.name, days: stayDays(index), taken: Set(stop.dayTrips.map(\.trip.name)),
                                 onResults: { onReveal("stop\(stop.id)") }) { place, day in
                        addDayTrip(stop.id, place, day)
                    } onClose: {
                        withAnimation(.calm) { dayTripFor = nil }
                    }
                }
            )
            .plainRow(bottom: 0)
            .id("stop\(stop.id)")
        }
        // The system's own swipe to delete, which also lets go of the touch afterwards,
        // so the undo pill answers its first tap.
        .onDelete { offsets in
            guard let i = offsets.first, plan.stops.indices.contains(i) else { return }
            let row = plan.stops[i]
            saver.remove(trip, $plan, send: saves, PendingDelete(kind: .stop(row, index: i), name: row.name, serverId: row.serverId, at: Date())) {
                plan.stops.remove(at: i)
            }
        }
        .onMove { from, to in
            withAnimation(.calm) { plan.stops.move(fromOffsets: from, toOffset: to) }
            guard saves else { return }
            let ids = plan.routeOrder
            saver.run($plan) { try await Remote.reorderStops(trip, ids) }
        }

        if let leg = plan.back {
            LegRow(name: "Terug", leg: leg, mode: legBinding(\.back, outbound: false), color: color) { openLegFlight(outbound: false) }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) { removeLeg(outbound: false) } label: { Label("Verwijderen", systemImage: "trash") }
                }
                .plainRow(top: 12)
        } else if !plan.stops.isEmpty {
            AddLegRow(label: "Terugreis toevoegen") { addLeg(outbound: false, mode: $0) }
                .plainRow(top: 12)
        }

        AddStopCard(trip: trip, plan: $plan, saves: saves, saver: saver, onFocus: onFocusAdd)
            .plainRow(top: 20)
            .id("add")
    }

    // MARK: Changes

    private func addLeg(outbound: Bool, mode: Mode) {
        Haptic.tap()
        let id = saves ? UUID().uuidString.lowercased() : nil
        let leg = Leg(mode: mode, from: outbound ? "Thuis" : "", to: outbound ? "" : "Thuis", km: 0, serverId: id)
        withAnimation(.calm) { if outbound { plan.outbound = leg } else { plan.back = leg } }
        if let id {
            let order = outbound ? plan.routeOrder : nil
            saver.run($plan) { try await PlannerRemote.addLeg(trip, id: id, outbound: outbound, mode: mode, order: order) }
        }
        if mode == .flight { later { openLegFlight(outbound: outbound) } }
    }

    private func removeLeg(outbound: Bool) {
        guard let leg = outbound ? plan.outbound : plan.back else { return }
        saver.remove(trip, $plan, send: saves, PendingDelete(kind: .leg(outbound: outbound, leg), name: outbound ? "Heenreis" : "Terugreis", serverId: leg.serverId, at: Date())) {
            if outbound { plan.outbound = nil } else { plan.back = nil }
        }
    }

    private func addDayTrip(_ key: Int, _ place: Remote.Place, _ day: Date) {
        guard let i = plan.stops.firstIndex(where: { $0.id == key }) else { return }
        Haptic.tap()
        let id = saves ? UUID().uuidString.lowercased() : nil
        let dt = PlanDayTrip(id: plan.nextKey, trip: DayTrip(name: place.name, flag: place.flag, at: place.at, day: day, serverId: id))
        withAnimation(.calm) {
            plan.nextKey += 1
            plan.stops[i].dayTrips.append(dt)
            plan.stops[i].dayTrips.sort { ($0.trip.day ?? .distantPast) < ($1.trip.day ?? .distantPast) }
            dayTripFor = nil
        }
        if let id, let parent = plan.stops[i].serverId {
            saver.run($plan) { try await PlannerRemote.addDayTrip(trip, id: id, parentId: parent, place: place, day: day) }
        }
    }

    private func removeDayTrip(_ key: Int, _ dt: PlanDayTrip) {
        guard let i = plan.stops.firstIndex(where: { $0.id == key }), let at = plan.stops[i].dayTrips.firstIndex(of: dt) else { return }
        saver.remove(trip, $plan, send: saves, PendingDelete(kind: .dayTrip(stop: key, dt, index: at), name: dt.trip.name, serverId: dt.trip.serverId, at: Date())) {
            plan.stops[i].dayTrips.remove(at: at)
        }
    }

    // MARK: Dates and distances

    /// The first day at a stop, counted on from the trip's first day.
    private func arrival(_ index: Int) -> Date? {
        guard let first = trip.firstDay else { return nil }
        let before = plan.stops.prefix(index).reduce(0) { $0 + $1.nights }
        return Format.calendar.date(byAdding: .day, value: before, to: first)
    }

    /// The days of a stay a day trip can be on: each day from arriving up to the last night.
    private func stayDays(_ index: Int) -> [Date] {
        guard let from = arrival(index), plan.stops.indices.contains(index) else { return [] }
        return (0..<max(1, plan.stops[index].nights)).compactMap { Format.calendar.date(byAdding: .day, value: $0, to: from) }
    }

    /// "4 t/m 7 dec" for a stop, counted on from the trip's first day.
    private func dates(upTo index: Int) -> String {
        guard let from = arrival(index), plan.stops.indices.contains(index) else { return "" }
        let nights = plan.stops[index].nights
        if nights == 0 { return Format.shortDay(from) }
        let to = Format.calendar.date(byAdding: .day, value: nights, to: from) ?? from
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
        .animation(.calm, value: share)
        .accessibilityHidden(true)
    }
}

/// How a leg is travelled: a capsule that opens the system menu.
struct ModeMenu: View {
    @Binding var mode: Mode

    var body: some View {
        Menu {
            Picker("Vervoer", selection: $mode.animation(.calm)) {
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
                Text(mode.label).font(.outfit(13.5, 600)).fixedSize()
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

/// The outlined accent pill of a flight: its airports, else its number, else an invitation to fill it in.
private struct AirportPill: View {
    let number: String?
    let from: String?
    let to: String?
    let via: [String]
    let color: Color
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "airplane").font(.system(size: 11, weight: .bold))
                if let from, let to {
                    Text(from)
                    Image(systemName: "arrow.right").font(.system(size: 9, weight: .bold))
                    Text(to)
                    // Layovers as a small count; the sheet names them.
                    if !via.isEmpty {
                        Text("+\(via.count)").font(.outfit(11, 700)).padding(.horizontal, 5).padding(.vertical, 1)
                            .background(color.opacity(0.16), in: .capsule)
                    }
                } else if let number {
                    Text(number)
                } else {
                    Text("Vlucht invullen")
                }
            }
            .font(.outfit(13, 650))
            .foregroundStyle(color)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 11)
            .frame(height: 32)
            .background(color.opacity(0.1), in: .capsule)
            .overlay { Capsule().strokeBorder(color, lineWidth: 1.5) }
            .contentShape(.capsule)
        }
        .buttonStyle(PressStyle(scale: 0.95))
        .accessibilityLabel("Vlucht bewerken")
    }
}

/// The way there or back: its name, how (from a menu), the airports of a flight, and how long or far.
private struct LegRow: View {
    let name: String
    let leg: Leg
    @Binding var mode: Mode
    let color: Color
    let onFlight: () -> Void
    /// Bumped once the airport list is in, so the flight time appears.
    @State private var airportsIn = false

    var body: some View {
        let _ = airportsIn
        let codes = [leg.airportFrom].compactMap { $0 } + leg.via + [leg.airportTo].compactMap { $0 }
        let time = leg.mode == .flight && leg.airportFrom != nil && leg.airportTo != nil ? FlightAirports.flightTime(codes) : nil
        HStack(spacing: 10) {
            Text(name).font(.outfit(17, 650)).foregroundStyle(Brand.ink).frame(width: 52, alignment: .leading)
            if leg.mode == .flight {
                AirportPill(number: leg.flightNumber, from: leg.airportFrom, to: leg.airportTo, via: leg.via, color: color, action: onFlight)
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
                if let time {
                    // Only when there is room for it beside the pill and the mode.
                    ViewThatFits { Text(time).font(.inter(13, 500)).foregroundStyle(Brand.inkSoft).fixedSize(); Color.clear.frame(width: 0) }
                }
            } else if !leg.from.isEmpty && !leg.to.isEmpty {
                HStack(spacing: 6) {
                    Text(leg.from)
                    Image(systemName: "arrow.right").font(.system(size: 12, weight: .bold)).foregroundStyle(Brand.inkSoft)
                    Text(leg.to)
                }
                .font(.outfit(15, 600))
                .foregroundStyle(Brand.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 4)
            if leg.mode != .flight && leg.km > 0 {
                Text(Format.km(leg.km)).font(.inter(13, 500)).foregroundStyle(Brand.inkSoft).fixedSize()
            }
            ModeMenu(mode: $mode)
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .padding(.vertical, 10)
        .background(Brand.raised, in: .rect(cornerRadius: 22))
        .animation(.calm, value: leg.mode)
        .task {
            await FlightAirports.shared.load()
            withAnimation(.calm) { airportsIn = true }
        }
    }
}

/// A quiet row to add the way there or back; the mode is picked from the menu it opens.
private struct AddLegRow: View {
    let label: String
    let onAdd: (Mode) -> Void

    var body: some View {
        HStack {
            Menu {
                ForEach(Mode.allCases) { m in
                    Button(m.label, systemImage: m.symbol) { onAdd(m) }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 13, weight: .bold))
                    Text(label)
                }
                    .font(.outfit(14.5, 600))
                    .foregroundStyle(Brand.accent)
                    .padding(.leading, 14)
                    .padding(.trailing, 18)
                    .frame(height: 40)
                    .background(Brand.raised, in: .capsule)
                    .contentShape(.capsule)
            }
            .buttonStyle(.borderless)
            Spacer()
        }
    }
}

private struct StopRow<Panel: View>: View {
    @Environment(\.colorScheme) private var scheme
    @Binding var stop: PlanStop
    let index: Int
    let dates: String
    let km: Int?
    let showConnector: Bool
    let color: Color
    let editable: Bool
    let dayTripOpen: Bool
    let onFlight: () -> Void
    let onDayTrip: () -> Void
    let onRemoveDayTrip: (PlanDayTrip) -> Void
    @ViewBuilder let panel: () -> Panel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showConnector {
                // Between two stops: the line in the trip's colour, how the road was travelled and how far.
                HStack(spacing: 0) {
                    Rectangle().fill(color.opacity(0.35)).frame(width: 2)
                    if index > 0 {
                        ModeMenu(mode: $stop.mode).padding(.leading, 18)
                        if stop.mode == .flight {
                            AirportPill(number: stop.flightNumber, from: stop.fromAirport, to: stop.toAirport, via: stop.via, color: color, action: onFlight)
                                .padding(.leading, 8)
                                .transition(.scale(scale: 0.8).combined(with: .opacity))
                        } else if let km {
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
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    // In dark the number is a light version of the trip's colour: the plain one was brown on dark.
                    Text("\(index + 1)")
                        .font(.outfit(17, 700))
                        .foregroundStyle(scheme == .dark ? Geo.legible(color, dark: true, darkFloor: 0.74) : color)
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
                    Stepper("Nachten in \(stop.name)", value: $stop.nights.animation(.calm), in: 0...60)
                        .labelsHidden()
                        .fixedSize()
                }
                ForEach(stop.dayTrips) { dt in
                    DayTripRow(dt: dt, editable: editable) { onRemoveDayTrip(dt) }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                if dayTripOpen {
                    panel().transition(.opacity.combined(with: .move(edge: .top)))
                } else if editable {
                    Button {
                        Haptic.tap()
                        onDayTrip()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                            Text("Dagtrip")
                        }
                            .font(.outfit(13.5, 600))
                            .foregroundStyle(Brand.accent)
                            .padding(.horizontal, 12)
                            .frame(height: 32)
                            .background(Brand.sunken, in: .capsule)
                            .contentShape(.capsule)
                    }
                    .buttonStyle(.borderless)
                    .padding(.top, 10)
                    .padding(.leading, 56)
                }
            }
            .padding(12)
            .background(Brand.raised, in: .rect(cornerRadius: 22))
            .animation(.calm, value: stop.dayTrips.map(\.id))
            .animation(.calm, value: dayTripOpen)
        }
        .contentShape(.rect)
    }
}

/// A day trip under its stop: the place, "Dagtrip · 5 aug", and a cross to take it off.
private struct DayTripRow: View {
    let dt: PlanDayTrip
    let editable: Bool
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            FlagView(flag: dt.trip.flag, height: 13)
                .frame(width: 40, height: 40)
                .background(Brand.raised, in: .rect(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 1) {
                Text(dt.trip.name).font(.outfit(15, 600)).foregroundStyle(Brand.ink).lineLimit(1)
                Text("Dagtrip" + (dt.trip.day.map { " · \(Format.shortDay($0))" } ?? "")).font(.inter(12.5, 500)).foregroundStyle(Brand.inkSoft)
            }
            Spacer(minLength: 6)
            if editable {
                // A cross, as on the web: the rows are small, and a swipe on something this size is fiddly.
                Button {
                    Haptic.tap()
                    onRemove()
                } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Brand.inkSoft)
                        .frame(width: 32, height: 32)
                        .background(Brand.raised, in: .circle)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("\(dt.trip.name) verwijderen")
            }
        }
        .padding(6)
        .background(Brand.sunken, in: .rect(cornerRadius: 18))
        .padding(.top, 8)
    }
}

/// Where the day trip went, searched like a new stop, and on which day of the stay.
private struct DayTripPanel: View {
    let trip: Trip
    let parent: String
    let days: [Date]
    let taken: Set<String>
    var onResults: () -> Void = {}
    let onPick: (Remote.Place, Date) -> Void
    let onClose: () -> Void
    @State private var query = ""
    @State private var chosen: Date?
    @State private var found: [Remote.Place] = []
    @FocusState private var focused: Bool

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        let matches: [Remote.Place] = trip.remoteId != nil
            ? found.filter { !taken.contains($0.name) && $0.name != parent }
            : (q.isEmpty ? [] : Demo.places.filter { !taken.contains($0.name) && $0.name.localizedCaseInsensitiveContains(q) }.prefix(4)
                .map { Remote.Place(name: $0.name, region: "", countryCode: Remote.code(fromFlag: $0.flag), at: $0.at) })
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .medium)).foregroundStyle(Brand.inkSoft)
                TextField("Waar ging je heen vanuit \(parent)?", text: $query)
                    .font(.inter(16))
                    .focused($focused)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(Brand.sunken, in: .capsule)
            if days.count > 1 {
                Text("Welke dag?").font(.outfit(13.5, 600)).foregroundStyle(Brand.inkSoft).padding(.leading, 4)
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(days, id: \.self) { d in
                            let on = d == (chosen ?? days.first)
                            Button {
                                if !on { Haptic.select() }
                                withAnimation(.calm) { chosen = d }
                            } label: {
                                HStack(spacing: 5) {
                                    if on { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)) }
                                    Text(Format.shortDay(d)).font(.inter(13, 600))
                                }
                                .foregroundStyle(on ? Color.white : Brand.ink)
                                .padding(.horizontal, 12)
                                .frame(height: 34)
                                .background(on ? Brand.accent : Brand.sunken, in: .capsule)
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
                .scrollIndicators(.hidden)
                .contentMargins(.horizontal, 12, for: .scrollContent)
                .padding(.horizontal, -12)
            }
            VStack(spacing: 0) {
                ForEach(matches) { place in
                    Button { onPick(place, chosen ?? days.first ?? trip.firstDay ?? Date()) } label: {
                        HStack(spacing: 8) {
                            FlagView(flag: place.flag, height: 13)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(place.name).font(.outfit(15, 600)).foregroundStyle(Brand.ink)
                                if !place.region.isEmpty { Text(place.region).font(.inter(12.5, 450)).foregroundStyle(Brand.inkSoft).lineLimit(1) }
                            }
                            Spacer()
                            Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(Brand.accent)
                        }
                        .padding(.vertical, 9)
                        .padding(.horizontal, 4)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.borderless)
                }
            }
            .animation(.calm, value: matches.map(\.id))
            .onChange(of: matches.count) { onResults() }
            if q.isEmpty {
                Button("Annuleren", action: onClose).font(.outfit(14, 600)).foregroundStyle(Brand.accent).buttonStyle(.borderless).padding(.leading, 4)
            }
        }
        .padding(.top, 12)
        .task {
            try? await Task.sleep(for: .milliseconds(320))
            focused = true
        }
        .task(id: q) {
            guard trip.remoteId != nil else { return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            found = await Remote.searchPlaces(q)
        }
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
            .animation(.calm, value: matches.map(\.id))

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
        .animation(.calm, value: query.isEmpty)
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
        withAnimation(.calm) {
            plan.stops.append(PlanStop(id: plan.nextKey, name: place.name, flag: place.flag, at: place.at, nights: 1, mode: .car, serverId: serverId))
            plan.nextKey += 1
            plan.query = ""
        }
        focused = false
        if let serverId { saver.run($plan) { try await Remote.addStop(trip, id: serverId, place: place, nights: 1, afterStopId: after) } }
    }
}
