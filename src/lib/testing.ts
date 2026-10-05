/**
 * Testing mode: the Test button (chips, skipping ahead, items, ripe crops) only
 * shows in a build made with EXPO_PUBLIC_TESTING=true, which is meant for your
 * own machine's .env and nowhere else. The server checks profiles.tester on
 * every call too (see 0005_testing.sql and deployment/0002-testing-tools.md).
 */
export const TESTING = process.env.EXPO_PUBLIC_TESTING === 'true';

const listeners = new Set<() => void>();

/** Lets screens that poll (the garden) catch up at once after a skip. */
export function onTimeSkipped(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function timeSkipped() {
  listeners.forEach((l) => l());
}
