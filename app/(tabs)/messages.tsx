import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { supabase } from '@/config/supabase';
import { useSupabaseUser } from '@/hooks/use-supabase-user';
import { describeMessagePreview } from '@/lib/messages';
import { ensureUserProfileExists } from '@/lib/user-profile';

type UserProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
  photo_url: string | null;
};

type MessageRecord = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
};

type ConversationPreview = UserProfile & {
  lastMessage?: MessageRecord | null;
  isFollowing?: boolean;
};

const AVATAR_COLORS = ['#6D4BD1', '#2D1F1D', '#F26B5A', '#4E2F39', '#3D5C35', '#FFB84D', '#2E8B57'];

type PostgrestLikeError = {
  message?: string;
  code?: string;
};

const buildInitials = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/);

  if (parts.length === 0) {
    return '?';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const resolveDisplayName = (profile: UserProfile) =>
  profile.display_name?.trim() || profile.email || 'Unnamed user';

const getAccentForId = (id: string) => {
  const charCodes = id.split('').reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return AVATAR_COLORS[charCodes % AVATAR_COLORS.length];
};

const resolveErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as PostgrestLikeError).message ?? '').trim();
    if (message) {
      return message;
    }
  }

  return fallback;
};

const formatRelativeTime = (iso?: string) => {
  if (!iso) {
    return '';
  }

  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) {
    return '';
  }

  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) {
    return 'Just now';
  }

  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return new Date(iso).toLocaleDateString();
};

const fetchConversationPreviews = async (
  currentUserId: string,
  profiles: UserProfile[],
): Promise<ConversationPreview[]> => {
  if (!supabase || profiles.length === 0) {
    return profiles.map((profile) => ({ ...profile, lastMessage: null }));
  }

  const previews = await Promise.all(
    profiles.map(async (profile) => {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('id, sender_id, recipient_id, body, created_at')
          .or(
            `and(sender_id.eq.${currentUserId},recipient_id.eq.${profile.id}),and(sender_id.eq.${profile.id},recipient_id.eq.${currentUserId})`,
          )
          .order('created_at', { ascending: false })
          .limit(1);

        if (error) {
          throw error;
        }

        return {
          ...profile,
          lastMessage: data?.[0] ?? null,
        };
      } catch (previewError) {
        console.warn('Failed to load conversation preview', previewError);
        return {
          ...profile,
          lastMessage: null,
        };
      }
    }),
  );

  return previews;
};

