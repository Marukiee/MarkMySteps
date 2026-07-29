/**
 * Minimal fetch wrapper with JWT handling: attaches the access token,
 * transparently refreshes once on 401, and logs out when refresh fails.
 */

import { Capacitor } from '@capacitor/core';
import { DEFAULT_SERVER_URL } from '../config';
import { mediaSrc } from '../lib/gallery';
import { localRequest } from '../lib/localBackend';
import { isLocalMode } from '../lib/localMode';
import {
  cacheGetJson,
  cachePutJson,
  thumbCacheMatch,
  thumbCachePut,
} from '../lib/offlineCache';

const ACCESS_KEY = 'mms.access';
const REFRESH_KEY = 'mms.refresh';
const SERVER_KEY = 'mms.server';

/**
 * In the browser/PWA the API lives on the same origin (empty base). The
 * Android app is served from its own WebView origin, so it needs the full
 * server URL. It defaults to DEFAULT_SERVER_URL so a fresh install just
 * works; without this the app would fetch its own bundled index.html and
 * choke on "Unexpected token '<'".
 */
export function getServerBase(): string {
  const stored = localStorage.getItem(SERVER_KEY);
  if (stored) return stored;
  // In the native app the WebView origin is not the API — default to the
  // real server. On the web the API is same-origin (empty base).
  return Capacitor.isNativePlatform() ? DEFAULT_SERVER_URL : '';
}

export function setServerBase(url: string): void {
  localStorage.setItem(SERVER_KEY, url.replace(/\/+$/, ''));
}

let onLogout: (() => void) | null = null;

export function setLogoutHandler(handler: () => void): void {
  onLogout = handler;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function isLoggedIn(): boolean {
  return getAccessToken() !== null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Whether the server answered the last request. GETs fall back to the offline
 * cache below, so the app keeps working without a server — but writes don't,
 * and the UI has to be able to say so.
 */
let serverReachable = true;
const reachabilityListeners = new Set<(ok: boolean) => void>();

export function isServerReachable(): boolean {
  return serverReachable;
}

export function onServerReachability(fn: (ok: boolean) => void): () => void {
  reachabilityListeners.add(fn);
  return () => reachabilityListeners.delete(fn);
}

function setReachable(ok: boolean): void {
  if (ok === serverReachable) return;
  serverReachable = ok;
  for (const fn of reachabilityListeners) fn(ok);
}

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  // Collapse concurrent 401s into a single refresh call.
  refreshPromise ??= (async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${getServerBase()}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
      setTokens(tokens.accessToken, tokens.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; formData?: FormData } = {},
  isRetry = false,
): Promise<T> {
  // Without a server every request is answered on the device, using the same
  // paths and the same shapes — so nothing above this line knows the
  // difference. See localBackend.
  if (isLocalMode()) return localRequest<T>(path, options);

  const token = getAccessToken();
  const method = options.method ?? 'GET';
  const isGet = method === 'GET';

  let res: Response;
  try {
    res = await fetch(`${getServerBase()}/api${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body:
        options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch (netError) {
    setReachable(false);
    // No network: fall back to the offline read cache for GETs.
    if (isGet) {
      const cached = await cacheGetJson<T>(path);
      if (cached !== null) return cached;
    }
    throw netError;
  }
  // An HTTP answer of any kind means the server is there.
  setReachable(true);

  if (res.status === 401 && !isRetry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) {
      return api<T>(path, options, true);
    }
    clearTokens();
    onLogout?.();
    throw new ApiError(401, 'Sessie verlopen, log opnieuw in');
  }

  if (!res.ok) {
    let message = `Fout ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string | string[] };
      message = Array.isArray(data.message) ? data.message.join(', ') : (data.message ?? message);
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T;
  // Keep a copy of GET responses for offline viewing of opened trips.
  if (isGet) void cachePutJson(path, data);
  return data;
}

// Thumbnails go through a small concurrency gate: photo-heavy trips would
// otherwise fire hundreds of parallel fetches and freeze the UI.
const MAX_CONCURRENT_BLOBS = 6;
let activeBlobFetches = 0;
const blobQueue: (() => void)[] = [];

function acquireBlobSlot(): Promise<void> {
  if (activeBlobFetches < MAX_CONCURRENT_BLOBS) {
    activeBlobFetches++;
    return Promise.resolve();
  }
  return new Promise((resolve) => blobQueue.push(resolve));
}

function releaseBlobSlot(): void {
  const next = blobQueue.shift();
  if (next) next();
  else activeBlobFetches--;
}

/** Authorized binary fetch → object URL (for Immich thumbnail proxying). */
/** `/media/<encoded content:// uri>/thumbnail` — how local media is addressed. */
const LOCAL_MEDIA = /^\/media\/(.+)\/thumbnail$/;

export async function fetchBlobUrl(path: string): Promise<string> {
  // A local photo is not fetched at all: its id IS its content URI, and the
  // WebView can stream that straight into an <img> through Capacitor's file
  // bridge. Pulling hundreds of full images across the bridge as blobs would
  // be the slow way to arrive at the same picture.
  if (isLocalMode()) {
    const match = LOCAL_MEDIA.exec(path);
    if (match) return mediaSrc(decodeURIComponent(match[1]!));
    throw new ApiError(404, 'Geen afbeelding');
  }
  await acquireBlobSlot();
  try {
    const token = getAccessToken();
    let res: Response;
    try {
      res = await fetch(`${getServerBase()}/api${path}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
    } catch (netError) {
      // Offline: serve the thumbnail from cache if we've seen it before.
      const cached = await thumbCacheMatch(path);
      if (cached) return URL.createObjectURL(await cached.blob());
      throw netError;
    }
    if (!res.ok) {
      const cached = await thumbCacheMatch(path);
      if (cached) return URL.createObjectURL(await cached.blob());
      throw new ApiError(res.status, 'Kon afbeelding niet laden');
    }
    // Cache a copy for offline viewing (clone before reading the body).
    void thumbCachePut(path, res.clone());
    return URL.createObjectURL(await res.blob());
  } finally {
    releaseBlobSlot();
  }
}
