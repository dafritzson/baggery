import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Sheet } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

interface Hit {
  play_id: string;
  event: '1B' | '2B' | '3B' | 'HR';
  inning: number;
  top_inning: boolean;
  clip_slug: string | null;
  clip_headline: string | null;
  /** Savant has the video (it publishes a game's the next day). */
  savant_ready: boolean;
}

const HIT_NAMES: Record<Hit['event'], string> = { '1B': 'Single', '2B': 'Double', '3B': 'Triple', HR: 'Home run' };

/** MLB's official clip of a play. */
export const clipUrl = (slug: string) => `https://www.mlb.com/video/${slug}`;
/** Baseball Savant's video of a play: every pitch gets one, the day after the game. */
export const savantUrl = (playId: string) => `https://baseballsavant.mlb.com/sporty-videos?playId=${playId}`;

/**
 * A hitter's hits in one game, each with the videos that are up: MLB's official clip once one is
 * posted (most home runs, within a minute or two) and Savant's video of the play, which every hit
 * gets the day after the game (poll-games checks). A hit with neither yet is listed without links.
 * The ▶ only shows once one of them has a video. Loaded when opened, so it costs nothing until
 * someone taps ▶. Both open in the browser. The sheet
 * opens once they're in, at its full height: around the loader it opened tall and then dropped.
 */
export function HitVideosSheet({ gamePk, playerId, title, onClose }: { gamePk: number; playerId: number; title: string; onClose: () => void }) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  useEffect(() => {
    let stale = false;
    supabase
      .from('mlb_hits')
      .select('play_id, event, inning, top_inning, clip_slug, clip_headline, savant_ready')
      .eq('game_pk', gamePk)
      .eq('mlb_player_id', playerId)
      .order('ended_at')
      .then(({ data }) => {
        if (!stale) setHits((data ?? []) as Hit[]);
      });
    return () => {
      stale = true;
    };
  }, [gamePk, playerId]);

  return (
    <Sheet visible={hits !== null} title={title} onClose={onClose}>
      {hits?.length === 0 && (
        <ThemedText themeColor="textSecondary">His hits show up here a few seconds after they happen.</ThemedText>
      )}
      {hits?.map((h) => (
        <View key={h.play_id} style={styles.hit}>
          <ThemedText type="smallBold">
            {HIT_NAMES[h.event]} · {h.top_inning ? '▲' : '▼'}{h.inning}
          </ThemedText>
          {h.clip_headline && <ThemedText type="small" themeColor="textSecondary">{h.clip_headline}</ThemedText>}
          <View style={styles.links}>
            {h.clip_slug && <VideoLink label="▶ MLB clip" url={clipUrl(h.clip_slug)} />}
            {h.savant_ready && <VideoLink label="▶ Savant" url={savantUrl(h.play_id)} />}
          </View>
        </View>
      ))}
    </Sheet>
  );
}

function VideoLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => Linking.openURL(url)} accessibilityRole="link" hitSlop={6}>
      <ThemedText type="smallBold" themeColor="accent">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { gap: Spacing.half },
  links: { flexDirection: 'row', gap: Spacing.three },
});
