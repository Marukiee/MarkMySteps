import { ComponentType, lazy, ReactNode, Suspense, useEffect, useLayoutEffect } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { BottomNav } from './components/BottomNav';
import { BookProgress } from './components/BookProgress';
import { InvitePopup } from './components/InvitePopup';
import { TopBar } from './components/TopBar';
import { TrackingPrompt } from './components/TrackingPrompt';
import { OfflineBanner } from './components/OfflineBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { isNativeApp, isOnboarded } from './lib/native';
import { resumeBackgroundNotify, takeNotificationPath } from './lib/notify';
import { BootScreen } from './components/BootScreen';
import { useExit } from './lib/useExit';

/**
 * Pages arrive when they are asked for.
 *
 * Every screen used to be in the first file the browser downloaded — the map
 * engine, the globe, the photo book, the whole of Settings — so a cheap phone
 * parsed all of it before it could draw the trips list. Each route is its own
 * chunk now; the launch downloads the one you are on. The pages export named
 * components, hence the unwrapping.
 */
const lazyPage = <T extends string>(
  loader: () => Promise<Record<T, ComponentType>>,
  name: T,
) => lazy(() => loader().then((m) => ({ default: m[name] })));

const FriendsPage = lazyPage(() => import('./pages/FriendsPage'), 'FriendsPage');
const LoginPage = lazyPage(() => import('./pages/LoginPage'), 'LoginPage');
const OnboardingV2Page = lazyPage(() => import('./pages/OnboardingV2Page'), 'OnboardingV2Page');
const CoverPreviewPage = lazyPage(() => import('./pages/CoverPreviewPage'), 'CoverPreviewPage');
const PendingPage = lazyPage(() => import('./pages/PendingPage'), 'PendingPage');
const PlanPage = lazyPage(() => import('./pages/PlanPage'), 'PlanPage');
const TripSettingsPage = lazyPage(() => import('./pages/TripSettingsPage'), 'TripSettingsPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const SharePage = lazyPage(() => import('./pages/SharePage'), 'SharePage');
const TripDetailPage = lazyPage(() => import('./pages/TripDetailPage'), 'TripDetailPage');
const TravellerPage = lazyPage(() => import('./pages/TravellerPage'), 'TravellerPage');
const TripsPage = lazyPage(() => import('./pages/TripsPage'), 'TripsPage');

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready, pending } = useAuth();
  // Held on screen for its own exit, so the app does not simply cut from the
  // waiting screen to the home screen.
  const [bootMounted, bootClosing] = useExit(!ready, 460);
  if (!ready) return <BootScreen />;
  // Signed in, but the server has not let this account in yet. It refuses
  // everything for such a session anyway; this is the screen that says so.
  if (pending) return <PendingPage />;
  if (!user) return <Navigate to="/login" replace />;
  if (isNativeApp() && !isOnboarded()) return <Navigate to="/onboarding" replace />;
  return (
    <>
      {bootMounted && <BootScreen closing={bootClosing} />}
      {children}
    </>
  );
}

/**
 * Every page starts at the top.
 *
 * Leaving a long page for a short one, the browser keeps the scroll offset and
 * clamps it to whatever the new page is worth at that instant — which, for a
 * page that fills itself in from the server a moment later, is somewhere near
 * the bottom of it. Set before paint, so nobody sees the wrong place first.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo({ top: 0 });
    document.scrollingElement?.scrollTo({ top: 0 });
    // `overflow-x: hidden` on the body computes its overflow-y to `auto`, which
    // makes the BODY the scroller — not the viewport and not the scrolling
    // element. Without this, leaving a scrolled page for another one landed you
    // halfway down the new one.
    document.body.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

/**
 * A tapped notification lands on the trip it was about.
 *
 * The activity is started before the web app exists, so Android holds the
 * route it wants and this asks for it — at launch, and again whenever the app
 * comes back to the front with a fresh tap behind it.
 */
function NotificationRoute() {
  const navigate = useNavigate();
  useEffect(() => {
    const check = () => {
      void takeNotificationPath().then((path) => {
        if (path) navigate(path);
      });
    };
    check();
    // Re-arms the quarter-hourly check; cheap when nothing has changed.
    void resumeBackgroundNotify();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [navigate]);
  return null;
}

function Shell() {
  const { user } = useAuth();
  return (
    <>
      <ScrollToTop />
      <NotificationRoute />
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
      {/* A photo book being made keeps being made wherever you go; this is how
          it says so, and how it hands the file over when it is done. */}
      <BookProgress />
      <TrackingPrompt />
      <InvitePopup />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      {/* The page's own chunk is on its way. BootScreen shows nothing for the
          first couple of seconds, so a chunk that arrives quickly - every
          chunk, once it is in the cache - passes without a flicker, and only a
          genuinely slow fetch gets a screen that says so. */}
      <Suspense fallback={<BootScreen />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* The second tour is now the tour. The old path still resolves to it
              so a link from anywhere (a dev button, a bookmark) keeps working. */}
          <Route path="/onboarding" element={<OnboardingV2Page />} />
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
            {/* Developer options: every coverless-trip design on one page. */}
            <Route path="/preview/covers" element={<CoverPreviewPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
