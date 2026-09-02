package nl.markmaaktmedia.markmysteps;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Installs a new version of the app from inside the app.
 *
 * There is no Play Store on the target phones, so an update used to mean:
 * open a browser, download an APK, find it in Downloads, tap it, work out why
 * Android will not install it. Four screens and a dead end for anyone who is
 * not already comfortable doing that.
 *
 * The APK is fetched here rather than in the WebView because a WebView cannot
 * hand the file to the package installer afterwards: that needs a content://
 * URI from the app's own FileProvider, which only native code can mint.
 */
@CapacitorPlugin(name = "MmsUpdate")
public class MmsUpdatePlugin extends Plugin {

    /** Set by cancel(), read by the download loop. */
    private volatile boolean cancelled = false;

    /** Whether Android will let this app start an install at all. */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", mayInstall());
        call.resolve(result);
    }

    /**
     * Opens the one settings screen where "install unknown apps" can be given.
     *
     * Android offers no way to ask for this in a dialog: it is a per-app switch
     * the user has to flip themselves, so the honest thing is to take them
     * straight to it rather than fail with a message about permissions.
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (mayInstall()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                    .setData(Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            call.reject("Kon het instellingenscherm niet openen");
            return;
        }
        JSObject result = new JSObject();
        result.put("granted", false);
        call.resolve(result);
    }

    /**
     * Streams the APK into the cache directory, reporting progress as it goes.
     *
     * Into the cache and not Downloads: this is a file nobody wants to keep,
     * and one the system clears on its own if the phone runs short of room.
     */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Geen download-adres");
            return;
        }
        cancelled = false;
        new Thread(() -> {
            File target = new File(updatesDir(), "markmysteps-update.apk");
            HttpURLConnection connection = null;
            try {
                connection = open(url);
                int status = connection.getResponseCode();
                if (status < 200 || status > 299) {
                    call.reject("Download mislukt (" + status + ")");
                    return;
                }
                long total = connection.getContentLengthLong();
                try (InputStream in = connection.getInputStream();
                     FileOutputStream out = new FileOutputStream(target)) {
                    byte[] buffer = new byte[64 * 1024];
                    long copied = 0;
                    long lastReport = -1;
                    while (true) {
                        if (cancelled) {
                            //noinspection ResultOfMethodCallIgnored
                            target.delete();
                            call.reject("Geannuleerd");
                            return;
                        }
                        int read = in.read(buffer);
                        if (read == -1) break;
                        out.write(buffer, 0, read);
                        copied += read;
                        // One event per whole percent: the WebView cannot
                        // usefully redraw faster than that, and a progress bar
                        // that costs more than the download is a poor trade.
                        long percent = total > 0 ? (copied * 100 / total) : -1;
                        if (percent != lastReport) {
                            lastReport = percent;
                            JSObject progress = new JSObject();
                            progress.put("loaded", copied);
                            progress.put("total", total);
                            progress.put("percent", percent);
                            notifyListeners("progress", progress);
                        }
                    }
                }
                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                call.resolve(result);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                target.delete();
                call.reject("Download mislukt");
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    /** Stops a download that is running. */
    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        call.resolve();
    }

    /**
     * Hands a downloaded file to the system's package installer.
     *
     * What the user sees from here is Android's own install screen, which is
     * the point: the app never installs anything behind their back.
     */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("Geen bestand");
            return;
        }
        File file = new File(path);
        if (!file.exists()) {
            call.reject("Het gedownloade bestand is weg");
            return;
        }
        if (!mayInstall()) {
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("needsPermission", true);
            call.resolve(result);
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            call.reject("Geen installatieprogramma op dit toestel");
            return;
        }
        JSObject result = new JSObject();
        result.put("started", true);
        result.put("needsPermission", false);
        call.resolve(result);
    }

    /** Throws away anything left in the update cache. */
    @PluginMethod
    public void clean(PluginCall call) {
        File[] files = updatesDir().listFiles();
        if (files != null) {
            for (File file : files) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
        call.resolve();
    }

    private boolean mayInstall() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    /**
     * Follows redirects by hand.
     *
     * A release asset on GitHub is a redirect to its storage host, and
     * HttpURLConnection quietly refuses to follow one that changes protocol —
     * which is exactly the hop that link makes. Left to itself the download
     * ends as an empty file with a 302 in front of it.
     */
    private HttpURLConnection open(String url) throws Exception {
        String next = url;
        for (int hop = 0; hop < 5; hop++) {
            HttpURLConnection connection = (HttpURLConnection) new URL(next).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "MarkMySteps");
            connection.setRequestProperty("Accept", "application/octet-stream");
            int status = connection.getResponseCode();
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IllegalStateException("Redirect zonder adres");
                next = new URL(new URL(next), location).toString();
                continue;
            }
            return connection;
        }
        throw new IllegalStateException("Te veel omleidingen");
    }

    private File updatesDir() {
        File dir = new File(getContext().getCacheDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }
}
