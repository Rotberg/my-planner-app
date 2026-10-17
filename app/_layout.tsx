import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
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
    // Bill reminders move on to the next due date, so refresh them each launch.
    requestNotificationPermissions().then(() => syncBillReminders());
  }, []);

  // Notifications can carry a route to open (e.g. bill reminders → Money tab).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    function open(response: Notifications.NotificationResponse | null) {
      const url = response?.notification.request.content.data?.url;
      if (typeof url !== 'string') return;
      router.push(url as never);
      // Otherwise the same tap would re-open the route on every launch.
      Notifications.clearLastNotificationResponse();
    }
    // Tapped while the app was closed.
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);

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
