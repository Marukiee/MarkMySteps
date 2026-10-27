import Capacitor
import Photos
import UIKit

/**
 * The photo viewer, drawn natively on the iPhone.
 *
 * The page stays the owner of everything that is data: which photos, what they
 * are called, who said what about them, and what the menu does. It opens the
 * viewer with the list and keeps it told about the photo on screen (`state`).
 * This side owns what a finger feels: paging, zoom, the swipe away, video, and
 * the bars in Liquid Glass. What a person does here comes back as an event, and
 * the page answers it the way its own viewer would.
 *
 * Pixels come straight from the server with the page's token. What cannot be
 * fetched that way (offline, an expired token) is asked of the page, which has
 * its own cache and refreshes its own session: this side never refreshes, or
 * it would race the page for the one refresh token and sign the user out.
 */
@objc(MmsViewerPlugin)
public class MmsViewerPlugin: CAPPlugin, CAPBridgedPlugin, PhotoViewerDelegate {
    public let identifier = "MmsViewerPlugin"
    public let jsName = "MmsViewer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "items", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "image", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "video", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "note", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "result", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
    ]

    private var viewer: PhotoViewerController?
    private let source = ViewerSource()

    public override func load() {
        source.askPage = { [weak self] key, path in
            self?.notifyListeners("image", data: ["key": key, "path": path])
        }
    }

    @objc func open(_ call: CAPPluginCall) {
        let items = (call.getArray("items") as? [[String: Any]] ?? []).compactMap(ViewerItem.init)
        let labels = ViewerLabels(call.getObject("labels") ?? [:])
        let index = min(max(call.getInt("index") ?? 0, 0), max(items.count - 1, 0))
        let comments = call.getBool("startWithComments") ?? false
        source.token = call.getString("token")
        DispatchQueue.main.async {
            guard !items.isEmpty, let host = self.bridge?.viewController else {
                call.reject("Nothing to show")
                return
            }
            self.viewer?.closeNow()
            self.source.reset()
            let viewer = PhotoViewerController(
                items: items, index: index, labels: labels, source: self.source, delegate: self)
            self.viewer = viewer
            viewer.present(from: host, withComments: comments)
            call.resolve()
        }
    }

    @objc func items(_ call: CAPPluginCall) {
        let items = (call.getArray("items") as? [[String: Any]] ?? []).compactMap(ViewerItem.init)
        let index = call.getInt("index")
        DispatchQueue.main.async {
            self.viewer?.replace(items: items, index: index)
            call.resolve()
        }
    }

    @objc func state(_ call: CAPPluginCall) {
        guard let state = ViewerState(call.options as? [String: Any] ?? [:]) else {
            call.reject("No id")
            return
        }
        // The page refreshes its session on its own; the next fetch here uses
        // whatever it holds now.
        if let token = call.getString("token") { source.token = token }
        DispatchQueue.main.async {
            self.viewer?.apply(state)
            call.resolve()
        }
    }

    /** The page's answer to an `image` event: the bytes, or nothing at all. */
    @objc func image(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("No key")
            return
        }
        if let token = call.getString("token") { source.token = token }
        let data = call.getString("base64").flatMap { Data(base64Encoded: $0) }
        source.provided(key: key, data: data)
        call.resolve()
    }

    @objc func video(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("No id")
            return
        }
        let url = call.getString("url").flatMap(URL.init(string:))
        DispatchQueue.main.async {
            self.viewer?.videoURL(url, for: id)
            call.resolve()
        }
    }

    @objc func note(_ call: CAPPluginCall) {
        let text = call.getString("text")
        let busy = call.getBool("busy") ?? false
        DispatchQueue.main.async {
            self.viewer?.showNote(text, busy: busy)
            call.resolve()
        }
    }

    /** How a post or a delete the viewer asked for went. */
    @objc func result(_ call: CAPPluginCall) {
        let request = call.getString("request") ?? ""
        let error = call.getString("error")
        DispatchQueue.main.async {
            self.viewer?.finished(request: request, error: error)
            call.resolve()
        }
    }

    /**
     * The share sheet for a downloaded photo. The page's own share plugin asks
     * the bridge's controller, which is busy presenting this viewer and says
     * no; this presents it from the viewer instead.
     */
    @objc func share(_ call: CAPPluginCall) {
        let urls = (call.getArray("files") as? [String] ?? []).compactMap { path -> URL? in
            path.hasPrefix("file://") ? URL(string: path) : URL(fileURLWithPath: path)
        }
        DispatchQueue.main.async {
            guard let viewer = self.viewer, !urls.isEmpty else {
                call.reject("No viewer")
                return
            }
            viewer.share(urls) { completed in
                call.resolve(["completed": completed])
            }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.viewer?.closeNow()
            self.viewer = nil
            self.source.reset()
            call.resolve()
        }
    }

    // MARK: PhotoViewerDelegate

    func viewer(_ viewer: PhotoViewerController, didShow index: Int) {
        notifyListeners("index", data: ["index": index])
    }

    func viewerDidClose(_ viewer: PhotoViewerController) {
        if self.viewer === viewer {
            self.viewer = nil
            source.reset()
        }
        notifyListeners("closed", data: [:])
    }

    func viewer(_ viewer: PhotoViewerController, action: String, item: String) {
        notifyListeners("action", data: ["action": action, "id": item])
    }

    func viewer(_ viewer: PhotoViewerController, react target: String, kind: String?) {
        notifyListeners("react", data: ["target": target, "kind": kind ?? NSNull()])
    }

    func viewer(_ viewer: PhotoViewerController, post body: String, item: String, request: String) {
        notifyListeners("post", data: ["id": item, "body": body, "request": request])
    }

    func viewer(_ viewer: PhotoViewerController, remove comment: String, request: String) {
        notifyListeners("remove", data: ["comment": comment, "request": request])
    }

    func viewer(_ viewer: PhotoViewerController, needsVideo item: String) {
        notifyListeners("video", data: ["id": item])
    }
}

