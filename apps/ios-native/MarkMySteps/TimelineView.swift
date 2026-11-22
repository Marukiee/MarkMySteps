import SwiftUI

/*
 * The timeline as in today's app: the places of the trip as a row of photo
 * cards at the top, then day by day the date, where you were and the weather,
 * with all of that day's photos underneath, joined by a line down the left.
 * These are rows of the trip page's List.
 */

private struct TimelineDay: Identifiable {
    let day: TripDay
    let photos: [Media]
    let weather: Int?
    var id: Date { day.date }
}

struct TimelineRows: View {
    let trip: Trip
    let media: [Media]?
    let ns: Namespace.ID
    let onPhoto: (ViewerItem) -> Void

    var body: some View {
        let days = timelineDays
        // The places row only earns its place when there are several.
        if trip.mapStops.count > 1 {
            Text("Plaatsen")
                .font(.outfit(18, 650))
                .foregroundStyle(Brand.ink)
                .plainRow(bottom: 12)
            places
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
        if media == nil && trip.remoteId != nil {
            // The photos are on their way: a calm block in the size of a day, so nothing jumps.
            ProgressView()
                .frame(maxWidth: .infinity, minHeight: 220)
                .background(Brand.raised, in: .rect(cornerRadius: 20))
                .plainRow(top: 26)
        } else if media != nil && days.isEmpty {
            Text(trip.upcoming ? "De foto's komen hier vanzelf zodra de reis begint" : "Nog geen foto's bij deze reis")
                .font(.inter(14, 500))
                .foregroundStyle(Brand.inkSoft)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(Brand.raised, in: .rect(cornerRadius: 20))
                .plainRow(top: 26)
        }
        ForEach(Array(days.enumerated()), id: \.element.id) { i, day in
            DayRow(day: day, upcoming: trip.upcoming, last: i == days.count - 1, color: Brand.accent, ns: ns, onPhoto: onPhoto)
                .plainRow(top: i == 0 ? 26 : 0)
                .id(i == 0 ? "days" : "day\(i)")
        }
    }

    /// The places, each a photo with its name, wider than the screen so the row asks to be swiped.
    private var places: some View {
        let unique = trip.mapStops.map(\.stop)
        return ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(Array(unique.enumerated()), id: \.element.name) { i, stop in
                    placePhoto(stop, index: i)
                        .frame(width: 138, height: 168)
                        .overlay {
                            LinearGradient(stops: [.init(color: .clear, location: 0.45), .init(color: .black.opacity(0.62), location: 1)], startPoint: .top, endPoint: .bottom)
                        }
                        .overlay(alignment: .bottomLeading) {
                            Text(stop.name)
                                .font(.outfit(17, 650))
                                .foregroundStyle(.white)
                                .lineLimit(2)
                                .padding(12)
                        }
                        .clipShape(.rect(cornerRadius: 22))
                }
            }
        }
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .scrollIndicators(.hidden)
    }

    @ViewBuilder private func placePhoto(_ stop: Stop, index: Int) -> some View {
        if trip.remoteId != nil && media == nil {
            Rectangle().fill(Brand.sunken)
        } else if let media {
            if let pick = media.first(where: { !$0.video && stopOn($0.takenAt)?.name == stop.name }) {
                RemotePhoto(id: pick.id, size: "preview")
            } else {
                Rectangle().fill(Brand.sunken)
            }
        } else {
            LandscapeView(scene: Landscape.allCases[(index * 2 + 1) % Landscape.allCases.count])
        }
    }

    private func stopOn(_ date: Date) -> Stop? {
        trip.stops.last { s in s.start.map { $0 <= date } ?? false } ?? trip.stops.first
    }

    private var timelineDays: [TimelineDay] {
        guard let media else {
            // A real trip shows its own photos or placeholders, never the demo's.
            if trip.remoteId != nil { return [] }
            // The demo: each night at its stop, with drawn photos.
            return trip.demoDays.map { d in
                TimelineDay(day: d, photos: trip.upcoming ? [] : Demo.media(trip, day: d.index, date: d.date), weather: Demo.weather(trip, day: d.index))
            }
        }
        let photos = media.filter { !$0.video }
        let groups = Dictionary(grouping: photos, by: \.takenAt)
        return groups.keys.sorted().enumerated().map { i, date in
            TimelineDay(day: TripDay(date: date, stop: stopOn(date), index: i), photos: groups[date] ?? [], weather: nil)
        }
    }
}

