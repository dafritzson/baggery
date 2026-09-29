import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useRef } from 'react';
import { Pressable, type ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSeason } from '@/lib/season';

/** The page's sections, in order: `?section=<id>` (a link from Standings or a draft room) jumps to one. */
const SECTIONS = [
  { id: 'bags', label: 'Bags' },
  { id: 'rounds', label: 'Rounds' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'ghost', label: 'Ghost' },
  { id: 'autodraft', label: 'Autodraft' },
] as const;
type RulesSection = (typeof SECTIONS)[number]['id'];

/**
 * The rules for the league, in short: the players' version of docs/RULES.md, which has every
 * detail the app implements. Keep the two in step when a rule changes. Opened from the account
 * menu, and from the help on Standings and in a draft room.
 */
export default function RulesScreen() {
  const theme = useTheme();
  const { data } = useSeason();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const scroll = useRef<ScrollView>(null);
  // Where each section is on the page, and a section to jump to once it's been laid out.
  const offsets = useRef(new Map<string, number>());
  const pending = useRef<string | null>(null);

  const jump = (id: string) => jumpTo(scroll.current, offsets.current, id);
  // A link's section is jumped to (once it's laid out, when the page has just opened), then
  // cleared, so the same link works again later.
  useEffect(() => {
    if (!section) return;
    pending.current = jumpTo(scroll.current, offsets.current, section) ? null : section;
    router.setParams({ section: undefined });
  }, [section]);
  const place = (id: RulesSection, y: number) => {
    offsets.current.set(id, y);
    if (pending.current === id) {
      pending.current = null;
      jump(id);
    }
  };

  // This season's cut (5, 3, 1 so far), and how many managers start it.
  const survivors = data?.season.survivors_after_round ?? [5, 3, 1];
  const managers = data?.teams.filter((t) => !t.is_ghost).length || 7;

  return (
    <Screen scrollRef={scroll}>
      <View style={styles.intro}>
        <ThemedText type="subtitle">Rules</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Draft 4 hitters for the MLB postseason. Their bags decide who survives each round.
        </ThemedText>
      </View>
      <View style={styles.chips}>
        {SECTIONS.map((s) => (
          <Pressable
            key={s.id}
            accessibilityRole="link"
            onPress={() => jump(s.id)}
            style={({ pressed }) => [styles.chip, { backgroundColor: theme.backgroundElement, boxShadow: pressed ? theme.sunken : theme.raised }]}>
            <ThemedText type="smallBold">{s.label}</ThemedText>
          </Pressable>
        ))}
      </View>

      <Section title="Bags" id="bags" onPlace={place}>
        <View style={styles.bags}>
          {(
            [
              [1, 'Single'],
              [2, 'Double'],
              [3, 'Triple'],
              [4, 'Home run'],
            ] as const
          ).map(([n, label]) => (
            <View key={n} style={[styles.bag, { backgroundColor: theme.tint }]}>
              <ThemedText type="subtitle" style={{ color: theme.accent, lineHeight: 36 }}>{n}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
            </View>
          ))}
        </View>
        <Bullet>Your team is 4 hitters, and its bags are their total bases. Only hitting counts, even for two-way players.</Bullet>
        <Bullet>Bags reset every round. A hitter&apos;s bags count for you in games that start while he&apos;s on your roster, and stay yours after you drop him.</Bullet>
      </Section>

      <Section title="Rounds and the cut" id="rounds" onPlace={place}>
        <Table
          rows={[
            ['Round 1', 'Wild Card + Division Series', `Top ${survivors[0]} of ${managers} go through`],
            ['Round 2', 'Championship Series', `Top ${survivors[1]} go through`],
            ['Round 3', 'World Series', 'The top team wins it all'],
          ]}
        />
        <Bullet>A round ends by itself once every series in it has a winner, plus 3 hours for stat corrections. The teams below the cut are out.</Bullet>
        <Bullet>Level on bags? Then team slugging, on-base, home runs, runs and RBIs decide it, in that order. Still level: a drink-off.</Bullet>
      </Section>

      <Section title="Drafts" id="drafts" onPlace={place}>
        <Table
          rows={[
            ['Draft 1', 'Before the Wild Card', 'Random order, 4 picks each'],
            ['Draft 2', 'Before the Division Series', 'New random order'],
            ['Draft 3', 'Before the Championship Series', 'Round 1 standings, then the Ghost'],
            ['Draft 4', 'Before the World Series', 'Round 2 standings, the Ghost included'],
          ]}
        />
        <Bullet>Every draft is a snake, up to 4 rounds. Picks aren&apos;t timed.</Bullet>
        <Bullet>In Drafts 2 to 4 (redrafts), each pick drops one of your hitters and adds an undrafted one.</Bullet>
        <Bullet>You can yield to sit out the rest of a redraft, but not while you have a hitter whose MLB team is out: fill his spot first.</Bullet>
        <Bullet>A hitter can be on one roster a season, ever. Once he&apos;s dropped, nobody can take him again.</Bullet>
        <Bullet>Draft 1&apos;s pool is every playoff team&apos;s active roster, plus hitters on their injured lists who could be back in time. Redrafts use the postseason rosters of MLB teams still alive.</Bullet>
      </Section>

      <Section title="The Ghost" id="ghost" onPlace={place}>
        <ThemedText type="small">Knocked out? You join the Ghost, a team shared by the eliminated managers that can still win it all.</ThemedText>
        <Bullet><B>Draft 3:</B> after the survivors&apos; snake, the 2 managers out after round 1 each add an undrafted hitter to it, the higher-ranked first.</Bullet>
        <Bullet><B>Round 2:</B> it plays the Championship Series with those 2 hitters. It&apos;s never cut and takes nobody&apos;s spot: the bottom {survivors[0] - survivors[1]} managers are out wherever the Ghost finishes.</Bullet>
        <Bullet><B>Draft 4:</B> it joins the finalists&apos; snake, placed by round 2 bags. The 2 managers out after round 2 fill its empty spots (no drop, no pass). The 2 out after round 1 make an ordinary redraft pick each.</Bullet>
        <Bullet><B>Round 3:</B> it&apos;s ranked with the finalists. If it finishes first, its 4 managers share the title.</Bullet>
        <Bullet>Passing a ghost turn skips only that turn. A ghost pick nobody makes is autodrafted.</Bullet>
      </Section>

      <Section title="Autodraft" id="autodraft" onPlace={place}>
        <Bullet>Turn it on in a draft room and it picks for you: your queue first, in order, then the hitter with the most regular-season total bases (skipping the injured list).</Bullet>
        <Bullet>In a redraft it replaces your hitters whose MLB team is out, then yields.</Bullet>
        <Bullet>Your queue is private. On a ghost turn it&apos;s the queue of the manager making the pick.</Bullet>
      </Section>
    </Screen>
  );
}

