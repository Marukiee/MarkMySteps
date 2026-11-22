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

    func clear() { cache.removeAllObjects() }

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

/// Which photos the viewer pages through, and where it starts.
struct ViewerItem: Identifiable {
    let photos: [Media]
    let start: Media
    var id: String { start.id }
}

/// Photos full screen: swipe sideways through the day, down to close.
/// Originals are decoded with HDR kept and shown with the high dynamic range allowed.
struct PhotoViewer: View {
    let item: ViewerItem
    @State private var current: String
    @Environment(\.dismiss) private var dismiss

    init(item: ViewerItem) {
        self.item = item
        _current = State(initialValue: item.start.id)
    }

    var body: some View {
        TabView(selection: $current) {
            ForEach(item.photos) { media in
                FullPhoto(media: media).tag(media.id)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .background(.black)
        .ignoresSafeArea()
        .overlay(alignment: .top) {
            HStack {
                if let i = item.photos.firstIndex(where: { $0.id == current }) {
                    Text("\(i + 1) van \(item.photos.count)")
                        .font(.inter(15, 550))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .padding(.horizontal, 14)
                        .frame(height: 44)
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
        .environment(\.colorScheme, .dark)
        .statusBarHidden()
    }
}

private struct FullPhoto: View {
    let media: Media
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if media.scene != nil {
                MediaView(media: media)
                    .aspectRatio(media.ratio, contentMode: .fit)
            } else if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .allowedDynamicRange(.high)
                    .transition(.opacity)
            } else {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: media.id) {
            guard media.scene == nil else { return }
            // The preview first, quick; then the original with its gain map.
            if image == nil, let quick = await ImageLoader.shared.load(media.id, "preview") {
                withAnimation(.easeOut(duration: 0.2)) { image = quick }
            }
            if let full = await ImageLoader.shared.load(media.id, "original") { image = full }
        }
    }
}
