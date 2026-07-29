import { Controller, Get, Query } from '@nestjs/common';

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
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
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
  /** When someone last forced a lookup, so the button cannot be a hammer. */
  private lastForced = 0;
  private readonly FORCE_MIN_MS = 10 * 1000;

  /**
   * `?fresh=1` skips the cache: that is the Settings button, where the whole
   * point is asking GitHub now rather than being told what it said two minutes
   * ago. Still floored at one forced lookup every ten seconds, because the
   * GitHub API allows sixty an hour from one address.
   */
  @Get('latest')
  async latest(@Query('fresh') fresh?: string): Promise<LatestApp> {
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

    const now = Date.now();
    const forced = fresh === '1' && now - this.lastForced > this.FORCE_MIN_MS;
    if (forced) this.lastForced = now;
    if (!forced && this.cache && now - this.cache.at < this.TTL_MS) return this.cache.value;

    const value = await this.fetchLatestRelease(repo);
    this.cache = { at: Date.now(), value };
    return value;
  }

  private async fetchLatestRelease(repo: string): Promise<LatestApp> {
    const empty: LatestApp = { version: null, url: null, notes: null };
    const headers: Record<string, string> = {
      'user-agent': 'MarkMySteps',
      accept: 'application/vnd.github+json',
      // GitHub caches its own answers; without this a just-published release
      // can keep reading as if it were not there yet.
      'cache-control': 'no-cache',
    };
    // A token is optional, and only raises the hourly limit.
    if (process.env.GITHUB_TOKEN) {
      headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const get = async (path: string): Promise<unknown> => {
      const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
        headers,
        signal: AbortSignal.timeout(6000),
      });
      return res.ok ? res.json() : null;
    };

    const read = (rel: GhRelease | null | undefined): LatestApp | null => {
      if (!rel || rel.draft) return null;
      // Build number from a "vNN" / "NN" tag or release name.
      const tag = rel.tag_name ?? rel.name ?? '';
      const m = tag.match(/(\d+)/);
      const version = m ? Number(m[1]) : null;
      const apk = rel.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));
      if (!version || !apk) return null;
      return { version, url: apk.browser_download_url, notes: rel.body?.trim() || null };
    };

    try {
      const fromLatest = read((await get('releases/latest')) as GhRelease | null);
      // /releases/latest ignores prereleases, and a release is only "latest"
      // once its assets have finished uploading. The listing has it either
      // way, so the newest usable release there wins if it is newer.
      const list = ((await get('releases?per_page=10')) as GhRelease[] | null) ?? [];
      const fromList = list
        .map(read)
        .filter((r): r is LatestApp => r !== null)
        .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];

      if (fromLatest && fromList) {
        return (fromList.version ?? 0) > (fromLatest.version ?? 0) ? fromList : fromLatest;
      }
      return fromLatest ?? fromList ?? empty;
    } catch {
      return empty; // offline / rate-limited → no banner
    }
  }
}
