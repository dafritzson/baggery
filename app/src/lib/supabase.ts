import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';
export const appEnv = process.env.EXPO_PUBLIC_APP_ENV ?? 'local';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // AsyncStorage persists the session on native and uses localStorage on web, so
    // people stay signed in; the refresh token renews the session silently.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Web finishes Google sign-in by redirecting back with a code in the URL.
    detectSessionInUrl: Platform.OS === 'web',
    flowType: 'pkce',
  },
});

/** Calls an Edge Function and returns its error message, if any. */
export async function callFunction(name: string, body: object): Promise<string | null> {
  return (await invokeFunction(name, body)).error;
}

/** Calls an Edge Function and returns its response, or the error message to show. */
export async function invokeFunction<T>(name: string, body: object): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return { data: data as T, error: null };
  if ('context' in error && error.context instanceof Response) {
    try {
      const payload = await error.context.json();
      if (payload?.error) return { data: null, error: payload.error };
    } catch {
      // Fall through to the generic message.
    }
  }
  return { data: null, error: error.message || 'Something went wrong.' };
}
