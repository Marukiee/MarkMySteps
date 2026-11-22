import AVFoundation
import SwiftUI
import UIKit

/// Photos full screen, the whole trip to swipe through, growing out of their tile and back into it (the system
/// zoom transition, swipe down to close). Pinch or double-tap to zoom; originals keep HDR. On top the day with the
/// place it was taken under it, the ⋯ menu (covers, download, open in or share, Immich) and close. Below, for a
/// film, its controls, then how people reacted and what they said.
struct PhotoViewer: View {
    let item: ViewerItem
    @Binding var current: String
    @State private var reactions = Remote.Reactions()
    @State private var comments: [Remote.Comment] = []
    @State private var picking = false
    @State private var showComments = false
    @State private var zoomed = false
    @State private var stops: [ViewerApi.StopRow]?
    @State private var immich: String?
    @State private var note: String?
    @State private var noteSticky = false
    @State private var sharing: SharedFile?
    @State private var video = VideoHandle()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    /// Screenshots only (`-menuPreview YES`): a demo trip shows the menu and reactions as on your own server trip.
    /// Nothing can be sent: a demo trip has no server id, and every trip call stops on that.
    private var live: Bool { item.trip.remoteId != nil || Launch.menuPreview }
    private var media: Media? { item.photos.first { $0.id == current } }
    private var store: Store { Store.shared }
    private var knowsPlaces: Bool { item.photos.contains { $0.lat != nil && $0.lon != nil } }

    var body: some View {
        TabView(selection: $current) {
            ForEach(item.photos) { media in
                Group {
                    if media.video {
                        VideoPage(media: media, active: current == media.id, handle: video)
                    } else {
                        ZoomablePhoto(media: media, zoomed: $zoomed)
                    }
                }
                .tag(media.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .background(.black)
        .ignoresSafeArea()
        // A tap anywhere on the photo folds the reactions away again.
        .simultaneousGesture(TapGesture().onEnded { if picking { withAnimation(.snappy) { picking = false } } })
        .overlay(alignment: .top) { topBar }
        .overlay(alignment: .bottom) { if !zoomed { bottomBar.transition(.opacity.combined(with: .move(edge: .bottom))) } }
        .overlay(alignment: .top) { noteView }
        .animation(.calm, value: zoomed)
        .sheet(isPresented: $showComments) {
            CommentsSheet(trip: item.trip, mediaId: current, comments: $comments)
        }
        .sheet(item: $sharing) { file in ActivityView(items: [file.url]).ignoresSafeArea().presentationDetents([.medium, .large]) }
        .environment(\.colorScheme, .dark)
        .statusBarHidden(zoomed)
        .onChange(of: current) { picking = false }
        .task(id: current) {
            // The photos either side are fetched ahead, so paging never waits.
            guard let i = item.photos.firstIndex(where: { $0.id == current }) else { return }
            for j in [i + 1, i - 1] where item.photos.indices.contains(j) && item.photos[j].scene == nil {
                _ = await ImageLoader.shared.load(item.photos[j].id, "preview")
            }
        }
        .task {
            guard live else { return }
            async let r = Remote.reactions(item.trip)
            async let c = Remote.comments(item.trip)
            async let s = ViewerApi.stops(item.trip)
            async let i = ViewerApi.immichUrl()
            reactions = (try? await r) ?? Remote.Reactions()
            comments = (try? await c) ?? []
            stops = (try? await s) ?? []
            immich = await i
        }
    }

    // MARK: Top

    private var topBar: some View {
        HStack(alignment: .top, spacing: 10) {
            if let media, let i = item.photos.firstIndex(where: { $0.id == current }) {
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(Format.dayHeading(media.takenAt)).font(.outfit(15, 600)).lineLimit(1)
                        Text("\(i + 1)/\(item.photos.count)").font(.inter(12, 500)).foregroundStyle(.secondary)
                            .monospacedDigit()
                            .contentTransition(.numericText())
                    }
                    // Only on trips whose photos know where they were taken, so the line never sits empty everywhere.
                    if knowsPlaces { PlaceLine(media: media, photos: item.photos, index: i, stops: stops) }
                }
                .padding(.horizontal, 16)
                .frame(height: 52)
                .glassEffect(.regular, in: .capsule)
            }
            Spacer(minLength: 0)
            if live, let media {
                menu(media)
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 17, weight: .semibold)).frame(width: 30, height: 30)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .controlSize(.large)
            .tint(.primary)
            .accessibilityLabel("Sluiten")
        }
        .padding(.horizontal, 16)
        .animation(.calm, value: current)
    }

