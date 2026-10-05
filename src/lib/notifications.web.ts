// expo-notifications only supports iOS and Android, so on web these do nothing
// (and the web bundle doesn't load it). See notifications.ts for native.

export async function scheduleSessionEnd(_endsAt: Date, _minutes: number) {}

export async function cancelSessionEnd() {}
