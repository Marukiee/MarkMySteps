package nl.markmaaktmedia.markmysteps.next

import android.app.Application
import android.content.Context

/**
 * Starts what has to be there before any screen: the language, and the updater all of Marks apps share
 * (markupdate), whose install receiver uses the same instance, also when Android wakes the process for nothing else.
 */
class MmsApp : Application() {
    override fun attachBaseContext(base: Context) = super.attachBaseContext(Lang.wrap(base))

    override fun onCreate() {
        super.onCreate()
        Lang.init(this)
        Updates.init(this)
    }
}
