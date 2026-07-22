import { useEffect, useState } from 'react';

interface HealthResponse {
  status: string;
  postgis: string;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="shell">
      <h1>MarkMySteps</h1>
      <p className="tagline">Your journey, your server.</p>
      <p className="status">
        {health && `API online — PostGIS ${health.postgis}`}
        {error && 'API unreachable'}
        {!health && !error && 'Connecting…'}
      </p>
    </main>
  );
}
