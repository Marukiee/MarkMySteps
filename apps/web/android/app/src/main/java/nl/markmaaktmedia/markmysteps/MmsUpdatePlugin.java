package nl.markmaaktmedia.markmysteps;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.Closeable;
import java.util.List;

import nl.markmaaktmedia.markupdate.MarkUpdate;
import nl.markmaaktmedia.markupdate.MarkUpdater;
import nl.markmaaktmedia.markupdate.ReleaseHighlightsKt;
import nl.markmaaktmedia.markupdate.ReleaseInfo;
import nl.markmaaktmedia.markupdate.UpdateState;

/**
 * The page's side of the shared updater (markupdate).
 *
 * Finding the release, downloading it with its checksum and installing it
 * without a second tap is all markupdate's; this only passes its state to the
 * update card in the web app, and the card's buttons back. The card itself is
 * React, because the whole app is a WebView, but it follows the same shape and
 * words as the Compose card in the other apps.
 */
@CapacitorPlugin(name = "MmsUpdate")
public class MmsUpdatePlugin extends Plugin {

    private Closeable listening;

    @Override
    public void load() {
        listening = updater().addListener(state -> notifyListeners("state", describe(state)));
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (listening != null) listening.close();
        } catch (Exception ignored) {
            // Nothing left to stop.
        }
    }

    /** The app came back to the front: a download waiting on the install switch carries on. */
    @Override
    protected void handleOnResume() {
        updater().resume();
    }

    @PluginMethod
    public void state(PluginCall call) {
        call.resolve(describe(updater().getState().getValue()));
    }

    /** On launch at most every six hours; `manual` asks now, the way the check in Settings does. */
    @PluginMethod
    public void check(PluginCall call) {
        if (call.getBoolean("manual", false)) updater().checkAsync(true);
        else updater().checkIfDueAsync();
        call.resolve();
    }

    /** Update, or try again after a failure. */
    @PluginMethod
    public void start(PluginCall call) {
        UpdateState state = updater().getState().getValue();
        if (state instanceof UpdateState.Available) {
            updater().startUpdate(((UpdateState.Available) state).getRelease());
        } else if (state instanceof UpdateState.Failed) {
            updater().startRetry();
        }
        call.resolve();
    }

    /** Later: this version stays hidden until there is a newer one. */
    @PluginMethod
    public void later(PluginCall call) {
        ReleaseInfo release = releaseOf(updater().getState().getValue());
        if (release != null) updater().dismiss(release.getTag());
        updater().reset();
        call.resolve();
    }

    /** Developer options: a pretend release to walk the card through, or its failure. */
    @PluginMethod
    public void preview(PluginCall call) {
        if (call.getBoolean("fail", false)) updater().showFailurePreview(call.getString("reason", "Test"));
        else updater().showPreview();
        call.resolve();
    }

    private static MarkUpdater updater() {
        return MarkUpdate.get();
    }

    private static ReleaseInfo releaseOf(UpdateState state) {
        if (state instanceof UpdateState.Available) return ((UpdateState.Available) state).getRelease();
        if (state instanceof UpdateState.Downloading) return ((UpdateState.Downloading) state).getRelease();
        if (state instanceof UpdateState.ReadyToInstall) return ((UpdateState.ReadyToInstall) state).getRelease();
        if (state instanceof UpdateState.NeedsPermission) return ((UpdateState.NeedsPermission) state).getRelease();
        if (state instanceof UpdateState.Installing) return ((UpdateState.Installing) state).getRelease();
        if (state instanceof UpdateState.AwaitingConfirmation) return ((UpdateState.AwaitingConfirmation) state).getRelease();
        if (state instanceof UpdateState.Failed) return ((UpdateState.Failed) state).getRelease();
        return null;
    }

    /** The state as the card reads it: what it is, which version, the lines to show and how far along. */
    private JSObject describe(UpdateState state) {
        JSObject out = new JSObject();
        String kind = "idle";
        if (state instanceof UpdateState.Checking) kind = "checking";
        else if (state instanceof UpdateState.UpToDate) kind = "upToDate";
        else if (state instanceof UpdateState.Available) kind = "available";
        else if (state instanceof UpdateState.Downloading) {
            kind = "downloading";
            out.put("progress", ((UpdateState.Downloading) state).getProgress());
        } else if (state instanceof UpdateState.ReadyToInstall) kind = "installing";
        else if (state instanceof UpdateState.NeedsPermission) kind = "needsPermission";
        else if (state instanceof UpdateState.Installing) kind = "installing";
        else if (state instanceof UpdateState.AwaitingConfirmation) kind = "awaitingConfirmation";
        else if (state instanceof UpdateState.Failed) {
            kind = "failed";
            out.put("reason", ((UpdateState.Failed) state).getReason());
        }
        out.put("kind", kind);
        out.put("current", updater().getCurrentVersion());
        ReleaseInfo release = releaseOf(state);
        if (release != null) {
            out.put("version", release.getVersionName());
            out.put("sizeBytes", release.getApkSizeBytes());
            boolean dutch = "nl".equals(AppLang.get(getContext()));
            List<String> lines = ReleaseHighlightsKt.highlights(release, dutch, 2);
            out.put("notes", new JSArray(lines));
        }
        return out;
    }
}
