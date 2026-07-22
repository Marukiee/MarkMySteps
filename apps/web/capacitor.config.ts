import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'nl.markmaaktmedia.markmysteps',
  appName: 'MarkMySteps',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
};

export default config;
