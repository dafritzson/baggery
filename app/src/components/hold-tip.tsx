import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type GestureResponderEvent, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { TooltipPortal } from '@/components/tooltip-portal';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Web: shows `text` when the pointer rests on the element (react-native-web doesn't pass `title`
 * through). Phones have no hover: with `useHoldTip`, holding a finger on it shows the same text.
 */
export function hoverTitle(text: string) {
  if (Platform.OS !== 'web') return undefined;
  return (el: unknown) => {
    (el as HTMLElement | null)?.setAttribute?.('title', text);
  };
}

/** Web: a finger held on it gets the tip, not the text selected or the callout menu. */
export const noSelect = Platform.OS === 'web' ? ({ userSelect: 'none', WebkitTouchCallout: 'none' } as ViewStyle) : null;

/**
 * Tips for phones. `hold(fallback)` is an `onLongPress` for a Pressable: a finger held on anything
 * in it with a `hoverTitle` shows that title in a small bubble (render `tip` anywhere) until the
 * next touch or scroll. A hold anywhere else in it, or a long mouse click, does `fallback`, e.g.
 * what a tap does, so it isn't lost. Web only, like the titles.
 */
export function useHoldTip() {
  const [tip, setTip] = useState<{ text: string; box: DOMRect } | null>(null);
  const hold = (fallback?: () => void) => {
    if (Platform.OS !== 'web') return undefined;
    return (e: GestureResponderEvent) => {
      const native = e.nativeEvent as unknown as { type: string; target: HTMLElement | null };
      const el = native.type === 'touchstart' ? native.target?.closest?.('[title]') : null;
      const text = el?.getAttribute('title');
      if (el && text) setTip({ text, box: el.getBoundingClientRect() });
      else fallback?.();
    };
  };
  return { hold, tip: tip && <TipBubble text={tip.text} box={tip.box} onClose={() => setTip(null)} /> };
}

const MARGIN = Spacing.two;
const GAP = Spacing.one + 2;

/**
 * The tip above `box` (below it near the top of the screen), kept on screen, until the next touch,
 * click or scroll. Web only.
 */
export function TipBubble({ text, box, onClose }: { text: string; box: DOMRect; onClose: () => void }) {
  const theme = useTheme();
  const { top: safeTop } = useSafeAreaInsets();
  const ref = useRef<View>(null);
  // Placed once its own size is known, before it's drawn.
  useLayoutEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!el) return;
    const { offsetWidth: width, offsetHeight: height } = el;
    const left = Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - MARGIN);
    const above = box.top - GAP - height;
    el.style.left = `${Math.max(MARGIN, left)}px`;
    el.style.top = `${above >= safeTop + MARGIN ? above : box.bottom + GAP}px`;
    el.style.visibility = 'visible';
  }, [box, safeTop]);
  // The next touch or click anywhere closes it, and so does scrolling, which would leave it behind.
  useEffect(() => {
    const options = { capture: true, passive: true };
    document.addEventListener('pointerdown', onClose, options);
    window.addEventListener('scroll', onClose, options);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onClose, options);
      window.removeEventListener('scroll', onClose, options);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return (
    <TooltipPortal>
      <View
        ref={ref}
        style={[
          styles.bubble,
          { backgroundColor: theme.background, boxShadow: theme.floating },
          // Above the player popup's modal.
          { position: 'fixed', left: 0, top: 0, zIndex: 10000, visibility: 'hidden', pointerEvents: 'none' } as unknown as ViewStyle,
        ]}>
        <ThemedText type="small" style={styles.text}>{text}</ThemedText>
      </View>
    </TooltipPortal>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: 260, borderRadius: Radius.lg, paddingHorizontal: Spacing.two + 2, paddingVertical: Spacing.two - 2 },
  text: { fontSize: 13, lineHeight: 18 },
});
