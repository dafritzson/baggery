import { Redirect, useLocalSearchParams } from 'expo-router';

/** Old links to /almanac/h2h: Head-to-head is now a tab of the Almanac. */
export default function HeadToHeadRedirect() {
  const { a, b } = useLocalSearchParams<{ a?: string; b?: string }>();
  const params: Record<string, string> = { view: 'h2h' };
  if (a) params.a = a;
  if (b) params.b = b;
  return <Redirect href={{ pathname: '/almanac', params }} />;
}
