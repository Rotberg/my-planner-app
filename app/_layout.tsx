import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../global.css';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { onTableRecovered } from '@/utils/localDb';
import { requestNotificationPermissions } from '@/utils/notifications';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    requestNotificationPermissions();
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
