import { ThemedText } from '@/components/themed-text';

// Native Google sign-in comes with the iOS app (expo-auth-session or the Google SDK).
export function GoogleSignInButton() {
  return <ThemedText themeColor="textSecondary">Sign-in on the native app is coming later. Use the website for now.</ThemedText>;
}
