import '@fontsource-variable/fraunces';
// Wordmark candidates - see --font-brand in global.css.
import '@fontsource-variable/outfit';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/darker-grotesque/600.css';
import '@fontsource/darker-grotesque/700.css';
import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import {
  initBackButton,
  initKeyboardScroll,
  initStableViewport,
  initStatusBar,
  isNativeApp,
} from './lib/native';
import { initDynamicColor } from './lib/dynamicColor';
import { applySkin, applyTheme, getThemeId } from './lib/prefs';
import { enforceThumbBudget } from './lib/offlineCache';
import { initPendingWrites } from './lib/pendingWrites';
import { captureCurrentLocation, resumeIfTracking } from './tracking/tracker';
import './styles/global.css';
import './styles/m3.css';

// Theme and skin before first paint; keep following the OS when set to "system".
applyTheme();
applySkin();
// Publishes the Material 3 colour roles (wallpaper-derived on Android 12+).
// Fire-and-forget: the classic skin never reads them, and the M3 skin ships
// seed-derived fallbacks in CSS so there is no unstyled frame while this lands.
void initDynamicColor();
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
// Android back gesture support.
initBackButton();
// Overlay + style the native status bar.
initStatusBar();
// Keyboard-proof viewport height (--vh-stable) for the map panels.
initStableViewport();
// Centres a focused field above the keyboard once it has finished opening.
initKeyboardScroll();
// Lets CSS style the APK differently (no topbar, tab bar always on).
if (isNativeApp()) document.documentElement.classList.add('native-app');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
