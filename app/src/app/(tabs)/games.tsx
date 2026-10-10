import { type ReactNode, useRef, useState } from 'react';
import { type LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';

import { BAG_EMOJI, hitBags } from '@core/bag-celebration.ts';
import { neededGames, postseasonSeries, recordBefore, seriesOf, seriesSummary } from '@core/schedule.ts';
import type { PitcherStats } from '@core/box-score.ts';
import type { LastPlay } from '@core/live.ts';
import { SERIES } from '@core/scoreboard.ts';
import type { GameType } from '@core/types.ts';

import { type Bagger, HitterRow, UpTag } from '@/components/at-bat';
import { BoxScoreSheet } from '@/components/box-score';
import { Card } from '@/components/card';
import { DayCalendar } from '@/components/day-calendar';
import { HitVideosSheet } from '@/components/hit-videos';
import { LiveStatus } from '@/components/live-status';
import { Loader } from '@/components/loader';
import { YouTag } from '@/components/owner-badge';
import { PlayerName } from '@/components/player-name';
import { PostseasonView, RoundView } from '@/components/schedule';
import { Screen } from '@/components/screen';
import { TeamTile } from '@/components/team-tile';
import { TeamPopup } from '@/components/team-popup';
import { ThemedText } from '@/components/themed-text';
import { Toggle } from '@/components/toggle';
import { Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { dayLabel, gameDay, useToday } from '@/lib/game-day';
import { lineScore, ownerOf, seriesLabel, shortSeriesLabel, statusLine } from '@/lib/game-labels';
import { type Previews, type Probable, usePreviews } from '@/lib/previews';
import { type BattingLine, type GameInfo, type ScoreHit, type Scores, useScores } from '@/lib/scores';
import { type SeasonData, useSeason } from '@/lib/season';
import { ownerName, teamName } from '@/lib/teams';
import { zoom, zoomFixed, zoomKey, zoomView } from '@/lib/zoom';

const STATUS_ORDER: Record<string, number> = { Live: 0, Preview: 1, Final: 2 };

/** Live games first, then the ones still to come, then the finished ones; by start time within each. */
function byStatusThenStart(a: GameInfo, b: GameInfo): number {
  const status = (g: GameInfo) => STATUS_ORDER[g.status] ?? 1;
  return status(a) - status(b) || a.start.localeCompare(b.start);
}

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
  const { scores } = useScores();
  const wide = useLayout() === 'wide';
  const today = useToday();
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedRound, setPickedRound] = useState<GameType | null>(null);
  const [view, setView] = useState<Zoom>('day');
  // The game whose box score is open.
  const [boxPk, setBoxPk] = useState<number | null>(null);
  // The MLB team whose popup is open.
  const [teamId, setTeamId] = useState<number | null>(null);
  // Ballparks and announced starters of the games still to come, for their cards.
  const previews = usePreviews(scores ? scores.games.filter((g) => g.status === 'Preview').map((g) => g.gamePk) : []);

  if (loading || (data && !scores)) {
    return <Screen width="wide"><Loader /></Screen>;
  }
  if (!data || !scores) return <Screen width="wide"><ThemedText>No season set up yet.</ThemedText></Screen>;

  // The Day view leaves out games a decided series no longer needs (Round and Postseason show them as —).
  const listed = neededGames(scores.games);
  const days = [...new Set(listed.map(gameDay))].sort();
  const day = picked && days.includes(picked) ? picked : defaultDay(days, today);
  const games = listed.filter((g) => day && gameDay(g) === day).sort(byStatusThenStart);

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
  // From the live scores, so an open box score follows the game.
  const boxGame = boxPk === null ? undefined : scores.games.find((g) => g.gamePk === boxPk);

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
                  const n = listed.filter((g) => gameDay(g) === d).length;
                  return { value: d, label: `${dayLabel(d, today)} · ${n} ${n === 1 ? 'game' : 'games'}` };
                })}
                value={day}
                onChange={showDay}
                stepper={days.map((d) => dayLabel(d, today))}
                calendar={{ counts: new Map(days.map((d) => [d, listed.filter((g) => gameDay(g) === d).length])), today }}
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
          {/*
            All three views stay mounted and only the one on show is displayed, so a zoom doesn't
            rebuild the day's cards (and re-measure their bags) while it animates.
          */}
          <View {...zoomView()}>
            <View style={[styles.column, view !== 'day' && styles.hidden]}>
              {wide
                ? // Rows of two that fill the width; both cards in a row are as tall as the taller one.
                  games
                    .filter((_, i) => i % 2 === 0)
                    .map((g, row) => (
                      <View key={g.gamePk} style={styles.row}>
                        {games.slice(row * 2, row * 2 + 2).map((game) => (
                          <View key={game.gamePk} style={styles.cell} {...zoomKey(`game-${game.gamePk}`)}>
                            <GameCard data={data} scores={scores} previews={previews} game={game} onOpen={() => setBoxPk(game.gamePk)} onTeam={setTeamId} fill />
                          </View>
                        ))}
                        {row * 2 + 1 >= games.length && <View style={styles.cell} />}
                      </View>
                    ))
                : games.map((g) => (
                    <View key={g.gamePk} {...zoomKey(`game-${g.gamePk}`)}>
                      <GameCard data={data} scores={scores} previews={previews} game={g} onOpen={() => setBoxPk(g.gamePk)} onTeam={setTeamId} />
                    </View>
                  ))}
            </View>
            <View style={view !== 'round' && styles.hidden}>
              <RoundView series={series.filter((s) => s.gameType === round)} {...scheduleProps} />
            </View>
            <View style={view !== 'postseason' && styles.hidden}>
              <PostseasonView series={series} {...scheduleProps} />
            </View>
          </View>
        </>
      )}
      {boxGame && <BoxScoreSheet key={boxGame.gamePk} data={data} game={boxGame} onClose={() => setBoxPk(null)} onOpenGame={setBoxPk} />}
      {teamId !== null && <TeamPopup data={data} scores={scores} mlbTeamId={teamId} onClose={() => setTeamId(null)} onOpenGame={setBoxPk} />}
    </Screen>
  );
}

