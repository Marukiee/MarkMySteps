import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// The showcase site for markmysteps.nl: static files, put on Bunny by
// .github/workflows/site.yml. Shares its colours, fonts and icons with the
// app in ../web, so it is imported from there rather than copied.
export default defineConfig({
  site: 'https://markmysteps.nl',
  integrations: [
    // Renders the app's own Icon component to plain SVG while building; no
    // React reaches the visitor.
    react(),
    sitemap({ i18n: { defaultLocale: 'nl', locales: { nl: 'nl-NL', en: 'en-GB' } } }),
  ],
  i18n: {
    defaultLocale: 'nl',
    locales: ['nl', 'en'],
    routing: { prefixDefaultLocale: false },
  },
  vite: {
    server: { fs: { allow: ['../..'] } },
  },
});
