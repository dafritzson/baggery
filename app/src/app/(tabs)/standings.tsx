import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { currentRound, roundStandings } from '@core/scoreboard.ts';
import {
  buildTimeline,
  dayEnd,
  isDayEnd,
  nearestStop,
  nextPlayStop,
  playStops,
  previousStop,
  sameStop,
  scoresAt,
  type Stop,
  stopPosition,
  stopsFor,
  type Zoom,
} from '@core/timeline.ts';
import type { FantasyRound } from '@core/types.ts';

import { CloseRoundCard } from '@/components/close-round-card';
import { Columns } from '@/components/columns';
import { Loader } from '@/components/loader';
import { RoundChips, StandingsTable, TeamScoreboard } from '@/components/scoreboard';
import { SeasonScrubber, roundTeamIds } from '@/components/season-scrubber';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import { type Scores, coreSpells, useScores, useSeasonPlayLines } from '@/lib/scores';
import { type SeasonData, useSeason } from '@/lib/season';
import { teamName } from '@/lib/teams';

/** How long each bag of playback takes, by zoom: a whole season, a round, a day. */
const PLAY_MS: Record<Zoom, number> = { season: 100, round: 140, day: 450 };

/**
 * Fantasy standings: each round's TB by game, and any team's TB by player. Desktops show both
 * side by side; phones switch between them. `?team=<id>` (a player popup's link) picks that team.
 */
export default function StandingsScreen() {
  const { data, loading, refetch } = useSeason();
  const { scores } = useScores();

  if (loading || (data && !scores)) {
    return <Screen width="wide"><Loader /></Screen>;
  }
  if (!data || !scores) return <Screen width="wide"><ThemedText>No season set up yet.</ThemedText></Screen>;
  // A new season starts at its latest standings.
  return <SeasonStandings key={data.season.id} data={data} scores={scores} refetch={refetch} />;
}

