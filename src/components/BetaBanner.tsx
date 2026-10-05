import { Link } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { tones } from '@/lib/theme';

/** Where testers post feedback and ideas while Focus Together is in beta. */
const FEEDBACK_GROUP = 'https://chat.whatsapp.com/IYT1ETYTHwMBu0acq2Fq0t';

/**
 * A slim strip across the top of the page during the beta, above `children`.
 * The whole strip is the link, and it opens the WhatsApp group in a new tab.
 * Web only, as the beta is.
 *
 * The strip runs up under a phone's notch, so the screen below it is told
 * there's no notch to keep clear of. The tree is the same with or without the
 * strip, so hiding it doesn't reload the screen.
 */
export function BetaBanner({
  hidden = false,
  children,
}: {
  hidden?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const shown = Platform.OS === 'web' && !hidden;
  const below = useMemo(() => (shown ? { ...insets, top: 0 } : insets), [shown, insets]);
  return (
    <View style={styles.fill}>
      {shown && (
        <Link
          href={FEEDBACK_GROUP}
          target="_blank"
          rel="noopener noreferrer"
          style={[styles.banner, STICKY, { paddingTop: 7 + insets.top }]}
        >
          This is a beta test. <Text style={styles.link}>Join the WhatsApp group</Text> to post
          feedback and ideas.
        </Link>
      )}
      <SafeAreaInsetsContext value={below}>
        <View style={styles.fill}>{children}</View>
      </SafeAreaInsetsContext>
    </View>
  );
}

/**
 * Safari on an iPhone (from iOS 26) colours the bar above the page from a
 * sticky or fixed element at the top edge, and otherwise from the page's
 * background, which is the scene's. Sticky makes it take the banner's colour.
 * The banner never scrolls, so it stays where it was. React Native's types
 * don't know sticky, but the web passes it through to CSS.
 */
const STICKY = { position: 'sticky', top: 0 } as unknown as TextStyle;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: {
    backgroundColor: tones.night.raised,
    color: tones.night.text,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingBottom: 7,
    paddingHorizontal: 16,
  },
  link: { fontWeight: '600', textDecorationLine: 'underline' },
});
