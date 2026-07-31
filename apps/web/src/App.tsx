import { ReactNode } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
} from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { BottomNav } from './components/BottomNav';
import { InvitePopup } from './components/InvitePopup';
import { TopBar } from './components/TopBar';
import { TrackingPrompt } from './components/TrackingPrompt';
import { OfflineBanner } from './components/OfflineBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { isNativeApp, isOnboarded } from './lib/native';
import { FriendsPage } from './pages/FriendsPage';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OnboardingV2Page } from './pages/OnboardingV2Page';
import { PendingPage } from './pages/PendingPage';
import { PlanPage } from './pages/PlanPage';
import { TripSettingsPage } from './pages/TripSettingsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SharePage } from './pages/SharePage';
import { TripDetailPage } from './pages/TripDetailPage';
import { TravellerPage } from './pages/TravellerPage';
import { TripsPage } from './pages/TripsPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready, pending } = useAuth();
  if (!ready) return null;
  // Signed in, but the server has not let this account in yet. It refuses
  // everything for such a session anyway; this is the screen that says so.
  if (pending) return <PendingPage />;
  if (!user) return <Navigate to="/login" replace />;
  if (isNativeApp() && !isOnboarded()) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function Shell() {
  const { user } = useAuth();
  return (
    <>
      <UpdateBanner />
      <OfflineBanner />
      <TopBar />
      {user?.mustChangePassword && (
        <div className="pw-banner">
          Je gebruikt nog een tijdelijk wachtwoord. Kies een eigen wachtwoord bij{' '}
          <Link to="/settings">Instellingen</Link>.
        </div>
      )}
      <Outlet />
      <BottomNav />
      <TrackingPrompt />
      <InvitePopup />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        {/* The next onboarding, still only reachable from developer options.
            It does not replace the real one until it has been looked at. */}
        <Route path="/onboarding-v2" element={<OnboardingV2Page />} />
        {/* Developer options open this to check the waiting room without
            having to make an account and get it refused. */}
        <Route path="/preview/pending" element={<PendingPage />} />
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
          <Route path="/friends/:userId" element={<TravellerPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
