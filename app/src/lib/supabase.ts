import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

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
    detectSessionInUrl: false,
  },
});
