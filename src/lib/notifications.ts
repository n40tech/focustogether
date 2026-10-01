import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// expo-notifications only supports iOS and Android.
const supported = Platform.OS !== 'web';

if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

// Local notification for when the timer runs out, so it fires even if the app is closed.
export async function scheduleSessionEnd(endsAt: Date, minutes: number) {
  if (!supported) return;
  try {
    if (Platform.OS === 'android') {
      // Android 13+ only shows the permission prompt once a channel exists.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Focus sessions',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const { granted } = await Notifications.requestPermissionsAsync();
    if (!granted) return;

    // The app only ever has one session notification pending.
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Focus session complete 🎉',
        body: `You earned ${minutes} point${minutes === 1 ? '' : 's'}. Time for a break.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: endsAt },
    });
  } catch (e) {
    console.warn('Could not schedule notification', e);
  }
}

export async function cancelSessionEnd() {
  if (!supported) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.warn('Could not cancel notification', e);
  }
}
