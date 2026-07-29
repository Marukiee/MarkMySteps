package nl.markmaaktmedia.markmysteps;

import android.Manifest;
import android.content.ContentUris;
import android.content.ContentResolver;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import androidx.core.content.ContextCompat;
import androidx.exifinterface.media.ExifInterface;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.InputStream;

/**
 * The phone's own photo library, for running without Immich.
 *
 * Reads MediaStore directly — no Google Photos, no Play Services — and hands
 * back `content://` URIs. Those go straight into an `<img>` through Capacitor's
 * file bridge, so a timeline of hundreds of photos streams natively instead of
 * being marshalled across the bridge as base64.
 *
 * The awkward part is the location. Since Android 10 the LATITUDE and LONGITUDE
 * columns are always empty: coordinates are stripped from the row, and from the
 * file itself, unless the app holds ACCESS_MEDIA_LOCATION and asks for the
 * original through {@link MediaStore#setRequireOriginal}. Without that a trip
 * has photos but no map, which is most of the point — so it is asked for
 * alongside the library permission.
 */
@CapacitorPlugin(
        name = "MmsGallery",
        permissions = {
                @Permission(
                        alias = MmsGalleryPlugin.LIBRARY,
                        strings = {
                                // Android 13+ splits the old storage permission per media type.
                                Manifest.permission.READ_MEDIA_IMAGES,
                                Manifest.permission.READ_MEDIA_VIDEO,
                        }),
                @Permission(
                        alias = MmsGalleryPlugin.MEDIA_LOCATION,
                        strings = { Manifest.permission.ACCESS_MEDIA_LOCATION }),
        })
public class MmsGalleryPlugin extends Plugin {

    static final String LIBRARY = "library";
    static final String MEDIA_LOCATION = "mediaLocation";

    /** Never hand back more than this in one query; a full library can be tens
     *  of thousands of rows and a trip is never that. */
    private static final int MAX_ROWS = 4000;

    @PluginMethod
    public void permissionStatus(PluginCall call) {
        call.resolve(status());
    }

