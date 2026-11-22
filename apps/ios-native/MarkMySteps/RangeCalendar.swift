import SwiftUI

/*
 * A calendar of one month at a time, made for picking the days of a trip, after Android's RangeCalendar.
 *
 * Press a day and drag to the last one; let go and the range stays. Either end can be picked up again and
 * dragged to another day. A tap starts a new range, a second tap after it closes it. Every day the finger
 * passes gives a light tick. The month changes with the arrows, sliding the way you go. The weekday letters
 * are small and quiet, so they never look like dates. Monday is the first day, in Dutch.
 */

struct RangeCalendar: View {
    @Binding var start: Date?
    @Binding var end: Date?
    @State private var month: Date
    @State private var forward = true

    private static let weekdays = ["MA", "DI", "WO", "DO", "VR", "ZA", "ZO"]
    private let cellHeight: CGFloat = 46

    init(start: Binding<Date?>, end: Binding<Date?>) {
        _start = start
        _end = end
        let c = RangeCalendar.calendar
        let base = start.wrappedValue ?? c.startOfDay(for: Date())
        _month = State(initialValue: c.date(from: c.dateComponents([.year, .month], from: base)) ?? base)
    }

    /// The app's calendar (UTC days) with the week starting on Monday.
    static var calendar: Calendar {
        var c = Format.calendar
        c.firstWeekday = 2
        return c
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                arrow(-1)
                Text("\(Format.monthsLong[RangeCalendar.calendar.component(.month, from: month) - 1]) \(String(RangeCalendar.calendar.component(.year, from: month)))")
                    .font(.outfit(19, 650))
                    .foregroundStyle(Brand.ink)
                    .frame(maxWidth: .infinity)
                    .id(month)
                    .transition(.push(from: forward ? .trailing : .leading))
                arrow(1)
            }
            .clipped()
            .padding(.bottom, 10)
            HStack(spacing: 0) {
                ForEach(RangeCalendar.weekdays, id: \.self) { d in
                    Text(d)
                        .font(.inter(11.5, 600))
                        .tracking(0.4)
                        .foregroundStyle(Brand.inkSoft.opacity(0.75))
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.bottom, 4)
            MonthGrid(month: month, start: $start, end: $end, cellHeight: cellHeight)
                .id(month)
                .transition(.asymmetric(insertion: .push(from: forward ? .trailing : .leading), removal: .push(from: forward ? .trailing : .leading)))
                .frame(height: cellHeight * 6, alignment: .top)
                .clipped()
        }
    }

    private func arrow(_ step: Int) -> some View {
        Button {
            Haptic.tap()
            forward = step > 0
            withAnimation(.smooth(duration: 0.35)) {
                month = RangeCalendar.calendar.date(byAdding: .month, value: step, to: month) ?? month
            }
        } label: {
            Image(systemName: step < 0 ? "chevron.left" : "chevron.right")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Brand.inkSoft)
                .frame(width: 44, height: 44)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(step < 0 ? "Vorige maand" : "Volgende maand")
    }
}

private struct MonthGrid: View {
    let month: Date
    @Binding var start: Date?
    @Binding var end: Date?
    let cellHeight: CGFloat

    /// Which end the finger holds while dragging, and the other end it pivots around.
    @State private var anchor: Date?
    @State private var holdingNew = false
    @State private var lastDay: Date?
    @State private var dragging = false
    @State private var firstDay: Date?

    private var cal: Calendar { RangeCalendar.calendar }
    private var lead: Int { (cal.component(.weekday, from: month) + 5) % 7 }
    private var count: Int { cal.range(of: .day, in: .month, for: month)?.count ?? 30 }
    private var today: Date { cal.startOfDay(for: Date()) }