/**
 * The current choice as a chip, opening a menu of them all (on web, scrolled to the current one).
 * `stepper` adds arrows inside the chip to step to the previous or next choice. The chip is as wide
 * as the longest label it can show, so the arrows never move; at either end an arrow is hidden but
 * keeps its place. `calendar` (the day chip) opens a calendar of the days instead of the menu.
 */
function MenuChip<T extends string>({
  label,
  title,
  options,
  value,
  onChange,
  stepper,
  calendar,
}: {
  label: string;
  /** What's being picked, for screen readers: "day". */
  title: string;
  options: { value: T; label: string }[];
  value?: T;
  onChange: (value: T) => void;
  /** Every label the chip can show, to size it to the longest. */
  stepper?: string[];
  /** Games on each day, and today, for a calendar in place of the menu. */
  calendar?: { counts: Map<string, number>; today: string };
}) {
  const theme = useTheme();
  const chipRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; height: number } | null>(null);
  const openCalendar = () => chipRef.current?.measureInWindow((x, y, _w, height) => setAnchor({ x, y, height }));
  // By the World Series the list of days is long.
  const scrollToChecked = (open: boolean) => {
    if (!open || Platform.OS !== 'web') return;
    requestAnimationFrame(() => document.querySelector('.chip-menu [data-state="checked"]')?.scrollIntoView({ block: 'center' }));
  };
  const surface = { backgroundColor: theme.backgroundElement, boxShadow: theme.raised };
  const i = options.findIndex((o) => o.value === value);
  const prev = stepper && i > 0 ? options[i - 1] : undefined;
  const next = stepper && i >= 0 && i < options.length - 1 ? options[i + 1] : undefined;
  const arrow = (to: T, glyph: string, name: string, side: ViewStyle) => (
    <Pressable onPress={() => onChange(to)} accessibilityRole="button" aria-label={`${name} ${title}`} style={[styles.step, { borderColor: theme.border }, side]}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.stepGlyph}>
        {glyph}
      </ThemedText>
    </Pressable>
  );
  const menu = (
    <DropdownMenu.Root onOpenChange={scrollToChecked}>
      <DropdownMenu.Trigger className="menu-trigger menu-trigger-chip" aria-label={`Showing ${label}, change ${title}`}>
        <View style={[styles.chip, !stepper && surface, stepper && styles.chipInStepper]}>
          <ThemedText type="smallBold">{stepper ? label : `${label} ▾`}</ThemedText>
          {/* Every label, invisible and flat: they set the width but take no height. */}
          {stepper &&
            [...new Set(stepper)].map((l) => (
              <ThemedText key={l} type="smallBold" aria-hidden style={styles.sizer}>
                {l}
              </ThemedText>
            ))}
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
  const chipBody = (
    <View style={[styles.chip, styles.chipInStepper]}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {stepper &&
        [...new Set(stepper)].map((l) => (
          <ThemedText key={l} type="smallBold" aria-hidden style={styles.sizer}>
            {l}
          </ThemedText>
        ))}
    </View>
  );
  const picker = calendar ? (
    <>
      <Pressable ref={chipRef} onPress={openCalendar} accessibilityRole="button" aria-label={`Showing ${label}, change ${title}`}>
        {chipBody}
      </Pressable>
      <DayCalendar
        open={anchor !== null}
        anchor={anchor}
        days={options.map((o) => o.value)}
        counts={calendar.counts}
        value={value}
        today={calendar.today}
        onPick={(d) => onChange(d as T)}
        onClose={() => setAnchor(null)}
      />
    </>
  ) : (
    menu
  );
  if (!stepper) return menu;
  return (
    <View style={[styles.stepper, surface]}>
      {/* A missing arrow leaves its space empty, so the date doesn't slide over. */}
      {prev ? arrow(prev.value, '‹', 'Previous', styles.stepPrev) : <View style={styles.step} />}
      {picker}
      {next ? arrow(next.value, '›', 'Next', styles.stepNext) : <View style={styles.step} />}
    </View>
  );
}

