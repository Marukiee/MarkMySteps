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
  const close = (result: boolean) => {
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
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={() => close(false)}>
            {options.cancelLabel ?? 'Annuleren'}
          </button>
          <button
            className={`btn ${options.danger ? 'btn-danger' : 'btn-primary'}`}
            autoFocus
            onClick={() => close(true)}
          >
            {options.confirmLabel ?? 'Bevestigen'}
          </button>
        </div>
      </div>
    </div>
  );
}
