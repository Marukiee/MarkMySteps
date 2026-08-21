import { Component, type ErrorInfo, type ReactNode } from 'react';
import './errorboundary.css';

interface State {
  error: Error | null;
  where: string | null;
}

/**
 * Catches a render that throws, instead of letting the app go white.
 *
 * React unmounts the whole tree when a render throws and leaves an empty page
 * behind — which is what a white screen is. Whatever went wrong, the honest
 * thing is to say so, show what it said, and offer the way back. It also means
 * a bug that only happens on one screen no longer costs you the app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, where: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console as well: the stack is what actually finds the bug.
    console.error('Render mislukt', error, info.componentStack);
    this.setState({ where: info.componentStack?.split('\n').slice(1, 4).join('\n') ?? null });
  }

  override render(): ReactNode {
    const { error, where } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="crash">
        <div className="crash-card card">
          <h1>Er ging iets mis</h1>
          <p className="muted">
            Dit scherm liep vast. Wat je had opgeslagen is veilig; alleen deze weergave gaf het op.
          </p>
          <pre className="crash-detail">
            {error.message}
            {where ? `\n${where}` : ''}
          </pre>
          <div className="crash-actions">
            <button
              className="btn btn-primary"
              onClick={() => this.setState({ error: null, where: null })}
            >
              Opnieuw proberen
            </button>
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>
              App herladen
            </button>
          </div>
        </div>
      </main>
    );
  }
}
