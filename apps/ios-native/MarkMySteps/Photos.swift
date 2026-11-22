import SwiftUI
import UIKit

/// Photos from the server: kept in memory while the app runs, six downloads at a time.
final class ImageLoader {
    static let shared = ImageLoader()

    private let cache: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.totalCostLimit = 128 * 1024 * 1024
        return c
    }()
    private var inFlight: [String: Task<UIImage?, Never>] = [:]
    /// A timeline asks for a hundred photos at once; six at a time is what the server likes.
    private let lanes = 6
    private var running = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []

    /// Decoding happens off the main thread. HDR originals keep their gain map,
    /// so the viewer can show them bright; an original of 50 megapixels is
    /// brought down to about a screen and a half.
    @concurrent nonisolated private static func decode(_ data: Data, original: Bool) async -> UIImage? {
        var config = UIImageReader.Configuration()
        config.prefersHighDynamicRange = true
        config.preparesImagesForDisplay = true
        if original { config.preferredThumbnailSize = CGSize(width: 2400, height: 2400) }
        return await UIImageReader(configuration: config).image(data: data)
    }

    func clear() { cache.removeAllObjects(); tones.removeAll() }

    private var tones: [String: Color] = [:]

    /// The average colour of a photo, for surfaces that should belong to it.
    func tone(_ id: String) async -> Color? {
        if let hit = tones[id] { return hit }
        guard let image = await load(id, "thumbnail"), let tone = await Self.average(image) else { return nil }
        tones[id] = tone
        return tone
    }

    @concurrent nonisolated private static func average(_ image: UIImage) async -> Color? {
        guard let cg = image.cgImage else { return nil }
        let side = 8
        var px = [UInt8](repeating: 0, count: side * side * 4)
        let ok: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        guard ok else { return nil }
        var r = 0, g = 0, b = 0
        for i in stride(from: 0, to: px.count, by: 4) { r += Int(px[i]); g += Int(px[i + 1]); b += Int(px[i + 2]) }
        let n = Double(side * side * 255)
        return Color(red: Double(r) / n, green: Double(g) / n, blue: Double(b) / n)
    }

    func cached(_ id: String, _ size: String) -> UIImage? { cache.object(forKey: "\(id)/\(size)" as NSString) }

    /// `size` is the server's rendition: "thumbnail" for grids, "preview" for a screen,
    /// "original" for the file as taken, the one that still carries an HDR gain map.
    func load(_ id: String, _ size: String) async -> UIImage? {
        await load(key: "\(id)/\(size)", path: "/api/media/\(id)/thumbnail?size=\(size)", original: size == "original")
    }

    /// A person's avatar, from /api/users/:id/avatar.
    func avatar(_ userId: String) async -> UIImage? {
        await load(key: "avatar/\(userId)", path: "/api/users/\(userId)/avatar", original: false)
    }

    private func load(key: String, path: String, original: Bool) async -> UIImage? {
        if let hit = cache.object(forKey: key as NSString) { return hit }
        if let task = inFlight[key] { return await task.value }
        let task = Task<UIImage?, Never> {
            await acquire()
            defer { release() }
            guard let data = await Api.shared.bytes(path) else { return nil }
            guard let image = await Self.decode(data, original: original) else { return nil }
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            cache.setObject(image, forKey: key as NSString, cost: cost)
            return image
        }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        return image
    }

    private func acquire() async {
        if running < lanes { running += 1; return }
        await withCheckedContinuation { waiting.append($0) }
    }

    private func release() {
        if waiting.isEmpty { running -= 1 } else { waiting.removeFirst().resume() }
    }
}

/// A photo from the server, fading in once it is there, on a quiet tone until then.
struct RemotePhoto: View {
    let id: String
    var size = "thumbnail"
    @State private var image: UIImage?

    var body: some View {
        Rectangle()
            .fill(Brand.sunken)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill().transition(.opacity)
                }
            }
            .clipped()
            .task(id: "\(id)/\(size)") {
                if let hit = ImageLoader.shared.cached(id, size) { image = hit; return }
                let loaded = await ImageLoader.shared.load(id, size)
                withAnimation(.easeOut(duration: 0.25)) { image = loaded }
            }
    }
}

/// A person as a round face: their avatar once it is there, their initial on their colour until then.
struct Avatar: View {
    let userId: String?
    let hasAvatar: Bool
    let initial: String
    let color: Color
    var ink: Color = .white
    var size: CGFloat
    @State private var image: UIImage?

