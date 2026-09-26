import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { AlmanacData } from '@/lib/almanac';
import { useSeason } from '@/lib/season';

/**
 * An Almanac manager's photo on their colored card: the photo of the account linked to them
 * (uploaded in Settings, else Google's), else their initial in `color` on white.
 */
export function ManagerPhoto({ data, managerKey, color, size }: { data: AlmanacData; managerKey: string; color: string; size: number }) {
  const { data: season } = useSeason();
  const [failed, setFailed] = useState<string | null>(null);
  const account = data.accounts.get(managerKey);
  const photo = account ? season?.photos.get(account) : undefined;
  const name = data.managers.get(managerKey) ?? '?';
  const round = { width: size, height: size, borderRadius: size / 2, backgroundColor: '#fff', borderWidth: 2, borderColor: '#fff' };
  if (photo && failed !== photo) {
    return <Image source={photo} style={round} onError={() => setFailed(photo)} accessibilityLabel={name} />;
  }
  return (
    <View style={[round, { alignItems: 'center', justifyContent: 'center' }]}>
      <ThemedText style={{ color, fontSize: size / 2, lineHeight: size * 0.625, fontWeight: '800' }}>{name[0]}</ThemedText>
    </View>
  );
}