/** Scrolls to a section, if it's been laid out: whether it could. */
function jumpTo(scroll: ScrollView | null, offsets: Map<string, number>, id: string): boolean {
  const y = offsets.get(id);
  if (y === undefined || !scroll) return false;
  scroll.scrollTo({ y: Math.max(0, y - Spacing.three), animated: true });
  return true;
}

function Section({
  id,
  title,
  onPlace,
  children,
}: {
  id: RulesSection;
  title: string;
  onPlace: (id: RulesSection, y: number) => void;
  children: ReactNode;
}) {
  return (
    <View onLayout={(e) => onPlace(id, e.nativeEvent.layout.y)}>
      <Card title={title}>{children}</Card>
    </View>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.bullet}>
      <View style={[styles.dot, { backgroundColor: theme.accent }]} />
      <ThemedText type="small" style={styles.bulletText}>{children}</ThemedText>
    </View>
  );
}

function B({ children }: { children: ReactNode }) {
  return <ThemedText type="smallBold">{children}</ThemedText>;
}

/** Rows of a name, what it covers and a note, e.g. a round's series and its cut. */
function Table({ rows }: { rows: [string, string, string][] }) {
  const theme = useTheme();
  return (
    <View style={[styles.table, { borderColor: theme.border, backgroundColor: theme.background }]}>
      {rows.map(([name, what, note], i) => (
        <View key={name} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
          <ThemedText type="smallBold" style={styles.rowName}>{name}</ThemedText>
          <View style={styles.rowBody}>
            <ThemedText type="small">{what}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{note}</ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { gap: Spacing.one },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radius.md },
  bags: { flexDirection: 'row', gap: Spacing.two },
  bag: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Radius.md },
  bullet: { flexDirection: 'row', gap: Spacing.two },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  bulletText: { flex: 1 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.md },
  row: { flexDirection: 'row', gap: Spacing.three, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  rowName: { width: 64 },
  rowBody: { flex: 1 },
});