    /// The same options as the web's viewer: the trip's or a stop's cover (owner only), the original saved to Foto's,
    /// opened in or shared with another app, and your own photo in Immich.
    private func menu(_ media: Media) -> some View {
        let owner = (item.trip.ownerId != nil && item.trip.ownerId == store.me?.id) || Launch.menuPreview
        let stop = stops.flatMap { ViewerApi.stopFor(media, $0) }
        let what = media.video ? "Video" : "Foto"
        let mine = media.userId != nil && media.userId == store.me?.id
        return Menu {
            if owner {
                Section {
                    Button("Omslag van de reis", systemImage: "photo") {
                        cover("Omslag van de reis") { try await ViewerApi.setTripCover(item.trip, mediaId: media.id) }
                    }
                    if let stop {
                        Button("Omslag van \(stop.name)", systemImage: "mappin.and.ellipse") {
                            cover("Omslag van \(stop.name)") { try await ViewerApi.setStopCover(item.trip, stopId: stop.id, mediaId: media.id) }
                        }
                    }
                }
            }
            Section {
                Button("\(what) downloaden", systemImage: "arrow.down.to.line") { download(media) }
                Button("Openen in of delen", systemImage: "square.and.arrow.up") { share(media) }
            }
            // Only your own photos live in your Immich; a friend's are on theirs.
            if let immich, mine, let asset = media.immichAssetId, let url = URL(string: "\(immich)/photos/\(asset)") {
                Section {
                    Button("Openen in Immich", systemImage: "arrow.up.forward.app") { openURL(url) }
                }
            }
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 17, weight: .semibold)).frame(width: 30, height: 30)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .controlSize(.large)
        .tint(.primary)
        .accessibilityLabel("Opties")
    }

    private func cover(_ label: String, _ work: @escaping () async throws -> Void) {
        Task {
            do {
                try await work()
                show("\(label) ingesteld")
                Haptic.tap()
                await store.load()
            } catch {
                show("Instellen lukte niet")
            }
        }
    }

    private func download(_ media: Media) {
        show("Downloaden…", sticky: true)
        Task {
            switch await ViewerApi.saveToPhotos(media) {
            case .saved: show("Opgeslagen in Foto's"); Haptic.tap()
            case .denied: show("Geef MarkMySteps toegang tot Foto's in Instellingen")
            case .failed: show("Downloaden lukte niet")
            }
        }
    }

    private func share(_ media: Media) {
        show("\(media.video ? "Video" : "Foto") ophalen…", sticky: true)
        Task {
            do {
                let file = try await ViewerApi.original(media)
                show(nil)
                sharing = SharedFile(url: file)
            } catch {
                show("Ophalen lukte niet")
            }
        }
    }

    private func show(_ text: String?, sticky: Bool = false) {
        withAnimation(.calm) { note = text; noteSticky = sticky }
        guard let text, !sticky else { return }
        Task {
            try? await Task.sleep(for: .seconds(2.4))
            if note == text { withAnimation(.calm) { note = nil } }
        }
    }

    @ViewBuilder private var noteView: some View {
        if let note {
            HStack(spacing: 10) {
                if noteSticky { ProgressView().controlSize(.small) }
                Text(note).font(.inter(15, 550))
            }
            .padding(.horizontal, 18)
            .frame(height: 44)
            .glassEffect(.regular, in: .capsule)
            .padding(.top, 70)
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    // MARK: Bottom

    private var bottomBar: some View {
        let mine = reactions.mine[current]
        let counts = reactions.counts[current] ?? [:]
        let said = comments.filter { $0.mediaId == current }.count
        return VStack(alignment: .leading, spacing: 12) {
            if media?.video == true {
                VideoControls(handle: video)
                    .transition(.opacity)
            }
            ReactionBar(
                mine: mine, counts: counts, names: reactions.names[current] ?? [], comments: said, enabled: live,
                picking: $picking, onReact: react, onComments: { showComments = true }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .opacity(live ? 1 : 0.5)
        .animation(.calm, value: media?.video)
    }

    /// Your reaction, shown at once and then sent; put back if the server refuses.
    private func react(_ kind: String?) {
        guard live else { return }
        let id = current
        let before = reactions
        let old = reactions.mine[id]
        var counts = reactions.counts[id] ?? [:]
        if let old { counts[old] = max(0, (counts[old] ?? 1) - 1) }
        if let kind { counts[kind, default: 0] += 1 }
        reactions.counts[id] = counts.filter { $0.value > 0 }
        reactions.mine[id] = kind
        Task {
            do { try await Remote.setReaction(item.trip, mediaId: id, kind: kind) } catch { reactions = before }
        }
    }
}

/// A file handed to the share sheet.
struct SharedFile: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

/// The system share sheet: open in another app, save, AirDrop, send.
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Where the photo was taken, under the date, as the web does it: the place its spot lies in, else the stop near
/// that spot. The line keeps its height and its last name while the next one is looked up, and only crossfades when
/// the name really changes, so twenty photos in one town never flash it twenty times.
private struct PlaceLine: View {
    let media: Media
    let photos: [Media]
    let index: Int
    let stops: [ViewerApi.StopRow]?
    @State private var place: String?

    var body: some View {
        ZStack(alignment: .leading) {
            if let place {
                Text(place).id(place).transition(.opacity)
            }
        }
        .font(.inter(12.5, 500))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .frame(height: 16, alignment: .leading)
        .animation(.easeInOut(duration: 0.25), value: place)
        .task(id: "\(media.id)/\(stops != nil)") {
            let fallback = stops.flatMap { ViewerApi.stopFor(media, $0)?.name }
            // As the web: a photo that does not know where it was taken has no place; the stop only stands in when
            // the spot has no name.
            guard let lat = media.lat, let lon = media.lon else { place = nil; return }
            if case let .some(known) = ViewerApi.knownPlace(lat: lat, lon: lon) {
                place = known ?? fallback
            } else if let name = try? await ViewerApi.placeName(lat: lat, lon: lon) {
                place = name
            } else {
                place = fallback ?? place
            }
            // The neighbours' names ahead of time, so paging shows them straight away.
            for n in [index + 1, index - 1] where photos.indices.contains(n) {
                if let la = photos[n].lat, let lo = photos[n].lon { _ = try? await ViewerApi.placeName(lat: la, lon: lo) }
            }
        }
    }
}

// MARK: Reactions

/// Your reaction with what people gave, and the comments. A tap opens the five reactions, as on the web; the one you
/// pick pops and lifts, and the button takes it over with a bounce. Your own pick again takes it back.
private struct ReactionBar: View {
    let mine: String?
    let counts: [String: Int]
    let names: [(kind: String, name: String)]
    let comments: Int
    let enabled: Bool
    @Binding var picking: Bool
    let onReact: (String?) -> Void
    let onComments: () -> Void
    /// The one just picked, held while it lifts and the row folds away.
    @State private var picked: String?
    @State private var pop: CGFloat = 1

    /// The one exception to the calm springs: a little life in the reactions.
    private static let lively = Animation.spring(response: 0.34, dampingFraction: 0.58)

    var body: some View {
        let total = counts.values.reduce(0, +)
        VStack(alignment: .leading, spacing: 10) {
            if picking {
                VStack(alignment: .leading, spacing: 8) {
                    // Who gave what, when the server says.
                    if !names.isEmpty {
                        Text(names.map { "\(Remote.reactionEmoji[$0.kind] ?? "") \($0.name)" }.joined(separator: "  ·  "))
                            .font(.inter(13, 500))
                            .foregroundStyle(.white.opacity(0.9))
                            .lineLimit(2)
                            .padding(.leading, 6)
                    }
                    HStack(spacing: 2) {
                        ForEach(Array(Remote.reactionKinds.enumerated()), id: \.element) { i, kind in
                            ReactionChoice(
                                emoji: Remote.reactionEmoji[kind] ?? "", index: i,
                                on: (picked ?? mine) == kind, dimmed: picked != nil && picked != kind
                            ) { choose(kind) }
                        }
                    }
                    .padding(6)
                    .glassEffect(.regular, in: .capsule)
                }
                .transition(.scale(scale: 0.6, anchor: .bottomLeading).combined(with: .opacity))
            }
            HStack(spacing: 8) {
                Button {
                    Haptic.tap()
                    withAnimation(.snappy) { picking.toggle() }
                } label: {
                    HStack(spacing: 4) {
                        Group {
                            if let mine {
                                Text(Remote.reactionEmoji[mine] ?? "").font(.system(size: 20))
                            } else {
                                Image(systemName: "heart").font(.system(size: 19, weight: .semibold))
                            }
                        }
                        .frame(width: 24, height: 24)
                        .scaleEffect(pop)
                        // The others' picks as a small stack, then how many.
                        ForEach(counts.filter { $0.key != mine && $0.value > 0 }.sorted { $0.value > $1.value }.prefix(3).map(\.key), id: \.self) { kind in
                            Text(Remote.reactionEmoji[kind] ?? "").font(.system(size: 15)).transition(.scale.combined(with: .opacity))
                        }
                        if total > 0 {
                            Text("\(total)").font(.outfit(16, 650)).monospacedDigit().padding(.leading, 4).contentTransition(.numericText())
                        }
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 48)
                    .contentShape(.capsule)
                }
                .buttonStyle(PressStyle(scale: 0.94))
                .glassEffect(mine != nil || picking ? .regular.tint(.white.opacity(0.16)).interactive() : .regular.interactive(), in: .capsule)
                .accessibilityLabel(mine == nil ? "Reageren" : "Jouw reactie wijzigen")

                Button { Haptic.tap(); onComments() } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "bubble.left").font(.system(size: 18, weight: .semibold))
                        Text(comments == 0 ? "Reageer" : "\(comments)").font(.outfit(16, 650)).monospacedDigit()
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 48)
                    .contentShape(.capsule)
                }
                .buttonStyle(PressStyle(scale: 0.94))
                .glassEffect(.regular.interactive(), in: .capsule)
                .accessibilityLabel("Opmerkingen")
            }
            .foregroundStyle(.white)
        }
        .disabled(!enabled)
        .animation(.snappy, value: counts)
        .onChange(of: picking) { _, on in if on { picked = nil } }
        .onChange(of: mine) {
            // The button's emoji pops in with a bounce each time your pick changes.
            pop = 0.4
            withAnimation(Self.lively) { pop = 1 }
        }
    }

    private func choose(_ kind: String) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        let again = mine == kind
        withAnimation(Self.lively) { picked = again ? "" : kind }
        onReact(again ? nil : kind)
        Task {
            try? await Task.sleep(for: .milliseconds(340))
            withAnimation(.snappy) { picking = false }
        }
    }
}

