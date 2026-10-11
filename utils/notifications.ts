import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { fromYMD } from './dates';

// How notifications behave when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('planner', {
      name: 'Planner Events',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Schedule a notification for an event.
 * Returns the notification identifier (used to cancel later).
 */
export async function scheduleEventNotification(
  title: string,
  notes: string,
  date: string,  // YYYY-MM-DD
  time: string   // HH:MM
): Promise<string | null> {
  const [hour, minute] = time.split(':').map(Number);
  const trigger = fromYMD(date);
  trigger.setHours(hour, minute, 0, 0);

  // Don't schedule notifications in the past
  if (trigger <= new Date()) return null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: notes || 'You have an event now.',
      sound: 'default',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: trigger,
    },
  });

  return id;
}

/**
 * Cancel a previously scheduled notification.
 */
export async function cancelEventNotification(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
