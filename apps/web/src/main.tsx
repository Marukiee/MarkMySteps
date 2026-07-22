import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { resumeIfTracking } from './tracking/tracker';
import './styles/global.css';

// After an app restart mid-trip, pick tracking back up automatically.
resumeIfTracking();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
