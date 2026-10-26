import { BadRequestException } from '@nestjs/common';
import { coded } from '../common/i18n';

/**
 * The floor a password has to clear, checked here because the meter in the app
 * cannot refuse anything.
 *
 * Deliberately a floor and not a scoring system: rules like "one capital and
 * one digit" push people toward Wachtwoord1! and no further. Length does the
 * real work, so what is rejected here is only what is genuinely guessable —
 * the words on every list, your own name, and a password made of four
 * characters repeated.
 */

const COMMON = [
  'password',
  'wachtwoord',
  'welkom',
  'welcome',
  'qwerty',
  'azerty',
  'letmein',
  'iloveyou',
  'admin',
  'geheim',
  'monkey',
  'dragon',
  'football',
  'voetbal',
  'sunshine',
  'princess',
  'zonnetje',
  'abcdef',
  'qwertyuiop',
  '123456',
  '1234567890',
];

/** Throws 400 when the password is one nobody should be allowed to choose. */
export function assertStrongPassword(password: string, personal: (string | null)[] = []): void {
  const lower = password.toLowerCase();

  if (password.length < 10) {
    throw new BadRequestException(
      coded('Wachtwoord moet minimaal 10 tekens zijn', 'password.tooShort', { min: 10 }),
    );
  }
  if (COMMON.some((word) => lower.includes(word))) {
    throw new BadRequestException(
      coded(
        'Dit wachtwoord staat op elke lijst die als eerste geprobeerd wordt. Kies iets anders.',
        'password.common',
      ),
    );
  }
  for (const part of personal) {
    const clean = part?.trim().toLowerCase() ?? '';
    if (clean.length >= 4 && lower.includes(clean)) {
      throw new BadRequestException(
        coded(
          'Gebruik je naam, gebruikersnaam of e-mailadres niet in je wachtwoord.',
          'password.personal',
        ),
      );
    }
  }
  if (new Set(password).size <= 4) {
    throw new BadRequestException(
      coded('Wachtwoord bevat te weinig verschillende tekens', 'password.tooFewDistinct'),
    );
  }
}
