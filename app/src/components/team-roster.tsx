import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { ROSTER_SIZE } from '@core/draft.ts';

import { CommishTag, OwnerBadge, YouTag } from '@/components/owner-badge';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { headshotUrl, mlbTeamAbbr } from '@/lib/format';
import { useOpenPlayer } from '@/lib/player';
import type { SeasonData, Team } from '@/lib/season';
import { ownerLine, ownerName, teamName } from '@/lib/teams';

/**
 * How many empty slots to show after a roster: the picks still to come, while the season is
 * drafting. A team with no picks yet just says so (see TeamTile), unless `whenEmpty` asks for slots.
 */
export function emptySlots(data: SeasonData, roster: number[], whenEmpty = false): number {
  if (data.season.status === 'complete' || (roster.length === 0 && !whenEmpty)) return 0;
  return Math.max(0, ROSTER_SIZE - roster.length);
}

/**
 * A team as a tile: its manager's badge, name and tags over its hitters, with empty slots for the
 * picks still to come. Tapping the header folds the hitters away, leaving their headshots in a
 * small stack. Sits on a card (`backgroundElement`); my team's tile is tinted.
 */
export function TeamTile({
  data,
  team,
  roster,
  onRename,
  style,
}: {
  data: SeasonData;
  team: Team;
  roster: number[];
  onRename?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(true);
  const mine = team.id === data.myTeam?.id;
  const commish = !!team.user_id && data.commissionerIds.has(team.user_id);
  // Past seasons' teams are named after their manager: no need to say it twice.
  const line = ownerLine(data, team);
  const owner = line === teamName(team) ? null : line;
  const openSpot = !team.user_id && data.season.status !== 'complete';
  // Past seasons' unclaimed teams are named after their manager, so their badge takes the name's initial.
  const badgeOwner = openSpot ? null : (ownerName(data, team) ?? teamName(team));
  const surface = mine ? theme.mine : theme.background;
  return (
    <View style={[styles.tile, { backgroundColor: surface }, style]}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? 'Hides the players' : 'Shows the players'}
        style={styles.tileHead}>
        <OwnerBadge teamId={team.id} owner={badgeOwner} photo={team.user_id ? data.photos.get(team.user_id) : null} size={36} />
        <View style={styles.tileTitle}>
          <ThemedText numberOfLines={1} style={styles.teamName}>{teamName(team)}</ThemedText>
          {(owner || mine || commish) && (
            <View style={styles.ownerLine}>
              {owner && <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.owner}>{owner}</ThemedText>}
              {mine && <YouTag />}
              {commish && <CommishTag />}
            </View>
          )}
        </View>
        {onRename && open && (
          <Pressable onPress={onRename} hitSlop={8} accessibilityLabel={`Rename ${teamName(team)}`}>
            <ThemedText type="small" style={{ color: theme.accent }}>Rename</ThemedText>
          </Pressable>
        )}
        {!open && roster.length > 0 && (
          <View style={styles.stack}>
            {roster.map((id, i) => (
              <Image
                key={id}
                source={headshotUrl(id, 96)}
                style={[styles.stackHeadshot, { backgroundColor: theme.backgroundElement, borderColor: surface }, i > 0 && styles.stackOverlap]}
                contentFit="cover"
                accessibilityIgnoresInvertColors
              />
            ))}
          </View>
        )}
        <SymbolView
          name={open ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' } : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
          size={20}
          tintColor={theme.textSecondary}
        />
      </Pressable>
      {open &&
        (roster.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">No players yet</ThemedText>
        ) : (
          <RosterRows data={data} roster={roster} empty={emptySlots(data, roster)} />
        ))}
    </View>
  );
}

/**
 * A roster as rows (headshot, name, position, MLB team), then `empty` dashed slots. `stat`
 * adds a number at the end of each row, such as the hitter's regular-season total bases.
 * `stacked` puts position and team under the name, for narrow columns.
 */