    var body: some View {
        Text(initial)
            .font(.outfit(size * 0.4, 700))
            .foregroundStyle(ink)
            .frame(width: size, height: size)
            .background(color, in: .circle)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill().frame(width: size, height: size).clipShape(.circle).transition(.opacity)
                }
            }
            .task(id: userId) {
                guard let userId, hasAvatar else { return }
                if let hit = ImageLoader.shared.cached("avatar", userId) { image = hit; return }
                let loaded = await ImageLoader.shared.avatar(userId)
                withAnimation(.easeOut(duration: 0.25)) { image = loaded }
            }
    }
}

/// The tone of a trip's cover: sampled from its photo, else the trip's own colour.
struct CoverTone<Content: View>: View {
    let trip: Trip
    @ViewBuilder let content: (Color) -> Content
    @State private var tone: Color?

    var body: some View {
        content(tone ?? trip.color)
            .animation(.easeInOut(duration: 0.4), value: tone)
            .task(id: trip.coverId) {
                guard let id = trip.coverId else { return }
                tone = await ImageLoader.shared.tone(id)
            }
    }
}

/// A trip's cover: its photo from the server, or the drawn landscape of the demo.
struct CoverView: View {
    let trip: Trip
    var size = "thumbnail"

    var body: some View {
        if let id = trip.coverId {
            RemotePhoto(id: id, size: size)
        } else if let scene = trip.cover {
            LandscapeView(scene: scene)
        } else {
            // A real trip without a cover photo: its own colour with the compass, never a drawn landscape.
            ColourCover(trip: trip)
        }
    }
}

