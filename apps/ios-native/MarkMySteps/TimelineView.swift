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

    static func days(_ trip: Trip, _ media: [Media]?, notes: [Remote.Note] = []) -> [TimelineDay] {
        guard let media else {
            // A real trip shows its own photos or placeholders, never the demo's.
            if trip.remoteId != nil { return [] }
            return trip.demoDays.map { d in
                TimelineDay(day: d, photos: trip.upcoming ? [] : Demo.media(trip, day: d.index, date: d.date), weather: Demo.weather(trip, day: d.index))
            }
        }
        let groups = Dictionary(grouping: media, by: \.takenAt)
        // A day with a story but no photos still has its place.
        let storyDays = notes.compactMap { Remote.day($0.day) }
        return Set(groups.keys).union(storyDays).sorted().enumerated().map { i, date in
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
    let onPlace: (Date) -> Void
    var stories = DayStories()

    var body: some View {
        // The places row only earns its place when there are several.
        if trip.mapStops.count > 1 || media.map({ TripPlaces.stops(trip, $0).count > 1 }) == true {
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
            // "Once the trip starts" only before it has: `upcoming` is also true while it is under way.
            Text(trip.startsInDays != nil ? "De foto's komen hier vanzelf zodra de reis begint" : "Nog geen foto's bij deze reis")
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
            let iso = PlannerRemote.isoDay(day.day.date)
            let notes = stories.notes.filter { $0.day == iso }
            if i == 0 { Color.clear.frame(height: 26).plainRow() }
            // A row without height right on top of the day, so a jump to it lands the heading exactly where asked
            // (a List lines up the same point of the row and of the screen, which a tall row would shift).
            Color.clear.frame(height: 0).plainRow()
                .id(i == 0 ? "days" : "day\(i)")
            let storied = trip.remoteId != nil || Launch.menuPreview
            let mine = notes.contains { $0.authorId != nil && $0.authorId == stories.me }
            // A day without your story yet: the round pencil beside the date starts one, as on Android and the web.
            DayHeader(
                day: day, live: trip.remoteId != nil, line: !(lastDay && rows.isEmpty && !trip.upcoming && notes.isEmpty),
                onWrite: storied && stories.canWrite && !mine ? { stories.onWrite(day.day.date, nil) } : nil
            )
                .plainRow()
            if storied && (!notes.isEmpty || (stories.canComment && (stories.comments[iso] ?? 0) > 0)) {
                DayStoryRow(
                    day: day.day.date, notes: notes, comments: stories.comments[iso] ?? 0, me: stories.me,
                    canWrite: stories.canWrite, canComment: stories.canComment,
                    onWrite: { n in stories.onWrite(day.day.date, n) }, onDelete: stories.onDelete,
                    onComments: { stories.onComments(iso) }
                )
                .timelineLine(show: !(lastDay && rows.isEmpty), bottom: rows.isEmpty ? 30 : 12)
                .plainRow()
            }
            // A day still to come (or today) without photos yet: they arrive here by themselves. During the trip a
            // day that has been never says so (it simply had no photos).
            if trip.upcoming && rows.isEmpty && Calendar.current.startOfDay(for: day.day.date) >= Calendar.current.startOfDay(for: Date()) {
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

    private var places: some View {
        PlacesRow(trip: trip, media: media, onPlace: onPlace)
    }
}

/// The places, each a small photo with its name, four in view as on Android (92 by 116, corners 18); a tap goes to
/// that place's first day. The row runs to the screen edges with the first tile on the page's line, without a fade at
/// the sides, and keeps where it was scrolled to while the app runs, also after going home and back.
private struct PlacesRow: View {
    let trip: Trip
    let media: [Media]?
    let onPlace: (Date) -> Void
    @State private var position: ScrollPosition

    /// How far each trip's row was scrolled, while the app runs.
    @MainActor private static var offsets: [String: CGFloat] = [:]

    init(trip: Trip, media: [Media]?, onPlace: @escaping (Date) -> Void) {
        self.trip = trip
        self.media = media
        self.onPlace = onPlace
        _position = State(initialValue: ScrollPosition(x: PlacesRow.offsets[trip.id] ?? 0))
    }

    var body: some View {
        let tiles = tiles()
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(Array(tiles.enumerated()), id: \.element.id) { i, place in
                    Button { if let d = place.day { onPlace(d) } } label: {
                        tile(place, index: i)
                            .frame(width: 92, height: 116)
                            .clipShape(.rect(cornerRadius: 18))
                            .contentShape(.rect(cornerRadius: 18))
                    }
                    .buttonStyle(PressStyle(scale: 0.95))
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
                    .accessibilityLabel("Naar \(place.name)")
                }
            }
            .animation(.smooth(duration: 0.35), value: tiles.map(\.name))
        }
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .scrollIndicators(.hidden)
        .scrollPosition($position)
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.x + $0.contentInsets.leading } action: { _, x in
            PlacesRow.offsets[trip.id] = max(0, x)
        }
    }

    /// The places you put in the plan yourself, the stops and the day trips you photographed, by where their photos
    /// were taken, in trip order. Towns passed on the way (Rauma, Lesja on the road to Åndalsnes) are no place of
    /// their own (Mark): only what you filled in, as on Android and the web.
    private func tiles() -> [TripPlaces.Tile] {
        guard let media else {
            return trip.mapStops.enumerated().map { i, s in TripPlaces.Tile(name: s.stop.name, flag: s.stop.flag, photos: [], day: s.stop.start, order: i) }
        }
        var seen = Set<String>()
        return TripPlaces.stops(trip, media).filter { seen.insert($0.name).inserted }.sorted { $0.order < $1.order }
    }

    @ViewBuilder private func tile(_ place: TripPlaces.Tile, index: Int) -> some View {
        let photo = media == nil ? trip.remoteId == nil : !place.photos.isEmpty
        ZStack(alignment: .bottomLeading) {
            if trip.remoteId != nil && media == nil {
                // The photos are on their way: the tile's own quiet tone, the name already on it.
                Rectangle().fill(Brand.raised)
            } else if media != nil {
                if !place.photos.isEmpty {
                    RemotePhoto(ids: place.photos, size: "thumbnail")
                } else {
                    // No photo of this place: the trip's colour with its flag, instead of an empty frame.
                    LinearGradient(colors: [trip.color.opacity(0.35), trip.color.opacity(0.12)], startPoint: .topLeading, endPoint: .bottomTrailing)
                        .background(Brand.raised)
                        .overlay(alignment: .topLeading) { if let f = place.flag { FlagView(flag: f, height: 15).padding(10) } }
                }
            } else {
                LandscapeView(scene: Landscape.allCases[(index * 2 + 1) % Landscape.allCases.count])
            }
            if photo {
                LinearGradient(stops: [.init(color: .clear, location: 0.45), .init(color: .black.opacity(0.62), location: 1)], startPoint: .top, endPoint: .bottom)
            }
            // A long name breaks with a hyphen ("Saltsjö-baden"), never a loose end on its own line.
            Text(Format.hyphenated(place.name))
                .font(.outfit(14, 650))
                .foregroundStyle(photo ? Color.white : Brand.ink)
                .lineLimit(2)
                .lineSpacing(-1)
                .padding(.horizontal, 9)
                .padding(.vertical, 8)
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

/// What the timeline needs for the day stories: the stories, how many comments each day has, who you are, what
/// you may do, and what happens on a tap.
struct DayStories {
    var notes: [Remote.Note] = []
    var comments: [String: Int] = [:]
    var me: String?
    var canWrite = false
    var canComment = false
    var onWrite: (Date, Remote.Note?) -> Void = { _, _ in }
    var onDelete: (Remote.Note) -> Void = { _ in }
    var onComments: (String) -> Void = { _ in }
}

private struct DayHeader: View {
    let day: TimelineDay
    var live = false
    let line: Bool
    var onWrite: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Circle().fill(Brand.accent).frame(width: 13, height: 13)
                Text(Format.dayHeading(day.day.date))
                    .font(.fraunces(24, 560))
                    .tracking(-0.2)
                    .foregroundStyle(Brand.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .padding(.leading, 14)
                if let onWrite {
                    Button {
                        Haptic.tap()
                        onWrite()
                    } label: {
                        Image(systemName: "pencil")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Brand.inkSoft)
                            .frame(width: 34, height: 34)
                            .background(Brand.raised, in: .circle)
                            .contentShape(.circle)
                    }
                    .buttonStyle(.borderless)
                    .padding(.leading, 8)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
                    .accessibilityLabel("Verhaal schrijven")
                }
            }
            .frame(minHeight: 34)
            .animation(.smooth(duration: 0.3), value: onWrite == nil)
            if let stop = day.day.stop {
                HStack(spacing: 6) {
                    FlagView(flag: stop.flag, height: 13)
                    Text(stop.name).font(.inter(15, 500)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                    if live {
                        // That day's real weather where you were.
                        WeatherBadge(at: stop.at, day: day.day.date)
                    } else if let t = day.weather {
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
