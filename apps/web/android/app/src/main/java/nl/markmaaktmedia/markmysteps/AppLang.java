package nl.markmaaktmedia.markmysteps;

import android.content.Context;
import android.content.res.Configuration;

import java.util.Locale;

/**
 * The language the app speaks, for the few texts the native side writes itself:
 * the tracking notification, the notification channels and the errors a plugin
 * hands back to the page.
 *
 * The page says which language it chose (Settings can differ from the phone),
 * and that is kept here so a service or a worker that runs without the page
 * still writes in it. Until the page has said anything, the phone decides.
 */
final class AppLang {
    private static final String PREFS = "mms_lang";
    private static final String KEY = "lang";

    private AppLang() {}

    static void set(Context context, String lang) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY, lang == null ? "" : lang)
                .apply();
    }

    /** "nl", "en", or "" when the page has not said yet. */
    static String get(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "");
    }

    /** For the server, which writes the phone's notification in this language. */
    static String header(Context context) {
        String lang = get(context);
        return lang.isEmpty() ? Locale.getDefault().toLanguageTag() : lang;
    }

    /** The string in the app's language. */
    static String text(Context context, int id, Object... args) {
        return localized(context).getString(id, args);
    }

    private static Context localized(Context base) {
        String lang = get(base);
        if (lang.isEmpty()) return base;
        Configuration config = new Configuration(base.getResources().getConfiguration());
        config.setLocale(new Locale(lang));
        return base.createConfigurationContext(config);
    }
}
