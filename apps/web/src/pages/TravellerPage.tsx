import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import {
  CountryPanel,
  RecentTrips,
  StatGrid,
  TravelStats,
  plural,
} from '../components/TravelStatsView';
import './friends.css';

/**
 * One travel companion's numbers, on a page of their own.
 *
 * A sheet was the first version of this and it was the wrong shape: there is a
 * globe, a grid and a list of trips in here, which is a page's worth of things
 * to look at, and every one of those trips is a link that has to leave. A page
 * can be linked to, gets a back button for free, and does not have to decide
 * what to do when you tap through it.
 */
export function TravellerPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const [stats, setStats] = useState<TravelStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    setStats(null);
    setError(null);
    api<TravelStats>(`/users/${userId}/stats`)
      .then(setStats)
      .catch(() =>
        setError('Deze reiziger bestaat niet, of je deelt geen reis met diegene.'),
      );
  }, [userId]);

  return (
    <main className="page fade-in traveller-page">
      <button type="button" className="traveller-back" onClick={() => navigate(-1)}>
        <Icon name="chevron-right" size={16} />
        Terug
      </button>

      {error && <p className="error-text">{error}</p>}

      <header className="traveller-head">
        <div className="traveller-avatar">
          <Avatar
            userId={userId ?? ''}
            displayName={stats?.user.displayName ?? '?'}
            hasAvatar={stats?.user.hasAvatar ?? false}
            size={76}
          />
        </div>
        <h1>{stats?.user.displayName ?? ' '}</h1>
        {stats && <span className="muted">@{stats.user.username}</span>}
        {!!stats?.sharedTrips && (
          <span className="traveller-shared">
            {plural(stats.sharedTrips, 'reis samen', 'reizen samen')}
          </span>
        )}
        {!!stats?.ongoing && (
          <span className="stats-ongoing">
            <span className="stats-ongoing-dot" />
            {stats.ongoing === 1 ? 'onderweg' : `${stats.ongoing}× onderweg`}
          </span>
        )}
      </header>

      {!error && (
        <>
          <section className="card traveller-body">
            <StatGrid stats={stats} />
            {stats && <CountryPanel countries={stats.countries} />}
          </section>
          {/* Out on the page rather than inside the panel: it is a list of
              places to go, like the travellers list, not another statistic. */}
          {stats && <RecentTrips trips={stats.recent} />}
        </>
      )}
    </main>
  );
}