export default function MessagesScreen() {
  const router = useRouter();
  const { user, loading: authLoading, error: authError, refresh: refreshAuth } = useSupabaseUser();

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [discover, setDiscover] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionTargetId, setActionTargetId] = useState<string | null>(null);

  const isBusy = loading || authLoading;

  const loadContacts = useCallback(async () => {
    if (!supabase) {
      setConversations([]);
      setDiscover([]);
      setFollowingIds(new Set());
      setErrorMessage('Supabase is not configured yet.');
      setLoading(false);
      return;
    }

    if (!user) {
      setConversations([]);
      setDiscover([]);
      setFollowingIds(new Set());
      setErrorMessage(authLoading ? null : 'Sign in to view your messages.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const { data: followRows, error: followError } = await supabase
        .from('user_follows')
        .select('followed_id')
        .eq('follower_id', user.id);

      if (followError) {
        throw followError;
      }

      const followedIdsArray =
        followRows?.map((row) => row.followed_id).filter((id): id is string => Boolean(id)) ?? [];
      const followedIdSet = new Set(followedIdsArray);

      const { data: partnerRows, error: partnerError } = await supabase
        .from('messages')
        .select('sender_id, recipient_id')
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`);

      if (partnerError) {
        throw partnerError;
      }

      const contactIdsSet = new Set<string>();
      for (const id of followedIdSet) {
        if (id && id !== user.id) {
          contactIdsSet.add(id);
        }
      }
      partnerRows?.forEach((row) => {
        const { sender_id, recipient_id } = row as { sender_id: string | null; recipient_id: string | null };
        if (sender_id && sender_id !== user.id) {
          contactIdsSet.add(sender_id);
        }
        if (recipient_id && recipient_id !== user.id) {
          contactIdsSet.add(recipient_id);
        }
      });

      const contactIds = Array.from(contactIdsSet);
      let contactProfiles: UserProfile[] = [];
      if (contactIds.length > 0) {
        const { data: profileRows, error: profileError } = await supabase
          .from('users')
          .select('id, display_name, photo_url, email')
          .in('id', contactIds);

        if (profileError) {
          throw profileError;
        }

        contactProfiles = profileRows ?? [];
      }

      const previews = await fetchConversationPreviews(user.id, contactProfiles);
      const previewMap = new Map(previews.map((preview) => [preview.id, preview]));

      const merged = contactProfiles
        .map<ConversationPreview>((profile) => {
          const preview = previewMap.get(profile.id);
          return {
            ...profile,
            lastMessage: preview?.lastMessage ?? null,
            isFollowing: followedIdSet.has(profile.id),
          };
        })
        .sort((a, b) => {
          const aTime = a.lastMessage?.created_at ? Date.parse(a.lastMessage.created_at) : 0;
          const bTime = b.lastMessage?.created_at ? Date.parse(b.lastMessage.created_at) : 0;
          return bTime - aTime;
        });

      setConversations(merged);
      setFollowingIds(new Set(followedIdSet));

      const { data: discoverRows, error: discoverError } = await supabase
        .from('users')
        .select('id, display_name, photo_url, email')
        .neq('id', user.id)
        .order('display_name', { ascending: true })
        .limit(50);

      if (discoverError) {
        throw discoverError;
      }

      const others =
        discoverRows?.filter((profile) => !contactIdsSet.has(profile.id) && profile.id !== user.id) ?? [];

      setDiscover(others);
    } catch (loadError: unknown) {
      console.warn('Failed to load messages data', loadError);
      setErrorMessage(resolveErrorMessage(loadError, 'Unable to load your messages right now. Please try again.'));
    } finally {
      setLoading(false);
    }
  }, [authLoading, user]);

  useFocusEffect(
    useCallback(() => {
      loadContacts();
    }, [loadContacts]),
  );

  useEffect(() => {
    if (authError) {
      setErrorMessage(authError);
    }
  }, [authError]);

  const filteredDiscover = useMemo(() => {
    if (!searchQuery.trim()) {
      return discover;
    }

    const needle = searchQuery.trim().toLowerCase();
    return discover.filter((profile) =>
      resolveDisplayName(profile).toLowerCase().includes(needle),
    );
  }, [discover, searchQuery]);

  const openConversation = useCallback(
    (recipientId: string) => {
      router.push({
        pathname: '/(routes)/messages/[userId]',
        params: { userId: recipientId },
      });
    },
    [router],
  );

  const handleFollow = useCallback(
    async (targetId: string) => {
      if (!supabase) {
        Alert.alert('Configuration missing', 'Supabase is not configured yet.');
        return;
      }

      if (!user) {
        Alert.alert('Sign in required', 'Sign in to follow other users.');
        refreshAuth();
        return;
      }

      try {
        setActionTargetId(targetId);
        const hasProfile = await ensureUserProfileExists(user);

        if (!hasProfile) {
          throw new Error('Your account profile is still being prepared. Please try again in a moment.');
        }

        const { error } = await supabase
          .from('user_follows')
          .insert({
            follower_id: user.id,
            followed_id: targetId,
            created_at: new Date().toISOString(),
          });

        if (error) {
          const duplicate =
            typeof error === 'object' && error !== null && 'code' in error && (error as PostgrestLikeError).code === '23505';

          if (!duplicate) {
            throw error;
          }
        }

        await loadContacts();
      } catch (followError: unknown) {
        console.warn('Failed to follow user', followError);
        Alert.alert('Unable to follow', resolveErrorMessage(followError, 'We could not follow this user right now. Please try again.'));
      } finally {
        setActionTargetId(null);
      }
    },
    [loadContacts, refreshAuth, user],
  );

  const handleUnfollow = useCallback(
    async (targetId: string) => {
      if (!supabase) {
        Alert.alert('Configuration missing', 'Supabase is not configured yet.');
        return;
      }

      if (!user) {
        Alert.alert('Sign in required', 'Sign in to manage follows.');
        refreshAuth();
        return;
      }

      try {
        setActionTargetId(targetId);
        const { error } = await supabase
          .from('user_follows')
          .delete()
          .match({ follower_id: user.id, followed_id: targetId });

        if (error) {
          throw error;
        }

        await loadContacts();
      } catch (unfollowError: unknown) {
        console.warn('Failed to unfollow user', unfollowError);
        Alert.alert('Unable to unfollow', resolveErrorMessage(unfollowError, 'We could not update your follow list. Please try again.'));
      } finally {
        setActionTargetId(null);
      }
    },
    [loadContacts, refreshAuth, user],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name='arrow-back' size={18} color='#111111' />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.searchWrapper}>
        <Ionicons name='search' size={18} color='#6B6B6B' style={styles.searchIcon} />
        <TextInput
          placeholder='Search people'
          placeholderTextColor='#A1A1A1'
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize='none'
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        {isBusy ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size='small' color='#3D5C35' />
          </View>
        ) : (
          <>
        {errorMessage && (
          <View style={styles.errorBanner}>
            <Ionicons name='warning' size={16} color='#B3261E' style={styles.errorIcon} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Conversations</Text>
            <Text style={styles.sectionCount}>{conversations.length}</Text>
          </View>

          {conversations.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptySubtitle}>
                Start a chat from the list below to connect with other shoppers.
              </Text>
            </View>
          ) : (
            conversations.map((profile) => {
              const fullName = resolveDisplayName(profile);
              const accent = getAccentForId(profile.id);
              const previewText = profile.lastMessage
                ? describeMessagePreview(profile.lastMessage.body)
                : 'No messages yet. Tap to say hello.';
              const isFollowing = profile.isFollowing ?? followingIds.has(profile.id);

              return (
                <View key={profile.id} style={styles.messageCard}>
                  {profile.photo_url ? (
                    <Image
                      source={{ uri: profile.photo_url }}
                      style={styles.avatar}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.avatar, { backgroundColor: accent }]}>
                      <Text style={styles.avatarLabel}>{buildInitials(fullName)}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.messageCopy}
                    onPress={() => openConversation(profile.id)}
                  >
                    <View style={styles.messageHeader}>
                      <Text style={styles.messageName}>{fullName}</Text>
                      {profile.lastMessage?.created_at ? (
                        <Text style={styles.messageTimestamp}>
                          {formatRelativeTime(profile.lastMessage.created_at)}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.messagePreview} numberOfLines={1}>
                      {previewText}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.actionColumn}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      style={[styles.actionButton, styles.primaryActionButton]}
                      onPress={() => openConversation(profile.id)}
                    >
                      <Text style={[styles.actionButtonText, styles.primaryActionButtonText]}>
                        Message
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      style={[styles.actionButton, styles.secondaryActionButton]}
                      onPress={() => (isFollowing ? handleUnfollow(profile.id) : handleFollow(profile.id))}
                      disabled={actionTargetId === profile.id}
                    >
                      <Text
                        style={[
                          styles.actionButtonText,
                          styles.secondaryActionButtonText,
                          actionTargetId === profile.id && styles.disabledActionText,
                        ]}
                      >
                        {actionTargetId === profile.id
                          ? '•••'
                          : isFollowing
                          ? 'Unfollow'
                          : 'Follow'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={[styles.section, styles.sectionSpacing]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Discover people</Text>
            <Text style={styles.sectionCount}>{filteredDiscover.length}</Text>
          </View>

          {filteredDiscover.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No people found</Text>
              <Text style={styles.emptySubtitle}>
                Try a different search term to find more users.
              </Text>
            </View>
          ) : (
            filteredDiscover.map((profile) => {
              const fullName = resolveDisplayName(profile);
              const accent = getAccentForId(profile.id);
              const isFollowing = followingIds.has(profile.id);

              return (
                <View key={profile.id} style={styles.discoverCard}>
                  {profile.photo_url ? (
                    <Image source={{ uri: profile.photo_url }} style={styles.avatarSmall} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatarSmall, { backgroundColor: accent }]}>
                      <Text style={styles.avatarSmallLabel}>{buildInitials(fullName)}</Text>
                    </View>
                  )}
                  <View style={styles.discoverCopy}>
                    <Text style={styles.discoverName}>{fullName}</Text>
                    <Text style={styles.discoverEmail} numberOfLines={1}>
                      {profile.email ?? 'No email on file'}
                    </Text>
                  </View>
                  <View style={styles.discoverActions}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      style={[styles.actionButton, styles.primaryActionButton]}
                      onPress={() => openConversation(profile.id)}
                    >
                      <Text style={[styles.actionButtonText, styles.primaryActionButtonText]}>Message</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      style={[
                        styles.followButton,
                        actionTargetId === profile.id && styles.followButtonDisabled,
                      ]}
                      onPress={() => (isFollowing ? handleUnfollow(profile.id) : handleFollow(profile.id))}
                      disabled={actionTargetId === profile.id}
                    >
                      <Text style={styles.followButtonText}>
                        {actionTargetId === profile.id
                          ? '•••'
                          : isFollowing
                          ? 'Unfollow'
                          : 'Follow'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D8D8D8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '800',
    color: '#111111',
  },
  headerSpacer: {
    width: 36,
  },
  searchWrapper: {
    marginHorizontal: 20,
    marginBottom: 18,
    borderRadius: 12,
    backgroundColor: '#F3F3F3',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 44,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#333333',
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginBottom: 30,
  },
  sectionSpacing: {
    marginTop: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  sectionCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B6B6B',
  },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    padding: 20,
    backgroundColor: '#F9F9F9',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2F2F2F',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#6F6F6F',
    lineHeight: 18,
  },
  messageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  messageCopy: {
    flex: 1,
    gap: 4,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  messageName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
    flex: 1,
  },
  messageTimestamp: {
    fontSize: 12,
    color: '#6B6B6B',
  },
  messagePreview: {
    fontSize: 13,
    color: '#6F6F6F',
  },
  actionColumn: {
    flexDirection: 'column',
    gap: 6,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 90,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  primaryActionButton: {
    backgroundColor: '#A8FF6F',
  },
  primaryActionButtonText: {
    color: '#111111',
  },
  secondaryActionButton: {
    backgroundColor: '#F1F1F1',
  },
  secondaryActionButtonText: {
    color: '#3D5C35',
  },
  disabledActionText: {
    color: '#A0A0A0',
  },
  discoverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
    gap: 12,
  },
  avatarSmall: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSmallLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  discoverCopy: {
    flex: 1,
  },
  discoverActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  discoverName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  discoverEmail: {
    fontSize: 12,
    color: '#6F6F6F',
    marginTop: 2,
  },
  followButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#3D5C35',
    borderRadius: 20,
  },
  followButtonDisabled: {
    opacity: 0.6,
  },
  followButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FCE8E6',
    borderColor: '#F5C2C0',
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  errorIcon: {
    marginTop: 1,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#B3261E',
  },
});
