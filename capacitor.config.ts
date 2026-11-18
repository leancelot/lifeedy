import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vidaorganizada.app',
  appName: 'Lifeedy',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      initialViewportFitValueHint: 'cover',
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#1C1715',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_lifeedy',
      iconColor: '#E28065',
    },
  },
};

export default config;
