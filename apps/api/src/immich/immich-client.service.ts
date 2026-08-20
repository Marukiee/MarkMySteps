import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

/** Subset of an Immich asset that MarkMySteps cares about. */
export interface ImmichAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  takenAt: Date;
  latitude: number | null;
  longitude: number | null;
}

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
  };
}

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
  async fetchThumbnail(serverUrl: string, apiKey: string, assetId: string): Promise<Response> {
    return this.request(
      serverUrl,
      apiKey,
      `/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=preview`,
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
    options: { method?: string; body?: unknown } = {},
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
      throw new BadGatewayException(`Immich responded with ${res.status}`);
    }
    return res;
  }
}

function toAsset(raw: RawAsset): ImmichAsset {
  return {
    id: raw.id,
    type: raw.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    takenAt: new Date(raw.exifInfo?.dateTimeOriginal ?? raw.fileCreatedAt),
    latitude: raw.exifInfo?.latitude ?? null,
    longitude: raw.exifInfo?.longitude ?? null,
  };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
