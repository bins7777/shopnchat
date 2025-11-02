import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

type ExpoSupabaseExtra = {
  url?: string;
  anonKey?: string;
  storageBucket?: string;
};

const supabaseExtra = Constants.expoConfig?.extra?.supabase as ExpoSupabaseExtra | undefined;

const isWeb = Platform.OS === 'web';
const isWebSSR = isWeb && typeof window === 'undefined';

type StorageAdapterLike = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;

const createWebSSRStorage = (): StorageAdapterLike => {
  const memory = new Map<string, string>();

  return {
    getItem: async (key, callback) => {
      const value = memory.has(key) ? memory.get(key)! : null;
      callback?.(null, value);
      return value;
    },
    setItem: async (key, value, callback) => {
      memory.set(key, value);
      callback?.(null);
    },
    removeItem: async (key, callback) => {
      memory.delete(key);
      callback?.(null);
    },
  };
};

type SignOutScope = 'global' | 'local' | 'others';

const JSON_PARSE_ERROR_PATTERN = /JSON Parse error/i;

const isJsonParseError = (error: unknown) =>
  error instanceof Error && JSON_PARSE_ERROR_PATTERN.test(error.message);

const getLogoutUrl = (scope: SignOutScope) => {
  if (!supabaseExtra?.url) {
    return null;
  }

  const trimmedBaseUrl = supabaseExtra.url.replace(/\/+$/, '');
  return `${trimmedBaseUrl}/auth/v1/logout?scope=${scope}`;
};

const clearSupabaseAuthStorage = async () => {
  if (!supabase) {
    return;
  }

  const authClient = supabase.auth as unknown as {
    _removeSession?: () => Promise<void>;
    storageKey?: string;
  };

  try {
    if (typeof authClient._removeSession === 'function') {
      await authClient._removeSession();
      return;
    }
  } catch (internalCleanupError) {
    console.warn('Supabase internal session cleanup failed', internalCleanupError);
  }

  const storageKey = typeof authClient.storageKey === 'string' ? authClient.storageKey : undefined;

  if (!storageKey) {
    return;
  }

  if (isWebSSR) {
    return;
  }

  try {
    await AsyncStorage.multiRemove([
      storageKey,
      `${storageKey}-code-verifier`,
      `${storageKey}-user`,
    ]);
  } catch (storageError) {
    console.warn('Supabase auth storage cleanup failed', storageError);
  }
};

const attemptManualLogout = async (scope: SignOutScope) => {
  if (!supabase || !supabaseExtra?.anonKey) {
    return;
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    return;
  }

  const logoutUrl = getLogoutUrl(scope);
  if (!logoutUrl) {
    return;
  }

  const fetcher = globalThis.fetch;
  if (typeof fetcher !== 'function') {
    return;
  }

  try {
    const response = await fetcher(logoutUrl, {
      method: 'POST',
      headers: {
        apikey: supabaseExtra.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: '{}',
    });

    if (!response.ok) {
      console.warn(
        `Manual Supabase logout request returned ${response.status} ${response.statusText}`,
      );
    }
  } catch (manualLogoutError) {
    console.warn('Manual Supabase logout request failed', manualLogoutError);
  }
};

const signOutSafely = async (scope: SignOutScope = 'global') => {
  if (!supabase) {
    throw new Error('Supabase is not configured yet.');
  }

  const { error } = await supabase.auth.signOut({ scope });

  if (!error) {
    return;
  }

  if (!isJsonParseError(error)) {
    throw error;
  }

  console.warn('Supabase signOut returned a parse error; applying manual cleanup fallback.', error);

  await attemptManualLogout(scope);
  await clearSupabaseAuthStorage();
};

let supabase: SupabaseClient | undefined;
let storageBucket: string | undefined;

if (!supabaseExtra?.url || !supabaseExtra.anonKey) {
  console.warn(
    'Supabase configuration was not found. Populate expo.extra.supabase in app.json/app.config.ts.',
  );
} else {
  const storageAdapter = isWebSSR ? createWebSSRStorage() : AsyncStorage;
  const shouldPersistSession = !isWebSSR;

  supabase = createClient(supabaseExtra.url, supabaseExtra.anonKey, {
    auth: {
      storage: storageAdapter,
      autoRefreshToken: shouldPersistSession,
      persistSession: shouldPersistSession,
      detectSessionInUrl: false,
    },
  });

  storageBucket = supabaseExtra.storageBucket || 'avatars';
}

export { supabase, storageBucket, signOutSafely };
