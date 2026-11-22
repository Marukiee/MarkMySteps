import AVFoundation
import CryptoKit
import SwiftUI
import UIKit

/// Photos kept on the phone once fetched (thumbnails and previews, not originals or faces), as Android's PhotoDisk:
/// a photo seen before reads from here straight away, before anything waits for the network.
enum PhotoDisk {
    nonisolated private static let dir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    /// About 400 MB; the least recently used go first.
    nonisolated private static let limit = 400 * 1024 * 1024
    nonisolated(unsafe) private static var writes = 0

    nonisolated static func wanted(_ key: String) -> Bool { !key.hasSuffix("/original") && !key.hasPrefix("avatar/") }

    nonisolated private static func file(_ key: String) -> URL {
        let hash = Insecure.SHA1.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return dir.appendingPathComponent(hash)
    }

    nonisolated static func get(_ key: String) -> Data? {
        guard wanted(key) else { return nil }
        let url = file(key)
        guard let data = try? Data(contentsOf: url) else { return nil }
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
        return data
    }

    nonisolated static func put(_ key: String, _ data: Data) {
        guard wanted(key) else { return }
        try? data.write(to: file(key), options: .atomic)
        writes += 1
        if writes % 150 == 1 { Task.detached(priority: .background) { trim() } }
    }

    nonisolated static func remove(_ key: String) { try? FileManager.default.removeItem(at: file(key)) }

    nonisolated static func clear() { for url in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] { try? FileManager.default.removeItem(at: url) } }

    nonisolated private static func trim() {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys) else { return }
        var items = files.compactMap { url -> (URL, Int, Date)? in
            guard let v = try? url.resourceValues(forKeys: Set(keys)) else { return nil }
            return (url, v.fileSize ?? 0, v.contentModificationDate ?? .distantPast)
        }
        var total = items.reduce(0) { $0 + $1.1 }
        guard total > limit else { return }
        items.sort { $0.2 < $1.2 }
        for item in items where total > limit * 8 / 10 {
            try? FileManager.default.removeItem(at: item.0)
            total -= item.1
        }
    }
}

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

    func clear() { cache.removeAllObjects(); tones.removeAll(); Task.detached(priority: .utility) { PhotoDisk.clear() } }

    /// Drops one picture (a new avatar), so it is fetched again.
    func forget(_ key: String) { cache.removeObject(forKey: key as NSString); PhotoDisk.remove(key) }

    /// A photo kept on the phone, read and decoded off the main thread.
    @concurrent nonisolated private static func fromDisk(_ key: String, original: Bool) async -> UIImage? {
        guard let data = PhotoDisk.get(key) else { return nil }
        return await decode(data, original: original)
    }

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
            // A photo already kept on the phone never waits in the queue behind those that still come from the
            // server: on a cold start that queue made every kept cover look as if it loaded.
            if let kept = await Self.fromDisk(key, original: original) {
                keep(kept, key)
                return kept
            }
            await acquire()
            defer { release() }
            guard let data = await Api.shared.bytes(path) else { return nil }
            guard let image = await Self.decode(data, original: original) else { return nil }
            keep(image, key)
            Task.detached(priority: .utility) { PhotoDisk.put(key, data) }
            return image
        }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        return image
    }

    private func keep(_ image: UIImage, _ key: String) {
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        cache.setObject(image, forKey: key as NSString, cost: cost)
    }

    private func acquire() async {
        if running < lanes { running += 1; return }
        await withCheckedContinuation { waiting.append($0) }
    }

    private func release() {
        if waiting.isEmpty { running -= 1 } else { waiting.removeFirst().resume() }
    }
}

/// A photo from the server on a quiet tone until it is there. Already in memory, or read from the phone a moment
/// later (within 250 ms), it simply shows; only a photo that really comes over the network fades in. With more than
/// one candidate, a photo that does not load gives way to the next one (one broken photo made a stop flicker).
struct RemotePhoto: View {
    let ids: [String]
    var size = "thumbnail"
    @State private var image: UIImage?

    init(id: String, size: String = "thumbnail") {
        self.ids = [id]
        self.size = size
        _image = State(initialValue: ImageLoader.shared.cached(id, size))
    }

    /// The first of `ids` that loads.
    init(ids: [String], size: String = "thumbnail") {
        self.ids = ids
        self.size = size
        _image = State(initialValue: ids.lazy.compactMap { ImageLoader.shared.cached($0, size) }.first)
    }

    var body: some View {
        Rectangle()
            .fill(Brand.sunken)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill().transition(.opacity)
                }
            }
            .clipped()
            .task(id: "\(ids.first ?? "")/\(ids.count)/\(size)") {
                if let first = ids.first, let hit = ImageLoader.shared.cached(first, size) { image = hit; return }
                let born = Date()
                for id in ids.prefix(8) {
                    guard let loaded = await ImageLoader.shared.load(id, size) else { continue }
                    if Date().timeIntervalSince(born) < 0.25 || image != nil {
                        image = loaded
                    } else {
                        withAnimation(.easeOut(duration: 0.25)) { image = loaded }
                    }
                    return
                }
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
            .task(id: "\(userId ?? "")/\(hasAvatar)/\(Store.shared.version)") {
                guard let userId, hasAvatar else { image = nil; return }
                if let hit = ImageLoader.shared.cached("avatar", userId) { image = hit; return }
                let born = Date()
                let loaded = await ImageLoader.shared.avatar(userId)
                if Date().timeIntervalSince(born) < 0.25 { image = loaded } else { withAnimation(.easeOut(duration: 0.25)) { image = loaded } }
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
                .overlay(alignment: .topTrailing) {
                    if media.video {
                        // A video in the timeline: its still with a play badge.
                        Image(systemName: "play.fill")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 26, height: 26)
                            .background(.black.opacity(0.45), in: .circle)
                            .padding(8)
                            .accessibilityLabel("Video")
                    }
                }
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

/// One photo that can be pinched (to 6x) or double-tapped (2.5x around the tap) bigger
/// and moved around while big, kept inside its edges. It opens on the thumbnail the
/// timeline already has, then the preview, then the original with its HDR gain map.
struct ZoomablePhoto: View {
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

