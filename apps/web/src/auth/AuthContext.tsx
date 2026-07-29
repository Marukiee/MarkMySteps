import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, clearTokens, isLoggedIn, setLogoutHandler, setTokens } from '../api/client';
import type { AuthTokens, User } from '../api/types';
import { isLocalMode, LOCAL_USER, setLocalMode } from '../lib/localMode';

interface AuthState {
  user: User | null;
  ready: boolean;
  login(identifier: string, password: string): Promise<void>;
  register(email: string, username: string, displayName: string, password: string): Promise<void>;
  logout(): void;
  /** Switch to the device-only mode: no account, no server, no login. */
  startLocalMode(): void;
  /** Re-fetch the current user (e.g. after changing the profile photo). */
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    clearTokens();
    // Leaving local mode is the way back to the login screen; there is no
    // session to end.
    setLocalMode(false);
    setUser(null);
  }, []);

  useEffect(() => {
    setLogoutHandler(logout);
    // No server: the device's own account, no login step at all.
    if (isLocalMode()) {
      setUser(LOCAL_USER);
      setReady(true);
      return;
    }
    if (!isLoggedIn()) {
      setReady(true);
      return;
    }
    api<User>('/users/me')
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setReady(true));
  }, [logout]);

  const login = useCallback(async (identifier: string, password: string) => {
    const tokens = await api<AuthTokens>('/auth/login', {
      method: 'POST',
      body: { identifier, password },
    });
    setTokens(tokens.accessToken, tokens.refreshToken);
    setUser(await api<User>('/users/me'));
  }, []);

  const register = useCallback(
    async (email: string, username: string, displayName: string, password: string) => {
      const tokens = await api<AuthTokens>('/auth/register', {
        method: 'POST',
        body: { email, username, displayName, password },
      });
      setTokens(tokens.accessToken, tokens.refreshToken);
      setUser(await api<User>('/users/me'));
    },
    [],
  );

  const startLocalMode = useCallback(() => {
    clearTokens();
    setLocalMode(true);
    setUser(LOCAL_USER);
  }, []);

  const refresh = useCallback(async () => {
    setUser(await api<User>('/users/me').catch(() => null));
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout, startLocalMode, refresh }),
    [user, ready, login, register, logout, startLocalMode, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