/// One of the five: pops in after its left neighbour, shrinks under the finger, and lifts when it is yours.
private struct ReactionChoice: View {
    let emoji: String
    let index: Int
    let on: Bool
    let dimmed: Bool
    let action: () -> Void
    @State private var entered = false

    var body: some View {
        Button(action: action) {
            Text(emoji)
                .font(.system(size: 28))
                .frame(width: 48, height: 48)
                .background(Circle().fill(.white.opacity(on ? 0.22 : 0)))
                .scaleEffect(on ? 1.3 : 1)
                .offset(y: on ? -10 : 0)
        }
        .buttonStyle(PressStyle(scale: 0.82))
        .scaleEffect(entered ? 1 : 0.3)
        .opacity((entered ? 1 : 0) * (dimmed ? 0.45 : 1))
        .animation(.spring(response: 0.34, dampingFraction: 0.58), value: on)
        .animation(.easeOut(duration: 0.2), value: dimmed)
        .onAppear {
            withAnimation(.spring(response: 0.34, dampingFraction: 0.62).delay(Double(index) * 0.035)) { entered = true }
        }
        .accessibilityLabel(emoji)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

// MARK: Comments

/// The comments on one photo, with a field to add your own; your own (or as organiser anyone's) can go again.
struct CommentsSheet: View {
    let trip: Trip
    let mediaId: String?
    var day: String? = nil
    @Binding var comments: [Remote.Comment]
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var list: [Remote.Comment] {
        if let mediaId { return comments.filter { $0.mediaId == mediaId } }
        return comments.filter { $0.day == day && $0.mediaId == nil }
    }

    var body: some View {
        let list = list
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    if list.isEmpty {
                        Text("Nog niemand heeft gereageerd. Wees de eerste.").foregroundStyle(.secondary)
                    }
                    ForEach(list) { c in
                        HStack(alignment: .top, spacing: 12) {
                            Text(String(c.author.prefix(1)).uppercased())
                                .font(.outfit(15, 700))
                                .foregroundStyle(Brand.accent)
                                .frame(width: 36, height: 36)
                                .background(Brand.accent.opacity(0.16), in: .circle)
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(c.author).font(.outfit(15, 600))
                                    Text(c.at.formatted(.relative(presentation: .named).locale(Format.dutch))).font(.inter(12, 450)).foregroundStyle(.secondary)
                                }
                                Text(c.body).font(.inter(15.5, 450))
                            }
                        }
                        .id(c.id)
                        .swipeActions(edge: .trailing) {
                            if c.canDelete {
                                Button(role: .destructive) { remove(c) } label: { Label("Verwijderen", systemImage: "trash") }
                            }
                        }
                        .contextMenu {
                            if c.canDelete {
                                Button("Verwijderen", systemImage: "trash", role: .destructive) { remove(c) }
                            }
                        }
                    }
                    if let error { Text(error).foregroundStyle(.red) }
                }
                .onChange(of: list.count) { if let last = list.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } } }
            }
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 10) {
                    TextField("Schrijf een reactie", text: $text, axis: .vertical)
                        .font(.inter(17))
                        .lineLimit(1...4)
                        .focused($focused)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color.primary.opacity(0.08), in: .rect(cornerRadius: 20))
                    Button { send() } label: {
                        ZStack {
                            Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)).opacity(sending ? 0 : 1)
                            ProgressView().controlSize(.small).opacity(sending ? 1 : 0)
                        }
                        .frame(width: 22, height: 22)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.circle)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                    .accessibilityLabel("Versturen")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.bar)
            }
            .navigationTitle("Reacties")
            .navigationBarTitleDisplayMode(.inline)
            .animation(.calm, value: list.map(\.id))
        }
        .presentationDetents([.medium, .large])
    }

    private func send() {
        let body = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
        guard !body.isEmpty, !sending else { return }
        sending = true
        error = nil
        Task {
            do {
                let made: Remote.Comment?
                if let mediaId { made = try await Remote.addComment(trip, mediaId: mediaId, body: body) }
                else if let day { made = try await Remote.addDayComment(trip, day: day, body: body) }
                else { made = nil }
                // The server's own comment when it sends one back; otherwise shown as written.
                let name = Store.shared.me?.name ?? ""
                comments.append(made ?? Remote.Comment(id: UUID().uuidString, mediaId: mediaId, day: day, author: name.isEmpty ? "Jij" : name, body: body, at: Date(), canDelete: true))
                text = ""
                Haptic.tap()
            } catch {
                self.error = (error as? Api.Failure)?.message ?? "Versturen lukte niet"
            }
            sending = false
        }
    }

    private func remove(_ c: Remote.Comment) {
        let before = comments
        withAnimation(.calm) { comments.removeAll { $0.id == c.id } }
        Task {
            do { try await Remote.deleteComment(trip, c.id) } catch {
                comments = before
                self.error = (error as? Api.Failure)?.message ?? "Verwijderen lukte niet"
            }
        }
    }
}

