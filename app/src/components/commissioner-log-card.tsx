import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSeason } from '@/lib/season';
import { supabase } from '@/lib/supabase';

interface Entry {
  id: number;
  user_id: string | null;
  summary: string;
  created_at: string;
}

const PAGE = 20;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Commissioner only: every commissioner action in the league, newest first (the commissioner_log
 * table, which only the commissioner can read and nobody can change).
 */
export function CommissionerLogCard() {
  const { data } = useSeason();
  const leagueId = data?.isCommissioner ? data.season.league_id : null;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load(leagueId: string, before: number | null): Promise<{ rows: Entry[]; more: boolean }> {
    let query = supabase
      .from('commissioner_log')
      .select('id, user_id, summary, created_at')
      .eq('league_id', leagueId)
      .order('id', { ascending: false })
      .limit(PAGE + 1);
    if (before !== null) query = query.lt('id', before);
    const { data: rows } = await query;
    return { rows: ((rows ?? []) as Entry[]).slice(0, PAGE), more: (rows ?? []).length > PAGE };
  }

  useEffect(() => {
    if (!leagueId) return;
    let stale = false;
    load(leagueId, null).then((page) => {
      if (stale) return;
      setEntries(page.rows);
      setMore(page.more);
    });
    return () => {
      stale = true;
    };
  }, [leagueId]);

  if (!leagueId || !data) return null;

  async function older() {
    setLoading(true);
    const page = await load(leagueId!, entries[entries.length - 1]?.id ?? null);
    setEntries((e) => [...e, ...page.rows]);
    setMore(page.more);
    setLoading(false);
  }

  return (
    <Card title="Commissioner log">
      <ThemedText type="small" themeColor="textSecondary">
        Everything done with commissioner powers, newest first. Only the commissioner sees this, and it can&apos;t be
        edited.
      </ThemedText>
      {entries.length === 0 && <ThemedText themeColor="textSecondary">Nothing yet.</ThemedText>}
      {entries.map((e) => (
        <View key={e.id} style={styles.row}>
          <ThemedText>{e.summary}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {(e.user_id && data.owners.get(e.user_id)) ?? 'Someone'} · {formatWhen(e.created_at)}
          </ThemedText>
        </View>
      ))}
      {more && <Button label={loading ? 'Loading…' : 'Show older'} variant="secondary" onPress={older} disabled={loading} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.half },
});
