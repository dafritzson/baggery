import { type ReactNode, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';

import type { LiveState } from '@core/live.ts';
import { postseasonSeries } from '@core/schedule.ts';
import { SERIES } from '@core/scoreboard.ts';
import type { GameType } from '@core/types.ts';

import { Card } from '@/components/card';
import { YouTag } from '@/components/owner-badge';
import { PlayerName } from '@/components/player-name';
import { PostseasonView, RoundView } from '@/components/schedule';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Toggle } from '@/components/toggle';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { dayKey, dayLabel, gameDay } from '@/lib/game-day';
import { type BattingLine, type GameInfo, type Scores, useScores } from '@/lib/scores';
import { type SeasonData, useSeason } from '@/lib/season';
import { ownerName, teamName } from '@/lib/teams';
import { zoom, zoomFixed, zoomKey, zoomView } from '@/lib/zoom';

const STATUS_ORDER: Record<string, number> = { Live: 0, Preview: 1, Final: 2 };

/** Today if there are games today, else the next day with games, else the last one. */
function defaultDay(days: string[], today: string): string | undefined {
  return days.find((d) => d >= today) ?? days.at(-1);
}

type Zoom = 'day' | 'round' | 'postseason';

/** Most detail first: switching to a later level zooms out. */
const LEVELS: { value: Zoom; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'round', label: 'Round' },
  { value: 'postseason', label: 'Postseason' },
];

const level = (z: Zoom) => LEVELS.findIndex((l) => l.value === z);

/**
 * MLB's postseason games, at three zoom levels: a day's games with the fantasy players in each
 * and their TB, a round's series, or the whole postseason. Tapping a game in a series zooms into
 * its day.
 */
