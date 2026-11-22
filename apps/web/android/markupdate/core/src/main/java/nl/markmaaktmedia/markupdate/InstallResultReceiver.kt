package nl.markmaaktmedia.markupdate

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/** Wat de installer terugmeldt: een vraag om te tonen, een succes of een mislukking. Staat in de manifest van de module. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val updater = MarkUpdate.getOrNull() ?: return
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                // Android laat de vraag alleen openen over een app die voorin staat. De updater weet of dat zo is, en bewaart de vraag anders
                // tot de gebruiker terugkomt.
                if (confirm != null) updater.onConfirmationNeeded(confirm)
            }
            PackageInstaller.STATUS_SUCCESS -> updater.onInstalled()
            PackageInstaller.STATUS_FAILURE_ABORTED -> updater.onInstallFailed(context.getString(R.string.markupdate_reason_cancelled))
            else -> {
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
                updater.onInstallFailed(message.ifBlank { context.getString(R.string.markupdate_reason_installer) })
            }
        }
    }

    companion object {
        const val ACTION = "nl.markmaaktmedia.markupdate.INSTALL_RESULT"
    }
}