// MARK: Video

/// The film on show: its player, where it is, and the play, pause and sound the controls set.
@Observable
final class VideoHandle {
    private(set) var player: AVPlayer?
    var playing = true
    var muted = false
    var position: Double = 0
    var duration: Double = 0
    var scrubbing = false
    var ready: Bool { player != nil && duration > 0 }
    private var observer: Any?

    func attach(_ p: AVPlayer) {
        guard player !== p else { return }
        detach()
        player = p
        p.isMuted = muted
        position = p.currentTime().seconds.isFinite ? p.currentTime().seconds : 0
        observer = p.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 20), queue: .main) { [weak self, weak p] time in
            guard let self, let p else { return }
            if !self.scrubbing { self.position = time.seconds.isFinite ? time.seconds : 0 }
            if let d = p.currentItem?.duration.seconds, d.isFinite, d > 0, d != self.duration { self.duration = d }
        }
        playing = true
        p.play()
    }

    func detach() {
        if let observer, let player { player.removeTimeObserver(observer) }
        observer = nil
        player?.pause()
        player = nil
        position = 0
        duration = 0
    }

    func toggle() {
        guard let player else { return }
        playing.toggle()
        if playing { player.play() } else { player.pause() }
    }

    func mute() {
        muted.toggle()
        player?.isMuted = muted
    }

    func seek(_ seconds: Double) {
        position = seconds
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }
}