// MARK: - What the page hands over

/** One photo or video, and every place its pixels can come from. */
struct ViewerItem {
    let id: String
    let isVideo: Bool
    /** The server's small and full renditions, fetched with the page's token. */
    let lowURL: URL?
    let fullURL: URL?
    /** The same two as API paths, for asking the page when fetching fails. */
    let lowPath: String?
    let fullPath: String?
    /** A photo that never left the phone: its Photos asset id. */
    let asset: String?
    /** Width over height, known before any pixel is. */
    let ratio: CGFloat?

    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String else { return nil }
        self.id = id
        isVideo = (raw["video"] as? Bool) ?? false
        lowURL = (raw["low"] as? String).flatMap(URL.init(string:))
        fullURL = (raw["full"] as? String).flatMap(URL.init(string:))
        lowPath = raw["lowPath"] as? String
        fullPath = raw["fullPath"] as? String
        asset = raw["asset"] as? String
        ratio = (raw["ratio"] as? Double).map { CGFloat($0) }
    }
}

struct ViewerAction {
    let id: String
    let title: String
    let symbol: String
}

struct ViewerComment {
    let id: String
    let name: String
    let traveller: Bool
    let time: String
    let body: String
    let canDelete: Bool
    let likes: Int
    let liked: Bool
    let likedBy: String
}

struct ViewerComments {
    /** "Reacties" or "3 reacties", already in the page's language. */
    let title: String
    /** What the bottom button says: the count, or "Reageer" with none. */
    let button: String
    let list: [ViewerComment]
}

struct ViewerReactions {
    let mine: String?
    let total: Int
    /** Who gave what, as one line: "❤️ Mark · 😂 Sanne". */
    let names: String
}

/** What the page says about one photo. Sent again whenever any of it changes. */
struct ViewerState {
    let id: String
    let title: String
    let subtitle: String?
    let actions: [ViewerAction]
    let comments: ViewerComments?
    let reactions: ViewerReactions?

