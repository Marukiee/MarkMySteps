import { coded, langOf, NOTIFY } from './i18n';

describe('langOf', () => {
  it('writes Dutch for an app from before the translation, which sends no header', () => {
    expect(langOf(undefined)).toBe('nl');
    expect(langOf('')).toBe('nl');
  });

  it('follows the first language the app asks for', () => {
    expect(langOf('nl')).toBe('nl');
    expect(langOf('nl-NL,en;q=0.8')).toBe('nl');
    expect(langOf('en')).toBe('en');
    expect(langOf('en-GB,nl;q=0.8')).toBe('en');
  });

  it('answers a language it has no words for in English', () => {
    expect(langOf('de-DE')).toBe('en');
  });
});

describe('coded', () => {
  it('keeps the Dutch message next to the code, for older apps', () => {
    expect(coded('Je zit al op deze reis', 'trip.alreadyMember')).toEqual({
      message: 'Je zit al op deze reis',
      code: 'trip.alreadyMember',
    });
    expect(coded('Te kort', 'password.tooShort', { min: 10 })).toEqual({
      message: 'Te kort',
      code: 'password.tooShort',
      params: { min: 10 },
    });
  });
});

describe('NOTIFY', () => {
  it('says the same thing in both languages', () => {
    expect(NOTIFY.nl.added('Sanne', 'Rome')).toBe('Sanne heeft je toegevoegd aan Rome.');
    expect(NOTIFY.en.added('Sanne', 'Rome')).toBe('Sanne added you to Rome.');
  });
});