    /**
     * Asks for the library, and then — separately — for the permission that
     * puts the coordinates back. Two prompts, because they are two decisions.
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (!hasLibrary()) {
            requestPermissionForAlias(LIBRARY, call, "afterLibrary");
            return;
        }
        requestLocationThenResolve(call);
    }

    @PermissionCallback
    private void afterLibrary(PluginCall call) {
        if (!hasLibrary()) {
            call.resolve(status());
            return;
        }
        requestLocationThenResolve(call);
    }

    private void requestLocationThenResolve(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && getPermissionState(MEDIA_LOCATION) != PermissionState.GRANTED) {
            requestPermissionForAlias(MEDIA_LOCATION, call, "afterMediaLocation");
            return;
        }
        call.resolve(status());
    }

    @PermissionCallback
    private void afterMediaLocation(PluginCall call) {
        call.resolve(status());
    }

    /**
     * Every photo and video taken between two instants (milliseconds).
     *
     * Matched on when the shot was taken, not on when the file landed on the
     * phone — a photo copied over later still belongs to the day it was taken.
     */
    @PluginMethod
    public void query(PluginCall call) {
        if (!hasLibrary()) {
            call.reject("Geen toegang tot je fotobibliotheek");
            return;
        }
        long from = call.getData().optLong("fromMs", 0L);
        long to = call.getData().optLong("toMs", System.currentTimeMillis());
        boolean wantLocation = hasMediaLocation();

        Uri collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL);
        String[] projection = new String[] {
                MediaStore.Files.FileColumns._ID,
                MediaStore.Files.FileColumns.MEDIA_TYPE,
                MediaStore.Files.FileColumns.MIME_TYPE,
                MediaStore.Files.FileColumns.DATE_TAKEN,
                MediaStore.Files.FileColumns.DATE_MODIFIED,
                MediaStore.Files.FileColumns.WIDTH,
                MediaStore.Files.FileColumns.HEIGHT,
        };
        // DATE_TAKEN is null on plenty of files (screenshots, downloads), so
        // DATE_MODIFIED stands in — it is in SECONDS, hence the × 1000.
        String selection =
                "(" + MediaStore.Files.FileColumns.MEDIA_TYPE + "=? OR "
                        + MediaStore.Files.FileColumns.MEDIA_TYPE + "=?) AND "
                        + "COALESCE(" + MediaStore.Files.FileColumns.DATE_TAKEN + ", "
                        + MediaStore.Files.FileColumns.DATE_MODIFIED + " * 1000) BETWEEN ? AND ?";
        String[] args = new String[] {
                String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE),
                String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO),
                String.valueOf(from),
                String.valueOf(to),
        };

        JSArray items = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();
        try (Cursor cursor = resolver.query(
                collection,
                projection,
                selection,
                args,
                "COALESCE(" + MediaStore.Files.FileColumns.DATE_TAKEN + ", "
                        + MediaStore.Files.FileColumns.DATE_MODIFIED + " * 1000) ASC")) {
            if (cursor == null) {
                call.reject("Kon de fotobibliotheek niet lezen");
                return;
            }
            int idCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID);
            int typeCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE);
            int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MIME_TYPE);
            int takenCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_TAKEN);
            int modCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_MODIFIED);
            int widthCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.WIDTH);
            int heightCol = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.HEIGHT);

            while (cursor.moveToNext() && items.length() < MAX_ROWS) {
                long id = cursor.getLong(idCol);
                boolean isVideo = cursor.getInt(typeCol) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
                long taken = cursor.isNull(takenCol)
                        ? cursor.getLong(modCol) * 1000L
                        : cursor.getLong(takenCol);
                Uri uri = ContentUris.withAppendedId(collection, id);

                JSObject item = new JSObject();
                item.put("uri", uri.toString());
                item.put("takenAt", taken);
                item.put("mime", cursor.getString(mimeCol));
                item.put("video", isVideo);
                item.put("width", cursor.getInt(widthCol));
                item.put("height", cursor.getInt(heightCol));

                double[] coords = wantLocation && !isVideo ? latLong(resolver, uri) : null;
                if (coords != null) {
                    item.put("latitude", coords[0]);
                    item.put("longitude", coords[1]);
                }
                items.put(item);
            }
        } catch (Exception e) {
            call.reject("Kon de fotobibliotheek niet lezen: " + e.getMessage());
            return;
        }

        JSObject result = new JSObject();
        result.put("items", items);
        result.put("hasLocation", wantLocation);
        call.resolve(result);
    }

    /**
     * The coordinates out of the file's own EXIF. Only the ORIGINAL carries
     * them; the copy MediaStore hands out by default has been redacted.
     */
    private double[] latLong(ContentResolver resolver, Uri uri) {
        Uri source = uri;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                source = MediaStore.setRequireOriginal(uri);
            } catch (Exception ignored) {
                // Not every provider supports it; the redacted copy is all there is.
            }
        }
        try (InputStream stream = resolver.openInputStream(source)) {
            if (stream == null) return null;
            // getLatLong fills a float[]; widened here because everything above
            // this line works in degrees as doubles.
            float[] out = new float[2];
            if (!new ExifInterface(stream).getLatLong(out)) return null;
            return new double[] { out[0], out[1] };
        } catch (Exception e) {
            return null;
        }
    }

    // --- Helpers ------------------------------------------------------------

    private JSObject status() {
        JSObject result = new JSObject();
        result.put("library", hasLibrary());
        result.put("location", hasMediaLocation());
        return result;
    }

    private boolean hasLibrary() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return granted(Manifest.permission.READ_MEDIA_IMAGES)
                    || granted("android.permission.READ_MEDIA_VISUAL_USER_SELECTED");
        }
        return granted(Manifest.permission.READ_EXTERNAL_STORAGE);
    }

    private boolean hasMediaLocation() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || granted(Manifest.permission.ACCESS_MEDIA_LOCATION);
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
                == PackageManager.PERMISSION_GRANTED;
    }
}
