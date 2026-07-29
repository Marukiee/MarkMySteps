import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './confirm.css';

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
  /**
   * Makes the user type this exactly before the confirm button works.
   *
   * For the deletions there is no undo for: a trip takes its route, its photo
   * links and its notes with it, and "are you sure" is answered yes by reflex.
   * Typing the name cannot be done by reflex.
   */
  typeToConfirm?: string;
}

/**
 * Imperative, promise-based confirm — a themed in-app dialog that replaces the
 * browser's native window.confirm. `await confirmModal({...})` → true/false.
 */
export function confirmModal(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (result: boolean) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    root.render(<ConfirmDialog options={options} onDone={done} />);
  });
}

function ConfirmDialog({ options, onDone }: { options: ConfirmOptions; onDone: (r: boolean) => void }) {
  const [closing, setClosing] = useState(false);
  const [typed, setTyped] = useState('');
  const needsTyping = !!options.typeToConfirm;
  const matches = !needsTyping || typed.trim() === options.typeToConfirm;

  const close = (result: boolean) => {
    if (result && !matches) return;
    setClosing(true);
    window.setTimeout(() => onDone(result), 180);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`confirm-backdrop ${closing ? 'closing' : ''}`}
      onClick={() => close(false)}
      role="dialog"
      aria-modal="true"
    >
      <div className="confirm-card card" onClick={(e) => e.stopPropagation()}>
        <h3>{options.title}</h3>
        {options.body && <p className="muted">{options.body}</p>}
        {needsTyping && (
          <div className="field confirm-type">
            <label htmlFor="confirm-type">
              Typ <strong>{options.typeToConfirm}</strong> om te bevestigen
            </label>
            <input
              id="confirm-type"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        )}
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={() => close(false)}>
            {options.cancelLabel ?? 'Annuleren'}
          </button>
          <button
            className={`btn ${options.danger ? 'btn-danger' : 'btn-primary'}`}
            autoFocus={!needsTyping}
            disabled={!matches}
            onClick={() => close(true)}
          >
            {options.confirmLabel ?? 'Bevestigen'}
          </button>
        </div>
      </div>
    </div>
  );
}
