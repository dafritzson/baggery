import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { hitBags } from '@core/bag-celebration.ts';
import { type BoxLine, type BoxRow, type Linescore, boxTotals, extraBaseHits, teamBox } from '@core/box-score.ts';
import type { LivePlayer, LiveState } from '@core/live.ts';

import { type Bagger, HitterRow, UpTag } from '@/components/at-bat';
import { betweenInnings, LiveStatus, LiveStatusStack } from '@/components/live-status';
import { Loader } from '@/components/loader';
import { YouTag } from '@/components/owner-badge';
import { PlayerName } from '@/components/player-name';
import { PopupSheet, SheetHandle } from '@/components/popup-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Toggle } from '@/components/toggle';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { type BoxScore, useBoxScore } from '@/lib/box-score';
import { lineScore, nickname, ownerOf, seriesLabel, statusLine } from '@/lib/game-labels';
import { PlayerProvider } from '@/lib/player';
import { type GameInfo, useScores } from '@/lib/scores';
import type { SeasonData } from '@/lib/season';
import { ownerName, teamName } from '@/lib/teams';

type Side = 'away' | 'home';

/** Whose hitter he is in this game, and the name to show for another manager. */
function baggersFor(data: SeasonData, game: GameInfo) {
  return (playerId: number): { bagger: Bagger; owner: string | null } => {
    const teamId = ownerOf(data, playerId, game);
    if (!teamId) return { bagger: null, owner: null };
    if (teamId === data.myTeam?.id) return { bagger: 'mine', owner: null };
    const team = data.teams.find((t) => t.id === teamId);
    return { bagger: 'other', owner: team ? (ownerName(data, team) ?? teamName(team)) : null };
  };
}

/**
 * A game's box score, opened by tapping its card on the Games tab. Before first pitch: both
 * starting lineups side by side. Once it starts: every hitter's line in batting order, a team at a
 * time on phones (both side by side on wider screens), with the line score on top. Your hitters
 * are dark green, other managers' dark blue, and the hitter at bat gets a pulsing ring (blue with no
 * fill if nobody drafted him).
 */
