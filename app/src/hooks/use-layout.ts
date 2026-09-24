import { useWindowDimensions } from 'react-native';

/** Window width at which screens switch from the phone layout to the desktop layout. */
export const WIDE_MIN_WIDTH = 900;

/**
 * 'compact' on phones and narrow windows (one column), 'wide' on desktops and landscape
 * tablets (multi-column). Every screen picks its layout from this, not its own width checks.
 */
export function useLayout(): 'compact' | 'wide' {
  const { width } = useWindowDimensions();
  return width >= WIDE_MIN_WIDTH ? 'wide' : 'compact';
}
