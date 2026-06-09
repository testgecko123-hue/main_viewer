import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.vault.viewer',
  appName: 'Vault',
  webDir: 'frontend/dist',
  android: {
    path: 'android',
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
