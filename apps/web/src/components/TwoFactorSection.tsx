import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { TwoFactorSetup, TwoFactorStatus } from '../api/types';
import { isLocalMode } from '../lib/localMode';
import { signInProblem } from '../lib/twoFactor';
import { Icon } from './Icon';
import { PasswordInput } from './PasswordInput';
import { QrCode } from './QrCode';
import './twofactor.css';

type Step =
  | { name: 'idle' }
  | { name: 'password' }
  | { name: 'scan'; setup: TwoFactorSetup }
  | { name: 'codes'; codes: string[] }
  | { name: 'disable' }
  | { name: 'renew' };

/**
 * Two-step verification: a code from an authenticator app on top of the
 * password. Proton Authenticator, Aegis, Google Authenticator and the rest all
 * speak the same thing, so nothing here is specific to one of them.
 */
export function TwoFactorSection() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [step, setStep] = useState<Step>({ name: 'idle' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function loadStatus() {
    api<TwoFactorStatus>('/auth/2fa')
      .then(setStatus)
      // Offline or an older server without this: the card simply is not there.
      .catch(() => setStatus(null));
  }
  useEffect(loadStatus, []);

  // On the device alone there is no sign-in to protect.
  if (isLocalMode() || !status) return null;

  function reset(next: Step = { name: 'idle' }) {
    setStep(next);
    setPassword('');
    setCode('');
    setError(null);
    setCopied(false);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setError(signInProblem(err, 'Dat lukte niet'));
    } finally {
      setBusy(false);
    }
  }

  const startSetup = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const setup = await api<TwoFactorSetup>('/auth/2fa/setup', {
        method: 'POST',
        body: { password },
      });
      reset({ name: 'scan', setup });
    });
  };

  const finishSetup = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { recoveryCodes } = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        body: { code },
      });
      loadStatus();
      reset({ name: 'codes', codes: recoveryCodes });
    });
  };

  const disable = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api('/auth/2fa/disable', { method: 'POST', body: { password, code } });
      loadStatus();
      reset();
      setMessage('Tweestapsverificatie staat uit.');
    });
  };

  const renew = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { recoveryCodes } = await api<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', {
        method: 'POST',
        body: { password, code },
      });
      loadStatus();
      reset({ name: 'codes', codes: recoveryCodes });
    });
  };

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // No clipboard in this webview: the text is selectable, which will have to do.
      setCopied(false);
    }
  }

  const low = status.enabled && status.recoveryCodesLeft <= 3;

  return (
    <section className="card settings-card">
      <h2>
        <Icon name="shield" size={18} /> Tweestapsverificatie
      </h2>

      {step.name === 'idle' && (
        <>
          <div className="tf-state">
            <span className={`tf-badge ${status.enabled ? 'on' : ''}`}>
              <Icon name={status.enabled ? 'check' : 'lock'} size={13} />
              {status.enabled ? 'Aan' : 'Uit'}
            </span>
            {status.enabled && (
              <span className={low ? 'tf-warn' : 'muted'}>
                {status.recoveryCodesLeft === 0
                  ? 'Geen herstelcodes meer'
                  : `${status.recoveryCodesLeft} ${
                      status.recoveryCodesLeft === 1 ? 'herstelcode' : 'herstelcodes'
                    } over`}
              </span>
            )}
          </div>
          <p className="muted">
            {status.enabled
              ? 'Bij het inloggen vragen we naast je wachtwoord om een code uit je authenticator-app. Verlies je je telefoon, dan kom je erin met een herstelcode.'
              : 'Een gestolen of geraden wachtwoord is dan niet genoeg: wie inlogt heeft ook de code uit je authenticator-app nodig, zoals Proton Authenticator.'}
          </p>
          <div className="settings-actions">
            {status.enabled ? (
              <>
                <button className="btn btn-ghost" onClick={() => reset({ name: 'renew' })}>
                  Nieuwe herstelcodes
                </button>
                <button className="btn btn-ghost" onClick={() => reset({ name: 'disable' })}>
                  Uitschakelen
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => reset({ name: 'password' })}>
                Inschakelen
              </button>
            )}
          </div>
        </>
      )}

      {step.name === 'password' && (
        <form onSubmit={startSetup} className="settings-form">
          <p className="muted">
            Eerst je wachtwoord, om te laten zien dat jij het bent en niet iemand met je
            telefoon in handen.
          </p>
          <div className="field">
            <label htmlFor="tf-pw">Wachtwoord</label>
            <PasswordInput
              id="tf-pw"
              required
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Even geduld…' : 'Verder'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => reset()}>
              Annuleren
            </button>
          </div>
        </form>
      )}

      {step.name === 'scan' && (
        <form onSubmit={finishSetup} className="settings-form">
          <ol className="muted tf-steps">
            <li>Open je authenticator-app en kies een nieuw account toevoegen.</li>
            <li>Scan deze QR-code, of typ de sleutel eronder over.</li>
            <li>Voer hieronder de code in die de app laat zien.</li>
          </ol>
          <div className="tf-scan">
            <QrCode value={step.setup.otpauthUri} label="QR-code voor je authenticator-app" />
            <div className="tf-secret">
              <span className="muted">Lukt scannen niet? Typ deze sleutel over:</span>
              <code>{step.setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            </div>
          </div>
          <div className="field">
            <label htmlFor="tf-code">Code uit de app</label>
            <input
              id="tf-code"
              className="tf-code-input"
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={7}
              placeholder="123 456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="settings-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Even geduld…' : 'Inschakelen'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => reset()}>
              Annuleren
            </button>
          </div>
        </form>
      )}

      {step.name === 'codes' && (
        <div className="settings-form">
          <p>
            <strong>Bewaar deze herstelcodes nu.</strong> Je ziet ze maar één keer. Elke code
            werkt één keer en brengt je binnen als je je telefoon kwijt bent. Bewaar ze ergens
            anders dan op die telefoon, bijvoorbeeld in je wachtwoordmanager.
          </p>
          <ul className="tf-codes">
            {step.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="settings-actions">
            <button className="btn btn-ghost" onClick={() => void copy(step.codes.join('\n'))}>
              {copied ? 'Gekopieerd' : 'Kopiëren'}
            </button>
            <button className="btn btn-primary" onClick={() => reset()}>
              Ik heb ze bewaard
            </button>
          </div>
        </div>
      )}

      {(step.name === 'disable' || step.name === 'renew') && (
        <form onSubmit={step.name === 'disable' ? disable : renew} className="settings-form">
          <p className="muted">
            {step.name === 'disable'
              ? 'Uitzetten vraagt je wachtwoord én een code, zodat een open sessie niet genoeg is.'
              : 'De oude herstelcodes werken daarna niet meer. Dit vraagt je wachtwoord én een code.'}
          </p>
          <div className="field">
            <label htmlFor="tf-pw2">Wachtwoord</label>
            <PasswordInput
              id="tf-pw2"
              required
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="tf-code2">Code uit de app, of een herstelcode</label>
            <input
              id="tf-code2"
              className="tf-code-input"
              required
              autoComplete="one-time-code"
              maxLength={24}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="settings-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Even geduld…' : step.name === 'disable' ? 'Uitschakelen' : 'Nieuwe codes maken'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => reset()}>
              Annuleren
            </button>
          </div>
        </form>
      )}

      {step.name === 'idle' && error && <p className="error-text">{error}</p>}
      {message && <p className="settings-ok">{message}</p>}
    </section>
  );
}