export function RosterRows({
  data,
  roster,
  empty = 0,
  stat,
  stacked = false,
}: {
  data: SeasonData;
  roster: number[];
  empty?: number;
  stat?: (playerId: number) => string;
  stacked?: boolean;
}) {
  const theme = useTheme();
  return (
    <View>
      {roster.map((id, i) => (
        <RosterRow key={id} data={data} playerId={id} first={i === 0} stat={stat?.(id)} stacked={stacked} />
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <View key={i} style={[styles.row, roster.length + i > 0 && [styles.divider, { borderTopColor: theme.border }]]}>
          <View style={[styles.headshot, styles.emptyHeadshot, { borderColor: theme.textSecondary }]} />
          <ThemedText themeColor="textSecondary" style={styles.playerName}>Empty</ThemedText>
        </View>
      ))}
    </View>
  );
}

/** A hitter on a team: headshot, name, position and MLB team. Opens their stats. */
function RosterRow({
  data,
  playerId,
  first,
  stat,
  stacked,
}: {
  data: SeasonData;
  playerId: number;
  first: boolean;
  stat?: string;
  stacked: boolean;
}) {
  const theme = useTheme();
  const openPlayer = useOpenPlayer();
  const [hovered, setHovered] = useState(false);
  const player = data.players.get(playerId);
  const name = player?.full_name ?? `Player ${playerId}`;
  return (
    <Pressable
      onPress={() => openPlayer(playerId)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityHint="Shows the player's stats"
      style={[styles.row, !first && [styles.divider, { borderTopColor: theme.border }]]}>
      <Image
        source={headshotUrl(playerId, 96)}
        style={[styles.headshot, { backgroundColor: theme.backgroundSelected }]}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
      {stacked ? (
        <View style={styles.stackedName}>
          <ThemedText numberOfLines={1} style={[styles.name, hovered && { textDecorationLine: 'underline' }]}>{name}</ThemedText>
          <ThemedText numberOfLines={1} themeColor="textSecondary" style={styles.meta}>
            {[player?.primary_position, mlbTeamAbbr(data, playerId)].filter(Boolean).join(' · ')}
          </ThemedText>
        </View>
      ) : (
        <>
          <ThemedText numberOfLines={1} style={[styles.playerName, hovered && { textDecorationLine: 'underline' }]}>{name}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.position}>{player?.primary_position ?? ''}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.mlbTeam}>{mlbTeamAbbr(data, playerId)}</ThemedText>
        </>
      )}
      {stat !== undefined && <ThemedText style={styles.stat}>{stat}</ThemedText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: Radius.md, paddingHorizontal: Spacing.two + 4, paddingVertical: Spacing.two + 2, gap: Spacing.two },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  tileTitle: { flex: 1, minWidth: 0, gap: 1 },
  teamName: { fontSize: 15, lineHeight: 19, fontWeight: 700 },
  ownerLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  owner: { fontSize: 12, lineHeight: 15, flexShrink: 1 },
  stack: { flexDirection: 'row' },
  stackHeadshot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2 },
  stackOverlap: { marginLeft: -8 },
  // In a tile, headshots line up under the owner badge's center.
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: Spacing.one + 1, paddingLeft: 4 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth },
  headshot: { width: 28, height: 28, borderRadius: 14 },
  emptyHeadshot: { borderWidth: 1.5, borderStyle: 'dashed', opacity: 0.6 },
  playerName: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 18, fontWeight: 600 },
  stackedName: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, lineHeight: 18, fontWeight: 600 },
  meta: { fontSize: 12, lineHeight: 15 },
  position: { width: 30, textAlign: 'right', fontSize: 12, lineHeight: 15 },
  mlbTeam: { width: 36, textAlign: 'right', fontSize: 12, lineHeight: 15, fontWeight: 700 },
  stat: { width: 40, textAlign: 'right', fontSize: 14, lineHeight: 18, fontWeight: 700, fontVariant: ['tabular-nums'] },
});
