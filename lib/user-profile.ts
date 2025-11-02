import type { User as SupabaseAuthUser } from '@supabase/supabase-js';

import { DEFAULT_AVATAR_URI } from '@/constants/avatar';
import { supabase } from '@/config/supabase';

type UserProfileSeed = {
  id: string;
  email?: string | null;
  displayName?: string | null;
  photoUrl?: string | null;
};

const normaliseProfileSeed = (seed: SupabaseAuthUser | UserProfileSeed) => {
  if ('user_metadata' in seed) {
    const metadata = seed.user_metadata ?? {};
    const displayName =
      typeof metadata.display_name === 'string' && metadata.display_name.trim()
        ? metadata.display_name.trim()
        : seed.email ?? null;
    const photoUrl =
      typeof metadata.photo_url === 'string' && metadata.photo_url.trim()
        ? metadata.photo_url.trim()
        : null;

    return {
      id: seed.id,
      email: seed.email ?? null,
      displayName,
      photoUrl,
    };
  }

  const fallbackDisplay =
    typeof seed.displayName === 'string' && seed.displayName.trim()
      ? seed.displayName.trim()
      : seed.email ?? null;
  const photoUrl =
    typeof seed.photoUrl === 'string' && seed.photoUrl.trim()
      ? seed.photoUrl.trim()
      : null;

  return {
    id: seed.id,
    email: seed.email ?? null,
    displayName: fallbackDisplay,
    photoUrl,
  };
};

/**
 * Ensures there is a companion row for the current user in the `users` table.
 * Missing rows cause foreign-key failures when creating marketplace or social records.
 */
export const ensureUserProfileExists = async (
  seed: SupabaseAuthUser | UserProfileSeed | null | undefined,
): Promise<boolean> => {
  if (!seed || !supabase) {
    return false;
  }

  const profileSeed = normaliseProfileSeed(seed);

  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('id', profileSeed.id)
      .maybeSingle();

    if (error) {
      console.warn('Failed to verify current user profile row', error);
      return false;
    }

    if (data?.id) {
      return true;
    }

    const { error: upsertError } = await supabase.from('users').upsert(
      {
        id: profileSeed.id,
        email: profileSeed.email ?? null,
        display_name: profileSeed.displayName ?? null,
        photo_url: profileSeed.photoUrl ?? DEFAULT_AVATAR_URI,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (upsertError) {
      console.warn('Failed to upsert user profile row', upsertError);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('Unable to ensure user profile row', error);
    return false;
  }
};
