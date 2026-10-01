// Offset between the server clock and this device's, so countdowns match for everyone.
let offsetMs = 0;

export function syncClock(serverNowIso: string) {
  offsetMs = Date.parse(serverNowIso) - Date.now();
}

/** Current time in ms, corrected to the server's clock. */
export const serverNow = () => Date.now() + offsetMs;
