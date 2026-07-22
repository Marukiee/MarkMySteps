/**
 * Minimal fetch wrapper with JWT handling: attaches the access token,
 * transparently refreshes once on 401, and logs out when refresh fails.
 */

import { Capacitor } from '@capacitor/core';
import { DEFAULT_SERVER_URL } from '../config';

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
  const token = getAccessToken();
  const res = await fetch(`${getServerBase()}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: options.formData ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  if (res.status === 401 && !isRetry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) {
      return api<T>(path, options, true);
    }
    clearTokens();
    onLogout?.();
    throw new ApiError(401, 'Sessie verlopen — log opnieuw in');
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
  return (await res.json()) as T;
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
export async function fetchBlobUrl(path: string): Promise<string> {
  await acquireBlobSlot();
  try {
    const token = getAccessToken();
    const res = await fetch(`${getServerBase()}/api${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, 'Kon afbeelding niet laden');
    return URL.createObjectURL(await res.blob());
  } finally {
    releaseBlobSlot();
  }
}