    var body: some View {
        GeometryReader { geo in
            let cellWidth = geo.size.width / 7
            VStack(spacing: 0) {
                ForEach(0..<6, id: \.self) { r in
                    HStack(spacing: 0) {
                        ForEach(0..<7, id: \.self) { c in
                            let n = r * 7 + c - lead + 1
                            Group {
                                if n >= 1 && n <= count, let day = cal.date(byAdding: .day, value: n - 1, to: month) {
                                    cell(day, column: c, number: n)
                                } else {
                                    Color.clear
                                }
                            }
                            .frame(width: cellWidth, height: cellHeight)
                        }
                    }
                }
            }
            .contentShape(.rect)
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { g in changed(g, cellWidth: cellWidth) }
                    .onEnded { g in ended(g, cellWidth: cellWidth) }
            )
        }
    }

    private func day(at p: CGPoint, cellWidth: CGFloat) -> Date? {
        guard p.y >= 0 else { return nil }
        let col = min(6, max(0, Int(p.x / cellWidth)))
        let row = Int(p.y / cellHeight)
        let n = row * 7 + col - lead + 1
        guard n >= 1 && n <= count else { return nil }
        return cal.date(byAdding: .day, value: n - 1, to: month)
    }

    private func changed(_ g: DragGesture.Value, cellWidth: CGFloat) {
        if firstDay == nil {
            guard let first = day(at: g.startLocation, cellWidth: cellWidth) else { return }
            firstDay = first
            lastDay = first
            // An existing end picked up again, or a new range from this day.
            if let s = start, let e = end, first == e { anchor = s; holdingNew = false }
            else if let s = start, let e = end, first == s { anchor = e; holdingNew = false }
            else { anchor = first; holdingNew = true }
        }
        guard let first = firstDay, let anchor else { return }
        if !dragging && hypot(g.translation.width, g.translation.height) > 8 {
            dragging = true
            Haptic.select()
            if holdingNew { set(first, first) }
        }
        guard dragging, let d = day(at: g.location, cellWidth: cellWidth), d != lastDay else { return }
        lastDay = d
        Haptic.select()
        // The held end follows the finger; past the other end the two simply swap roles.
        if d < anchor { set(d, anchor) } else { set(anchor, d) }
    }

    private func ended(_ g: DragGesture.Value, cellWidth: CGFloat) {
        defer { firstDay = nil; anchor = nil; dragging = false; lastDay = nil }
        guard !dragging, let first = firstDay else { return }
        // A tap: the first day of a new range, or the last day of one that has only a start.
        Haptic.tap()
        if let s = start, end == nil, first >= s { set(s, first) } else { set(first, nil) }
    }

    private func set(_ s: Date?, _ e: Date?) {
        withAnimation(.smooth(duration: 0.2)) {
            start = s
            end = e
        }
    }

    @ViewBuilder private func cell(_ day: Date, column: Int, number: Int) -> some View {
        let last = end ?? start
        let isStart = day == start
        let isEnd = day == last
        let inRange = start != nil && last != nil && day >= start! && day <= last!
        let endpoint = isStart || isEnd
        // The band between the ends, joined across the week, rounded where a week or the range starts or stops.
        let roundLeft = isStart || column == 0 || number == 1
        let roundRight = isEnd || column == 6 || number == count
        ZStack {
            if inRange && start != last {
                UnevenRoundedRectangle(topLeadingRadius: roundLeft ? 20 : 0, bottomLeadingRadius: roundLeft ? 20 : 0,
                                       bottomTrailingRadius: roundRight ? 20 : 0, topTrailingRadius: roundRight ? 20 : 0)
                    .fill(Brand.accent.opacity(0.16))
                    .padding(.vertical, 3)
                    .padding(.leading, isStart ? 3 : 0)
                    .padding(.trailing, isEnd ? 3 : 0)
            }
            if endpoint {
                Circle().fill(Brand.accent).padding(3)
            } else if day == today {
                Circle().strokeBorder(Brand.accent.opacity(0.6), lineWidth: 1.5).padding(4)
            }
            Text("\(number)")
                .font(.inter(16, endpoint ? 650 : 500))
                .foregroundStyle(endpoint ? Color.white : Brand.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Format.dayHeading(day))
        .accessibilityAddTraits(endpoint ? .isSelected : [])
    }
}
