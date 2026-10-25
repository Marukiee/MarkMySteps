import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getServerBase, setServerBase } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DEFAULT_SERVER_URL } from '../config';
import { isNative } from '../tracking/tracker';
import { signInProblem } from '../lib/twoFactor';
import { LocalModeSheet } from '../components/LocalModeSheet';
import { LogoMark } from '../components/Logo';
import { PasswordInput } from '../components/PasswordInput';
import { PasswordStrength } from '../components/PasswordStrength';
import { LANGUAGES, getLang, setLangSetting, t } from '../i18n';
import './login.css';

export function LoginPage() {
  const { login, loginMfa, register, startLocalMode } = useAuth();
  const navigate = useNavigate();
  // Opened from developer options to look at the screen. Everything on it works
  // except starting local mode, which would sign the tester out of the server
  // they are testing from.
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [server, setServer] = useState(getServerBase());
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localInfo, setLocalInfo] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Set once the password was right for an account that also has an
  // authenticator app: the screen then asks for the code instead.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNative()) setServerBase(server.trim() || DEFAULT_SERVER_URL);
      if (mode === 'login') {
        const challenge = await login(email, password);
        if (challenge) {
          setMfaToken(challenge.mfaToken);
          return;
        }
      } else {
        await register(email, username, displayName, password);
      }
      navigate('/');
    } catch (err) {
      setError(signInProblem(err, t('common.errorGeneric')));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event?: FormEvent, value: string = code) {
    event?.preventDefault();
    if (!mfaToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      await loginMfa(mfaToken, value.trim());
      navigate('/');
    } catch (err) {
      // The token only lives a few minutes; once it is gone the password has to
      // be given again, and staying on a screen that can no longer work helps nobody.
      if (err instanceof Error && err.message === 'Sign in again') setMfaToken(null);
      setError(signInProblem(err, 'Die code klopt niet'));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  function leaveCodeStep() {
    setMfaToken(null);
    setCode('');
    setRecovery(false);
    setError(null);
    // The password is not kept around for the next person.
    setPassword('');
  }

  return (
    <div className="login-shell">
      <div className="login-hero">
        {/* The mark the rest of the app carries, at the one screen where the
            app still has to say what it is. */}
        <LogoMark size={58} />
        <h1>MarkMySteps</h1>
        <p>{t('auth.login.tagline')}</p>
      </div>

      {mfaToken ? (
        <form className="card login-card fade-in" onSubmit={(e) => void submitCode(e)}>
          <h2 className="login-code-title">Tweede stap</h2>
          <p className="muted">
            {recovery
              ? 'Voer een van je herstelcodes in. Elke code werkt maar één keer.'
              : 'Open je authenticator-app (bijvoorbeeld Proton Authenticator) en voer de code van 6 cijfers in.'}
          </p>
          <div className="field">
            <label htmlFor="mfa-code">{recovery ? 'Herstelcode' : 'Code'}</label>
            <input
              id="mfa-code"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode={recovery ? 'text' : 'numeric'}
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={recovery ? 24 : 7}
              placeholder={recovery ? 'XXXX-XXXX-XXXX-XXXX' : '123 456'}
              value={code}
              onChange={(e) => {
                const value = e.target.value;
                setCode(value);
                // Six digits is a complete code: no need for another tap.
                if (!recovery && /^\d{6}$/.test(value.replace(/\s/g, ''))) {
                  void submitCode(undefined, value);
                }
              }}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? t('auth.login.wait') : 'Doorgaan'}
          </button>
          <button
            type="button"
            className="login-nolink"
            onClick={() => {
              setRecovery((r) => !r);
              setCode('');
              setError(null);
            }}
          >
            {recovery ? 'Toch een code uit de app gebruiken' : 'Ik heb mijn telefoon niet: herstelcode gebruiken'}
          </button>
          <button type="button" className="login-nolink" onClick={leaveCodeStep}>
            {t('auth.pending.rejected.back')}
          </button>
        </form>
      ) : (
      <form className="card login-card fade-in" onSubmit={submit}>
        <div className="login-tabs" role="tablist" data-tab={mode}>
          {/* One pill that slides between the two, the way the trip's tabs do. */}
          <span className="login-tabs-thumb" aria-hidden="true" />
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            {t('auth.login.signIn')}
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            {t('auth.login.createAccount')}
          </button>
        </div>

        {isNative() && (
          <div className="field">
            <label htmlFor="server">{t('auth.login.server')}</label>
            <input
              id="server"
              type="url"
              placeholder={DEFAULT_SERVER_URL}
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
            <span className="muted">{t('auth.login.serverHint')}</span>
          </div>
        )}

        <div className="field">
          {/* Logging in takes either; making an account takes the address and
              asks for the name separately. The label changed in one frame,
              which read as a glitch — the two swap over instead. */}
          <label htmlFor="email" className="login-label-swap">
            <span key={mode}>{mode === 'login' ? t('auth.login.identifier') : t('auth.login.email')}</span>
          </label>
          <input
            id="email"
            type={mode === 'login' ? 'text' : 'email'}
            required
            autoComplete={mode === 'login' ? 'username' : 'email'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {/* Grows and shrinks with the tab rather than snapping: the two extra
            fields used to appear and disappear in one frame. */}
        <div className="login-extra" data-open={mode === 'register'}>
          <div className="login-extra-inner">
            <div className="field">
              <label htmlFor="username">{t('auth.login.username')}</label>
              <input
                id="username"
                required={mode === 'register'}
                disabled={mode !== 'register'}
                pattern="[a-zA-Z0-9._\-]{3,30}"
                autoComplete="username"
                placeholder={t('auth.login.usernamePlaceholder')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <span className="muted">{t('auth.login.usernameHint')}</span>
            </div>
            <div className="field">
              <label htmlFor="name">{t('auth.login.name')}</label>
              <input
                id="name"
                required={mode === 'register'}
                disabled={mode !== 'register'}
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="password">{t('auth.login.password')}</label>
          <PasswordInput
            id="password"
            required
            minLength={10}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {/* Only when making one: judging the password you already have is
              noise, and on a login screen it would be a hint to a shoulder. */}
          <PasswordStrength
            password={password}
            personal={[username, displayName, email.split('@')[0] ?? '']}
            open={mode === 'register'}
          />
          <span className="login-hint" data-open={mode === 'register'}>
            <span>{t('auth.login.passwordHint')}</span>
          </span>
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" disabled={busy}>
          <span key={mode} className="login-submit-face">
            {busy
              ? t('auth.login.wait')
              : mode === 'login'
                ? t('auth.login.signIn')
                : t('auth.login.createAccount')}
          </span>
        </button>

        {note && <p className="muted login-note">{note}</p>}

        {/* The app is usable with nothing but the phone; saying so here is the
            only place anyone would look for it. */}
        <button type="button" className="login-nolink" onClick={() => setLocalInfo(true)}>
          {t('auth.login.noServer')}
        </button>
      </form>
      )}

      {/* Someone the phone's language guessed wrong for has to be able to put
          it right before signing in, so the two names stay out of the way
          under the card instead of being tucked inside settings. */}
      <div className="login-lang" role="group" aria-label={t('app.language.title')}>
        {LANGUAGES.map((l) => (
          <button
            key={l.id}
            type="button"
            lang={l.id}
            className={l.id === getLang() ? 'active' : ''}
            aria-pressed={l.id === getLang()}
            onClick={() => l.id !== getLang() && setLangSetting(l.id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      {localInfo && (
        <LocalModeSheet
          onClose={() => setLocalInfo(false)}
          onContinue={() => {
            setLocalInfo(false);
            if (preview) {
              setNote(t('auth.login.previewNote'));
              return;
            }
            startLocalMode();
            navigate('/', { replace: true });
          }}
        />
      )}
    </div>
  );
}
