/** Shared UI primitives — one visual language across every screen. */
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native';
import { colors, radii, spacing, type } from '@/theme/tokens';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ flex: 1, backgroundColor: colors.background, padding: spacing.md }, style]}>
      {children}
    </View>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.md,
        marginBottom: spacing.sm,
      }}
    >
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'secondary'
        ? colors.secondary
        : variant === 'danger'
          ? colors.destructive
          : 'transparent';
  const fg =
    variant === 'primary' || variant === 'danger'
      ? colors.primaryForeground
      : variant === 'secondary'
        ? colors.foreground
        : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={{
        backgroundColor: bg,
        borderRadius: radii.sm,
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.md,
        alignItems: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ ...type.body, fontWeight: '600', color: fg }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Badge({ label, tone }: { label: string; tone?: 'success' | 'warning' | 'danger' }) {
  const bg =
    tone === 'success'
      ? '#DCFCE7'
      : tone === 'warning'
        ? '#FEF3C7'
        : tone === 'danger'
          ? '#FEE2E2'
          : colors.secondary;
  const fg =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.destructive
          : colors.mutedForeground;
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: radii.sm,
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text style={{ ...type.caption, color: fg, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
      <Text style={{ ...type.title, color: colors.foreground }}>{title}</Text>
      {body && (
        <Text
          style={{
            ...type.body,
            color: colors.mutedForeground,
            marginTop: spacing.xs,
            textAlign: 'center',
          }}
        >
          {body}
        </Text>
      )}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label && (
        <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: spacing.sm }}>
          {label}
        </Text>
      )}
    </View>
  );
}