/** How many bags fit in `width`, once a bag's width has been measured. */
function bagsThatFit(width: number, bagWidth: number | null): number {
  return bagWidth ? Math.floor((width + 0.5) / bagWidth) : 0;
}

/** A bag's width, once any card has measured it: a day's cards mount with it already known. */
let measuredBagWidth: number | null = null;

function rememberBagWidth(width: number): number {
  measuredBagWidth = width;
  return width;
}

/**
 * An onLayout that passes on the width, except while the view it's in is hidden (the Day view
 * behind the Round view, say), when everything in it measures 0 × 0: keeping the last width
 * means nothing re-renders then, or again once it's back on show.
 */
function onShownWidth(onWidth: (width: number) => void) {
  return (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 || height > 0) onWidth(width);
  };
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
    <View style={[styles.bagRoom, { minWidth }]} onLayout={onShownWidth(onWidth)}>
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
  hits,
  line,
  gamePk,
  gameLabel,
  bagWidth,
}: {
  data: SeasonData;
  playerId: number;
  team: SeasonData['teams'][number];
  tb: number | null;
  /** His hits in the game, in order: each one's bags are drawn alike (core hitBags). */
  hits: ScoreHit[];
  /** His batting line in the game, for hits no play is matched to yet. */
  line: BattingLine | null;
  gamePk: number;
  /** "World Series · Game 3", for the videos sheet. */
  gameLabel: string;
  bagWidth: number | null;
}) {
  const theme = useTheme();
  const [videos, setVideos] = useState(false);
  const name = data.players.get(playerId)?.full_name ?? `Player ${playerId}`;
  const compact = useLayout() === 'compact';
  const [nameRoom, setNameRoom] = useState(0);
  const [ownerRoom, setOwnerRoom] = useState(0);
  const mine = team.id === data.myTeam?.id;
  const owner = ownerName(data, team);
  const bags = tb ? hitBags(tb, hits.map((h) => h.event), playerId, gamePk, line) : [];
  // ▶ only once there's a video to watch: MLB's clip (most home runs, within minutes) or Savant's.
  const hasVideo = !!tb && hits.some((h) => h.hasVideo);
  // Beside the name: only what the owner line can't hold.
  const high = Math.max(0, Math.min(bagsThatFit(nameRoom, bagWidth), bags.length - bagsThatFit(ownerRoom, bagWidth)));
  const low = bags.slice(high);
  return (
    <>
      {videos && <HitVideosSheet gamePk={gamePk} playerId={playerId} title={`${name} · ${gameLabel}`} onClose={() => setVideos(false)} />}
      {/* Yours are dark green. Other managers' stay plain: the owner line already says whose. */}
      <HitterRow bagger={mine ? 'mine' : null} style={[styles.playerCard, { backgroundColor: theme.background }]}>
        <View style={styles.playerLine}>
          <PlayerName playerId={playerId} type="smallBold" numberOfLines={1} style={styles.playerName}>
            {name}
          </PlayerName>
          <BagRoom bags={bags.slice(0, high).join('')} onWidth={setNameRoom} />
          {hasVideo && (
            <Pressable onPress={() => setVideos(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Videos of ${name}'s hits`}>
              <ThemedText type="smallBold" themeColor="playButton">{'\u25B6\uFE0E'}</ThemedText>
            </Pressable>
          )}
        </View>
        <View style={[styles.playerLine, styles.playerSecondLine]}>
          {/*
            Like Standings: team and owner, or a YOU tag on my own players (already green).
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
      </HitterRow>
    </>
  );
}

interface CardProps {
  data: SeasonData;
  scores: Scores;
  game: GameInfo;
  /** Ballparks and announced starters of games to come. */
  previews: Previews;
  /** Opens the game's box score. */
  onOpen: () => void;
  /** Opens an MLB team's popup, from its abbreviation. */
  onTeam: (mlbTeamId: number) => void;
  /** Stretches the card to the height of its row (desktop). */
  fill?: boolean;
}

/**
 * Tapping anywhere on a game opens its box score, except on a team's abbreviation (its popup), a
 * player's name (his popup) or ▶ (his videos), which handle their own taps.
 */
function GameCard(props: CardProps) {
  return (
    <Pressable
      onPress={props.onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${seriesLabel(props.game)}, box score`}
      style={props.fill && styles.fill}>
      {props.game.status === 'Final' ? <FinalCard {...props} /> : <OpenCard {...props} />}
    </Pressable>
  );
}

/** A team's tile on a card (its colors and abbreviation): tapping it opens the team's popup. */
function TeamAbbr({ teamId, abbr, onTeam, faded }: { teamId: number; abbr: string; onTeam: (mlbTeamId: number) => void; faded?: boolean }) {
  return (
    <Pressable onPress={() => onTeam(teamId)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${abbr} team stats`}>
      <TeamTile mlbTeamId={teamId} abbr={abbr} faded={faded} />
    </Pressable>
  );
}

/** A finished game: the final score on one line, then how the baggers did. */
function FinalCard({ data, scores, game, fill, onTeam }: CardProps) {
  const theme = useTheme();
  const compact = useLayout() === 'compact';
  const side = (which: 'away' | 'home') => {
    const teamId = which === 'away' ? game.awayTeamId : game.homeTeamId;
    const score = which === 'away' ? game.awayScore : game.homeScore;
    const other = which === 'away' ? game.homeScore : game.awayScore;
    const won = score !== null && other !== null && score > other;
    const color = { color: won ? theme.text : theme.textSecondary };
    return (
      <View style={styles.finalSide}>
        <TeamAbbr teamId={teamId} abbr={data.mlbTeams.get(teamId)?.abbreviation ?? '—'} onTeam={onTeam} faded={score !== null && other !== null && !won} />
        <ThemedText style={[styles.finalScore, color, won && styles.bold]}>{score ?? ''}</ThemedText>
      </View>
    );
  };
  return (
    <Card style={[fill && styles.fill, compact && styles.cardCompact]}>
      <View style={styles.cardHead}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.headLabel}>{seriesLabel(game)}</ThemedText>
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
  return (
    <View style={fill && styles.fill} {...({ dataSet: { liveGlow: '' } } as object)}>
      {/* The spinning rainbow, behind the card; the ring is the edge of it the card doesn't cover. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} {...({ dataSet: { liveRing: '' } } as object)} />
      {children}
    </View>
  );
}

/** A game that's on or still to come: who's up, the score, and the baggers so far. */
function OpenCard({ data, scores, previews, game, fill, onTeam }: CardProps) {
  const theme = useTheme();
  const compact = useLayout() === 'compact';
  const live = game.status === 'Live';
  const bagger = (playerId: number): Bagger => {
    const owner = ownerOf(data, playerId, game);
    return owner ? (owner === data.myTeam?.id ? 'mine' : 'other') : null;
  };
  const lines = new Map(scores.lines.filter((l) => l.gamePk === game.gamePk).map((l) => [l.playerId, l]));
  /**
   * A small card per team listing who's up, one name per line: the batting team's batter, on
   * deck and in the hole (its card outlined in blue), and the fielding team's next three. Each
   * shows his spot in the batting order (blank until the box score has him), except the batter,
   * who gets the red AB tag the box score uses. Your
   * hitters are dark green and other managers' dark blue, like the box score; the one at bat, if
   * drafted, gets a pulsing ring.
   */
  const upNext = (which: 'away' | 'home') => {
    const state = game.live;
    if (!live || !state) return null;
    const batting = state.battingSide === which;
    const up = batting ? state.batting : state.dueUp;
    const abbr = data.mlbTeams.get(which === 'away' ? game.awayTeamId : game.homeTeamId)?.abbreviation ?? '';
    return (
      <View
        style={[
          styles.upCard,
          batting ? [styles.upCardBatting, { borderColor: theme.otherRing }] : { backgroundColor: theme.background },
        ]}>
        <ThemedText type="smallBold" style={[styles.upHead, { color: batting ? theme.accent : theme.textSecondary }]}>
          {abbr} {batting ? 'at bat' : 'due up'}
        </ThemedText>
        {up.map((p, i) => {
          const whose = p ? bagger(p.id) : null;
          return (
            <HitterRow key={i} bagger={whose} atBat={batting && i === 0} style={[styles.upRow, styles.upRowFill]}>
              <View style={[styles.upLabel, batting && styles.upLabelWide]}>
                {batting && i === 0 ? (
                  <UpTag />
                ) : (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.upSpot}>
                    {(p && lines.get(p.id)?.spot) ?? ''}
                  </ThemedText>
                )}
              </View>
              <ThemedText type={whose ? 'smallBold' : 'small'} numberOfLines={1} style={styles.upName}>
                {p ? p.name.split(' ').slice(1).join(' ') || p.name : '—'}
              </ThemedText>
              {p && <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.upLine}>{lineScore(lines.get(p.id))}</ThemedText>}
            </HitterRow>
          );
        })}
      </View>
    );
  };
  // Live, the header says who leads the series going in (before first pitch, each team's record
  // is by its tile instead); phones shorten the series' name to make room for it.
  const series = live && game.seriesGameNumber > 1 ? seriesOf(scores.games, game) : undefined;
  const record = series && series.wins.some((w) => w > 0) ? seriesSummary(series, (id) => data.mlbTeams.get(id)?.abbreviation ?? '—') : null;
  const sides = (['away', 'home'] as const).map((which) => {
    const teamId = which === 'away' ? game.awayTeamId : game.homeTeamId;
    const score = which === 'away' ? game.awayScore : game.homeScore;
    const other = which === 'away' ? game.homeScore : game.awayScore;
    const leading = game.status !== 'Preview' && score !== null && other !== null && score > other;
    return { which, teamId, abbr: data.mlbTeams.get(teamId)?.abbreviation ?? '—', score: game.status === 'Preview' ? '' : (score ?? ''), leading };
  });

  return (
    <LiveGlow live={live} fill={fill}>
      <Card style={[fill && styles.fill, compact && styles.cardCompact]}>
        <View style={styles.cardHead}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.headLabel}>
            {record && compact ? shortSeriesLabel(game) : seriesLabel(game)}
            {record && (
              <>
                {' · '}
                <ThemedText type="smallBold">{record}</ThemedText>
              </>
            )}
          </ThemedText>
          {live && game.live ? (
            <LiveStatus live={game.live} />
          ) : (
            <ThemedText type="smallBold" style={{ color: live ? theme.danger : theme.textSecondary }}>
              {live ? '● ' : ''}
              {statusLine(game)}
            </ThemedText>
          )}
        </View>
        {game.status === 'Preview' && previews.venues.has(game.gamePk) && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.venue}>
            {previews.venues.get(game.gamePk)}
          </ThemedText>
        )}
        {live && game.live?.lastPlay && <LastPlayLine play={game.live.lastPlay} whose={bagger(game.live.lastPlay.batterId)} />}
        {game.status === 'Preview' ? (
          <Matchup game={game} sides={sides} games={scores.games} probables={previews.probables} onTeam={onTeam} />
        ) : (
          <View style={styles.teams}>
            <View style={styles.upCards}>
              {upNext('away')}
              {upNext('home')}
            </View>
            {/* Abbreviations and runs as two columns, each as wide as its widest entry. */}
            <View style={styles.scores}>
              <View style={styles.scoreColumn}>
                {sides.map((t) => (
                  <TeamAbbr key={t.which} teamId={t.teamId} abbr={t.abbr} onTeam={onTeam} />
                ))}
              </View>
              <View style={styles.scoreColumn}>
                {sides.map((t) => (
                  <ThemedText key={t.which} type="default" style={[styles.score, t.leading && styles.bold]}>{t.score}</ThemedText>
                ))}
              </View>
            </View>
          </View>
        )}
        <Baggers data={data} scores={scores} game={game} />
      </Card>
    </LiveGlow>
  );
}

/**
 * A game still to come, a row per team: its announced starter and his hand ("Max Fried LHP", or
 * "Starter TBD"), with his regular-season ERA and postseason line under it, then its series record
 * going in (from game 2 on) and its tile.
 */
function Matchup({
  game,
  sides,
  games,
  probables,
  onTeam,
}: {
  game: GameInfo;
  sides: { which: 'away' | 'home'; teamId: number; abbr: string }[];
  games: GameInfo[];
  probables: Map<string, Probable>;
  onTeam: (mlbTeamId: number) => void;
}) {
  const record = game.seriesGameNumber > 1 ? recordBefore(games, game) : null;
  return (
    <View style={styles.matchup}>
      {sides.map((t) => {
        const starter = probables.get(`${game.gamePk}:${t.teamId}`);
        const wl = record?.get(t.teamId);
        return (
          <View key={t.which} style={styles.matchupRow}>
            <View style={styles.starter}>
              {starter ? (
                <ThemedText type="small" numberOfLines={1} style={styles.starterName}>
                  {starter.name}
                  {starter.hand && <ThemedText type="small" themeColor="textSecondary" style={styles.starterName}>{` ${starter.hand}HP`}</ThemedText>}
                </ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={styles.starterName}>Starter TBD</ThemedText>
              )}
              {starter?.stats && <PitcherLine stats={starter.stats} />}
            </View>
            {wl && (
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.record} accessibilityLabel={`${t.abbr} ${wl[0]} and ${wl[1]} in the series`}>
                {`${wl[0]}–${wl[1]}`}
              </ThemedText>
            )}
            <TeamAbbr teamId={t.teamId} abbr={t.abbr} onTeam={onTeam} />
          </View>
        );
      })}
    </View>
  );
}

/** "2.49 ERA · Post: 1–0, 0.00, 7.0 IP, 9 K", the ERA in bold; on a narrow card the end gives way (…). */
function PitcherLine({ stats }: { stats: PitcherStats }) {
  const post = stats.post ? `Post: ${stats.post.w}–${stats.post.l}, ${stats.post.era}, ${stats.post.ip} IP, ${stats.post.k} K` : 'Post: first start';
  return (
    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.pitcherLine}>
      {stats.era && (
        <>
          <ThemedText type="smallBold" style={styles.pitcherLine}>{stats.era}</ThemedText>
          {' ERA · '}
        </>
      )}
      {post}
    </ThemedText>
  );
}

