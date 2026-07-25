import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { initBackButton, initStableViewport, initStatusBar, isNativeApp } from './lib/native';
import { applyTheme, getThemeId } from './lib/prefs';
import { resumeIfTracking } from './tracking/tracker';
import './styles/global.css';

// Theme before first paint; keep following the OS when set to "system".
applyTheme();
window
  .matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => getThemeId() === 'system' && applyTheme());

// After an app restart mid-trip, pick tracking back up automatically.
resumeIfTracking();
// Android back gesture support.
initBackButton();
// Overlay + style the native status bar.
initStatusBar();
// Keyboard-proof viewport height (--vh-stable) for the map panels.
initStableViewport();
// Lets CSS style the APK differently (no topbar, tab bar always on).
if (isNativeApp()) document.documentElement.classList.add('native-app');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
