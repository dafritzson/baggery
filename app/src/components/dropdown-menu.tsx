import { type ReactNode, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A small menu that drops down from its trigger, right-aligned to it. Tapping outside or
 * pressing Escape closes it. Works on web too, unlike @expo/ui's native MenuView.
 */
export function DropdownMenu({
  trigger,
  label,
  children,
}: {
  trigger: ReactNode;
  /** Accessibility label for the trigger. */
  label: string;
  /** Menu contents; call `close` after an item's action. */
  children: (close: () => void) => ReactNode;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const close = () => setAnchor(null);

  function open() {
    triggerRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ top: y + h + Spacing.one, right: Math.max(Spacing.two, width - (x + w)) });
    });
  }

  return (
    <>
      <Pressable ref={triggerRef} onPress={open} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
        {trigger}
      </Pressable>
      <Modal visible={!!anchor} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close menu" />
        {anchor && (
          <View
            accessibilityRole="menu"
            style={[
              styles.menu,
              { top: anchor.top, right: anchor.right, backgroundColor: theme.background, borderColor: theme.border },
            ]}>
            {children(close)}
          </View>
        )}
      </Modal>
    </>
  );
}

export function DropdownMenuItem({
  label,
  onPress,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [styles.item, (pressed || hovered) && { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" themeColor={destructive ? 'danger' : 'text'}>{label}</ThemedText>
    </Pressable>
  );
}

export function DropdownMenuDivider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    minWidth: 220,
    maxWidth: 300,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
  },
  item: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.one },
});
