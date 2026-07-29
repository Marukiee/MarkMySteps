package nl.markmaaktmedia.markmysteps;

import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Writes a file to the phone's Downloads folder and offers to share it.
 *
 * A WebView cannot do this on its own: `<a download>` is ignored, and the Web
 * Share API there carries text but not files. Going through MediaStore also
 * means no storage permission is needed on Android 10 and up — the app writes
 * into its own Downloads entry, nothing more.
 */
@CapacitorPlugin(name = "MmsExport")
public class MmsExportPlugin extends Plugin {

    /**
     * `filename`, `mimeType` and `base64`. Resolves with the path the file
     * landed on, so the app can say where it went.
     */
    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename", "markmysteps-backup.json");
        String mimeType = call.getString("mimeType", "application/json");
        String base64 = call.getString("base64");
        if (base64 == null) {
            call.reject("Niets om op te slaan");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Kon het bestand niet lezen");
            return;
        }

        try {
            Uri uri;
            String where;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                uri = getContext()
                        .getContentResolver()
                        .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    call.reject("Kon niet naar Downloads schrijven");
                    return;
                }
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                    if (out == null) {
                        call.reject("Kon niet naar Downloads schrijven");
                        return;
                    }
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContext().getContentResolver().update(uri, values, null, null);
                where = "Downloads/" + filename;
            } else {
                // Pre-scoped-storage: a plain file, shared through the provider.
                File dir = Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("Kon niet naar Downloads schrijven");
                    return;
                }
                File file = new File(dir, filename);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                uri = FileProvider.getUriForFile(
                        getContext(), getContext().getPackageName() + ".fileprovider", file);
                where = file.getAbsolutePath();
            }

            if (Boolean.TRUE.equals(call.getBoolean("share", false))) {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mimeType);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(send, "Back-up delen");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
            }

            JSObject result = new JSObject();
            result.put("path", where);
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Opslaan mislukt: " + e.getMessage());
        }
    }
}