export function BoxScoreSheet({ data, game, onClose }: { data: SeasonData; game: GameInfo; onClose: () => void }) {
  const theme = useTheme();
  const wide = useLayout() === 'wide';
  const { box, failed } = useBoxScore(game);
  const preview = game.status === 'Preview';
  const live = game.status === 'Live' ? game.live : null;
  const [side, setSide] = useState<Side>(live?.battingSide ?? 'away');
  const abbr = (s: Side) => data.mlbTeams.get(s === 'away' ? game.awayTeamId : game.homeTeamId)?.abbreviation ?? '—';
  const teamId = (s: Side) => (s === 'away' ? game.awayTeamId : game.homeTeamId);
  const name = (s: Side) => data.mlbTeams.get(teamId(s))?.name ?? abbr(s);

  const scoreLine = (
    <View style={styles.scoreLine}>
      {(['away', 'home'] as const).map((s, i) => {
        const score = s === 'away' ? game.awayScore : game.homeScore;
        const other = s === 'away' ? game.homeScore : game.awayScore;
        const ahead = !preview && score !== null && other !== null && score > other;
        return (
          <View key={s} style={styles.scoreSide}>
            {i === 1 && <ThemedText themeColor="textSecondary">{preview ? 'at' : '–'}</ThemedText>}
            <ThemedText style={[styles.scoreAbbr, { color: ahead || preview ? theme.text : theme.textSecondary }]}>{abbr(s)}</ThemedText>
            {!preview && <ThemedText style={[styles.scoreRuns, ahead && styles.bold]}>{score ?? ''}</ThemedText>}
          </View>
        );
      })}
    </View>
  );

  const body = failed ? (
    <ThemedText type="small" themeColor="textSecondary">Couldn&apos;t load the box score. Close it and try again.</ThemedText>
  ) : !box ? (
    <Loader />
  ) : preview ? (
    <View style={styles.columns}>
      {(['away', 'home'] as const).map((s) => (
        <View key={s} style={styles.column}>
          <Lineup data={data} game={game} box={box} teamId={teamId(s)} title={name(s)} />
        </View>
      ))}
    </View>
  ) : wide ? (
    <View style={styles.columns}>
      {(['away', 'home'] as const).map((s) => (
        <View key={s} style={styles.column}>
          <ThemedText type="smallBold">{name(s)}</ThemedText>
          <TeamBox data={data} game={game} box={box} side={s} />
        </View>
      ))}
    </View>
  ) : (
    <TeamBox data={data} game={game} box={box} side={side} />
  );

  return (
    <PopupSheet open onClose={onClose} maxWidth={900} tall>
      {(dragHandlers) => (
        // Its players open over it, not behind it under the app's own player popup.
        <PlayerProvider stacked onLeave={onClose}>
          <SheetHandle dragHandlers={dragHandlers} style={[styles.head, { borderBottomColor: theme.border }]}>
            <View style={styles.headTop}>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.headLabel}>
                {seriesLabel(game)}
                {/* A live game's inning, count and outs are drawn by the score instead. */}
                {!live && (
                  <>
                    {' · '}
                    <ThemedText type="smallBold" themeColor="textSecondary">{statusLine(game)}</ThemedText>
                  </>
                )}
              </ThemedText>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close box score">
                <ThemedText themeColor="textSecondary" style={styles.close}>✕</ThemedText>
              </Pressable>
            </View>
            {wide && live ? (
              // Desktops: the score and linescore, then the inning, runners, count and outs, then who's up, all on one row.
              <View style={styles.band}>
                <View style={styles.bandScore}>
                  {scoreLine}
                  {box?.linescore && <LinescoreTable linescore={box.linescore} away={abbr('away')} home={abbr('home')} />}
                </View>
                <View style={[styles.bandPart, { borderLeftColor: theme.border }]}>
                  <LiveStatusStack live={live} />
                </View>
                {!betweenInnings(live) && (
                  <View style={[styles.bandPart, styles.bandUp, { borderLeftColor: theme.border }]}>
                    <UpNow live={live} box={box} />
                  </View>
                )}
              </View>
            ) : (
              <>
                <View style={styles.scoreRow}>
                  {scoreLine}
                  {live && <LiveStatus live={live} />}
                </View>
                {live && !betweenInnings(live) && <UpNow live={live} box={box} compact />}
                {!preview && box?.linescore && <LinescoreTable linescore={box.linescore} away={abbr('away')} home={abbr('home')} />}
              </>
            )}
            {!preview && !wide && (
              <Toggle
                options={(['away', 'home'] as const).map((s) => ({
                  value: s,
                  label: nickname(name(s)),
                  note: live ? (live.battingSide === s ? 'At bat' : '') : undefined,
                }))}
                value={side}
                onChange={setSide}
                fill
              />
            )}
          </SheetHandle>
          <ScrollView contentContainerStyle={styles.body}>
            {body}
            {!failed && box && <Legend live={!!live} />}
          </ScrollView>
        </PlayerProvider>
      )}
    </PopupSheet>
  );
}

/** "1-3, 2B, RBI, 2 TB": hits-at bats, then extra-base hits, RBIs, walks and total bases. */
function gameLine(line: BoxLine): string {
  const times = (n: number, label: string) => (n === 0 ? [] : [n === 1 ? label : `${n} ${label}`]);
  return [
    `${line.h}-${line.ab}`,
    ...times(line.hr, 'HR'),
    ...times(line.triples, '3B'),
    ...times(line.doubles, '2B'),
    ...times(line.rbi, 'RBI'),
    ...times(line.bb, 'BB'),
    ...(line.tb ? [`${line.tb} TB`] : []),
  ].join(', ');
}