export default function GamesScreen() {
  const { data, loading } = useSeason();
  const { scores } = useScores(data);
  const wide = useLayout() === 'wide';
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedRound, setPickedRound] = useState<GameType | null>(null);
  const [view, setView] = useState<Zoom>('day');

  if (loading || (data && !scores)) {
    return <Screen width="wide"><ThemedText themeColor="textSecondary">Loading…</ThemedText></Screen>;
  }
  if (!data || !scores) return <Screen width="wide"><ThemedText>No season set up yet.</ThemedText></Screen>;

  const today = dayKey(new Date().toISOString());
  const days = [...new Set(scores.games.map(gameDay))].sort();
  const day = picked && days.includes(picked) ? picked : defaultDay(days, today);
  const games = scores.games
    .filter((g) => day && gameDay(g) === day)
    // Live games first, then the ones still to come, then the finished ones; by start time within each.
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1) || a.start.localeCompare(b.start));

  const series = postseasonSeries(scores.games);
  const rounds = SERIES.filter((r) => series.some((s) => s.gameType === r.gameType));
  // The Round view follows the day (its latest round, if two overlap) unless a round was picked.
  const dayRound = SERIES.findLast((r) => games.some((g) => g.gameType === r.gameType))?.gameType;
  const round = rounds.find((r) => r.gameType === pickedRound)?.gameType ?? dayRound ?? rounds[0]?.gameType;
  // The game the zoom centers on: the day's first.
  const focus = games[0] && `game-${games[0].gamePk}`;

  const zoomTo = (next: Zoom) => {
    if (next !== view) zoom(level(next) < level(view) ? 'in' : 'out', () => setView(next), focus);
  };
  const showDay = (d: string) => {
    setPicked(d);
    setPickedRound(null);
  };
  const pickGame = (game: GameInfo) =>
    zoom('in', () => {
      showDay(gameDay(game));
      setView('day');
    }, `game-${game.gamePk}`);
  const scheduleProps = { data, day, today, onPick: pickGame };

  return (
    <Screen width="wide">
      {days.length === 0 ? (
        <ThemedText themeColor="textSecondary">Games show up here once the postseason schedule is out.</ThemedText>
      ) : (
        <>
          <View style={styles.controls} {...zoomFixed()}>
            <Toggle options={LEVELS} value={view} onChange={zoomTo} large />
            {view === 'day' && (
              <MenuChip
                label={day ? dayLabel(day, today) : 'Pick a day'}
                title="day"
                options={days.map((d) => {
                  const n = scores.games.filter((g) => gameDay(g) === d).length;
                  return { value: d, label: `${dayLabel(d, today)} · ${n} ${n === 1 ? 'game' : 'games'}` };
                })}
                value={day}
                onChange={showDay}
              />
            )}
            {/* The chip says "Championship", not "Championship Series", to fit beside the toggle on phones. */}
            {view === 'round' && round && (
              <MenuChip
                label={round === 'L' ? 'Championship' : (SERIES.find((r) => r.gameType === round)?.name ?? '')}
                title="round"
                options={rounds.map((r) => ({ value: r.gameType, label: r.name }))}
                value={round}
                onChange={setPickedRound}
              />
            )}
          </View>
          <View style={styles.column} {...zoomView()}>
            {view === 'round' ? (
              <RoundView series={series.filter((s) => s.gameType === round)} {...scheduleProps} />
            ) : view === 'postseason' ? (
              <PostseasonView series={series} {...scheduleProps} />
            ) : wide ? (
              // Rows of two that fill the width; both cards in a row are as tall as the taller one.
              games
                .filter((_, i) => i % 2 === 0)
                .map((g, row) => (
                  <View key={g.gamePk} style={styles.row}>
                    {games.slice(row * 2, row * 2 + 2).map((game) => (
                      <View key={game.gamePk} style={styles.cell} {...zoomKey(`game-${game.gamePk}`)}>
                        <GameCard data={data} scores={scores} game={game} fill />
                      </View>
                    ))}
                    {row * 2 + 1 >= games.length && <View style={styles.cell} />}
                  </View>
                ))
            ) : (
              games.map((g) => (
                <View key={g.gamePk} {...zoomKey(`game-${g.gamePk}`)}>
                  <GameCard data={data} scores={scores} game={g} />
                </View>
              ))
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

/** The current choice as a chip, opening a menu of them all (on web, scrolled to the current one). */
function MenuChip<T extends string>({
  label,
  title,
  options,
  value,
  onChange,
}: {
  label: string;
  /** What's being picked, for screen readers: "day". */
  title: string;
  options: { value: T; label: string }[];
  value?: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  // By the World Series the list of days is long.
  const scrollToChecked = (open: boolean) => {
    if (!open || Platform.OS !== 'web') return;
    requestAnimationFrame(() => document.querySelector('.chip-menu [data-state="checked"]')?.scrollIntoView({ block: 'center' }));
  };
  return (
    <DropdownMenu.Root onOpenChange={scrollToChecked}>
      <DropdownMenu.Trigger className="menu-trigger menu-trigger-chip" aria-label={`Showing ${label}, change ${title}`}>
        <View style={[styles.chip, { backgroundColor: theme.backgroundElement, boxShadow: theme.raised }]}>
          <ThemedText type="smallBold">{label} ▾</ThemedText>
        </View>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="menu-content menu-content-scroll chip-menu" align="start" sideOffset={6} collisionPadding={8}>
        {options.map((o) => (
          <DropdownMenu.CheckboxItem key={o.value} className="menu-item" value={o.value === value ? 'on' : 'off'} onValueChange={() => onChange(o.value)}>
            <DropdownMenu.ItemTitle>{o.label}</DropdownMenu.ItemTitle>
            <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
          </DropdownMenu.CheckboxItem>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

const BAGS = ['👜', '💼', '🎒', '🛍️', '👝', '🧳'];

/**
 * One bag emoji per total base, each picked at random. Seeded by player, game and position, so a
 * row doesn't reshuffle every time the live scores refresh.
 */
function bagEmojis(tb: number, playerId: number, gamePk: number): string[] {
  return Array.from({ length: tb }, (_, i) => {
    let h = (playerId ^ Math.imul(gamePk, 0x9e3779b1) ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
    return BAGS[((h ^ (h >>> 16)) >>> 0) % BAGS.length];
  });
}

/** How many bags fit in `width`, once a bag's width has been measured. */
function bagsThatFit(width: number, bagWidth: number | null): number {
  return bagWidth ? Math.floor((width + 0.5) / bagWidth) : 0;
}

/**
 * The free space at the end of a line of a player's mini card, filled with bags from the right.
 * Reports its width, so the card can decide how many bags go on each line. `scroll` lets a
 * row that doesn't fit scroll sideways.
 */
function BagRoom({
  bags,
  minWidth,
  scroll,
  label,
  onWidth,
}: {
  bags: string;
  minWidth?: number;
  scroll?: boolean;
  label?: string;
  onWidth: (width: number) => void;
}) {
  const text = (
    <ThemedText
      type="small"
      numberOfLines={1}
      style={styles.bagText}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? 'auto' : 'no-hide-descendants'}>
      {bags}
    </ThemedText>
  );
  return (
    <View style={[styles.bagRoom, { minWidth }]} onLayout={(e) => onWidth(e.nativeEvent.layout.width)}>
      {scroll ? (
        <ScrollView horizontal showsHorizontalScrollIndicator style={styles.fill} contentContainerStyle={styles.bagScroll}>
          {text}
        </ScrollView>
      ) : (
        bags ? text : null
      )}
    </View>
  );
}

/**
 * A rostered player in a game: name, then owner, with a bag per TB in the space left on both
 * lines. Bags fill the owner line first, then beside the name; only past that does the owner
 * line scroll sideways.
 */
function BaggerCard({
  data,
  playerId,
  team,
  tb,
  gamePk,
  bagWidth,
}: {
  data: SeasonData;
  playerId: number;
  team: SeasonData['teams'][number];
  tb: number | null;
  gamePk: number;
  bagWidth: number | null;
}) {
  const theme = useTheme();
  const compact = useLayout() === 'compact';
  const [nameRoom, setNameRoom] = useState(0);
  const [ownerRoom, setOwnerRoom] = useState(0);
  const mine = team.id === data.myTeam?.id;
  const owner = ownerName(data, team);
  const bags = tb ? bagEmojis(tb, playerId, gamePk) : [];
  // Beside the name: only what the owner line can't hold.
  const high = Math.max(0, Math.min(bagsThatFit(nameRoom, bagWidth), bags.length - bagsThatFit(ownerRoom, bagWidth)));
  const low = bags.slice(high);
  return (
    <View style={[styles.playerCard, { backgroundColor: mine ? theme.mine : theme.background }]}>
      <View style={styles.playerLine}>
        <PlayerName playerId={playerId} type="smallBold" numberOfLines={1} style={styles.playerName}>
          {data.players.get(playerId)?.full_name ?? `Player ${playerId}`}
        </PlayerName>
        <BagRoom bags={bags.slice(0, high).join('')} onWidth={setNameRoom} />
      </View>
      <View style={[styles.playerLine, styles.playerSecondLine]}>
        {/*
          Like Standings: team and owner, or a YOU tag on my own players (already tinted).
          Phones only have room for the owner's name.
        */}
        <View style={styles.ownerLine}>
          {mine ? (
            <YouTag />
          ) : (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.owner}>
              {compact ? (owner ?? teamName(team)) : `${teamName(team)}${owner ? ` · ${owner}` : ''}`}
            </ThemedText>
          )}
        </View>
        {tb !== null && (
          <BagRoom
            bags={tb === 0 ? '–' : low.join('')}
            // A long team or owner name gives way to the first few bags.
            minWidth={Math.min(low.length, 4) * (bagWidth ?? 0)}
            scroll={low.length > bagsThatFit(ownerRoom, bagWidth)}
            label={`${tb} total bases`}
            onWidth={setOwnerRoom}
          />
        )}
      </View>
    </View>
  );
}

/** "Wild Card · Game 2", or "Division Series · Game 3". */
function seriesLabel(game: GameInfo): string {
  const series = SERIES.find((s) => s.gameType === game.gameType);
  return `${series?.name ?? ''} · Game ${game.seriesGameNumber}`;
}

function statusLine(game: GameInfo): string {
  if (game.status === 'Preview' && game.detailedState !== 'Postponed') {
    if (game.startTimeTbd) return 'Time TBD';
    // Eastern and Pacific, like a TV listing.
    const at = (timeZone: string) =>
      new Date(game.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
    return `${at('America/New_York')} ET · ${at('America/Los_Angeles')} PT`;
  }
  // "F/10" for extra innings (or a shortened game), like a box score.
  if (game.status === 'Final' && game.detailedState === 'Final' && game.live && game.live.inning !== 9) {
    return `F/${game.live.inning}`;
  }
  return game.detailedState ?? game.status;
}

/** "▲7", "▼7", "Mid 7", "End 7". */
function inningLabel(live: LiveState): string {
  if (live.inningState === 'Top') return `▲${live.inning}`;
  if (live.inningState === 'Bottom') return `▼${live.inning}`;
  return `${live.inningState === 'Middle' ? 'Mid' : 'End'} ${live.inning}`;
}

/** Runners on base as a little diamond: filled squares for occupied bases. */
function Diamond({ bases }: { bases: [boolean, boolean, boolean] }) {
  const theme = useTheme();
  const base = (on: boolean, position: object) => (
    <View
      style={[
        styles.base,
        position,
        on ? { backgroundColor: theme.text, borderColor: theme.text } : { borderColor: theme.textSecondary },
      ]}
    />
  );
  return (
    <View style={styles.diamond} accessibilityLabel={`Runners: ${['first', 'second', 'third'].filter((_, i) => bases[i]).join(', ') || 'none'}`}>
      {base(bases[1], styles.second)}
      {base(bases[2], styles.third)}
      {base(bases[0], styles.first)}
    </View>
  );
}

/** Top right of a live game: inning, runners, count and outs. */
function LiveStatus({ live }: { live: LiveState }) {
  const theme = useTheme();
  const between = live.inningState === 'Middle' || live.inningState === 'End';
  return (
    <View style={styles.liveStatus}>
      <ThemedText type="smallBold" style={{ color: theme.danger }}>{inningLabel(live)}</ThemedText>
      {!between && (
        <>
          <Diamond bases={live.bases} />
          <ThemedText type="small" style={styles.count}>{`${live.balls}-${live.strikes}`}</ThemedText>
          <View style={styles.outs} accessibilityLabel={`${live.outs} out`}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.out, { borderColor: theme.textSecondary }, i < live.outs && { backgroundColor: theme.textSecondary }]} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

/** Who owned the player when the game started (or owns him now, before it starts). */
function ownerOf(data: SeasonData, playerId: number, game: GameInfo): string | undefined {
  const t = Date.parse(game.start);
  const started = game.status !== 'Preview';
  return data.spells.find(
    (s) =>
      s.mlb_player_id === playerId &&
      (started ? Date.parse(s.from_at) <= t && (s.to_at === null || t < Date.parse(s.to_at)) : s.to_at === null),
  )?.fantasy_team_id;
}

/** "1-3 HR BB": hits-at bats, then the extra-base hits and walks. Empty before a first time up. */
function lineScore(line: BattingLine | undefined): string {
  if (!line) return '';
  const times = (n: number, label: string) => (n === 0 ? [] : [n === 1 ? label : `${n}${label}`]);
  return [`${line.h}-${line.ab}`, ...times(line.hr, 'HR'), ...times(line.triples, '3B'), ...times(line.doubles, '2B'), ...times(line.bb, 'BB')].join(' ');
}

/** `fill` stretches the card to the height of its row (desktop). */
function GameCard({ data, scores, game, fill }: { data: SeasonData; scores: Scores; game: GameInfo; fill?: boolean }) {
  if (game.status === 'Final') return <FinalCard data={data} scores={scores} game={game} fill={fill} />;
  return <OpenCard data={data} scores={scores} game={game} fill={fill} />;
}

/** A finished game: the final score on one line, then how the baggers did. */
function FinalCard({ data, scores, game, fill }: { data: SeasonData; scores: Scores; game: GameInfo; fill?: boolean }) {
  const theme = useTheme();
  const side = (which: 'away' | 'home') => {
    const teamId = which === 'away' ? game.awayTeamId : game.homeTeamId;
    const score = which === 'away' ? game.awayScore : game.homeScore;
    const other = which === 'away' ? game.homeScore : game.awayScore;
    const won = score !== null && other !== null && score > other;
    const color = { color: won ? theme.text : theme.textSecondary };
    return (
      <View style={styles.finalSide}>
        <ThemedText style={[styles.finalAbbr, color]}>{data.mlbTeams.get(teamId)?.abbreviation ?? '—'}</ThemedText>
        <ThemedText style={[styles.finalScore, color, won && styles.bold]}>{score ?? ''}</ThemedText>
      </View>
    );
  };
  return (
    <Card style={fill && styles.fill}>
      <View style={styles.cardHead}>
        <ThemedText type="small" themeColor="textSecondary">{seriesLabel(game)}</ThemedText>
        <ThemedText type="smallBold" themeColor="textSecondary">{statusLine(game)}</ThemedText>
      </View>
      <View style={styles.finalScores}>
        {side('away')}
        <ThemedText themeColor="textSecondary">–</ThemedText>
        {side('home')}
      </View>
      <Baggers data={data} scores={scores} game={game} />
    </Card>
  );
}

/**
 * A live game gets a spinning rainbow ring (global.css) so it stands out from the rest. Web only
 * for now; an iOS app would draw it natively.
 */
function LiveGlow({ live, fill, children }: { live: boolean; fill?: boolean; children: ReactNode }) {
  if (!live) return children;
  // dataSet isn't in React Native's types; react-native-web turns it into data-* attributes.
  return <View style={fill && styles.fill} {...({ dataSet: { liveGlow: '' } } as object)}>{children}</View>;
}

/** A game that's on or still to come: who's up, the score, and the baggers so far. */
function OpenCard({ data, scores, game, fill }: { data: SeasonData; scores: Scores; game: GameInfo; fill?: boolean }) {
  const theme = useTheme();
  const live = game.status === 'Live';
  // Who's on a fantasy roster now, for highlighting them in the due-up lines.
  const currentOwner = new Map(data.spells.filter((s) => s.to_at === null).map((s) => [s.mlb_player_id, s.fantasy_team_id]));
  const lines = new Map(scores.lines.filter((l) => l.gamePk === game.gamePk).map((l) => [l.playerId, l]));
  /**
   * A small card per team listing who's up, one name per line: the batting team's batter, on
   * deck and in the hole (tinted blue), and the fielding team's next three (plain).
   */
  const upNext = (which: 'away' | 'home') => {
    const state = game.live;
    if (!live || !state) return null;
    const batting = state.battingSide === which;
    const up = batting ? state.batting : state.dueUp;
    const labels = batting ? ['AB', 'OD', 'IH'] : ['1', '2', '3'];
    const abbr = data.mlbTeams.get(which === 'away' ? game.awayTeamId : game.homeTeamId)?.abbreviation ?? '';
    return (
      <View style={[styles.upCard, { backgroundColor: batting ? theme.tint : theme.background }]}>
        <ThemedText type="smallBold" style={[styles.upHead, { color: batting ? theme.accent : theme.textSecondary }]}>
          {abbr} {batting ? 'at bat' : 'due up'}
        </ThemedText>
        {up.map((p, i) => {
          const owner = p ? currentOwner.get(p.id) : undefined;
          const mine = owner !== undefined && owner === data.myTeam?.id;
          return (
            <View key={i} style={styles.upRow}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.upLabel}>{labels[i]}</ThemedText>
              <ThemedText
                type={owner ? 'smallBold' : 'small'}
                numberOfLines={1}
                style={[styles.upName, mine && [styles.upMine, { backgroundColor: theme.mine }]]}>
                {p ? p.name.split(' ').slice(1).join(' ') || p.name : '—'}
              </ThemedText>
              {p && <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.upLine}>{lineScore(lines.get(p.id))}</ThemedText>}
            </View>
          );
        })}
      </View>
    );
  };
  const side = (which: 'away' | 'home') => {
    const teamId = which === 'away' ? game.awayTeamId : game.homeTeamId;
    const score = which === 'away' ? game.awayScore : game.homeScore;
    const other = which === 'away' ? game.homeScore : game.awayScore;
    const leading = game.status !== 'Preview' && score !== null && other !== null && score > other;
    return (
      <View style={styles.scoreRow}>
        <ThemedText type="default" style={[styles.teamAbbr, leading && styles.bold]}>
          {data.mlbTeams.get(teamId)?.abbreviation ?? '—'}
        </ThemedText>
        <ThemedText type="default" style={[styles.score, leading && styles.bold]}>
          {game.status === 'Preview' ? '' : (score ?? '')}
        </ThemedText>
      </View>
    );
  };

  return (
    <LiveGlow live={live} fill={fill}>
      <Card style={fill && styles.fill}>
        <View style={styles.cardHead}>
          <ThemedText type="small" themeColor="textSecondary">{seriesLabel(game)}</ThemedText>
          {live && game.live ? (
            <LiveStatus live={game.live} />
          ) : (
            <ThemedText type="smallBold" style={{ color: live ? theme.danger : theme.textSecondary }}>
              {live ? '● ' : ''}
              {statusLine(game)}
            </ThemedText>
          )}
        </View>
        <View style={styles.teams}>
          <View style={styles.upCards}>
            {upNext('away')}
            {upNext('home')}
          </View>
          <View style={styles.scores}>
            {side('away')}
            {side('home')}
          </View>
        </View>
        <Baggers data={data} scores={scores} game={game} />
      </Card>
    </LiveGlow>
  );
}

/** The fantasy-rostered players on either team, as mini cards with their bags, most TB first. */
function Baggers({ data, scores, game }: { data: SeasonData; scores: Scores; game: GameInfo }) {
  const theme = useTheme();
  const [bagWidth, setBagWidth] = useState<number | null>(null);
  // Fantasy-rostered players on either team, with their TB in this game.
  const tb = new Map(scores.stats.filter((s) => s.gamePk === game.gamePk).map((s) => [s.playerId, s.tb]));
  const playerIds = [...new Set(data.spells.map((s) => s.mlb_player_id))];
  const players = playerIds
    .filter((id) => {
      const mlb = data.poolByPlayer.get(id)?.mlb_team_id;
      return mlb === game.homeTeamId || mlb === game.awayTeamId;
    })
    .flatMap((id) => {
      const owner = ownerOf(data, id, game);
      const team = owner ? data.teams.find((t) => t.id === owner) : undefined;
      return team ? [{ id, team, tb: tb.get(id) ?? (game.status === 'Preview' ? null : 0) }] : [];
    })
    .sort((a, b) => (b.tb ?? -1) - (a.tb ?? -1));

  if (players.length === 0) return null;
  return (
    <View style={[styles.players, { borderTopColor: theme.border }]}>
      {/* Every bag once, out of sight, to measure how wide one is. */}
      <ThemedText
        type="small"
        numberOfLines={1}
        style={[styles.bagText, styles.measure]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={(e) => setBagWidth(e.nativeEvent.layout.width / BAGS.length)}>
        {BAGS.join('')}
      </ThemedText>
      {players.map((p) => (
        <BaggerCard key={p.id} data={data} playerId={p.id} team={p.team} tb={p.tb} gamePk={game.gamePk} bagWidth={bagWidth} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.two + 4, paddingVertical: Spacing.one + 2, borderRadius: Radius.md },
  column: { gap: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three },
  cell: { flex: 1, minWidth: 0 },
  fill: { flexGrow: 1 },
  finalScores: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  finalSide: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  finalAbbr: { fontSize: 17, lineHeight: 24, fontWeight: 600 },
  finalScore: { fontSize: 22, lineHeight: 28, fontWeight: 600, fontVariant: ['tabular-nums'] },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  // Who's up (two small cards) on the left, the scores on the right.
  teams: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  upCards: { flex: 1, minWidth: 0, flexDirection: 'row', gap: Spacing.one + 2 },
  upCard: { flex: 1, minWidth: 0, borderRadius: Radius.md, paddingVertical: Spacing.one, paddingHorizontal: Spacing.one + 2 },
  upHead: { fontSize: 9, lineHeight: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  upLabel: { width: 14, fontSize: 9, lineHeight: 14 },
  // The name keeps its width; the line score after it gets cut off first.
  upName: { flexShrink: 0, maxWidth: '75%', fontSize: 11, lineHeight: 14 },
  upLine: { marginLeft: 2, flexShrink: 1, minWidth: 0, fontSize: 10, lineHeight: 14, fontVariant: ['tabular-nums'] },
  upMine: { paddingHorizontal: 3, borderRadius: 3, overflow: 'hidden' },
  scores: { marginLeft: 'auto', gap: Spacing.half },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 28 },
  teamAbbr: { width: 40, fontWeight: 600, textAlign: 'right' },
  score: { width: 28, textAlign: 'right', fontSize: 20, lineHeight: 26, fontVariant: ['tabular-nums'], fontWeight: 600 },
  liveStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  diamond: { width: 26, height: 19 },
  base: { position: 'absolute', width: 7, height: 7, borderWidth: 1.5, transform: [{ rotate: '45deg' }] },
  second: { left: 9.5, top: 1.5 },
  third: { left: 2, top: 9 },
  first: { left: 17, top: 9 },
  count: { fontVariant: ['tabular-nums'] },
  outs: { flexDirection: 'row', gap: 3 },
  out: { width: 6, height: 6, borderRadius: 3, borderWidth: 1 },
  bold: { fontWeight: 800 },
  // Two columns of mini cards.
  players: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two + 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: Spacing.one + 2,
  },
  // Name on top; fantasy team and bags below, so the name gets the full width.
  playerCard: {
    width: '49%',
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.md,
  },
  playerLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  playerSecondLine: { minHeight: 18 },
  playerName: { fontSize: 13, lineHeight: 17 },
  ownerLine: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  owner: { flexShrink: 1, minWidth: 0, fontSize: 11, lineHeight: 14 },
  // The rest of a line, bags pushed to its right end.
  bagRoom: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', overflow: 'hidden' },
  bagScroll: { flexGrow: 1, justifyContent: 'flex-end' },
  bagText: { lineHeight: 17 },
  measure: { position: 'absolute', opacity: 0 },
});
