import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// iOS and Android only; notifications.web.ts stands in on web.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Local notification for when the timer runs out, so it fires even if the app is closed.
export async function scheduleSessionEnd(endsAt: Date, minutes: number) {
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
        title: 'Session complete',
        body: `${minutes} chip${minutes === 1 ? '' : 's'} and a break are waiting for you.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: endsAt },
    });
  } catch (e) {
    console.warn('Could not schedule notification', e);
  }
}

export async function cancelSessionEnd() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (e) {
    console.warn('Could not cancel notification', e);
  }
}