    init?(_ raw: [String: Any]) {
        guard let id = raw["id"] as? String else { return nil }
        self.id = id
        title = raw["title"] as? String ?? ""
        subtitle = raw["subtitle"] as? String
        actions = (raw["actions"] as? [[String: Any]] ?? []).compactMap { a in
            guard let id = a["id"] as? String, let title = a["title"] as? String else { return nil }
            return ViewerAction(id: id, title: title, symbol: a["symbol"] as? String ?? "circle")
        }
        if let c = raw["comments"] as? [String: Any] {
            comments = ViewerComments(
                title: c["title"] as? String ?? "",
                button: c["button"] as? String ?? "",
                list: (c["list"] as? [[String: Any]] ?? []).compactMap { row in
                    guard let id = row["id"] as? String else { return nil }
                    return ViewerComment(
                        id: id,
                        name: row["name"] as? String ?? "",
                        traveller: row["traveller"] as? Bool ?? false,
                        time: row["time"] as? String ?? "",
                        body: row["body"] as? String ?? "",
                        canDelete: row["canDelete"] as? Bool ?? false,
                        likes: row["likes"] as? Int ?? 0,
                        liked: row["liked"] as? Bool ?? false,
                        likedBy: row["likedBy"] as? String ?? "")
                })
        } else {
            comments = nil
        }
        if let r = raw["reactions"] as? [String: Any] {
            reactions = ViewerReactions(
                mine: r["mine"] as? String,
                total: r["total"] as? Int ?? 0,
                names: r["names"] as? String ?? "")
        } else {
            reactions = nil
        }
    }
}

/** Every word the viewer says, in the page's language. */
struct ViewerLabels {
    struct Reaction {
        let kind: String
        let emoji: String
        let label: String
    }

    let close: String
    let more: String
    let comments: String
    let commentsClose: String
    let placeholder: String
    let post: String
    let delete: String
    let empty: String
    let traveller: String
    let videoLoading: String
    let like: String
    let unlike: String
    let change: String
    let reactions: [Reaction]

    init(_ raw: [String: Any]) {
        func s(_ key: String) -> String { raw[key] as? String ?? "" }
        close = s("close")
        more = s("more")
        comments = s("comments")
        commentsClose = s("commentsClose")
        placeholder = s("placeholder")
        post = s("post")
        delete = s("delete")
        empty = s("empty")
        traveller = s("traveller")
        videoLoading = s("videoLoading")
        like = s("like")
        unlike = s("unlike")
        change = s("change")
        reactions = (raw["reactions"] as? [[String: Any]] ?? []).compactMap { r in
            guard let kind = r["kind"] as? String, let emoji = r["emoji"] as? String else { return nil }
            return Reaction(kind: kind, emoji: emoji, label: r["label"] as? String ?? kind)
        }
    }

    func emoji(_ kind: String?) -> String? {
        reactions.first { $0.kind == kind }?.emoji
    }
}

// MARK: - Where the pixels come from

/**
 * Loads the two renditions of a photo, small first.
 *
 * Server photos come over the network with the page's bearer token; anything
 * that fails (offline, a token that just ran out) is asked of the page, whose
 * own loader has the offline cache and refreshes the session. Photos that never
 * left the phone come from Photos itself.
 */
final class ViewerSource {
    enum Size: String {
        case low
        case full
    }

    var token: String?
    /** Asks the page for the bytes of an API path; it answers through `provided`. */
    var askPage: ((_ key: String, _ path: String) -> Void)?

