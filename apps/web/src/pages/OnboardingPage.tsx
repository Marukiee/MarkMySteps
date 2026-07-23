import { registerPlugin } from '@capacitor/core';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { markOnboarded } from '../lib/native';
import './onboarding.css';

interface BgGeoPlugin {
  addWatcher(
    options: { requestPermissions?: boolean; stale?: boolean },
    callback: (position?: unknown, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BgGeoPlugin>('BackgroundGeolocation');

/** First-run flow in the Android app: explain and request permissions. */
export function OnboardingPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [permissionState, setPermissionState] = useState<'idle' | 'granted' | 'denied'>('idle');

  /** Fires the system location dialog by briefly starting a watcher. */
  async function requestLocation() {
    try {
      const id = await BackgroundGeolocation.addWatcher(
        { requestPermissions: true, stale: true },
        (_position, error) => {
          setPermissionState(error?.code === 'NOT_AUTHORIZED' ? 'denied' : 'granted');
        },
      );
      window.setTimeout(() => void BackgroundGeolocation.removeWatcher({ id }), 4000);
    } catch {
      setPermissionState('denied');
    }
  }

  function finish() {
    markOnboarded();
    navigate('/', { replace: true });
  }

  const steps = [
    <section key="welcome" className="onb-step fade-in">
      <Logo size={64} />
      <h1>Welkom bij MarkMySteps</h1>
      <p className="muted">
        Jouw reizen, jouw server. Volg je route zuinig op de accu, ook zonder internet — alles
        wordt gebufferd en later geüpload.
      </p>
      <button className="btn btn-primary" onClick={() => setStep(1)}>
        Beginnen
      </button>
    </section>,

    <section key="location" className="onb-step fade-in">
      <h1>Locatie­toestemming</h1>
      <p className="muted">
        Voor route-tracking vraagt de app om je locatie. Er wordt alléén een GPS-punt bewaard als
        je ≥50 meter verplaatst — dat spaart je batterij.
      </p>
      {permissionState === 'granted' ? (
        <p className="onb-ok">
          <Icon name="check" size={18} /> Toestemming gegeven
        </p>
      ) : (
        <button className="btn btn-primary" onClick={() => void requestLocation()}>
          Toestemming vragen
        </button>
      )}
      {permissionState === 'denied' && (
        <p className="error-text">Geweigerd — je kunt dit later aanzetten via Instellingen.</p>
      )}
      <button
        className={`btn ${permissionState === 'granted' ? 'btn-primary' : 'btn-ghost'}`}
        onClick={() => setStep(2)}
      >
        Verder
      </button>
    </section>,

    <section key="always" className="onb-step fade-in">
      <h1>“Altijd toestaan”</h1>
      <p className="muted">
        Android staat tracking met het scherm uit alleen toe als locatie op{' '}
        <strong>“Altijd toestaan”</strong> staat. Volg dit pad in de app-instellingen van Android:
      </p>
      <div className="onb-path">
        {['Apps', 'MarkMySteps', 'Rechten', 'Locatie', 'Altijd toestaan'].map((step, i) => (
          <span key={step} className="onb-path-step">
            {i > 0 && <Icon name="chevron-right" size={13} />}
            <span>{step}</span>
          </span>
        ))}
      </div>
      <button
        className="btn btn-primary"
        onClick={() => void BackgroundGeolocation.openSettings()}
      >
        Open systeeminstellingen
      </button>
      <button className="btn btn-ghost" onClick={finish}>
        Klaar
      </button>
    </section>,
  ];

  return <main className="onb-shell">{steps[step]}</main>;
}
