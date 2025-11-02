import { useCallback, useEffect, useState } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';

import { supabase } from '@/config/supabase';

type UseSupabaseUserResult = {
  user: SupabaseUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * Small helper hook that keeps the latest Supabase auth user in sync.
 * Falls back gracefully when Supabase is not configured.
 */
export const useSupabaseUser = (): UseSupabaseUserResult => {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) {
      setUser(null);
      setError('Supabase is not configured yet.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: authError } = await supabase.auth.getUser();

      if (authError) {
        throw authError;
      }

      setUser(data.user ?? null);
    } catch (refreshError: unknown) {
      console.warn('Unable to load Supabase auth user', refreshError);
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Unable to load auth user. Please try again.',
      );
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    if (!supabase) {
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refresh]);

  return { user, loading, error, refresh };
};