/// A film in the viewer: its still first, then playing (round and round) while it is the page in view.
private struct VideoPage: View {
    let media: Media
    let active: Bool
    let handle: VideoHandle
    @State private var player: AVPlayer?
    @State private var ready = false
    @State private var loop: NSObjectProtocol?

    var body: some View {
        ZStack {
            RemotePhoto(id: media.id, size: "preview")
                .aspectRatio(media.ratio, contentMode: .fit)
                .opacity(ready ? 0 : 1)
            if let player {
                PlayerLayerView(player: player) { ready = true }
                    .aspectRatio(media.ratio, contentMode: .fit)
                    .opacity(ready ? 1 : 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(.rect)
        .onTapGesture { if active { handle.toggle() } }
        .animation(.easeOut(duration: 0.25), value: ready)
        .task(id: media.id) {
            guard player == nil, let url = try? await Remote.videoURL(media.id) else { return }
            let p = AVPlayer(playerItem: AVPlayerItem(url: url))
            p.actionAtItemEnd = .pause
            // At the end it starts again, as a short clip on the phone does.
            loop = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: p.currentItem, queue: .main) { [weak p] _ in
                p?.seek(to: .zero)
                p?.play()
            }
            player = p
            if active { handle.attach(p) }
        }
        .onChange(of: active) { _, on in
            guard let player else { return }
            if on { handle.attach(player) } else {
                player.pause()
                player.seek(to: .zero)
            }
        }
        .onDisappear {
            player?.pause()
            if let player, handle.player === player { handle.detach() }
            if let loop { NotificationCenter.default.removeObserver(loop) }
        }
    }
}

/// A film's controls: play and pause, how far (drag to scrub), how long, and the sound.
private struct VideoControls: View {
    let handle: VideoHandle
    @State private var resume = false

    var body: some View {
        HStack(spacing: 10) {
            Button { Haptic.tap(); handle.toggle() } label: {
                Image(systemName: handle.playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel(handle.playing ? "Pauzeren" : "Afspelen")

            Text(clock(handle.position)).font(.inter(13, 600)).monospacedDigit()
            Slider(value: Binding(get: { min(handle.position, max(handle.duration, 0.01)) }, set: { handle.seek($0) }),
                   in: 0...max(handle.duration, 0.01)) { editing in
                handle.scrubbing = editing
                if editing {
                    resume = handle.playing
                    if handle.playing { handle.toggle() }
                } else if resume {
                    handle.toggle()
                }
            }
            .tint(.white)
            .disabled(!handle.ready)
            .accessibilityLabel("Positie in de video")
            Text(clock(handle.duration)).font(.inter(13, 600)).monospacedDigit().foregroundStyle(.white.opacity(0.78))

            Button { Haptic.tap(); handle.mute() } label: {
                Image(systemName: handle.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel(handle.muted ? "Geluid aan" : "Geluid uit")
        }
        .foregroundStyle(.white)
    }

    private func clock(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.isFinite ? seconds : 0))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}

/// AVPlayerLayer in SwiftUI, telling when the first frame is ready to show.
private struct PlayerLayerView: UIViewRepresentable {
    let player: AVPlayer
    let onReady: @MainActor @Sendable () -> Void

    final class LayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
        var observation: NSKeyValueObservation?
    }

    func makeUIView(context: Context) -> LayerView {
        let view = LayerView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        let ready = onReady
        view.observation = view.playerLayer.observe(\.isReadyForDisplay, options: [.new]) { layer, _ in
            if layer.isReadyForDisplay { Task { @MainActor in ready() } }
        }
        return view
    }

    func updateUIView(_ view: LayerView, context: Context) {}
}
