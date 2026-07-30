import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, ApiError, clearTokens, isLoggedIn, setLogoutHandler, setTokens } from '../api/client';
import type { AuthTokens, User } from '../api/types';
import { isLocalMode, localUser, setLocalMode } from '../lib/localMode';

interface AuthState {
  user: User | null;
  ready: boolean;
  /**
   * Signed in, but the account is still waiting for an admin. The server
   * refuses everything for such a session; this only decides which screen to
   * show.
   */
  pending: boolean;
  login(identifier: string, password: string): Promise<void>;
  register(email: string, username: string, displayName: string, password: string): Promise<void>;
  logout(): void;
  /** Switch to the device-only mode: no account, no server, no login. */
  startLocalMode(): void;
  /** Re-fetch the current user (e.g. after changing the profile photo). */
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** A 403 on /users/me means the token is valid but the account is not yet in. */
function isPendingError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

/**
 * The one answer that means "sign in again": the server refused the session
 * itself. The client only raises this after a refresh was actually turned down.
 */
function isSessionOver(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/**
 * Last known profile, kept so a launch without a reachable server still opens
 * the app instead of the login screen. The trips themselves already come from
 * the offline cache; the account was the one thing that did not.
 */
const USER_CACHE_KEY = 'mms.user';

function cachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function cacheUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_CACHE_KEY);
  } catch {
    /* storage full — the app still works, it just asks again next time */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    clearTokens();
    cacheUser(null);
    // Leaving local mode is the way back to the login screen; there is no
    // session to end.
    setLocalMode(false);
    setUser(null);
    setPending(false);
  }, []);

  /** Loads the account, or notes that it is still waiting for approval. */
  const load = useCallback(async () => {
    try {
      const me = await api<User>('/users/me');
      cacheUser(me);
      setUser(me);
      setPending(false);
    } catch (err) {
      if (isPendingError(err)) {
        setUser(null);
        setPending(true);
        return;
      }
      // Only the server refusing the session ends it. A launch in a tunnel, a
      // server that is down for a minute, a rate limit — none of those are a
      // reason to throw away tokens that are good for a month, and doing so is
      // what signed people out for no reason they could see.
      if (!isSessionOver(err)) {
        setUser(cachedUser());
        setPending(false);
        return;
      }
      clearTokens();
      cacheUser(null);
      setUser(null);
      setPending(false);
    }
  }, []);

  useEffect(() => {
    setLogoutHandler(logout);
    // No server: the device's own identity, no login step at all.
    if (isLocalMode()) {
      setUser(localUser());
      setReady(true);
      return;
    }
    if (!isLoggedIn()) {
      setReady(true);
      return;
    }
    void load().finally(() => setReady(true));
  }, [logout, load]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const tokens = await api<AuthTokens>('/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      setTokens(tokens.accessToken, tokens.refreshToken);
      await load();
    },
    [load],
  );

  const register = useCallback(
    async (email: string, username: string, displayName: string, password: string) => {
      const tokens = await api<AuthTokens>('/auth/register', {
        method: 'POST',
        body: { email, username, displayName, password },
      });
      setTokens(tokens.accessToken, tokens.refreshToken);
      // A new account is normally a REQUEST, so this usually lands on the
      // waiting screen rather than in the app.
      await load();
    },
    [load],
  );

  const startLocalMode = useCallback(() => {
    clearTokens();
    setLocalMode(true);
    setUser(localUser());
    setPending(false);
  }, []);

  /**
   * Re-reads the account. Used after the waiting screen sees an approval: the
   * token still says "pending", so it is swapped for a fresh one first.
   */
  const refresh = useCallback(async () => {
    if (isLocalMode()) {
      setUser(localUser());
      return;
    }
    if (pending) {
      const stored = localStorage.getItem('mms.refresh');
      if (stored) {
        try {
          const tokens = await api<AuthTokens>('/auth/refresh', {
            method: 'POST',
            body: { refreshToken: stored },
          });
          setTokens(tokens.accessToken, tokens.refreshToken);
        } catch {
          /* fall through: load() decides what the session is worth */
        }
      }
    }
    await load();
  }, [load, pending]);

  const value = useMemo(
    () => ({ user, ready, pending, login, register, logout, startLocalMode, refresh }),
    [user, ready, pending, login, register, logout, startLocalMode, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
