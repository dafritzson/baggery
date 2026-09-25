import { useColorScheme as useDeviceColorScheme } from 'react-native';

import { useColorSchemeChoice } from '@/lib/color-scheme';

/** The device's light or dark mode, unless someone picked one with the header's toggle. */
export function useColorScheme() {
  const device = useDeviceColorScheme();
  return useColorSchemeChoice() ?? device;
}