/**
 * The hitter at bat and his game so far, then who's on deck (and, on desktops, in the hole). One
 * line under the score on phones.
 */
function UpNow({ live, box, compact }: { live: LiveState; box: BoxScore | null; compact?: boolean }) {
  const [batter, onDeck, inHole] = live.batting;
  if (!batter) return null;
  const lineOf = (id: number) => box?.lines.find((l) => l.playerId === id);
  const line = lineOf(batter.id);
  const position = line?.position?.split('-').pop();
  const lastName = (name: string) => name.split(' ').slice(1).join(' ') || name;
  const next = (label: string, p: LivePlayer | null) =>
    p && (
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={compact && styles.upNext}>
        {label}{' '}
        <ThemedText type="smallBold">{compact ? lastName(p.name) : p.name}</ThemedText>
        {!compact && ` ${lineScore(lineOf(p.id))}`}
      </ThemedText>
    );
  const atBat = (
    <View style={styles.upBatter}>
      <UpTag label="AB" />
      <PlayerName playerId={batter.id} type="smallBold" numberOfLines={1} style={!compact && styles.upName}>
        {batter.name}
      </PlayerName>
      {!!position && <ThemedText themeColor="textSecondary" style={styles.pos}>{position}</ThemedText>}
      {line && <ThemedText type="small" numberOfLines={1} style={styles.upLine}>{gameLine(line)}</ThemedText>}
    </View>
  );
  if (compact) {
    return (
      <View style={styles.upRow}>
        {atBat}
        {next('On deck', onDeck)}
      </View>
    );
  }
  return (
    <View style={styles.upColumn}>
      {atBat}
      {next('On deck', onDeck)}
      {next('In the hole', inHole)}
    </View>
  );
}

/** Runs by inning, then R H E. At least nine innings; extra innings scroll sideways on phones. */
function LinescoreTable({ linescore, away, home }: { linescore: Linescore; away: string; home: string }) {
  const theme = useTheme();
  const innings = Array.from({ length: Math.max(9, linescore.innings.length) }, (_, i) => linescore.innings[i] ?? [null, null]);
  const cell = (text: string | number, key: string, strong?: boolean, divider?: boolean) => (
    <View key={key} style={[styles.lsCell, divider && [styles.lsDivider, { borderLeftColor: theme.border }]]}>
      <ThemedText type="small" themeColor={strong === undefined ? 'textSecondary' : 'text'} style={[styles.lsText, strong && styles.bold]}>
        {text}
      </ThemedText>
    </View>
  );
  const line = (label: string, which: 0 | 1, rhe: [number, number, number]) => (
    <View style={styles.lsRow}>
      <ThemedText type="smallBold" style={[styles.lsText, styles.lsTeam]}>{label}</ThemedText>
      {innings.map((inning, i) => cell(inning[which] ?? '', `i${i}`, false))}
      {rhe.map((n, i) => cell(n, `t${i}`, i === 0, i === 0))}
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.lsRow}>
          <View style={styles.lsTeam} />
          {innings.map((_, i) => cell(i + 1, `h${i}`))}
          {['R', 'H', 'E'].map((t, i) => cell(t, t, undefined, i === 0))}
        </View>
        {line(away, 0, linescore.away)}
        {line(home, 1, linescore.home)}
      </View>
    </ScrollView>
  );
}

const COLUMNS = [
  { key: 'ab', label: 'AB' },
  { key: 'r', label: 'R' },
  { key: 'h', label: 'H' },
  { key: 'rbi', label: 'RBI' },
  { key: 'bb', label: 'BB' },
  { key: 'so', label: 'K' },
] as const;

