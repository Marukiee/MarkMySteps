# Talen / Languages

MarkMySteps speaks Dutch and English. The app picks the language of the phone
or browser (English when it has no words for that language), and Settings →
Display → Language overrides it.

## Where the words are

`apps/web/src/i18n/locales/<lang>/<area>.json`, one flat file per part of the
app. Every key starts with the name of its file:

```json
// locales/nl/trip.json
{
  "trip.tracking.start": "Start tracking",
  "trip.nights_one": "{count} nacht",
  "trip.nights_other": "{count} nachten"
}
```

Dutch (`nl`) is the reference. Every other language has exactly the same keys,
with the same `{placeholders}` and `<tags>`. `pnpm --filter @markmysteps/web
check:i18n` checks that, and the build runs it first.

## Using them in code

```tsx
import { t, intlLocale } from '../i18n';
import { tr } from '../i18n/rich';

t('common.save')                               // "Opslaan" / "Save"
t('trip.nights', { count: 3 })                 // picks trip.nights_one or _other
t('share.by', { name: trip.owner })            // "{name}" filled in
tr('app.tempPassword', { link: (s) => <Link to="/settings">{s}</Link> })
date.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long' })
```

- Keys are checked by TypeScript: a key that does not exist does not compile.
- A sentence stays one key, also when part of it is bold or a link: use `tr()`
  with `<b>...</b>` or `<link>...</link>` in the text. Never glue sentence
  fragments together, the word order differs per language.
- Counts use the `_one` / `_other` pair and `{ count }`.
- Dates and numbers go through `intlLocale()`, never a fixed `'nl-NL'`.
- Words used all over the app (Save, Cancel, Close, ...) are in `common.json`.
- Changing the language reloads the app, so text built once at start-up is
  fine.

The server answers errors with a `code` and an English `message`
(`{ "code": "password.tooShort", "message": "...", "params": { ... } }`). The
app shows `apiError.<code>` from its own dictionary, and the server's English
when it does not know the code.

## Adding a language

1. Copy `apps/web/src/i18n/locales/en` to `locales/<code>` (for example `de`)
   and translate the values. Leave the keys, `{placeholders}` and `<tags>` as
   they are.
2. Add it to `LANGUAGES` and `LOADERS` in `apps/web/src/i18n/index.ts`, with
   its name in its own language.
3. Add `apps/web/android/app/src/main/res/values-<code>/strings.xml` for the
   Android notifications, and the server texts in
   `apps/api/src/common/i18n.ts`.
4. Run `pnpm --filter @markmysteps/web build`.
