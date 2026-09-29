import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  type GestureResponderHandlers,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const nativeDriver = Platform.OS !== 'web';

/**
 * A popup: a centered dialog on desktops, a bottom sheet on phones that's dragged down by its
 * header to close (the player popup, a game's box score). `children` gets the drag handlers for
 * that header (none on desktops), to spread on it with `SheetHandle`.
 */
export function PopupSheet({
  open,
  onClose,
  maxWidth = 760,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The dialog's width on desktops. */
  maxWidth?: number;
  children: (dragHandlers: GestureResponderHandlers | undefined) => ReactNode;
}) {
  const theme = useTheme();
  const wide = useLayout() === 'wide';
  const { drag, handlers } = useDragToClose(open, onClose);
  // The backdrop fades as the sheet is dragged down.
  const dim = drag.interpolate({ inputRange: [0, 400], outputRange: [1, 0], extrapolate: 'clamp' });
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, wide ? styles.backdropWide : styles.backdropCompact]}
        onPress={onClose}
        accessibilityLabel="Close">
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: wide ? 1 : dim }]} pointerEvents="none" />
        {/* Swallows taps so they don't reach the backdrop. */}
        <AnimatedPressable
          onPress={() => {}}
          style={[
            styles.panel,
            wide ? [styles.panelWide, { maxWidth }] : styles.panelCompact,
            { backgroundColor: theme.background, boxShadow: theme.floating },
            !wide && { transform: [{ translateY: drag }] },
          ]}>
          {open && children(wide ? undefined : handlers)}
        </AnimatedPressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Dragging the bottom sheet down by its header: past a third of the way (or on a quick flick) it
 * slides out and closes; short of that it springs back.
 */
function useDragToClose(open: boolean, onClose: () => void) {
  const { height } = useWindowDimensions();
  const [drag] = useState(() => new Animated.Value(0));
  // Back in place each time it opens.
  useEffect(() => {
    if (open) drag.setValue(0);
  }, [open, drag]);

  const handlers = useMemo(() => {
    const springBack = () =>
      Animated.spring(drag, { toValue: 0, bounciness: 0, useNativeDriver: nativeDriver }).start();
    return PanResponder.create({
      // Touches that start on the header are its own, or the sheet's Pressable would take them.
      // Its buttons are deeper, so they still get their taps; a downward drag from one comes here.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > height / 3 || (g.dy > 40 && g.vy > 0.8)) {
          Animated.timing(drag, { toValue: height, duration: 180, useNativeDriver: nativeDriver }).start(() => onClose());
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: springBack,
    }).panHandlers;
  }, [drag, height, onClose]);

  return { drag, handlers };
}

/** A sheet's header: with drag handlers (phones), it's the handle, with a grabber on top. */
export function SheetHandle({
  dragHandlers,
  style,
  children,
}: {
  dragHandlers: GestureResponderHandlers | undefined;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[style, dragHandlers && styles.dragHandle]} {...dragHandlers}>
      {dragHandlers && <View style={[styles.grabber, { backgroundColor: theme.border }]} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center' },
  dim: { backgroundColor: 'rgba(0,0,0,0.5)' },
  backdropWide: { justifyContent: 'center', padding: Spacing.four },
  backdropCompact: { justifyContent: 'flex-end' },
  panel: { width: '100%', overflow: 'hidden' },
  panelWide: { maxHeight: '90%', borderRadius: Radius.lg },
  panelCompact: { maxHeight: '92%', borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  // Web: keep the browser from scrolling or selecting text while the header is dragged.
  dragHandle: Platform.select({ web: { touchAction: 'none', userSelect: 'none', cursor: 'grab' } as object, default: {} }),
  grabber: { position: 'absolute', top: 6, alignSelf: 'center', left: '50%', marginLeft: -18, width: 36, height: 5, borderRadius: 3 },
});