    private let cache = NSCache<NSString, UIImage>()
    private var waiting: [String: [(UIImage?) -> Void]] = [:]
    /** Which ask of the page each key is waiting on, so a late timeout can tell. */
    private var asks: [String: UUID] = [:]
    private let lock = NSLock()
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 256 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config)
    }()

    init() {
        cache.totalCostLimit = 160 << 20
    }

    func cached(_ item: ViewerItem, _ size: Size) -> UIImage? {
        cache.object(forKey: key(item, size) as NSString)
    }

    /** Calls back on the main queue, with nil when there is nothing to show. */
    func image(_ item: ViewerItem, _ size: Size, completion: @escaping (UIImage?) -> Void) {
        let key = self.key(item, size)
        if let hit = cache.object(forKey: key as NSString) {
            completion(hit)
            return
        }
        lock.lock()
        let first = waiting[key] == nil
        waiting[key, default: []].append(completion)
        lock.unlock()
        guard first else { return }

        if let asset = item.asset {
            fromPhotos(asset, size: size) { [weak self] image in self?.deliver(key, image) }
            return
        }
        let path = size == .low ? item.lowPath : item.fullPath
        let fallBack = { [weak self] in
            guard let self else { return }
            guard let path else {
                self.deliver(key, nil)
                return
            }
            self.ask(key, path)
        }
        // No address of its own (a phone without a server): only the page
        // knows where it is.
        guard let url = size == .low ? item.lowURL : item.fullURL else {
            fallBack()
            return
        }
        var request = URLRequest(url: url)
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        session.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            if ok, let data, let image = Self.decode(data) {
                self.deliver(key, image)
                return
            }
            fallBack()
        }.resume()
    }

    /**
     * Asks the page, and stops waiting after a while: a page that never
     * answers (the viewer was closed, its own fetch hung) would otherwise
     * leave this photo waiting until the app is quit, and every later look at
     * it would join that wait.
     */
    private func ask(_ key: String, _ path: String) {
        let id = UUID()
        lock.lock()
        asks[key] = id
        lock.unlock()
        DispatchQueue.main.async { [weak self] in
            guard let ask = self?.askPage else {
                self?.deliver(key, nil)
                return
            }
            ask(key, path)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let same = self.asks[key] == id
            self.lock.unlock()
            if same { self.deliver(key, nil) }
        }
    }

    /**
     * Lets go of everything still waiting, for a viewer that closed or a new
     * one: nobody is left to answer the old asks. Fetches still on their way
     * fill the cache when they land.
     */
    func reset() {
        lock.lock()
        let all = waiting
        waiting = [:]
        asks = [:]
        lock.unlock()
        DispatchQueue.main.async {
            for callbacks in all.values {
                for callback in callbacks { callback(nil) }
            }
        }
    }

    /** The page's answer to a request it was asked to fill. */
    func provided(key: String, data: Data?) {
        DispatchQueue.global(qos: .userInitiated).async {
            self.deliver(key, data.flatMap(Self.decode))
        }
    }

    /** Fetches ahead, so paging lands on a photo rather than on a placeholder. */
    func warm(_ item: ViewerItem) {
        guard !item.isVideo || item.asset == nil else { return }
        image(item, item.isVideo ? .low : .full) { _ in }
    }

    private func key(_ item: ViewerItem, _ size: Size) -> String {
        "\(item.id)|\(size.rawValue)"
    }

    private func deliver(_ key: String, _ image: UIImage?) {
        if let image {
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            cache.setObject(image, forKey: key as NSString, cost: cost)
        }
        lock.lock()
        let callbacks = waiting.removeValue(forKey: key) ?? []
        asks.removeValue(forKey: key)
        lock.unlock()
        DispatchQueue.main.async {
            for callback in callbacks { callback(image) }
        }
    }

    /** Decoded off the main queue, so the first frame of a page does not stall. */
    private static func decode(_ data: Data) -> UIImage? {
        guard let image = UIImage(data: data) else { return nil }
        return image.preparingForDisplay() ?? image
    }

    private func fromPhotos(_ id: String, size: Size, completion: @escaping (UIImage?) -> Void) {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            completion(nil)
            return
        }
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        let side: CGFloat = size == .low ? 400 : 2400
        let scale = min(1, side / CGFloat(max(asset.pixelWidth, asset.pixelHeight, 1)))
        let target = CGSize(width: CGFloat(asset.pixelWidth) * scale, height: CGFloat(asset.pixelHeight) * scale)
        PHImageManager.default().requestImage(
            for: asset, targetSize: target, contentMode: .aspectFit, options: options
        ) { image, _ in
            completion(image)
        }
    }
}
