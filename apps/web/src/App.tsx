import { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { BottomNav } from './components/BottomNav';
import { TopBar } from './components/TopBar';
import { TrackingPrompt } from './components/TrackingPrompt';
import { isNativeApp, isOnboarded } from './lib/native';
import { FriendsPage } from './pages/FriendsPage';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { PlanPage } from './pages/PlanPage';
import { TripSettingsPage } from './pages/TripSettingsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharePage } from './pages/SharePage';
import { TripDetailPage } from './pages/TripDetailPage';
import { TripsPage } from './pages/TripsPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (isNativeApp() && !isOnboarded()) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function Shell() {
  const { user } = useAuth();
  return (
    <>
      <TopBar />
      {user?.mustChangePassword && (
        <div className="pw-banner">
          Je gebruikt nog een tijdelijk wachtwoord — kies een eigen wachtwoord bij{' '}
          <Link to="/settings">Instellingen</Link>.
        </div>
      )}
      <Outlet />
      <BottomNav />
      <TrackingPrompt />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/s/:slug" element={<SharePage />} />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<TripsPage />} />
          <Route path="/trips/:tripId" element={<TripDetailPage />} />
          <Route path="/trips/:tripId/plan" element={<PlanPage />} />
          <Route path="/trips/:tripId/settings" element={<TripSettingsPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
