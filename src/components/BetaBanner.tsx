import { Link } from 'expo-router';
import { Platform, StyleSheet, Text } from 'react-native';

import { tones } from '@/lib/theme';

/** Where testers post feedback and ideas while Focus Together is in beta. */
const FEEDBACK_GROUP = 'https://chat.whatsapp.com/IYT1ETYTHwMBu0acq2Fq0t';

/**
 * A slim strip across the top of the page during the beta. The whole strip is
 * the link, and it opens the WhatsApp group in a new tab. Web only, as the
 * beta is.
 */
export function BetaBanner() {
  if (Platform.OS !== 'web') return null;
  return (
    <Link href={FEEDBACK_GROUP} target="_blank" rel="noopener noreferrer" style={styles.banner}>
      This is a beta test. <Text style={styles.link}>Join the WhatsApp group</Text> to post feedback
      and ideas.
    </Link>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: tones.night.raised,
    color: tones.night.text,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  link: { fontWeight: '600', textDecorationLine: 'underline' },
});
