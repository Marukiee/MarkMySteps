import { Controller, Get } from '@nestjs/common';

interface LatestApp {
  /** Latest Android versionCode (integer). null when unknown/not configured. */
  version: number | null;
  /** Where to download the APK. null when not configured. */
  url: string | null;
  /** Optional short release note shown in the banner. */
  notes: string | null;
}

/** GitHub release shape (only the bits we read). */
interface GhRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  assets?: { name: string; browser_download_url: string }[];
}

/**
 * Public "is there a newer app?" endpoint (no Play Store on the de-Googled
 * target phones). Two ways to configure it in the API's env:
 *
 *   APP_UPDATE_REPO=owner/repo   – the API reads that repo's LATEST GitHub
 *                                  release automatically (build = the vNN tag,
 *                                  APK = the release's .apk asset). Zero upkeep.
 *
 * or a fully manual override:
 *   APP_LATEST_BUILD=<versionCode>  APP_LATEST_URL=<apk url>  APP_LATEST_NOTES=…
 *
 * The app compares its own build number and shows a download banner if older.
 */
@Controller('app')
export class AppInfoController {
  // Cache the GitHub lookup so we don't hit their API on every app launch.
  // Short enough that a fresh release is advertised within a couple of minutes
  // (a 10-minute cache made a new build look like it hadn't shipped yet).
  private cache: { at: number; value: LatestApp } | null = null;
  private readonly TTL_MS = 2 * 60 * 1000;

  @Get('latest')
  async latest(): Promise<LatestApp> {
    // Manual override wins if set.
    const raw = process.env.APP_LATEST_BUILD;
    if (raw && /^\d+$/.test(raw)) {
      return {
        version: Number(raw),
        url: process.env.APP_LATEST_URL || null,
        notes: process.env.APP_LATEST_NOTES || null,
      };
    }

    const repo = process.env.APP_UPDATE_REPO;
    if (!repo) return { version: null, url: null, notes: null };

    if (this.cache && Date.now() - this.cache.at < this.TTL_MS) return this.cache.value;

    const value = await this.fetchLatestRelease(repo);
    this.cache = { at: Date.now(), value };
    return value;
  }

  private async fetchLatestRelease(repo: string): Promise<LatestApp> {
    const empty: LatestApp = { version: null, url: null, notes: null };
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { 'user-agent': 'MarkMySteps', accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return empty;
      const rel = (await res.json()) as GhRelease;
      // Build number from a "vNN" / "NN" tag or release name.
      const tag = rel.tag_name ?? rel.name ?? '';
      const m = tag.match(/(\d+)/);
      const version = m ? Number(m[1]) : null;
      const apk = rel.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));
      if (!version || !apk) return empty;
      return { version, url: apk.browser_download_url, notes: rel.body?.trim() || null };
    } catch {
      return empty; // offline / rate-limited → no banner
    }
  }
}
