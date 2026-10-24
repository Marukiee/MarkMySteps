import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'nl.markmaaktmedia.markmysteps',
  appName: 'MarkMySteps',
  webDir: 'dist',
  server: {
    // NOTE: do NOT set hostname to the real server domain — the WebView would
    // then hijack requests to that domain and serve bundled files instead of
    // reaching the actual API ("Unexpected token '<'"). Keep the default
    // localhost origin; CORS allows https://localhost.
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    // The paper colour, so the first frame is not a white flash.
    backgroundColor: '#faf6ef',
  },
};

export default config;
