import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { useTone } from '@/art/Scene';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'quiet' | 'ghost' | 'danger';
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  small,
  style,
  accessibilityLabel,
}: Props) {
  const tone = useTone();
  const surface: ViewStyle =
    variant === 'primary'
      ? { backgroundColor: tone.accent }
      : variant === 'quiet'
        ? { borderWidth: 1, borderColor: tone.line, backgroundColor: tone.raised }
        : {};
  const colour =
    variant === 'primary'
      ? tone.accentText
      : variant === 'danger'
        ? tone.danger
        : variant === 'ghost'
          ? tone.muted
          : tone.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        surface,
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.7 },
        style,
      ]}
    >
      <Text numberOfLines={1} style={[styles.text, small && styles.smallText, { color: colour }]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 11 },
  text: { fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
  smallText: { fontSize: 13 },
});
