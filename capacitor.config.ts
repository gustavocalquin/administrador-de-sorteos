import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ar.com.administradordesorteos.app',
  appName: 'Administrador de Sorteos',
  webDir: 'dist',
  loggingBehavior: 'none',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: { CapacitorSQLite: { androidIsEncryption: false } },
};

export default config;
