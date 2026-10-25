import Capacitor
import Photos

/**
 * The phone's own photo library, for running without Immich.
 *
 * Same interface as the Android plugin. Each item's `uri` is an `mmsphoto:`
 * address holding the Photos asset id; PhotoSchemeHandler turns that into the
 * picture when an <img> asks for it, so nothing crosses the bridge as base64.
 *
 * Unlike Android, iOS hands over a photo's coordinates together with the
 * library itself, so `location` simply follows `library`.
 */
@objc(MmsGalleryPlugin)
public class MmsGalleryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MmsGalleryPlugin"
    public let jsName = "MmsGallery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "permissionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "query", returnType: CAPPluginReturnPromise),
    ]

    /** Never more than this in one query; a trip is never a whole library. */
    private static let maxRows = 4000

    @objc func permissionStatus(_ call: CAPPluginCall) {
        call.resolve(status())
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] _ in
            call.resolve(self?.status() ?? ["library": false, "location": false])
        }
    }

    /** Every photo and video taken between two instants (milliseconds). */
    @objc func query(_ call: CAPPluginCall) {
        guard hasLibrary() else {
            call.reject(AppLang.text("gallery.noAccess"))
            return
        }
        let from = Date(timeIntervalSince1970: (call.getDouble("fromMs") ?? 0) / 1000)
        let to = Date(timeIntervalSince1970: (call.getDouble("toMs") ?? Date().timeIntervalSince1970 * 1000) / 1000)

        let options = PHFetchOptions()
        options.predicate = NSPredicate(
            format: "creationDate >= %@ AND creationDate <= %@ AND (mediaType == %d OR mediaType == %d)",
            from as NSDate, to as NSDate, PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        options.fetchLimit = Self.maxRows

        var items: [[String: Any]] = []
        PHAsset.fetchAssets(with: options).enumerateObjects { asset, _, _ in
            let video = asset.mediaType == .video
            var item: [String: Any] = [
                "uri": PhotoSchemeHandler.uri(for: asset.localIdentifier),
                "takenAt": (asset.creationDate ?? Date()).timeIntervalSince1970 * 1000,
                "mime": video ? "video/mp4" : "image/jpeg",
                "video": video,
                "width": asset.pixelWidth,
                "height": asset.pixelHeight,
            ]
            if let location = asset.location, !video {
                item["latitude"] = location.coordinate.latitude
                item["longitude"] = location.coordinate.longitude
            }
            items.append(item)
        }
        call.resolve(["items": items, "hasLocation": true])
    }

    private func hasLibrary() -> Bool {
        let state = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return state == .authorized || state == .limited
    }

    private func status() -> [String: Any] {
        let library = hasLibrary()
        return ["library": library, "location": library]
    }
}
