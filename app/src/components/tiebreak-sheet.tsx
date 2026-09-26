import { StyleSheet, View } from 'react-native';

import { type StatLine, decidedBy, obp, slg } from '@core/scoring.ts';

import { Sheet } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface TiedTeam {
  teamId: string;
  name: string;
  totals: StatLine;
  /** Through the cut, out, or still level after every tiebreaker (a drink-off). */
  status: 'through' | 'out' | 'drink-off' | null;
}

type Column = 'TB' | 'SLG' | 'OBP' | 'HR' | 'R' | 'RBI';
const COLUMNS: Column[] = ['TB', 'SLG', 'OBP', 'HR', 'R', 'RBI'];
const WORDS: Record<Column, string> = { TB: 'bags', SLG: 'slugging', OBP: 'on-base', HR: 'home runs', R: 'runs', RBI: 'RBIs' };

const rate = (n: number, digits: number) => n.toFixed(digits).replace(/^0/, '');

/** A column's value for a team; rates to 3 places, or 4 when 3 would hide the difference. */
function cell(col: Column, t: StatLine, others: StatLine[]): string {
  if (col === 'SLG' || col === 'OBP') {
    const f = col === 'SLG' ? slg : obp;
    const v = f(t);
    const close = others.some((o) => o !== t && f(o) !== v && rate(f(o), 3) === rate(v, 3));
    return rate(v, close ? 4 : 3);
  }
  return String({ TB: t.tb, HR: t.hr, R: t.r, RBI: t.rbi }[col]);
}

/**
 * Teams level on bags, and how the tiebreakers (SLG, OBP, HR, R, RBI, in that order) separate
 * them: a table of each, the deciding stat highlighted between each pair, and a line saying so.
 */
export function TiebreakSheet({ teams, title, onClose }: { teams: TiedTeam[] | null; title: string; onClose: () => void }) {
  const theme = useTheme();
  const list = teams ?? [];
  const lines = list.map((t) => t.totals);
  // What separated each team from the one below it.
  const deciders = list.slice(0, -1).map((t, i) => decidedBy(t.totals, list[i + 1].totals));
  const highlighted = (i: number, col: Column) => deciders[i] === col || deciders[i - 1] === col;
  return (
    <Sheet visible={teams !== null} title={title} onClose={onClose}>
      <View style={[styles.table, { borderColor: theme.border }]}>
        <View style={styles.row}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.name}>Team</ThemedText>
          {COLUMNS.map((c) => (
            <View key={c} style={styles.stat}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={{ textAlign: 'right' }}>{c}</ThemedText>
            </View>
          ))}
        </View>
        {list.map((t, i) => (
          <View key={t.teamId} style={[styles.row, { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <View style={styles.name}>
              <ThemedText type="smallBold" numberOfLines={1}>{t.name}</ThemedText>
              {t.status && (
                <ThemedText
                  type="small"
                  style={[styles.status, { color: t.status === 'through' ? theme.success : t.status === 'out' ? theme.danger : theme.accent }]}>
                  {t.status === 'through' ? 'Through' : t.status === 'out' ? 'Out' : 'Drink-off'}
                </ThemedText>
              )}
            </View>
            {COLUMNS.map((c) => (
              <View key={c} style={[styles.stat, highlighted(i, c) && { backgroundColor: theme.backgroundSelected, borderRadius: Radius.md }]}>
                <ThemedText type={highlighted(i, c) ? 'smallBold' : 'small'} style={{ textAlign: 'right' }}>{cell(c, t.totals, lines)}</ThemedText>
              </View>
            ))}
          </View>
        ))}
      </View>
      <View style={{ gap: Spacing.one }}>
        {deciders.map((d, i) => (
          <ThemedText key={i} type="small" themeColor="textSecondary">
            {d
              ? `${list[i].name} ahead of ${list[i + 1].name} on ${WORDS[d]} (${cell(d, list[i].totals, lines)} to ${cell(d, list[i + 1].totals, lines)}).`
              : `${list[i].name} and ${list[i + 1].name} are level on everything: a drink-off decides it.`}
          </ThemedText>
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          Ties on bags go to higher slugging (TB ÷ AB), then on-base, home runs, runs and RBIs.
        </ThemedText>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.lg, paddingHorizontal: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.two, gap: 1 },
  name: { flex: 1, minWidth: 60 },
  status: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  // Six of these plus the name fit a phone.
  stat: { width: 40, paddingHorizontal: 3, paddingVertical: 2 },
});