/** One team's hitters in batting order, the totals and the extra-base hits. */
function TeamBox({ data, game, box, side }: { data: SeasonData; game: GameInfo; box: BoxScore; side: Side }) {
  const theme = useTheme();
  const { scores } = useScores();
  const baggers = baggersFor(data, game);
  const teamId = side === 'away' ? game.awayTeamId : game.homeTeamId;
  const lines = box.lines.filter((l) => l.teamId === teamId);
  const rows = teamBox(lines, box.lineups.get(teamId));
  const totals = boxTotals(lines);
  // The batting team's batter, on deck and in the hole.
  const live = game.status === 'Live' ? game.live : null;
  const up = new Map<number, string>();
  if (live && live.battingSide === side) {
    live.batting.forEach((p, i) => p && up.set(p.id, ['AB', 'OD', 'IH'][i]));
  }
  const hitsOf = (playerId: number) =>
    (scores?.hits ?? [])
      .filter((h) => h.gamePk === game.gamePk && h.playerId === playerId)
      .sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? ''))
      .map((h) => h.event);

  if (rows.length === 0) {
    return <ThemedText type="small" themeColor="textSecondary">No one has batted yet.</ThemedText>;
  }
  const number = (n: number | string, key: string, bold?: boolean) => (
    <ThemedText key={key} type="small" themeColor={n === 0 || n === '–' ? 'textSecondary' : 'text'} style={[styles.num, bold && styles.bold]}>
      {n}
    </ThemedText>
  );
  return (
    <View style={styles.table}>
      <View style={styles.row}>
        <View style={styles.spot} />
        <ThemedText type="smallBold" themeColor="textSecondary" style={[styles.headText, styles.who]}>Batter</ThemedText>
        {COLUMNS.map((c) => (
          <ThemedText key={c.key} type="smallBold" themeColor="textSecondary" style={[styles.headText, styles.num]}>{c.label}</ThemedText>
        ))}
        <ThemedText type="smallBold" themeColor="textSecondary" style={[styles.headText, styles.num, styles.tb]}>TB</ThemedText>
      </View>
      {rows.map((row) => {
        const { bagger, owner } = baggers(row.playerId);
        const tag = up.get(row.playerId);
        return (
          <HitterRow key={row.playerId} bagger={bagger} atBat={tag === 'AB'} ringUndrafted style={[styles.row, styles.line, { borderTopColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary" style={[styles.spot, styles.spotText]}>{row.sub || row.spot === null ? '' : row.spot}</ThemedText>
            <BatterCell row={row} bagger={bagger} owner={owner} tag={tag} bags={row.line?.tb ? hitBags(row.line.tb, hitsOf(row.playerId), row.playerId, game.gamePk, row.line).join('') : ''} />
            {COLUMNS.map((c) => number(row.line ? row.line[c.key] : '–', c.key))}
            <View style={styles.tb}>{number(row.line ? row.line.tb : '–', 'tb', true)}</View>
          </HitterRow>
        );
      })}
      <View style={[styles.row, styles.line, styles.totals, { borderTopColor: theme.textSecondary }]}>
        <View style={styles.spot} />
        <ThemedText type="smallBold" style={[styles.who, styles.nameText]}>Totals</ThemedText>
        {COLUMNS.map((c) => number(totals[c.key], c.key, true))}
        <View style={styles.tb}>{number(totals.tb, 'tb', true)}</View>
      </View>
      {extraBaseHits(lines).map((x) => (
        <ThemedText key={x.label} type="small" themeColor="textSecondary" style={styles.note}>
          <ThemedText type="smallBold" style={styles.note}>{x.label}: </ThemedText>
          {x.text}
        </ThemedText>
      ))}
    </View>
  );
}

/** Name and position, a sub indented under the hitter he replaced; for a drafted hitter, his owner and bags below. */
function BatterCell({
  row,
  bagger,
  owner,
  tag,
  bags,
}: {
  row: BoxRow;
  bagger: Bagger;
  owner: string | null;
  tag?: string;
  bags: string;
}) {
  return (
    <View style={[styles.who, row.sub && styles.sub]}>
      <View style={styles.nameLine}>
        {row.sub && <ThemedText type="small" themeColor="textSecondary" style={styles.nameText}>↳</ThemedText>}
        <PlayerName playerId={row.playerId} type="smallBold" numberOfLines={1} style={styles.nameText}>
          {row.name}
        </PlayerName>
        {!!row.position && <ThemedText themeColor="textSecondary" style={styles.pos}>{row.position}</ThemedText>}
        {tag && <UpTag label={tag} />}
      </View>
      {bagger && (
        <View style={styles.ownerLine}>
          {bagger === 'mine' ? <YouTag /> : <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.owner}>{owner}</ThemedText>}
          {!!row.line && (
            <ThemedText numberOfLines={1} style={styles.bags} accessibilityLabel={`${row.line.tb} total bases`}>
              {row.line.tb ? bags : '–'}
            </ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

/** Before first pitch: the team's announced starter, its posted lineup, and its drafted hitters on the bench. */
function Lineup({ data, game, box, teamId, title }: { data: SeasonData; game: GameInfo; box: BoxScore; teamId: number; title: string }) {
  const theme = useTheme();
  const baggers = baggersFor(data, game);
  const lineup = box.lineups.get(teamId) ?? [];
  const probable = box.probables.get(teamId);
  // Drafted hitters on this MLB team, now.
  const drafted = [...new Set(data.spells.filter((s) => s.to_at === null).map((s) => s.mlb_player_id))].filter(
    (id) => data.poolByPlayer.get(id)?.mlb_team_id === teamId,
  );
  const inLineup = new Set(lineup.map((p) => p.id));
  const bench = drafted.filter((id) => !inLineup.has(id));
  const benchLabel = (id: number) => {
    const { bagger, owner } = baggers(id);
    return `${data.players.get(id)?.full_name ?? `Player ${id}`} · ${bagger === 'mine' ? 'you' : owner}`;
  };
  return (
    <View style={styles.lineup}>
      <ThemedText type="smallBold" numberOfLines={1}>{title}</ThemedText>
      {probable && (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.note}>
          SP <ThemedText type="smallBold" style={styles.note}>{probable.name}</ThemedText>
          {probable.hand ? ` (${probable.hand})` : ''}
        </ThemedText>
      )}
      {lineup.length === 0 ? (
        <ThemedView type="background" style={[styles.pending, { borderColor: theme.border }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            Lineup not posted yet. Lineups usually come 2–4 hours before first pitch.
          </ThemedText>
        </ThemedView>
      ) : (
        lineup.map((p, i) => {
          const { bagger, owner } = baggers(p.id);
          return (
            <HitterRow key={p.id} bagger={bagger} style={[styles.lineupRow, { borderTopColor: theme.border }]}>
              <ThemedText type="small" themeColor="textSecondary" style={[styles.spot, styles.spotText]}>{i + 1}</ThemedText>
              <View style={styles.who}>
                <View style={styles.nameLine}>
                  <PlayerName playerId={p.id} type="smallBold" numberOfLines={1} style={styles.nameText}>{p.name}</PlayerName>
                  {!!p.pos && <ThemedText themeColor="textSecondary" style={styles.pos}>{p.pos}</ThemedText>}
                </View>
                {bagger && (
                  <View style={styles.ownerLine}>
                    {bagger === 'mine' ? <YouTag /> : <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.owner}>{owner}</ThemedText>}
                  </View>
                )}
              </View>
            </HitterRow>
          );
        })
      )}
      {bench.length > 0 && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          <ThemedText type="smallBold" style={styles.note}>{lineup.length ? 'On the bench: ' : 'Drafted: '}</ThemedText>
          {bench.map(benchLabel).join(', ')}
        </ThemedText>
      )}
    </View>
  );
}

function Legend({ live }: { live: boolean }) {
  const theme = useTheme();
  const swatch = (color: string, ring?: string) => (
    <View style={[styles.swatch, { backgroundColor: color }, ring && { borderColor: ring, borderWidth: 1.5 }]} />
  );
  const item = (sw: ReactNode, label: string) => (
    <View key={label} style={styles.legendItem}>
      {sw}
      <ThemedText themeColor="textSecondary" style={styles.legendText}>{label}</ThemedText>
    </View>
  );
  return (
    <View style={styles.legend}>
      {item(swatch(theme.mineFill), 'Your hitters')}
      {item(swatch(theme.otherFill), 'Drafted by others')}
      {live && item(swatch('transparent', theme.otherRing), 'At bat (green ring if yours)')}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three + 4, paddingBottom: Spacing.two + 2, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  headTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headLabel: { flex: 1, minWidth: 0 },
  close: { fontSize: 18, lineHeight: 22 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  scoreLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.three },
  // Desktops, live: score and linescore | inning, runners, count, outs | who's up.
  band: { flexDirection: 'row', alignItems: 'stretch' },
  bandScore: { flexShrink: 1, minWidth: 0, gap: Spacing.two, paddingRight: Spacing.four },
  bandPart: { justifyContent: 'center', paddingHorizontal: Spacing.four, borderLeftWidth: StyleSheet.hairlineWidth },
  bandUp: { flex: 1, minWidth: 0, paddingRight: 0 },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  upColumn: { gap: Spacing.one + 2 },
  upBatter: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  upName: { fontSize: 15, lineHeight: 20 },
  upLine: { flexShrink: 1, fontVariant: ['tabular-nums'] },
  upNext: { marginLeft: 'auto', flexShrink: 1 },
  scoreSide: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  scoreAbbr: { fontSize: 17, lineHeight: 24, fontWeight: 600 },
  scoreRuns: { fontSize: 22, lineHeight: 28, fontWeight: 600, fontVariant: ['tabular-nums'] },
  bold: { fontWeight: 800 },
  lsRow: { flexDirection: 'row', alignItems: 'center' },
  lsTeam: { width: 40 },
  lsCell: { width: 20, alignItems: 'center' },
  lsDivider: { borderLeftWidth: StyleSheet.hairlineWidth, width: 24 },
  lsText: { fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
  body: { padding: Spacing.two + 2, paddingBottom: Spacing.five, gap: Spacing.three },
  columns: { flexDirection: 'row', gap: Spacing.four, alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0, gap: Spacing.two },
  table: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 3 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 5, borderRadius: Radius.md },
  totals: { borderTopWidth: 1.5, borderRadius: 0 },
  headText: { fontSize: 10, lineHeight: 14, textTransform: 'uppercase', letterSpacing: 0.4 },
  spot: { width: 18, paddingLeft: 4 },
  spotText: { fontSize: 11, lineHeight: 17 },
  who: { flex: 1, minWidth: 0, paddingLeft: 2 },
  sub: { paddingLeft: 10 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  nameText: { fontSize: 12.5, lineHeight: 17 },
  pos: { fontSize: 10, lineHeight: 14, fontWeight: 600, flexShrink: 0 },
  ownerLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  owner: { fontSize: 10.5, lineHeight: 14, flexShrink: 1 },
  bags: { marginLeft: 'auto', fontSize: 11, lineHeight: 14, letterSpacing: -1 },
  num: { width: 24, textAlign: 'right', fontSize: 12, lineHeight: 17, fontVariant: ['tabular-nums'] },
  tb: { width: 30, paddingRight: 4, alignItems: 'flex-end' },
  note: { fontSize: 11.5, lineHeight: 16 },
  lineup: { gap: 4 },
  lineupRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md },
  pending: { borderWidth: 1, borderStyle: 'dashed', borderRadius: Radius.lg, padding: Spacing.two + 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontSize: 11, lineHeight: 15 },
  swatch: { width: 11, height: 11, borderRadius: 2 },
});
