import { passwordStrength } from '../lib/password';
import './password-strength.css';

/**
 * The bar under a new-password field.
 *
 * Four segments rather than a percentage: a bar that creeps invites fiddling
 * with one more character until it turns green, and that is not what makes a
 * password good. The line underneath is the part that actually helps.
 */
export function PasswordStrength({
  password,
  personal = [],
  open = true,
}: {
  password: string;
  personal?: string[];
  open?: boolean;
}) {
  const { score, label, tip } = passwordStrength(password, personal);
  return (
    <div className="pw-strength" data-open={open && password.length > 0} data-score={score}>
      <div>
        <div className="pw-strength-bar" aria-hidden="true">
          {[1, 2, 3, 4].map((step) => (
            <span key={step} className={step <= score ? 'on' : ''} />
          ))}
        </div>
        <p className="pw-strength-text" role="status">
          <strong>{label}</strong>
          {tip && <span>{tip}</span>}
        </p>
      </div>
    </div>
  );
}
