import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as DropdownMenu from 'zeego/dropdown-menu';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useSeason } from '@/lib/season';
import { supabase } from '@/lib/supabase';

interface Manager {
  id: string;
  name: string;
  user_id: string | null;
}

/** The league's past managers, and everyone in the league (by display name) to link them to. */
async function fetchManagers(leagueId: string): Promise<{ managers: Manager[]; members: { id: string; name: string }[] }> {
  const [{ data: rows }, { data: memberRows }] = await Promise.all([
    supabase.from('league_managers').select('id, name, user_id').eq('league_id', leagueId).order('name'),
    supabase.from('league_members').select('user_id').eq('league_id', leagueId),
  ]);
  const ids = (memberRows ?? []).map((m) => m.user_id as string);
  const { data: profiles } = ids.length ? await supabase.from('profiles').select('id, display_name').in('id', ids) : { data: [] };
  return {
    managers: (rows ?? []) as Manager[],
    members: (profiles ?? [])
      .map((p) => ({ id: p.id as string, name: p.display_name as string }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Commissioner only: links each manager from the imported past seasons (a first name from the
 * old sheets) to someone's account, which makes that manager's past teams theirs.
 */
export function PastManagersCard() {
  const theme = useTheme();
  const { session } = useAuth();
  const { data } = useSeason();
  const leagueId = data?.season.league_id;
  const [managers, setManagers] = useState<Manager[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  // Bumped after linking, to reload.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!leagueId) return;
    let stale = false;
    fetchManagers(leagueId).then((r) => {
      if (stale) return;
      setManagers(r.managers);
      setMembers(r.members);
    });
    return () => {
      stale = true;
    };
  }, [leagueId, version]);

  if (!data?.isCommissioner || !managers.length) return null;
  // "(you)" tells your own account apart from anyone with the same name.
  const memberName = (id: string | null) => {
    const name = members.find((m) => m.id === id)?.name;
    return name ? `${name}${id === session?.user.id ? ' (you)' : ''}` : null;
  };

  async function link(manager: Manager, userId: string | null) {
    setMessage(null);
    const { error } = await supabase.rpc('link_manager', { p_manager_id: manager.id, p_user_id: userId });
    if (error) return setMessage({ text: error.message, error: true });
    setMessage({
      text: userId ? `${manager.name}'s past teams are now ${memberName(userId)}'s.` : `${manager.name} is unlinked.`,
      error: false,
    });
    setVersion((v) => v + 1);
  }

  return (
    <Card title="Past managers">
      <ThemedText type="small" themeColor="textSecondary">
        Link each manager from the past seasons to their account. Their past teams then show as theirs. Someone
        has to sign in once before they can be linked.
      </ThemedText>
      {managers.map((m) => (
        <View key={m.id} style={styles.row}>
          <ThemedText style={styles.name}>{m.name}</ThemedText>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="menu-trigger" aria-label={`Link ${m.name}`}>
              <View style={[styles.choice, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <ThemedText type="small" themeColor={m.user_id ? 'text' : 'textSecondary'} numberOfLines={1}>
                  {memberName(m.user_id) ?? 'Not linked'} ▾
                </ThemedText>
              </View>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className="menu-content menu-content-scroll" align="end" sideOffset={6} collisionPadding={8}>
              <DropdownMenu.Label className="menu-label menu-label-heading">{`${m.name} is…`}</DropdownMenu.Label>
              {members.map((member) => (
                <DropdownMenu.CheckboxItem
                  key={member.id}
                  className="menu-item"
                  value={m.user_id === member.id ? 'on' : 'off'}
                  onValueChange={() => link(m, member.id)}>
                  <DropdownMenu.ItemTitle>{memberName(member.id)!}</DropdownMenu.ItemTitle>
                  <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
                </DropdownMenu.CheckboxItem>
              ))}
              {m.user_id && (
                <>
                  <DropdownMenu.Separator className="menu-separator" />
                  <DropdownMenu.Item key="unlink" className="menu-item" onSelect={() => link(m, null)}>
                    <DropdownMenu.ItemTitle>Unlink</DropdownMenu.ItemTitle>
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </View>
      ))}
      {message && (
        <ThemedText type="small" themeColor={message.error ? 'danger' : 'success'}>{message.text}</ThemedText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  name: { flex: 1 },
  choice: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Radius.md, borderWidth: 1, maxWidth: 220 },
});
