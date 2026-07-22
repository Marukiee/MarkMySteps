import { InputHTMLAttributes, useState } from 'react';
import './password-input.css';

/** Password field with a show/hide eye toggle. */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="pw-input">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="pw-eye"
        aria-label={visible ? 'Verberg wachtwoord' : 'Toon wachtwoord'}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
            <path d="M3 3l18 18" />
          </svg>
        )}
      </button>
    </div>
  );
}
