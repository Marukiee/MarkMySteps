package nl.markmaaktmedia.markmysteps;

import android.app.Application;
import android.content.pm.PackageInfo;

import nl.markmaaktmedia.markupdate.MarkUpdate;
import nl.markmaaktmedia.markupdate.MarkUpdateConfig;

/**
 * Starts the updater all of Marks apps share (markupdate), before anything
 * else: its install receiver uses the same instance, also when Android wakes
 * the process for nothing but that.
 *
 * MarkMySteps counts in build numbers (the release tag is v267), so the
 * version it compares is the version code, not the "1.0" version name.
 * There is no changelog.json in this repo, so the card takes its lines from
 * the release text.
 */
public class MainApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        MarkUpdate.init(
                this,
                new MarkUpdateConfig(
                        "Marukiee",
                        "MarkMySteps",
                        "markmysteps.apk",
                        String.valueOf(versionCode()),
                        "MarkMySteps",
                        R.drawable.ic_stat_track,
                        "update",
                        6L * 60 * 60 * 1000,
                        null));
    }

    private long versionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.getLongVersionCode();
        } catch (Exception e) {
            return 0;
        }
    }
}