private struct DayRow: View {
    let day: TimelineDay
    let upcoming: Bool
    let last: Bool
    let color: Color
    let ns: Namespace.ID
    let onPhoto: (ViewerItem) -> Void
    @State private var all = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                Circle().fill(color).frame(width: 13, height: 13)
                Text(Format.dayHeading(day.day.date))
                    .font(.fraunces(24, 560))
                    .tracking(-0.2)
                    .foregroundStyle(Brand.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            if let stop = day.day.stop {
                HStack(spacing: 6) {
                    Text(stop.flag).font(.system(size: 15))
                    Text(stop.name).font(.inter(15, 500)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                    if let t = day.weather {
                        Image(systemName: t >= 20 ? "sun.max" : t >= 12 ? "cloud.sun" : "cloud")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Brand.inkSoft)
                            .padding(.leading, 6)
                        Text("\(t)°").font(.inter(15, 500)).foregroundStyle(Brand.inkSoft)
                    }
                }
                .padding(.leading, 27)
                .padding(.top, 3)
            }
            Group {
                if upcoming {
                    // Nothing taken yet: the photos arrive here by themselves once the trip starts.
                    Text("De foto's van deze dag komen hier vanzelf")
                        .font(.inter(13.5, 500))
                        .foregroundStyle(Brand.inkSoft)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(Brand.raised, in: .rect(cornerRadius: 18))
                } else {
                    photos
                }
            }
            .padding(.leading, 27)
            .padding(.top, 12)
            .padding(.bottom, 30)
        }
        .background(alignment: .topLeading) {
            // The line down the left, from this day's dot to the next one.
            if !last {
                Rectangle().fill(Brand.line).frame(width: 2).padding(.top, 22).padding(.leading, 5.5)
            }
        }
    }

    @ViewBuilder private var photos: some View {
        let shown = all ? day.photos : Array(day.photos.prefix(12))
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(justified(shown).enumerated()), id: \.offset) { _, row in
                PhotoRow(row: row, ns: ns) { m in onPhoto(ViewerItem(photos: day.photos, start: m)) }
            }
            if day.photos.count > 12 {
                Button {
                    withAnimation(.smooth) { all.toggle() }
                } label: {
                    Text(all ? "Minder tonen" : "Alle \(day.photos.count) foto's van deze dag").font(.outfit(14, 600))
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .padding(.top, 4)
            }
        }
    }

    /// Rows that fill the width at a pleasant height: two side by side as a rule,
    /// three when they are all tall, a wide one alone.
    private func justified(_ list: [Media]) -> [[Media]] {
        var rows: [[Media]] = []
        var i = 0
        while i < list.count {
            let take: Int
            if list[i].ratio > 1.6 { take = 1 }
            else if i + 2 < list.count && list[i...(i + 2)].allSatisfy({ $0.ratio < 0.9 }) { take = 3 }
            else { take = 2 }
            let n = min(take, list.count - i)
            rows.append(Array(list[i..<(i + n)]))
            i += n
        }
        return rows
    }
}

/// One row of photos, each as wide as its own shape asks.
private struct PhotoRow: View {
    let row: [Media]
    let ns: Namespace.ID
    let onTap: (Media) -> Void

    var body: some View {
        let total = row.reduce(0) { $0 + $1.ratio }
        Color.clear
            // A photo left alone at the end of a day is not allowed to fill the whole screen.
            .aspectRatio(row.count == 1 ? max(1.4, total) : max(0.8, total), contentMode: .fit)
            .overlay {
                GeometryReader { geo in
                    let gaps = CGFloat(row.count - 1) * 6
                    HStack(spacing: 6) {
                        ForEach(row) { m in
                            Button { onTap(m) } label: {
                                MediaView(media: m)
                                    .frame(width: (geo.size.width - gaps) * m.ratio / total, height: geo.size.height)
                                    .clipShape(.rect(cornerRadius: 14))
                                    .contentShape(.rect(cornerRadius: 14))
                            }
                            .buttonStyle(PressStyle(scale: 0.98))
                            .matchedTransitionSource(id: m.id, in: ns) { $0.clipShape(.rect(cornerRadius: 14)) }
                            .accessibilityLabel("Foto")
                        }
                    }
                }
            }
    }
}
