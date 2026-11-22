import SwiftUI

/*
 * The timeline as in today's app: the places of the trip as a row of photo
 * cards at the top, then day by day the date, where you were and the weather,
 * with all of that day's photos underneath, joined by a line down the left.
 * Every row of photos is a List row of its own: they load lazily, a day shows
 * all its photos, and the viewer can scroll the timeline to the photo it is on.
 */

struct TimelineDay: Identifiable {
    let day: TripDay
    let photos: [Media]
    let weather: Int?
    var id: Date { day.date }
    /// Justified rows: two side by side as a rule, three when all are tall, a wide one alone.
    var rows: [[Media]] {
        var out: [[Media]] = []
        var i = 0
        while i < photos.count {
            let take: Int
            if photos[i].ratio > 1.6 { take = 1 }
            else if i + 2 < photos.count && photos[i...(i + 2)].allSatisfy({ $0.ratio < 0.9 }) { take = 3 }
            else { take = 2 }
            let n = min(take, photos.count - i)
            out.append(Array(photos[i..<(i + n)]))
            i += n
        }
        return out
    }
}

enum Timeline {
    static func stopOn(_ trip: Trip, _ date: Date) -> Stop? {
        trip.stops.last { s in s.start.map { $0 <= date } ?? false } ?? trip.stops.first
    }

    static func days(_ trip: Trip, _ media: [Media]?) -> [TimelineDay] {
        guard let media else {
            // A real trip shows its own photos or placeholders, never the demo's.
            if trip.remoteId != nil { return [] }
            return trip.demoDays.map { d in
                TimelineDay(day: d, photos: trip.upcoming ? [] : Demo.media(trip, day: d.index, date: d.date), weather: Demo.weather(trip, day: d.index))
            }
        }
        let groups = Dictionary(grouping: media.filter { !$0.video }, by: \.takenAt)
        return groups.keys.sorted().enumerated().map { i, date in
            TimelineDay(day: TripDay(date: date, stop: stopOn(trip, date), index: i), photos: groups[date] ?? [], weather: nil)
        }
    }

    /// The List row a photo sits in, to scroll to it.
    static func rowId(_ media: Media, in days: [TimelineDay]) -> String? {
        for day in days {
            for row in day.rows where row.contains(where: { $0.id == media.id }) { return "ph-\(row[0].id)" }
        }
        return nil
    }
}

struct TimelineRows: View {
    let trip: Trip
    let media: [Media]?
    let days: [TimelineDay]
    let ns: Namespace.ID
    /// The photo the viewer is on: its tile stays empty while it is open.
    var hidden: String?
    let onPhoto: (ViewerItem) -> Void
    let onPlace: (String) -> Void

    var body: some View {
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
            CompassSpinner()
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
        let all = days.flatMap(\.photos)
        ForEach(Array(days.enumerated()), id: \.element.id) { i, day in
            let lastDay = i == days.count - 1
            let rows = day.rows
            DayHeader(day: day, line: !(lastDay && rows.isEmpty && !trip.upcoming))
                .plainRow(top: i == 0 ? 26 : 0)
                .id(i == 0 ? "days" : "day\(i)")
            if trip.upcoming {
                // Nothing taken yet: the photos arrive here by themselves once the trip starts.
                Text("De foto's van deze dag komen hier vanzelf")
                    .font(.inter(13.5, 500))
                    .foregroundStyle(Brand.inkSoft)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .background(Brand.raised, in: .rect(cornerRadius: 18))
                    .timelineLine(show: !lastDay, bottom: 30)
                    .plainRow()
            }
            ForEach(Array(rows.enumerated()), id: \.element.first?.id) { r, row in
                let lastRow = r == rows.count - 1
                PhotoRow(row: row, ns: ns, hidden: hidden) { m in
                    // The viewer pages through the whole trip, not just this day.
                    onPhoto(ViewerItem(trip: trip, photos: all, start: m))
                }
                .timelineLine(show: !(lastDay && lastRow), bottom: lastRow ? 30 : 6)
                .plainRow()
                .id("ph-\(row[0].id)")
            }
        }
    }

    /// The places, each a photo with its name; a tap goes to that place's first day.
    /// The row runs to the screen edges, the first tile on the page's line.
    private var places: some View {
        let unique = trip.mapStops.map(\.stop)
        return ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(Array(unique.enumerated()), id: \.element.name) { i, stop in
                    Button { onPlace(stop.name) } label: {
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
                    .buttonStyle(PressStyle(scale: 0.95))
                    .accessibilityLabel("Naar \(stop.name)")
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
            if let pick = media.first(where: { !$0.video && Timeline.stopOn(trip, $0.takenAt)?.name == stop.name }) {
                RemotePhoto(id: pick.id, size: "preview")
            } else {
                Rectangle().fill(Brand.sunken)
            }
        } else {
            LandscapeView(scene: Landscape.allCases[(index * 2 + 1) % Landscape.allCases.count])
        }
    }
}

extension View {
    /// The line down the left of the timeline, past the photos to the next day.
    func timelineLine(show: Bool, bottom: CGFloat) -> some View {
        padding(.leading, 27)
            .padding(.bottom, bottom)
            .background(alignment: .leading) {
                if show { Rectangle().fill(Brand.line).frame(width: 2).padding(.leading, 5.5) }
            }
    }
}

private struct DayHeader: View {
    let day: TimelineDay
    let line: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                Circle().fill(Brand.accent).frame(width: 13, height: 13)
                Text(Format.dayHeading(day.day.date))
                    .font(.fraunces(24, 560))
                    .tracking(-0.2)
                    .foregroundStyle(Brand.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            if let stop = day.day.stop {
                HStack(spacing: 6) {
                    FlagView(flag: stop.flag, height: 13)
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
            Color.clear.frame(height: 12)
        }
        .background(alignment: .topLeading) {
            // From this day's dot down to the photos.
            if line { Rectangle().fill(Brand.line).frame(width: 2).padding(.top, 22).padding(.leading, 5.5) }
        }
    }
}

/// One row of photos, each as wide as its own shape asks.
private struct PhotoRow: View {
    let row: [Media]
    let ns: Namespace.ID
    var hidden: String?
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
                                    // Its place stays empty while the photo is open in the viewer.
                                    .opacity(hidden == m.id ? 0 : 1)
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
