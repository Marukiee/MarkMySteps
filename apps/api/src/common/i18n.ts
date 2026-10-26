/**
 * The few things the server says in words, in the app's languages.
 *
 * Errors carry a `code` (and `params`) that the app looks up in its own
 * dictionary (`apiError.<code>` in apps/web/src/i18n). Their `message` is
 * still the Dutch sentence, because every app from before the translation
 * shows the message as it comes and only ever spoke Dutch.
 *
 * What the server writes itself, the notification on the phone, follows the
 * request's Accept-Language. A request without one comes from an app from
 * before the translation, so that one gets Dutch too.
 */

export type Lang = 'nl' | 'en';

/** The body of an error the app can translate: `throw new BadRequestException(coded(...))`. */
export function coded(
  message: string,
  code: string,
  params?: Record<string, string | number>,
): { message: string; code: string; params?: Record<string, string | number> } {
  return params ? { message, code, params } : { message, code };
}

/** The language to write in for this Accept-Language header. */
export function langOf(acceptLanguage: string | undefined): Lang {
  if (!acceptLanguage?.trim()) return 'nl';
  const first = acceptLanguage.split(',')[0]!.trim().toLowerCase();
  return first.startsWith('nl') ? 'nl' : 'en';
}

interface NotifyWords {
  title: {
    added: string;
    accessRequested: string;
    accessApproved: string;
    accessDenied: string;
    loginAttempts: string;
    accountRequested: string;
  };
  someone: string;
  aTrip: string;
  added: (who: string, trip: string) => string;
  accessRequested: (who: string, trip: string) => string;
  accessApproved: (who: string, trip: string) => string;
  accessDenied: (who: string, trip: string) => string;
  loginAttempts: string;
  accountRequested: (who: string) => string;
}

/** The heading and the sentence of the phone's own notification. */
export const NOTIFY: Record<Lang, NotifyWords> = {
  nl: {
    title: {
      added: 'Toegevoegd aan een reis',
      accessRequested: 'Verzoek om toegang',
      accessApproved: 'Je mag meekijken',
      accessDenied: 'Verzoek afgewezen',
      loginAttempts: 'Verdachte inlogpogingen',
      accountRequested: 'Nieuwe aanmelding',
    },
    someone: 'Iemand',
    aTrip: 'een reis',
    added: (who, trip) => `${who} heeft je toegevoegd aan ${trip}.`,
    accessRequested: (who, trip) => `${who} vraagt toegang tot ${trip}.`,
    accessApproved: (who, trip) => `${who} heeft je toegelaten tot ${trip}.`,
    accessDenied: (who, trip) => `${who} heeft je verzoek voor ${trip} afgewezen.`,
    loginAttempts: 'Er zijn veel mislukte inlogpogingen geweest.',
    accountRequested: (who) => `${who} wil een account op je server.`,
  },
  en: {
    title: {
      added: 'Added to a trip',
      accessRequested: 'Request for access',
      accessApproved: 'You can follow along',
      accessDenied: 'Request declined',
      loginAttempts: 'Suspicious sign-in attempts',
      accountRequested: 'New sign-up',
    },
    someone: 'Someone',
    aTrip: 'a trip',
    added: (who, trip) => `${who} added you to ${trip}.`,
    accessRequested: (who, trip) => `${who} is asking for access to ${trip}.`,
    accessApproved: (who, trip) => `${who} let you into ${trip}.`,
    accessDenied: (who, trip) => `${who} declined your request for ${trip}.`,
    loginAttempts: 'There have been many failed sign-in attempts.',
    accountRequested: (who) => `${who} would like an account on your server.`,
  },
};
