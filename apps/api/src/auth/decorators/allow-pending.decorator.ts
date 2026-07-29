import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING = 'allowPending';

/**
 * Lets a route accept the token of an account that is still waiting for an
 * admin. Everything without it refuses such a token.
 *
 * Deliberately opt-IN: a new endpoint that forgets about approval is closed to
 * pending accounts rather than open to them.
 */
export const AllowPending = () => SetMetadata(ALLOW_PENDING, true);
