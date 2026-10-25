/**
 * Which language the app speaks, and the words it says in it.
 *
 * Every piece of text lives in `locales/<lang>/<area>.json`, one flat file of
 * `"area.thing": "text"` per part of the app, and `t('area.thing')` looks it up.
 * Only the language in use is downloaded: the other one is its own chunk that
 * nobody asks for.
 *
 * The dictionary is loaded with a top-level await, which holds back every
 * module that imports this one until it is there. So `t()` simply works,
 * anywhere and at any moment, without a "not loaded yet" state to think about.
 *
 * Changing the language reloads the app. Text that was put together once and
 * kept (a list of options, a label on the map) would otherwise stay in the old
 * language until the next launch.
 */
import type nlDict from './locales/nl';

/** The languages there are words for. Dutch came first; English is the fallback. */
export const LANGUAGES = [
  { id: 'nl', name: 'Nederlands' },
  { id: 'en', name: 'English' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['id'];
/** What was chosen in settings: a language, or whatever the phone speaks. */
export type LangSetting = Lang | 'system';

type Dict = typeof nlDict;
type RawKey = keyof Dict & string;
type PluralForm = 'one' | 'other';
/** `trip.nights_one` and `trip.nights_other` are asked for as `trip.nights`, with a count. */
type PluralBase<K> = K extends `${infer B}_${PluralForm}` ? B : never;
export type TKey = Exclude<RawKey, `${string}_${PluralForm}`> | PluralBase<RawKey>;
export type TVars = Record<string, string | number>;

const LANG_KEY = 'mms.lang';

const LOADERS: Record<Lang, () => Promise<{ default: Record<string, string> }>> = {
  nl: () => import('./locales/nl'),
  en: () => import('./locales/en'),
};

function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && value in LOADERS;
}

function readSetting(): LangSetting {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'system' || isLang(stored)) return stored;
    // Everyone who used the app before it had a second language read it in
    // Dutch, whatever their phone is set to. They keep Dutch until they
    // choose otherwise; a fresh install follows the phone.
    if (stored === null && hasUsedAppBefore()) {
      localStorage.setItem(LANG_KEY, 'nl');
      return 'nl';
    }
  } catch {
    /* storage blocked: follow the phone */
  }
  return 'system';
}

function hasUsedAppBefore(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('mms.') && key !== LANG_KEY) return true;
  }
  return false;
}

/** The first language of the phone or browser that we have words for. English otherwise. */
function systemLang(): Lang {
  const wanted = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of wanted) {
    const base = tag?.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

const setting = readSetting();
const lang: Lang = setting === 'system' ? systemLang() : setting;
const dict: Record<string, string> = (await LOADERS[lang]()).default;
const plurals = new Intl.PluralRules(lang);

document.documentElement.lang = lang;

/** The language the app is speaking right now. */
export function getLang(): Lang {
  return lang;
}

/** What settings say: a language, or 'system'. */
export function getLangSetting(): LangSetting {
  return setting;
}

/** Saves the choice and restarts the app in it. */
export function setLangSetting(next: LangSetting): void {
  if (next === setting) return;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    return;
  }
  window.location.reload();
}

/**
 * The locale for dates and numbers (`toLocaleDateString(intlLocale(), ...)`).
 * British English: day before month, a 24 hour clock, the way most of the
 * people who would pick English here write a date.
 */
export function intlLocale(): string {
  return lang === 'en' ? 'en-GB' : 'nl-NL';
}

/** Whether there are words for this key, for text that may or may not have them (a server's error code). */
export function hasKey(key: string): boolean {
  return key in dict || `${key}_other` in dict;
}

/**
 * The text for a key, with `{name}` placeholders filled in.
 *
 * With a `count`, the key is a plural: `key_one` or `key_other`, as the
 * language's own rules decide. A key that is missing returns itself, so a
 * mistake shows on screen instead of an empty space.
 */
export function t(key: TKey, vars?: TVars): string {
  return lookup(key, vars);
}

/** `t()` for a key that is only known at run time. Checked with `hasKey` first. */
export function tDynamic(key: string, vars?: TVars): string {
  return lookup(key, vars);
}

function lookup(key: string, vars?: TVars): string {
  let text: string | undefined;
  if (vars && typeof vars.count === 'number') {
    text = dict[`${key}_${plurals.select(vars.count) === 'one' ? 'one' : 'other'}`];
  }
  text ??= dict[key] ?? dict[`${key}_other`];
  if (text === undefined) {
    console.warn(`[i18n] missing ${lang} text for "${key}"`);
    return key;
  }
  return vars ? fill(text, vars) : text;
}

function fill(text: string, vars: TVars): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