/// The trip's colour from light to deep, with the compass large and faint in the corner.
struct ColourCover: View {
    let trip: Trip
    var body: some View {
        GeometryReader { geo in
            let side = max(geo.size.width, geo.size.height) * 0.8
            ZStack(alignment: .topTrailing) {
                LinearGradient(colors: [trip.color, trip.color.mix(with: Color(hex: 0x1B2440), by: 0.55)], startPoint: .topLeading, endPoint: .bottomTrailing)
                CompassLogo(size: side, color: .white, lineWidth: 1.3)
                    .rotationEffect(.degrees(-12))
                    .opacity(0.16)
                    .offset(x: side * 0.27, y: -side * 0.14)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
    }
}

/// One photo of a day, real or drawn.
struct MediaView: View {
    let media: Media
    var size = "thumbnail"

    var body: some View {
        if let scene = media.scene {
            LandscapeView(scene: scene)
        } else {
            RemotePhoto(id: media.id, size: size)
        }
    }
}

/// Which photos the viewer pages through (the whole trip), and where it starts.
struct ViewerItem: Identifiable {
    let trip: Trip
    let photos: [Media]
    let start: Media
    var id: String { start.id }
}

/// Photos full screen, the whole trip to swipe through, growing out of their tile and
/// back into it (the system zoom transition, swipe down to close). Pinch or double-tap to
/// zoom; originals keep HDR. A heart (hold for five reactions) and comments sit in one
/// glass capsule at the bottom.
struct PhotoViewer: View {
    let item: ViewerItem
    @Binding var current: String
    @State private var reactions = Remote.Reactions()
    @State private var comments: [Remote.Comment] = []
    @State private var picking = false
    @State private var showComments = false
    @State private var zoomed = false
    @Environment(\.dismiss) private var dismiss

    private var live: Bool { item.trip.remoteId != nil }
    private var media: Media? { item.photos.first { $0.id == current } }

    var body: some View {
        TabView(selection: $current) {
            ForEach(item.photos) { media in
                ZoomablePhoto(media: media, zoomed: $zoomed).tag(media.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .background(.black)
        .ignoresSafeArea()
        .overlay(alignment: .top) { topBar }
        .overlay(alignment: .bottom) { if !zoomed { bottomBar.transition(.opacity.combined(with: .move(edge: .bottom))) } }
        .animation(.snappy, value: zoomed)
        .sheet(isPresented: $showComments) {
            CommentsSheet(trip: item.trip, mediaId: current, comments: $comments)
        }
        .environment(\.colorScheme, .dark)
        .statusBarHidden(zoomed)
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
            reactions = (try? await r) ?? Remote.Reactions()
            comments = (try? await c) ?? []
        }
    }

    private var topBar: some View {
        HStack(alignment: .top) {
            if let media, let i = item.photos.firstIndex(where: { $0.id == current }) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(Format.dayHeading(media.takenAt)).font(.outfit(15, 600))
                    Text("\(i + 1) van \(item.photos.count)").font(.inter(12, 500)).foregroundStyle(.secondary)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                }
                .padding(.horizontal, 16)
                .frame(height: 48)
                .glassEffect(.regular, in: .capsule)
            }
            Spacer()
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
        .animation(.snappy, value: current)
    }

    private var bottomBar: some View {
        let mine = reactions.mine[current]
        let counts = reactions.counts[current] ?? [:]
        let total = counts.values.reduce(0, +)
        let said = comments.filter { $0.mediaId == current }.count
        return VStack(spacing: 10) {
            if picking {
                // Hold the heart for the other reactions.
                HStack(spacing: 4) {
                    ForEach(Remote.reactionKinds, id: \.self) { kind in
                        Button { react(mine == kind ? nil : kind) } label: {
                            Text(Remote.reactionEmoji[kind] ?? "").font(.system(size: 28))
                                .frame(width: 48, height: 48)
                                .background(mine == kind ? Color.white.opacity(0.18) : .clear, in: .circle)
                        }
                        .buttonStyle(PressStyle(scale: 0.85))
                    }
                }
                .padding(6)
                .glassEffect(.regular.interactive(), in: .capsule)
                .transition(.scale(scale: 0.6, anchor: .bottomLeading).combined(with: .opacity))
            }
            GlassEffectContainer {
                HStack(spacing: 0) {
                    HStack(spacing: 6) {
                        if let mine, mine != "heart" {
                            Text(Remote.reactionEmoji[mine] ?? "").font(.system(size: 19))
                        } else {
                            Image(systemName: mine == "heart" ? "heart.fill" : "heart")
                                .font(.system(size: 19, weight: .semibold))
                                .foregroundStyle(mine == "heart" ? Color.red : Color.primary)
                                .contentTransition(.symbolEffect(.replace))
                        }
                        if total > 0 { Text("\(total)").font(.inter(15, 600)).monospacedDigit() }
                    }
                    .frame(minWidth: 60, minHeight: 48)
                    .padding(.horizontal, 8)
                    .contentShape(.rect)
                    .onTapGesture { if picking { withAnimation(.snappy) { picking = false } } else { react(mine == nil ? "heart" : nil) } }
                    .onLongPressGesture(minimumDuration: 0.35) { withAnimation(.snappy) { picking.toggle() } }
                    .accessibilityLabel(mine == nil ? "Reageren" : "Reactie weghalen")
                    .accessibilityAddTraits(.isButton)

                    Divider().frame(height: 24)

                    Button { showComments = true } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "bubble.left").font(.system(size: 18, weight: .semibold))
                            if said > 0 { Text("\(said)").font(.inter(15, 600)).monospacedDigit() }
                        }
                        .frame(minWidth: 60, minHeight: 48)
                        .padding(.horizontal, 8)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Opmerkingen")
                }
                .foregroundStyle(.primary)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
        }
        .padding(.bottom, 12)
        .opacity(live ? 1 : 0.5)
        .disabled(!live)
        .animation(.snappy, value: reactions.mine)
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
        reactions.counts[id] = counts
        reactions.mine[id] = kind
        picking = false
        Task {
            do { try await Remote.setReaction(item.trip, mediaId: id, kind: kind) } catch { reactions = before }
        }
    }
}

/// One photo that can be pinched (to 6x) or double-tapped (2.5x around the tap) bigger
/// and moved around while big, kept inside its edges. It opens on the thumbnail the
/// timeline already has, then the preview, then the original with its HDR gain map.
private struct ZoomablePhoto: View {
    let media: Media
    @Binding var zoomed: Bool
    @State private var image: UIImage?
    @State private var scale: CGFloat = 1
    @State private var base: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var box: CGSize = .zero

    init(media: Media, zoomed: Binding<Bool>) {
        self.media = media
        _zoomed = zoomed
        // Whatever is already in memory shows at once: no spinner, no wait.
        let cache = ImageLoader.shared
        _image = State(initialValue: cache.cached(media.id, "original") ?? cache.cached(media.id, "preview") ?? cache.cached(media.id, "thumbnail"))
    }

    var body: some View {
        ZStack {
            if media.scene != nil {
                MediaView(media: media).aspectRatio(media.ratio, contentMode: .fit)
            } else if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .allowedDynamicRange(.high)
            } else {
                // The photo's own shape while it loads, so nothing jumps when it arrives.
                Rectangle().fill(.white.opacity(0.06)).aspectRatio(media.ratio, contentMode: .fit)
            }
        }
        .scaleEffect(scale)
        .offset(offset)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(.rect)
        .onGeometryChange(for: CGSize.self) { $0.size } action: { box = $0 }
        .gesture(
            MagnifyGesture()
                .onChanged { v in scale = min(6, max(1, base * v.magnification)) }
                .onEnded { _ in
                    base = scale
                    withAnimation(.spring(duration: 0.3)) {
                        if scale <= 1.01 { reset() } else { offset = clamped(offset); lastOffset = offset }
                    }
                    zoomed = scale > 1.01
                }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { v in
                    offset = CGSize(width: lastOffset.width + v.translation.width, height: lastOffset.height + v.translation.height)
                }
                .onEnded { _ in
                    withAnimation(.spring(duration: 0.3)) { offset = clamped(offset) }
                    lastOffset = offset
                },
            isEnabled: scale > 1.01
        )
        .onTapGesture(count: 2) { point in
            withAnimation(.spring(duration: 0.25)) {
                if scale > 1.01 {
                    reset()
                } else {
                    // Zoom in around the spot that was tapped.
                    let target: CGFloat = 2.5
                    let dx = (box.width / 2 - point.x) * (target - 1)
                    let dy = (box.height / 2 - point.y) * (target - 1)
                    scale = target; base = target
                    offset = clamped(CGSize(width: dx, height: dy)); lastOffset = offset
                    zoomed = true
                }
            }
        }
        .task(id: media.id) {
            guard media.scene == nil else { return }
            if let quick = await ImageLoader.shared.load(media.id, "preview"), image == nil || image!.size.width < quick.size.width {
                image = quick
            }
            if let full = await ImageLoader.shared.load(media.id, "original") { image = full }
        }
        .onDisappear { reset() }
    }

    /// Keeps a zoomed photo from being dragged away from its edges.
    private func clamped(_ o: CGSize) -> CGSize {
        let fitted: CGSize = {
            guard box.width > 0, box.height > 0 else { return box }
            let r = media.ratio
            return box.width / box.height > r ? CGSize(width: box.height * r, height: box.height) : CGSize(width: box.width, height: box.width / r)
        }()
        let maxX = max(0, (fitted.width * scale - box.width) / 2)
        let maxY = max(0, (fitted.height * scale - box.height) / 2)
        return CGSize(width: min(maxX, max(-maxX, o.width)), height: min(maxY, max(-maxY, o.height)))
    }

    private func reset() {
        scale = 1; base = 1; offset = .zero; lastOffset = .zero; zoomed = false
    }
}

/// The comments on one photo, with a field to add your own.
private struct CommentsSheet: View {
    let trip: Trip
    let mediaId: String
    @Binding var comments: [Remote.Comment]
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        let list = comments.filter { $0.mediaId == mediaId }
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    if list.isEmpty {
                        Text("Nog geen opmerkingen bij deze foto.").foregroundStyle(.secondary)
                    }
                    ForEach(list) { c in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(c.author).font(.inter(14, 650))
                                Spacer()
                                Text(c.at.formatted(.relative(presentation: .named).locale(Format.dutch))).font(.inter(12, 450)).foregroundStyle(.secondary)
                            }
                            Text(c.body).font(.inter(16, 450))
                        }
                        .id(c.id)
                    }
                    if let error { Text(error).foregroundStyle(.red) }
                }
                .onChange(of: list.count) { if let last = list.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } } }
            }
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 10) {
                    TextField("Schrijf een opmerking", text: $text, axis: .vertical)
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
            .navigationTitle("Opmerkingen")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private func send() {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !sending else { return }
        sending = true
        error = nil
        Task {
            do {
                try await Remote.addComment(trip, mediaId: mediaId, body: body)
                comments = (try? await Remote.comments(trip)) ?? comments
                text = ""
            } catch {
                self.error = (error as? Api.Failure)?.message ?? "Versturen lukte niet"
            }
            sending = false
        }
    }
}
