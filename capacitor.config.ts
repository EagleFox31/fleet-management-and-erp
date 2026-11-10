import type { CapacitorConfig } from '@capacitor/cli';
import { NATIVE_OFFLINE_PAGE, resolveNativeServer } from './shared/native-shell';

// CAP_SERVER_URL (origine de prod au build) : l'APK charge l'application servie, même origine que
// la PWA. Absente : bundle local de `webDir`, pour le développement. Voir docs/deploiement/android-apk.md.
const nativeServer = resolveNativeServer(process.env.CAP_SERVER_URL);

const config: CapacitorConfig = {
  appId: 'com.yarofleetos.tech',
  appName: 'FleetOS Tech',
  webDir: 'dist/public',
  server: nativeServer
    ? {
        androidScheme: 'https',
        url: nativeServer.url,
        cleartext: nativeServer.cleartext,
        errorPath: NATIVE_OFFLINE_PAGE,
      }
    : {
        androidScheme: 'https',
        cleartext: true,
      },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#059669',
      sound: 'beep.wav',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
