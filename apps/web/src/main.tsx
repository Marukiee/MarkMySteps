// Only what the app actually sets: body, display, and the wordmark. Plus
// Jakarta Sans and Darker Grotesque were tried against --font-brand and lost,
// but stayed behind in the bundle - four extra font files on every launch for
// a face nothing asks for.
import '@fontsource-variable/fraunces';
import '@fontsource-variable/outfit';
import '@fontsource-variable/inter';
// First, so the language is known before any other module is evaluated.
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  initBackButton,
  initKeyboardInset,
  initKeyboardScroll,
  initStableViewport,
  initIosViewport,
  initStatusBar,
  isNativeApp,
} from './lib/native';
import { initNativeGlass } from './lib/nativeGlass';
import { initNativeTabBar } from './lib/nativeTabBar';
import { initDynamicAccent } from './lib/dynamicColor';
import { applyTheme, getThemeId } from './lib/prefs';
import { enforceThumbBudget } from './lib/offlineCache';
import { initPendingWrites } from './lib/pendingWrites';
import { captureCurrentLocation, resumeIfTracking } from './tracking/tracker';
import './styles/global.css';

// Theme before first paint; keep following the OS when set to "system".
applyTheme();
// Optional: borrow the accent from the wallpaper. Fire-and-forget, because the
// designed accent is already painted and this only ever replaces it.
void initDynamicAccent();
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => getThemeId() === 'system' && applyTheme());

// After an app restart mid-trip, pick tracking back up automatically.
resumeIfTracking();
// One fix on launch, so the maps know where you are without waiting for the
// next scheduled check (and even when no trip is being tracked at all).
void captureCurrentLocation();
// Edits made without a connection are replayed as soon as there is one.
initPendingWrites();
// Applies a photo-cache limit that was lowered in a previous session.
void enforceThumbBudget();
// Sheets need to know what the keyboard is covering.
initKeyboardInset();
// Android back gesture support.
initBackButton();
// Overlay + style the native status bar.
initStatusBar();
// The iPhone app keeps its scale, as native apps do.
initIosViewport();
// And has the system's own tab bar, in Liquid Glass, and glass floating buttons.
initNativeTabBar();
void initNativeGlass();
// Keyboard-proof viewport height (--vh-stable) for the map panels.
initStableViewport();
// Centres a focused field above the keyboard once it has finished opening.
initKeyboardScroll();
// Lets CSS style the APK differently (no topbar, tab bar always on).
if (isNativeApp()) document.documentElement.classList.add('native-app');
// Android, app or browser: no frosted layers (see the end of global.css).
if (/Android/i.test(navigator.userAgent)) document.documentElement.classList.add('android');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* A render that throws used to take the whole page with it and leave a
        white screen; now it leaves a message and a way back. */}
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
