import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';

/** Subset of an Immich asset that MarkMySteps cares about. */
export interface ImmichAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  takenAt: Date;
  latitude: number | null;
  longitude: number | null;
  /** Displayed size in pixels (EXIF orientation already applied). */
  width: number | null;
  height: number | null;
}

/**
 * Which rendition of an asset to serve.
 *
 * `thumbnail` is the small square-ish WebP Immich generates for its own grid —
 * tens of kilobytes. `preview` is the ~1440px JPEG meant for a full-screen
 * viewer. Handing a grid of two hundred photos the preview of each is what
 * makes a shared trip crawl.
 */
export type ThumbnailSize = 'thumbnail' | 'preview';

interface SearchPageResponse {
  assets: {
    items: RawAsset[];
    nextPage: string | null;
  };
}

interface RawAsset {
  id: string;
  type: string;
  fileCreatedAt: string;
  localDateTime?: string;
  exifInfo?: {
    latitude?: number | null;
    longitude?: number | null;
    dateTimeOriginal?: string | null;
    exifImageWidth?: number | null;
    exifImageHeight?: number | null;
    orientation?: string | number | null;
  };
}

/** EXIF orientations that turn the image a quarter turn: width and height swap. */
const ROTATED_ORIENTATIONS = new Set([5, 6, 7, 8]);

const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 250;
/** Hard cap so a mis-configured range can never loop forever. */
const MAX_PAGES = 40;

/**
 * Thin HTTP client for the Immich API. Stateless: server URL and API key are
 * passed per call so one instance serves every user's connection.
 */
@Injectable()
export class ImmichClientService {
  private readonly logger = new Logger(ImmichClientService.name);

  /** Validates URL + key by fetching the connected Immich user. */
  async ping(serverUrl: string, apiKey: string): Promise<{ email?: string }> {
    const res = await this.request(serverUrl, apiKey, '/api/users/me');
    return (await res.json()) as { email?: string };
  }

  /** Fetches all assets taken within [from, to], following pagination. */
  async searchAssets(
    serverUrl: string,
    apiKey: string,
    from: Date,
    to: Date,
  ): Promise<ImmichAsset[]> {
    const assets: ImmichAsset[] = [];
    let page: string | null = '1';

    for (let i = 0; i < MAX_PAGES && page !== null; i++) {
      const res = await this.request(serverUrl, apiKey, '/api/search/metadata', {
        method: 'POST',
        body: {
          takenAfter: from.toISOString(),
          takenBefore: to.toISOString(),
          size: PAGE_SIZE,
          page: Number(page),
          withExif: true,
          // Archived assets are deliberately hidden in Immich — keep them
          // out of trip timelines too. Newer Immich versions use the
          // `visibility` enum; older ones use `isArchived`. Send both.
          isArchived: false,
          visibility: 'timeline',
        },
      });

      const data = (await res.json()) as SearchPageResponse;
      for (const raw of data.assets.items) {
        assets.push(toAsset(raw));
      }
      page = data.assets.nextPage;
    }

    if (page !== null) {
      this.logger.warn(`searchAssets hit MAX_PAGES (${MAX_PAGES}); results truncated`);
    }
    return assets;
  }

  /**
   * People Immich has recognised, so a name in the search box can become a
   * face filter. Only named people are useful here.
   */
  async listPeople(serverUrl: string, apiKey: string): Promise<{ id: string; name: string }[]> {
    const res = await this.request(serverUrl, apiKey, '/api/people?withHidden=false&size=1000');
    const data = (await res.json()) as { people?: { id: string; name?: string }[] };
    return (data.people ?? [])
      .filter((p): p is { id: string; name: string } => Boolean(p.name))
      .map((p) => ({ id: p.id, name: p.name }));
  }

  /**
   * Asset ids for a search: Immich's own smart search when there are words to
   * search on, otherwise the metadata search filtered by face.
   *
   * Only ids come back. What those assets are, and whether the caller may see
   * them at all, is answered from our own media refs.
   */
  async searchAssetIds(
    serverUrl: string,
    apiKey: string,
    filters: { query?: string; personIds?: string[]; limit?: number },
  ): Promise<string[]> {
    const size = Math.min(filters.limit ?? 250, 1000);
    const smart = Boolean(filters.query);
    const res = await this.request(
      serverUrl,
      apiKey,
      smart ? '/api/search/smart' : '/api/search/metadata',
      {
        method: 'POST',
        body: {
          ...(filters.query ? { query: filters.query } : {}),
          ...(filters.personIds && filters.personIds.length > 0
            ? { personIds: filters.personIds }
            : {}),
          size,
          page: 1,
          isArchived: false,
          visibility: 'timeline',
        },
      },
    );
    const data = (await res.json()) as { assets?: { items?: { id: string }[] } };
    return (data.assets?.items ?? []).map((item) => item.id);
  }

