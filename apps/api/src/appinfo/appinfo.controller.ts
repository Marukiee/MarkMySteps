import { Controller, Get } from '@nestjs/common';

interface LatestApp {
  /** Latest Android versionCode (integer). null when not configured. */
  version: number | null;
  /** Where to download the APK. null when not configured. */
  url: string | null;
  /** Optional short release note shown in the banner. */
  notes: string | null;
}

/**
 * Public "is there a newer app?" endpoint. The self-hoster points these env vars
 * at their latest APK (there's no Play Store on the de-Googled target phones):
 *   APP_LATEST_BUILD  – the versionCode of the newest APK (e.g. 42)
 *   APP_LATEST_URL    – direct download URL for that APK
 *   APP_LATEST_NOTES  – optional one-line "what's new"
 * The app compares its own build number and shows a download banner if older.
 */
@Controller('app')
export class AppInfoController {
  @Get('latest')
  latest(): LatestApp {
    const raw = process.env.APP_LATEST_BUILD;
    const version = raw && /^\d+$/.test(raw) ? Number(raw) : null;
    return {
      version,
      url: process.env.APP_LATEST_URL || null,
      notes: process.env.APP_LATEST_NOTES || null,
    };
  }
}
