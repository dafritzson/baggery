import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { type AlmanacData, managerSlug } from '@/lib/almanac';

/** 1st, 2nd, 3rd, 4th, ... */
export const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** Opens a manager's Almanac page: /almanac/daniel, or the key for someone not linked to a manager. */
export function openManager(data: AlmanacData, key: string) {
  const name = data.managers.get(key);
  router.push({ pathname: '/almanac/[manager]', params: { manager: name && !key.includes(':') ? managerSlug(name) : key } });
}

/** A manager's name that opens their Almanac page. */
export function ManagerLink({ data, managerKey }: { data: AlmanacData; managerKey: string }) {
  const theme = useTheme();
  return (
    <ThemedText type="smallBold" style={{ color: theme.accent }} onPress={() => openManager(data, managerKey)}>
      {data.managers.get(managerKey) ?? '?'}
    </ThemedText>
  );
}