  /**
   * Writes a position onto an asset that has none.
   *
   * Immich takes coordinates on the asset itself (PUT /api/assets/:id), which
   * is also what its own map reads, so a photo placed here shows up in the
   * right country over there too.
   */
  async setAssetLocation(
    serverUrl: string,
    apiKey: string,
    assetId: string,
    latitude: number,
    longitude: number,
  ): Promise<void> {
    await this.request(serverUrl, apiKey, `/api/assets/${encodeURIComponent(assetId)}`, {
      method: 'PUT',
      body: { latitude, longitude },
    });
  }

  /** Streams a thumbnail; returns the upstream response for piping. */
  async fetchThumbnail(
    serverUrl: string,
    apiKey: string,
    assetId: string,
    size: ThumbnailSize = 'preview',
  ): Promise<Response> {
    return this.request(
      serverUrl,
      apiKey,
      `/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=${size}`,
      { missingIsGone: true },
    );
  }

  /**
   * Streams the file as it was uploaded, for "download this photo".
   *
   * The preview rendition is a re-encoded ~1440px JPEG, which is the right
   * thing to look at and the wrong thing to keep: a download should hand back
   * the picture the camera took, metadata and all.
   */
  async fetchOriginal(serverUrl: string, apiKey: string, assetId: string): Promise<Response> {
    return this.request(
      serverUrl,
      apiKey,
      `/api/assets/${encodeURIComponent(assetId)}/original`,
      { missingIsGone: true },
    );
  }

  /** Streams video playback with Range support (seeking). */
  async fetchVideo(
    serverUrl: string,
    apiKey: string,
    assetId: string,
    range?: string,
  ): Promise<Response> {
    const url = new URL(
      `/api/assets/${encodeURIComponent(assetId)}/video/playback`,
      serverUrl.endsWith('/') ? serverUrl : `${serverUrl}/`,
    );
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'x-api-key': apiKey,
          ...(range ? { range } : {}),
        },
        signal: AbortSignal.timeout(60_000),
        redirect: 'error',
      });
    } catch (err) {
      this.logger.warn(`Immich video request failed: ${String(err)}`);
      throw new BadGatewayException('Could not reach the Immich server');
    }
    if (!res.ok && res.status !== 206) {
      throw new BadGatewayException(`Immich responded with ${res.status}`);
    }
    return res;
  }

  private async request(
    serverUrl: string,
    apiKey: string,
    path: string,
    options: { method?: string; body?: unknown; missingIsGone?: boolean } = {},
  ): Promise<Response> {
    const url = new URL(path, ensureTrailingSlash(serverUrl));
    let res: Response;
    try {
      res = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'x-api-key': apiKey,
          accept: 'application/json',
          ...(options.body ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error', // an Immich API endpoint never redirects; fail closed
      });
    } catch (err) {
      this.logger.warn(`Immich request failed: ${String(err)}`);
      throw new BadGatewayException('Could not reach the Immich server');
    }

    if (!res.ok) {
      // A 404 on an asset is not a broken server: the photo was deleted in
      // Immich and everything here that still points at it is out of date.
      // Told apart from every other failure so the caller can act on it.
      if (res.status === 404 && options.missingIsGone) {
        throw new NotFoundException('Immich no longer has this asset');
      }
      throw new BadGatewayException(`Immich responded with ${res.status}`);
    }
    return res;
  }
}

function toAsset(raw: RawAsset): ImmichAsset {
  const { width, height } = displayedSize(raw.exifInfo);
  return {
    id: raw.id,
    type: raw.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    takenAt: new Date(raw.exifInfo?.dateTimeOriginal ?? raw.fileCreatedAt),
    latitude: raw.exifInfo?.latitude ?? null,
    longitude: raw.exifInfo?.longitude ?? null,
    width,
    height,
  };
}

/**
 * The size the photo is actually seen at.
 *
 * EXIF stores the sensor's dimensions plus a flag saying how the camera was
 * held. A portrait shot off a phone is a landscape file with orientation 6, so
 * taking the stored numbers at face value lays every portrait out sideways.
 */
function displayedSize(exif: RawAsset['exifInfo']): { width: number | null; height: number | null } {
  const w = exif?.exifImageWidth ?? null;
  const h = exif?.exifImageHeight ?? null;
  if (!w || !h || w <= 0 || h <= 0) return { width: null, height: null };
  const orientation = Number(exif?.orientation ?? 1);
  return ROTATED_ORIENTATIONS.has(orientation) ? { width: h, height: w } : { width: w, height: h };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
