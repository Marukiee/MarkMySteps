import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'nl.markmaaktmedia.markmysteps',
  appName: 'MarkMySteps',
  webDir: 'dist',
  server: {
    // Present the WebView as the real domain so password managers associate
    // saved credentials with the same site as the web app (not "localhost").
    hostname: 'reis.markmaaktmedia.nl',
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
