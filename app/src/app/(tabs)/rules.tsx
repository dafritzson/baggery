import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, type ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { FoldChevron } from '@/components/team-roster';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSeason } from '@/lib/season';

/** The page's sections: `?section=<id>` (a link from Standings or a draft room) opens one. */
const SECTIONS = ['bags', 'rounds', 'drafts', 'ghost', 'autodraft'] as const;
type RulesSection = (typeof SECTIONS)[number];
const isSection = (id: string | undefined): id is RulesSection => SECTIONS.includes(id as RulesSection);

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
  // Every section starts folded. A link opens just its section, at the top of the page; the link's
  // param is then cleared, so the same link works again later.
  const [open, setOpen] = useState<RulesSection[]>(() => (isSection(section) ? [section] : []));
  const [seenLink, setSeenLink] = useState(section);
  if (section !== seenLink) {
    setSeenLink(section);
    if (isSection(section)) setOpen([section]);
  }
  useEffect(() => {
    if (!section) return;
    scroll.current?.scrollTo({ y: 0, animated: false });
    router.setParams({ section: undefined });
  }, [section]);
  const fold = (id: RulesSection) => ({
    open: open.includes(id),
    onToggle: () => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id])),
  });

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

      <Section title="Bags" {...fold('bags')}>
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
        <Bullet>Your team is 4 hitters, and its bags are their total bases. Only hits count. Walks and errors do nothing.</Bullet>
        <Bullet>Bags reset every round. A hitter&apos;s bags count for you in games that start while he&apos;s on your roster, and stay yours after you drop him.</Bullet>
      </Section>

      <Section title="Rounds and the cut" {...fold('rounds')}>
        <Table
          rows={[
            ['Round 1', 'Wild Card + Division Series', `Top ${survivors[0]} of ${managers} go through`],
            ['Round 2', 'Championship Series', `Top ${survivors[1]} go through`],
            ['Round 3', 'World Series', 'The top team wins it all'],
          ]}
        />
        <Bullet>A round ends by itself once every series in it has a winner, plus 3 hours for stat corrections. The teams below the cut are out.</Bullet>
        <Bullet>
          Teams tied on bags are ranked by these tiebreakers, in order: team slugging percentage, team on-base percentage,
          home runs, runs, then RBIs. Teams still tied after all five settle it with a drink-off.
        </Bullet>
      </Section>

      <Section title="Drafts" {...fold('drafts')}>
        <Table
          rows={[
            ['Draft 1', 'Before the Wild Card', 'Random order, 4 picks each'],
            ['Draft 2', 'Before the Division Series', 'New random order'],
            ['Draft 3', 'Before the Championship Series', 'Round 1 standings, then the Ghost'],
            ['Draft 4', 'Before the World Series', 'Round 2 standings, the Ghost included'],
          ]}
        />
        <Bullet>Every draft is a snake, up to 4 rounds. Picks aren&apos;t timed.</Bullet>
        <Bullet>
          Drafts 2 to 4 are redrafts. A hitter whose MLB team has been eliminated, or who was left off its postseason roster,
          leaves an empty spot on your roster.
        </Bullet>
        <Bullet>
          Each redraft pick adds an undrafted hitter. He either fills one of your empty spots or replaces a hitter of yours
          who&apos;s still playing.
        </Bullet>
        <Bullet>
          You can yield to skip the rest of a redraft, but only once every empty spot on your roster is filled, or nobody
          undrafted is left.
        </Bullet>
        <Bullet>
          If the undrafted hitters run out, whoever still has picks yields and plays with what they have: an eliminated hitter
          scores 0.
        </Bullet>
        <Bullet>
          A hitter you drop is burned: nobody can take him again. The exception is a hitter dropped by a manager who&apos;s
          since been knocked out. He goes back in the pool, so anyone can draft him, the Ghost included. The hitters still
          on a knocked-out manager&apos;s roster stay off the board.
        </Bullet>
        <Bullet>Draft 1&apos;s pool is every playoff team&apos;s active roster, plus hitters on their injured lists who could be back in time. Redrafts use the postseason rosters of MLB teams still alive.</Bullet>
      </Section>

      <Section title="The Ghost 👻" {...fold('ghost')}>
        <ThemedText type="small">Knocked out? You join the Ghost, a team shared by the eliminated managers that can still win it all.</ThemedText>
        <Bullet>
          <B>Draft 3:</B> after the survivors&apos; snake, the 2 managers eliminated in round 1 each add an undrafted hitter
          to the Ghost. Of those 2 managers, the one who finished higher in round 1 picks first.
        </Bullet>
        <Bullet><B>Round 2:</B> it plays the Championship Series with those 2 hitters. It&apos;s never cut and takes nobody&apos;s spot: the bottom {survivors[0] - survivors[1]} managers are out wherever the Ghost finishes.</Bullet>
        <Bullet>
          <B>Draft 4:</B> the Ghost joins the finalists&apos; snake, placed by its round 2 bags like everyone else. Its first 2
          turns fill its 2 empty spots, with no drop and no pass (unless nobody undrafted is left), and go to the 2 managers eliminated in round 2. Its last
          2 turns are regular redraft picks and go to the 2 managers eliminated in round 1. In each pair, the manager who
          finished higher in the round they went out picks first.
        </Bullet>
        <Bullet><B>Round 3:</B> it&apos;s ranked with the finalists. If it finishes first, its 4 managers share the title.</Bullet>
        <Bullet>
          The hitters its managers dropped before they were knocked out go back in the pool, so the Ghost (or anyone) can
          draft them.
        </Bullet>
        <Bullet>Passing a ghost turn skips only that turn. A ghost pick nobody makes is autodrafted.</Bullet>
      </Section>

      <Section title="Autodraft" {...fold('autodraft')}>
        <Bullet>Turn on autodraft in the draft room and it makes your picks for you.</Bullet>
        <Bullet>
          It takes the highest hitter in your queue who&apos;s still available. If nobody in your queue is available, it takes
          the available hitter with the most regular-season total bases, skipping anyone on the injured list.
        </Bullet>
        <Bullet>In a redraft, it fills your empty spots, then yields.</Bullet>
        <Bullet>Your queue is private. On a ghost turn it&apos;s the queue of the manager making the pick.</Bullet>
      </Section>
    </Screen>
  );
}

/** A section: its title, tapped to open or fold it. */
function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Card>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={{ top: Spacing.three, bottom: Spacing.three }}
        style={styles.sectionHead}>
        <ThemedText type="smallBold" style={styles.sectionTitle}>{title}</ThemedText>
        <FoldChevron open={open} />
      </Pressable>
      {open && children}
    </Card>
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
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 28 },
  sectionTitle: { flex: 1, fontSize: 16, lineHeight: 24 },
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
