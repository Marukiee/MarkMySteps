import AVFoundation
import Photos
import UIKit
import WebKit

/**
 * Serves `mmsphoto://asset/<id>` to the WebView: a photo from the phone's own
 * library, by its Photos asset id.
 *
 * A picture is rendered to at most 1600 px on its long side, enough for the
 * full-screen viewer and still quick for a grid. A video gets its poster frame
 * when an <img> asks, and the file itself when a <video> does (those ask with a
 * Range header), served in ranges so it can seek.
 */
final class PhotoSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "mmsphoto"
    private static let maxSide: CGFloat = 1600

    static func uri(for localIdentifier: String) -> String {
        let id = localIdentifier.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? localIdentifier
        return "\(scheme)://asset/\(id)"
    }

    /** Tasks the WebView has given up on; answering one of those crashes. */
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        // Read from the raw address: `url.path` comes back decoded, and the
        // slashes inside an asset id would then split it into pieces.
        guard let url = task.request.url,
              let encoded = url.absoluteString.components(separatedBy: "/asset/").last?
                  .components(separatedBy: "?").first,
              let id = encoded.removingPercentEncoding,
              let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
            fail(task, code: 404)
            return
        }
        let range = task.request.value(forHTTPHeaderField: "Range")
        if asset.mediaType == .video && range != nil {
            serveVideo(asset, range: range, task: task)
        } else {
            serveImage(asset, task: task)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock()
        stopped.insert(ObjectIdentifier(task))
        lock.unlock()
    }

    private func serveImage(_ asset: PHAsset, task: WKURLSchemeTask) {
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = true
        options.isSynchronous = false
        let scale = min(1, Self.maxSide / CGFloat(max(asset.pixelWidth, asset.pixelHeight, 1)))
        let target = CGSize(width: CGFloat(asset.pixelWidth) * scale, height: CGFloat(asset.pixelHeight) * scale)
        PHImageManager.default().requestImage(
            for: asset, targetSize: target, contentMode: .aspectFit, options: options
        ) { [weak self] image, _ in
            guard let self else { return }
            guard let data = image?.jpegData(compressionQuality: 0.86) else {
                self.fail(task, code: 404)
                return
            }
            self.respond(task, status: 200, headers: [
                "Content-Type": "image/jpeg",
                "Content-Length": String(data.count),
                "Cache-Control": "private, max-age=86400",
            ], body: data)
        }
    }

    private func serveVideo(_ asset: PHAsset, range: String?, task: WKURLSchemeTask) {
        let options = PHVideoRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .highQualityFormat
        PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { [weak self] avAsset, _, _ in
            guard let self else { return }
            guard let fileURL = (avAsset as? AVURLAsset)?.url,
                  let handle = try? FileHandle(forReadingFrom: fileURL) else {
                self.fail(task, code: 404)
                return
            }
            defer { try? handle.close() }
            let total = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? 0
            var start = 0
            var end = total - 1
            if let range, range.hasPrefix("bytes=") {
                let parts = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
                if let s = parts.first.flatMap({ Int($0) }) { start = s }
                if parts.count > 1, let e = Int(parts[1]) { end = min(e, total - 1) }
            }
            // A small slice per request keeps memory flat; the player asks again.
            end = min(end, start + 4 * 1024 * 1024 - 1)
            guard start <= end, (try? handle.seek(toOffset: UInt64(start))) != nil else {
                self.fail(task, code: 416)
                return
            }
            let body = handle.readData(ofLength: end - start + 1)
            self.respond(task, status: 206, headers: [
                "Content-Type": "video/mp4",
                "Content-Length": String(body.count),
                "Content-Range": "bytes \(start)-\(start + body.count - 1)/\(total)",
                "Accept-Ranges": "bytes",
            ], body: body)
        }
    }

    private func respond(_ task: WKURLSchemeTask, status: Int, headers: [String: String], body: Data) {
        DispatchQueue.main.async {
            guard self.alive(task), let url = task.request.url,
                  let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)
            else { return }
            task.didReceive(response)
            task.didReceive(body)
            task.didFinish()
        }
    }

    private func fail(_ task: WKURLSchemeTask, code: Int) {
        DispatchQueue.main.async {
            guard self.alive(task) else { return }
            task.didFailWithError(NSError(domain: "mmsphoto", code: code))
        }
    }

    private func alive(_ task: WKURLSchemeTask) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopped.remove(ObjectIdentifier(task)) == nil
    }
}
