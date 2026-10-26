# Talen / Languages

MarkMySteps speaks Dutch and English. The app picks the language of the phone
or browser (English when it has no words for that language), and Settings →
Display → Language overrides it.

The choice is saved in `mms.lang` on the first start. An install that was
already in use before there was a choice keeps speaking Dutch; a new one starts
on "System".

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

## What the server says

Errors carry a `code` next to the `message`
(`{ "code": "password.tooShort", "message": "...", "params": { ... } }`), made
with `coded()` from `apps/api/src/common/i18n.ts`. The app shows
`apiError.<code>` from its own dictionary, and the `message` as it is when it
does not know the code. That `message` stays the sentence it always was
(mostly Dutch), because the apps from before the translation show it as it
comes.

The phone's own notifications are written by the server, in the language of
the request's `Accept-Language`. The words are in `NOTIFY` in
`apps/api/src/common/i18n.ts`. A request without the header comes from an older
app and gets Dutch. What was stored as text when it happened (the detail of a
security alert) stays in the language it was written in.

## The native side

The page tells the native side its language (`MmsNotify.setLanguage`), so texts
written without the page, like the tracking notification, follow the app and
not only the phone.

- Android: `res/values/strings.xml` (English) and `res/values-nl/strings.xml`,
  read through `AppLang.text()`. A language switch rewrites the running
  tracking notification and renames the notification channels.
- iOS: `en.lproj` and `nl.lproj`, each with `Localizable.strings` (what the
  plugins say, read through `AppLang`) and `InfoPlist.strings` (the permission
  prompts). iOS shows the permission prompts in the phone's language, whatever
  the app is set to. The tab bar and the glass buttons get their labels from
  the page.

## Adding a language

1. Copy `apps/web/src/i18n/locales/en` to `locales/<code>` (for example `de`)
   and translate the values. Leave the keys, `{placeholders}` and `<tags>` as
   they are.
2. Add it to `LANGUAGES` and `LOADERS` in `apps/web/src/i18n/index.ts`, with
   its name in its own language.
3. Add `apps/web/android/app/src/main/res/values-<code>/strings.xml` for the
   Android texts.
4. Add `apps/web/ios/App/App/<code>.lproj` with both `.strings` files, and add
   the language to the two variant groups in Xcode (Localizable and
   InfoPlist), so they are in the app.
5. Add the server texts to `NOTIFY` and the language to `Lang` and `langOf()`
   in `apps/api/src/common/i18n.ts`.
6. Run `pnpm --filter @markmysteps/web build`.
