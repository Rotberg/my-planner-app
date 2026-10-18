import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { router, Stack, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../global.css';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { syncBillReminders } from '@/utils/billReminders';
import { onTableRecovered } from '@/utils/localDb';
import { requestNotificationPermissions } from '@/utils/notifications';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // Bill reminders move on to the next due date, so refresh them each launch,
    // even if asking for permission fails (the sync checks permission itself).
    requestNotificationPermissions()
      .catch((e) => console.warn('Could not request notification permission:', e))
      .finally(() => syncBillReminders());
  }, []);

  // Notifications can carry a route to open (e.g. bill reminders → Money tab).
  // Wait until the navigator exists, or a tap that launched the app would try
  // to navigate before there's anywhere to go.
  const navReady = !!useRootNavigationState()?.key;
  const handledResponse = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web' || !navReady) return;
    function open(response: Notifications.NotificationResponse | null) {
      const url = response?.notification.request.content.data?.url;
      if (!response || typeof url !== 'string') return;
      // The launching tap can arrive both here and via the listener; open it once.
      const id = `${response.notification.request.identifier}|${response.notification.date}`;
      if (handledResponse.current === id) return;
      handledResponse.current = id;
      router.push(url as never);
      // Otherwise the same tap would re-open the route on every launch.
      Notifications.clearLastNotificationResponse();
    }
    // Tapped while the app was closed.
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [navReady]);

  // Tell the user if stored data was unreadable and had to be reset.
  useEffect(
    () =>
      onTableRecovered((label, backupKey) => {
        Alert.alert(
          'Some data could not be read',
          `Saved ${label} were damaged and have been reset.` +
            (backupKey ? ' A backup copy was kept on this device.' : ' A backup could not be saved.')
        );
      }),
    []
  );

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