function SeasonStandings({ data, scores, refetch }: { data: SeasonData; scores: Scores; refetch: () => void }) {
  const wide = useLayout() === 'wide';
  const theme = useTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<'standings' | 'team'>('standings');
  const { team: linkedTeam } = useLocalSearchParams<{ team?: string }>();
  // A round picked that hasn't started (the scrubber only goes where games have been played).
  const [futureRound, setFutureRound] = useState<FantasyRound | null>(null);
  // Where the scrubber is; null for the latest moment, which keeps up with live games.
  const [stop, setStop] = useState<Stop | null>(null);
  const [zoom, setZoom] = useState<Zoom>('season');
  const [playing, setPlaying] = useState(false);

  // A link to a team picks it, and on phones shows it. The param is then cleared, so the same link
  // works again after picking another team.
  const [seenLink, setSeenLink] = useState<string | undefined>(undefined);
  if (linkedTeam !== seenLink) {
    setSeenLink(linkedTeam);
    if (linkedTeam) {
      setPicked(linkedTeam);
      if (!wide) setView('team');
    }
  }
  useEffect(() => {
    if (linkedTeam) router.setParams({ team: undefined });
  }, [linkedTeam]);

  const spells = coreSpells(data);
  const timeline = buildTimeline(scores.games, scores.hits ?? [], spells, (teamId, round) =>
    roundTeamIds(data, round).includes(teamId),
  );
  const days = timeline.days;
  const latest = days.length ? dayEnd(timeline, days.length - 1) : null;
  // A stop the timeline no longer has (a late hit reordered the day) falls back to the latest.
  const valid = stop && stop.day < days.length && stop.bag <= days[stop.day].bags.length ? stop : null;
  const at = valid ?? latest;
  const atLatest = !at || !latest || sameStop(at, latest);
  // The middle of a day is rebuilt from the season's play-by-play, loaded the first time it's needed.
  const plays = useSeasonPlayLines((at !== null && !isDayEnd(timeline, at)) || playing);
  const shown: Scores = at && !atLatest ? { ...scores, ...scoresAt(timeline, scores.games, scores.stats, at, plays) } : scores;
  const round = futureRound ?? (at ? days[at.day].round : currentRound(scores.games));

  const go = (s: Stop) => {
    setFutureRound(null);
    setStop(latest && sameStop(s, latest) ? null : s);
  };

  // Playback: bag by bag (over the whole season when zoomed out), stopping at the last.
  const step = useRef<() => void>(() => {});
  useEffect(() => {
    step.current = () => {
      const next = at ? nextPlayStop(timeline, zoom, at) : null;
      if (next) go(next);
      if (!next || !nextPlayStop(timeline, zoom, next)) setPlaying(false);
    };
  });
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => step.current(), PLAY_MS[zoom]);
    return () => clearInterval(id);
  }, [playing, zoom]);
  const play = () => {
    if (playing) return setPlaying(false);
    if (!at) return;
    if (!nextPlayStop(timeline, zoom, at)) go(playStops(timeline, zoom, at)[0]);
    setPlaying(true);
  };
  const zoomTo = (z: Zoom) => {
    setPlaying(false);
    setZoom(z);
    if (!at) return;
    const stops = stopsFor(timeline, z, at);
    go(stops.find((s) => sameStop(s, at)) ?? nearestStop(timeline, stops, stopPosition(timeline, at)));
  };
  // A round chip goes to the end of that round (or the latest moment, for the one being played).
  const pickRound = (r: FantasyRound) => {
    setPlaying(false);
    const last = days.findLastIndex((d) => d.round === r);
    if (last < 0) return setFutureRound(r);
    go(dayEnd(timeline, last));
  };

  // The recorded result (who went out) holds once the scrubber is past the round's last game.
  const lastDay = days.findLastIndex((d) => d.round === round);
  const settled = atLatest || (at !== null && (at.day > lastDay || (at.day === lastDay && isDayEnd(timeline, at))));
  // Places moved since the previous stop in the same round.
  const prev = at ? previousStop(timeline, zoom, at) : null;
  const teamIds = roundTeamIds(data, round);
  const moves = new Map<string, number>();
  if (prev && days[prev.day].round === round && !futureRound) {
    const before = scoresAt(timeline, scores.games, scores.stats, prev, plays);
    const rankBefore = new Map(roundStandings(round, teamIds, before.games, before.stats, spells).map((r) => [r.teamId, r.rank]));
    for (const r of roundStandings(round, teamIds, shown.games, shown.stats, spells)) {
      const was = rankBefore.get(r.teamId);
      if (was !== undefined && was !== r.rank) moves.set(r.teamId, was - r.rank);
    }
  }
  // On a bag (any stop but a day's end on the season), the cell it went into.
  const bag = at && at.bag > 0 && (zoom !== 'season' || !isDayEnd(timeline, at)) ? days[at.day].bags[at.bag - 1] : null;
  const bagGame = bag ? scores.games.find((g) => g.gamePk === bag.gamePk) : undefined;
  const flash = bag && bagGame && bag.round === round ? { teamId: bag.teamId, column: `${bagGame.gameType}${bagGame.seriesGameNumber}` } : null;

  const teamId = picked ?? data.myTeam?.id ?? data.teams[0]?.id ?? null;
  const team = data.teams.find((t) => t.id === teamId);
  const selectTeam = (id: string) => {
    setPicked(id);
    if (!wide) setView('team');
  };

  const standings = (
    <View style={[styles.stack, wide && styles.wideStack]}>
      <RoundChips round={round} onChange={pickRound} />
      <StandingsTable
        data={data}
        scores={shown}
        round={round}
        selectedTeamId={wide ? teamId : null}
        onSelectTeam={selectTeam}
        settled={settled}
        moves={moves}
        flash={flash}
      />
      {at && !futureRound && (
        <SeasonScrubber
          data={data}
          timeline={timeline}
          games={scores.games}
          stats={scores.stats}
          stop={at}
          latest={atLatest}
          zoom={zoom}
          onStop={(s) => {
            setPlaying(false);
            go(s);
          }}
          onZoom={zoomTo}
          playing={playing}
          onPlay={play}
        />
      )}
      {atLatest && <CloseRoundCard data={data} scores={scores} round={round} refetch={refetch} />}
      {scores.games.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          Scores fill in once the postseason schedule is out and games start.
        </ThemedText>
      )}
    </View>
  );
  const teamView = teamId ? <TeamScoreboard data={data} scores={scores} teamId={teamId} /> : null;

  if (wide) {
    return (
      <Screen width="wide">
        <Columns main={standings} side={teamView} sideWidth={520} />
      </Screen>
    );
  }
  return (
    <Screen width="wide">
      <View style={[styles.toggle, { backgroundColor: theme.backgroundElement, boxShadow: theme.sunken }]} accessibilityRole="tablist">
        {(['standings', 'team'] as const).map((v) => {
          const active = view === v;
          return (
            <Pressable
              key={v}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setView(v)}
              style={[styles.toggleItem, active && { backgroundColor: theme.segment, boxShadow: theme.raised }]}>
              <ThemedText type="smallBold" numberOfLines={1} themeColor={active ? 'text' : 'textSecondary'}>
                {v === 'standings' ? 'Standings' : team ? (team.id === data.myTeam?.id ? 'My team' : teamName(team)) : 'Team'}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {view === 'standings' ? standings : teamView}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.three },
  // Matches the team panel's gap under its header, so the two columns' tables start level.
  wideStack: { gap: Spacing.four },
  toggle: { flexDirection: 'row', borderRadius: Radius.lg, padding: 3 },
  toggleItem: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Radius.lg },
});
