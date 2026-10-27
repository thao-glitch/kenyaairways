/**
 * Official Kenya Airways KQ mark for native screens. The same 512px master
 * feeds the APK launcher icon, so what passengers see here matches the icon
 * on their home screen.
 */
import { Image, Text, View } from 'react-native';
import { colors, spacing, type } from '@/theme/tokens';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ICON = require('../../assets/icon.png');

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      source={ICON}
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      accessibilityIgnoresInvertColors
      accessibilityLabel="Kenya Airways."
    />
  );
}

export function BrandLogo({
  size = 56,
  name = 'Kenya Airways.',
  tagline,
}: {
  size?: number;
  name?: string;
  tagline?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <BrandMark size={size} />
      <View style={{ flexShrink: 1 }}>
        <Text style={{ ...type.hero, color: colors.foreground }}>{name}</Text>
        {tagline ? (
          <Text style={{ ...type.body, color: colors.mutedForeground }}>{tagline}</Text>
        ) : null}
      </View>
    </View>
  );
}
