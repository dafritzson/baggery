import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';

export default function PrivacyScreen() {
  return (
    <Screen>
      <ThemedText type="subtitle">Privacy</ThemedText>
      <Card>
        <ThemedText>
          Baggery is a private fantasy baseball game among friends. When you sign in with Google we store
          your name and email address so we can show who manages which team. We don&apos;t sell or share
          your information, and we don&apos;t use it for advertising.
        </ThemedText>
        <ThemedText>
          Baseball stats come from the MLB Stats API. To delete your account, ask your league&apos;s
          commissioner.
        </ThemedText>
      </Card>
    </Screen>
  );
}