/**
 * A live game's last at-bat under its card's header, on one line: "Last play: Judge flyout to CF",
 * the label in bold gray, with the runs that scored on it in red. A drafted batter's name is in his manager's color: green for
 * yours, blue for another manager's (the fills in light mode, the brighter rings in dark, so it
 * reads on the card either way).
 */
function LastPlayLine({ play, whose }: { play: LastPlay; whose: Bagger }) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const nameColor = whose === 'mine' ? (dark ? theme.mineRing : theme.mineFill) : whose === 'other' ? (dark ? theme.otherRing : theme.otherFill) : theme.text;
  return (
    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.lastPlay}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.lastPlayText}>Last play: </ThemedText>
      <ThemedText type="smallBold" style={[styles.lastPlayText, { color: nameColor }]}>{play.batter}</ThemedText>
      {` ${play.play}`}
      {play.runs > 0 && (
        <ThemedText type="smallBold" style={[styles.lastPlayText, { color: theme.danger }]}>{` · ${play.runs} run${play.runs === 1 ? '' : 's'}`}</ThemedText>
      )}
    </ThemedText>
  );
}

/** The fantasy-rostered players on either team, as mini cards with their bags, most TB first. */
function Baggers({ data, scores, game }: { data: SeasonData; scores: Scores; game: GameInfo }) {
  const theme = useTheme();
  const [bagWidth, setBagWidth] = useState<number | null>(measuredBagWidth);
  // Fantasy-rostered players on either team, with their TB in this game.
  const tb = new Map(scores.stats.filter((s) => s.gamePk === game.gamePk).map((s) => [s.playerId, s.tb]));
  const hitsOf = (playerId: number) =>
    (scores.hits ?? [])
      .filter((h) => h.gamePk === game.gamePk && h.playerId === playerId)
      .sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? ''));
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
        onLayout={onShownWidth((width) => setBagWidth(rememberBagWidth(width / BAG_EMOJI.length)))}>
        {BAG_EMOJI.join('')}
      </ThemedText>
      {players.map((p) => (
        <BaggerCard
          key={p.id}
          data={data}
          playerId={p.id}
          team={p.team}
          tb={p.tb}
          hits={hitsOf(p.id)}
          line={scores.lines.find((l) => l.gamePk === game.gamePk && l.playerId === p.id) ?? null}
          gamePk={game.gamePk}
          gameLabel={seriesLabel(game)}
          bagWidth={bagWidth}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.two + 4, paddingVertical: Spacing.one + 2, borderRadius: Radius.md },
  // The day chip with its arrows: one raised surface, split by hairlines.
  stepper: { flexDirection: 'row', alignItems: 'stretch', borderRadius: Radius.md },
  // Kept tight so "Today · 10/10" still fits beside the toggle on a phone.
  chipInStepper: { paddingHorizontal: Spacing.two, alignItems: 'center' },
  sizer: { height: 0, overflow: 'hidden' },
  step: { width: 22, alignItems: 'center', justifyContent: 'center' },
  stepPrev: { borderRightWidth: StyleSheet.hairlineWidth },
  stepNext: { borderLeftWidth: StyleSheet.hairlineWidth },
  stepGlyph: { fontSize: 20, lineHeight: 20 },
  column: { gap: Spacing.three },
  hidden: { display: 'none' },
  row: { flexDirection: 'row', gap: Spacing.three },
  cell: { flex: 1, minWidth: 0 },
  fill: { flexGrow: 1 },
  finalScores: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  finalSide: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  finalScore: { fontSize: 22, lineHeight: 28, fontWeight: 600, fontVariant: ['tabular-nums'] },
  // Phones: a little less padding inside game cards leaves room for the up-next lines.
  cardCompact: { paddingHorizontal: Spacing.two + 2 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  // Who's up (two small cards) on the left, the scores on the right.
  teams: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  upCards: { flex: 1, minWidth: 0, flexDirection: 'row', gap: Spacing.one + 2 },
  upCard: { flex: 1, minWidth: 0, borderRadius: Radius.md, paddingVertical: Spacing.one, paddingHorizontal: Spacing.one + 2 },
  upHead: { fontSize: 9, lineHeight: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // Room for a fill and its ring around the name, lined up with the plain rows.
  upRowFill: { paddingHorizontal: 3, marginHorizontal: -3, borderRadius: Radius.sm },
  // The batting team's card: outlined, no fill, so a filled row always means a bagger.
  upCardBatting: { borderWidth: 1.5 },
  headLabel: { flexShrink: 1, minWidth: 0 },
  // Tucked up under the header.
  lastPlay: { fontSize: 13, lineHeight: 18, marginTop: -Spacing.one },
  lastPlayText: { fontSize: 13, lineHeight: 18 },
  // The batting order spot, or the batter's AB tag (so the batting team's card needs more room).
  upLabel: { width: 7, flexShrink: 0, alignItems: 'center' },
  upLabelWide: { width: 20 },
  upSpot: { fontSize: 9, lineHeight: 14, fontVariant: ['tabular-nums'] },
  // The name keeps its width; the line score after it gets cut off first.
  // Names left, lines right. The line is always shown in full; a long name gives way (…).
  upName: { flexShrink: 1, minWidth: 0, fontSize: 11, lineHeight: 14 },
  upLine: { marginLeft: 'auto', paddingLeft: 4, flexShrink: 0, textAlign: 'right', fontSize: 10, lineHeight: 14, fontVariant: ['tabular-nums'] },
  // A game to come: starter, series record and tile on each team's row.
  matchup: { gap: Spacing.two + 2 },
  matchupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  starter: { flex: 1, minWidth: 0 },
  starterName: { fontSize: 14, lineHeight: 18 },
  pitcherLine: { fontSize: 12, lineHeight: 16, fontVariant: ['tabular-nums'] },
  // Tucked up under the header.
  venue: { fontSize: 12, lineHeight: 16, marginTop: -Spacing.one },
  record: { fontVariant: ['tabular-nums'] },
  scores: { marginLeft: 'auto', flexDirection: 'row', gap: Spacing.two },
  scoreColumn: { alignItems: 'flex-end', gap: Spacing.half },
  score: { minWidth: 24, textAlign: 'right', fontSize: 20, lineHeight: 28, fontVariant: ['tabular-nums'], fontWeight: 600 },
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
