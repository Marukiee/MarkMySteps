import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { initBackButton, isNativeApp } from './lib/native';
import { resumeIfTracking } from './tracking/tracker';
import './styles/global.css';

// After an app restart mid-trip, pick tracking back up automatically.
resumeIfTracking();
// Android back gesture support.
initBackButton();
// Lets CSS style the APK differently (no topbar, tab bar always on).
if (isNativeApp()) document.documentElement.classList.add('native-app');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
