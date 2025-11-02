import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { supabase } from '@/config/supabase';
import { useSupabaseUser } from '@/hooks/use-supabase-user';
import { parseMessageBody } from '@/lib/messages';

const MESSAGE_MEDIA_BUCKET = 'Images-Videos-Message';

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

type PostgrestLikeError = {
  message?: string;
  code?: string;
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

const resolveDisplayName = (profile: UserProfile | null) =>
  profile?.display_name?.trim() || profile?.email || 'Unnamed user';

const PROFILE_ACCENTS = ['#6D4BD1', '#2D1F1D', '#F26B5A', '#4E2F39', '#3D5C35', '#FFB84D', '#2E8B57'];

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

const getAccentForId = (id: string) => {
  const sum = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return PROFILE_ACCENTS[sum % PROFILE_ACCENTS.length];
};

// Minimal base64-to-Uint8Array decoder (avoids Node Buffer dependency)
const decodeBase64ToUint8Array = (base64: string) => {
  const sanitized = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (sanitized.length % 4 !== 0) {
    throw new Error('Invalid base64 string length.');
  }
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  const outputLength = (sanitized.length / 4) * 3 - padding;
  const result = new Uint8Array(outputLength);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let p = 0;
  for (let i = 0; i < sanitized.length; i += 4) {
    const c1 = chars.indexOf(sanitized[i]);
    const c2 = chars.indexOf(sanitized[i + 1]);
    const c3 = chars.indexOf(sanitized[i + 2]);
    const c4 = chars.indexOf(sanitized[i + 3]);
    const chunk = (c1 << 18) | (c2 << 12) | ((c3 & 63) << 6) | (c4 & 63);
    if (p < outputLength) result[p++] = (chunk >> 16) & 255;
    if (p < outputLength) result[p++] = (chunk >> 8) & 255;
    if (p < outputLength) result[p++] = chunk & 255;
  }
  return result;
};

const MessageVideoAttachment = ({ uri }: { uri: string }) => {
  const player = useVideoPlayer(uri, (playerInstance) => {
    playerInstance.loop = false;
    playerInstance.pause();
  });

  return (
    <VideoView
      style={styles.attachmentVideo}
      player={player}
      nativeControls
      allowsFullscreen
      allowsPictureInPicture
      contentFit="cover"
    />
  );
};

const ProfileSummary = ({
  profile,
  following,
}: {
  profile: UserProfile;
  following: boolean;
}) => {
  const displayName = resolveDisplayName(profile);
  const accent = getAccentForId(profile.id);

  return (
    <View style={styles.profileSummary}>
      {profile.photo_url ? (
        <Image
          source={{ uri: profile.photo_url }}
          style={styles.profileSummaryAvatar}
          contentFit='cover'
        />
      ) : (
        <View style={[styles.profileSummaryFallback, { backgroundColor: accent }]}>
          <Text style={styles.profileSummaryInitials}>{buildInitials(displayName)}</Text>
        </View>
      )}
      <View style={styles.profileSummaryCopy}>
        <Text style={styles.profileSummaryName} numberOfLines={1}>
          {displayName}
        </Text>
        {profile.email ? (
          <Text style={styles.profileSummaryEmail} numberOfLines={1}>
            {profile.email}
          </Text>
        ) : null}
        <View style={styles.profileSummaryBadgeRow}>
          <View
            style={[
              styles.profileSummaryBadge,
              following ? styles.profileSummaryBadgeFollowing : styles.profileSummaryBadgePending,
            ]}
          >
            <Text
              style={[
                styles.profileSummaryBadgeText,
                following
                  ? styles.profileSummaryBadgeTextDark
                  : styles.profileSummaryBadgeTextLight,
              ]}
            >
              {following ? 'Following' : 'Not following yet'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const formatMessageTimestamp = (iso: string) => {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (diffDays < 7) {
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

export default function ConversationScreen() {
  const router = useRouter();
  const { user, loading: authLoading, error: authError, refresh: refreshAuth } = useSupabaseUser();

  const params = useLocalSearchParams<{ userId?: string }>();
  const targetUserIdValue = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const targetUserId = typeof targetUserIdValue === 'string' ? targetUserIdValue : null;

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [targetProfile, setTargetProfile] = useState<UserProfile | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const isBusy = loading || authLoading;
  const listRef = useRef<FlatList<MessageRecord>>(null);

  const conversationTitle = useMemo(() => resolveDisplayName(targetProfile), [targetProfile]);

  const loadConversation = useCallback(async () => {
    if (!supabase) {
      setErrorMessage('Supabase is not configured yet.');
      setLoading(false);
      return;
    }

    if (!targetUserId) {
      setErrorMessage('We could not find that conversation.');
      setLoading(false);
      return;
    }

    if (!user) {
      if (!authLoading) {
        setErrorMessage('Sign in to view this conversation.');
      }
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const { data: profileRow, error: profileError } = await supabase
        .from('users')
        .select('id, display_name, email, photo_url')
        .eq('id', targetUserId)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      if (!profileRow) {
        setTargetProfile(null);
        setMessages([]);
        setRequiresFollow(false);
        setErrorMessage('That user is no longer available.');
        return;
      }

      setTargetProfile(profileRow);

      const { data: followRow, error: followError } = await supabase
        .from('user_follows')
        .select('follower_id')
        .eq('follower_id', user.id)
        .eq('followed_id', targetUserId)
        .maybeSingle();

      if (followError && followError.code !== 'PGRST116') {
        throw followError;
      }

      setIsFollowing(Boolean(followRow));

      const { data: messageRows, error: messagesError } = await supabase
        .from('messages')
        .select('id, sender_id, recipient_id, body, created_at')
        .or(
          `and(sender_id.eq.${user.id},recipient_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},recipient_id.eq.${user.id})`,
        )
        .order('created_at', { ascending: true });

      if (messagesError) {
        throw messagesError;
      }

      setMessages(messageRows ?? []);
    } catch (conversationError: unknown) {
      console.warn('Failed to load conversation', conversationError);
      setErrorMessage(resolveErrorMessage(conversationError, 'Unable to load this conversation right now.'));
    } finally {
      setLoading(false);
    }
  }, [authLoading, targetUserId, user]);

  useFocusEffect(
    useCallback(() => {
      loadConversation();
    }, [loadConversation]),
  );

  useEffect(() => {
    if (authError) {
      setErrorMessage(authError);
    }
  }, [authError]);

  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const handleFollow = useCallback(async () => {
    if (!supabase) {
      Alert.alert('Configuration missing', 'Supabase is not configured yet.');
      return;
    }

    if (!user) {
      Alert.alert('Sign in required', 'Sign in to follow this user.');
      refreshAuth();
      return;
    }

    if (!targetUserId) {
      Alert.alert('Unavailable', 'This user is no longer available.');
      return;
    }

    try {
      setFollowBusy(true);
      const { error } = await supabase.from('user_follows').insert({
        follower_id: user.id,
        followed_id: targetUserId,
        created_at: new Date().toISOString(),
      });

      if (error) {
        const duplicate =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as PostgrestLikeError).code === '23505';

        if (!duplicate) {
          throw error;
        }
      }

      setIsFollowing(true);
      await loadConversation();
    } catch (followError: unknown) {
      console.warn('Failed to follow user', followError);
      Alert.alert('Unable to follow', resolveErrorMessage(followError, 'We could not follow this user right now.'));
    } finally {
      setFollowBusy(false);
    }
  }, [loadConversation, refreshAuth, targetUserId, user]);

  const handleUnfollow = useCallback(async () => {
    if (!supabase) {
      Alert.alert('Configuration missing', 'Supabase is not configured yet.');
      return;
    }

    if (!user) {
      Alert.alert('Sign in required', 'Sign in to manage follows.');
      refreshAuth();
      return;
    }

    if (!targetUserId) {
      Alert.alert('Unavailable', 'This user is no longer available.');
      return;
    }

    try {
      setFollowBusy(true);
      const { error } = await supabase
        .from('user_follows')
        .delete()
        .match({ follower_id: user.id, followed_id: targetUserId });

      if (error) {
        throw error;
      }

      setIsFollowing(false);
      await loadConversation();
    } catch (unfollowError: unknown) {
      console.warn('Failed to unfollow user', unfollowError);
      Alert.alert(
        'Unable to unfollow',
        resolveErrorMessage(unfollowError, 'We could not update your follow list right now.'),
      );
    } finally {
      setFollowBusy(false);
    }
  }, [refreshAuth, targetUserId, user]);

  const handleSend = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || sending) {
      return;
    }

    if (!supabase) {
      Alert.alert('Configuration missing', 'Supabase is not configured yet.');
      return;
    }

    if (!user) {
      Alert.alert('Sign in required', 'Sign in to send messages.');
      refreshAuth();
      return;
    }

    if (!targetUserId) {
      Alert.alert('Unavailable', 'This conversation is no longer available.');
      return;
    }

    try {
      setSending(true);
      const { data, error } = await supabase
        .from('messages')
        .insert({
          sender_id: user.id,
          recipient_id: targetUserId,
          body: trimmed,
          created_at: new Date().toISOString(),
        })
        .select('id, sender_id, recipient_id, body, created_at')
        .single();

      if (error) {
        throw error;
      }

      if (data) {
        setMessages((prev) => [...prev, data]);
      }
      setInputValue('');
    } catch (sendError: unknown) {
      console.warn('Failed to send message', sendError);
      Alert.alert('Send failed', resolveErrorMessage(sendError, 'We could not send this message right now.'));
    } finally {
      setSending(false);
    }
  }, [inputValue, refreshAuth, sending, targetUserId, user]);

  const renderMessage = useCallback(
    ({ item }: { item: MessageRecord }) => {
      const outgoing = item.sender_id === user?.id;
      const parsed = parseMessageBody(item.body);
      const fallbackText = (() => {
        if (parsed.kind === 'file') {
          return 'Attachment';
        }
        if (parsed.kind === 'unknown') {
          return parsed.raw ?? '';
        }
        if (parsed.kind === 'text') {
          return parsed.text;
        }
        return '';
      })();

      return (
        <View
          style={[
            styles.messageRow,
            outgoing ? styles.messageRowOutgoing : styles.messageRowIncoming,
          ]}
        >
          <View
            style={[
              styles.messageBubble,
              outgoing ? styles.messageBubbleOutgoing : styles.messageBubbleIncoming,
            ]}
          >
            {parsed.kind === 'image' ? (
              <Image source={{ uri: parsed.url }} style={styles.attachmentImage} contentFit="cover" />
            ) : parsed.kind === 'video' ? (
              <View style={styles.attachmentVideoWrapper}>
                <MessageVideoAttachment uri={parsed.url} />
              </View>
            ) : (
              <Text style={styles.messageBody}>{fallbackText}</Text>
            )}
            <Text style={styles.messageMeta}>{formatMessageTimestamp(item.created_at)}</Text>
          </View>
        </View>
      );
    },
    [user?.id],
  );

  const handleAttach = useCallback(async () => {
    if (!supabase) {
      Alert.alert('Configuration missing', 'Supabase is not configured yet.');
      return;
    }
    if (!user) {
      Alert.alert('Sign in required', 'Sign in to send attachments.');
      refreshAuth();
      return;
    }
    if (!targetUserId) {
      Alert.alert('Unavailable', 'This conversation is no longer available.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow access to your media to attach files.');
      return;
    }

    try {
      const bucketName = MESSAGE_MEDIA_BUCKET;
      setAttaching(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsMultipleSelection: false,
        base64: true,
        quality: 0.8,
      });
      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const mime = asset.mimeType || 'application/octet-stream';
      const isImage = mime.startsWith('image/');
      const isVideo = mime.startsWith('video/');
      const ext = asset.fileName?.split('.').pop()?.toLowerCase() || mime.split('/')[1] || 'bin';
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const filePath = `messages/${user.id}/${filename}`;

      let buffer: ArrayBuffer | null = null;
      if (isImage && asset.base64) {
        // Reuse base64 payload for images
        const bytes = decodeBase64ToUint8Array(asset.base64);
        buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      } else if (asset.uri) {
        const res = await fetch(asset.uri);
        buffer = await res.arrayBuffer();
      }
      if (!buffer) {
        Alert.alert('Attachment failed', 'We could not read the selected file.');
        return;
      }

      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(filePath, buffer, { contentType: mime, upsert: false });
      if (uploadError) {
        throw uploadError;
      }

      const { data: publicData } = supabase.storage.from(bucketName).getPublicUrl(filePath);
      const publicUrl = publicData?.publicUrl || '';
      if (!publicUrl) {
        Alert.alert('Attachment failed', 'We could not generate a public URL for the file.');
        return;
      }

      const prefix = isImage ? 'image:' : isVideo ? 'video:' : 'file:';
      const payload = `${prefix}${publicUrl}`;

      const { data, error } = await supabase
        .from('messages')
        .insert({
          sender_id: user.id,
          recipient_id: targetUserId,
          body: payload,
          created_at: new Date().toISOString(),
        })
        .select('id, sender_id, recipient_id, body, created_at')
        .single();
      if (error) {
        throw error;
      }
      if (data) {
        setMessages((prev) => [...prev, data]);
      }
    } catch (attachError: unknown) {
      console.warn('Attachment send failed', attachError);
      Alert.alert('Send failed', resolveErrorMessage(attachError, 'We could not send your attachment.'));
    } finally {
      setAttaching(false);
    }
  }, [refreshAuth, targetUserId, user]);

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

        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {conversationTitle}
          </Text>
          {targetProfile?.email ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {targetProfile.email}
            </Text>
          ) : null}
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.followToggle,
            isFollowing ? styles.unfollowButton : styles.followButton,
            followBusy && styles.followToggleBusy,
          ]}
          onPress={isFollowing ? handleUnfollow : handleFollow}
          disabled={followBusy}
        >
          <Text
            style={[
              styles.followToggleText,
              isFollowing ? styles.unfollowButtonText : styles.followButtonText,
            ]}
          >
            {followBusy ? '•••' : isFollowing ? 'Unfollow' : 'Follow'}
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        {isBusy ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size='small' color='#3D5C35' />
          </View>
        ) : errorMessage ? (
          <View style={styles.errorContainer}>
            <Ionicons name='warning' size={24} color='#B3261E' style={styles.errorIcon} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : (
          <View style={styles.flex}>
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps='handled'
              ListHeaderComponent={
                targetProfile ? (
                  <View style={styles.profileSummaryContainer}>
                    <ProfileSummary profile={targetProfile} following={isFollowing} />
                    <View style={styles.profileSummaryDivider} />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.emptyConversation}>
                  <Ionicons name='chatbubble-ellipses' size={36} color='#3D5C35' />
                  <Text style={styles.emptyConversationTitle}>Say hello</Text>
                  <Text style={styles.emptyConversationCopy}>
                    Send the first message to start the conversation.
                  </Text>
                </View>
              }
            />

            <View style={styles.composerRow}>
              <TextInput
                style={styles.composerInput}
                placeholder='Write a message'
                placeholderTextColor='#A1A1A1'
                value={inputValue}
                onChangeText={setInputValue}
                editable={!sending}
                multiline
              />
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.sendButton, (sending || attaching) && styles.sendButtonDisabled]}
                onPress={handleAttach}
                disabled={sending || attaching}
              >
                {attaching ? (
                  <ActivityIndicator size='small' color='#111111' />
                ) : (
                  <Ionicons name='attach' size={18} color='#111111' />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.sendButton,
                  (!inputValue.trim() || sending) && styles.sendButtonDisabled,
                ]}
                onPress={handleSend}
                disabled={!inputValue.trim() || sending}
              >
                <Ionicons name='send' size={18} color='#111111' />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  flex: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
    gap: 12,
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
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#6B6B6B',
    marginTop: 2,
  },
  followToggle: {
    minWidth: 90,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  followButton: {
    backgroundColor: '#3D5C35',
  },
  followButtonText: {
    color: '#FFFFFF',
  },
  unfollowButton: {
    backgroundColor: '#EFEFEF',
  },
  unfollowButtonText: {
    color: '#3D5C35',
  },
  followToggleBusy: {
    opacity: 0.6,
  },
  followToggleText: {
    fontSize: 13,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 14,
  },
  errorIcon: {
    opacity: 0.9,
  },
  errorText: {
    fontSize: 14,
    color: '#B3261E',
    textAlign: 'center',
  },
  followRequiredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  followRequiredTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  followRequiredCopy: {
    fontSize: 14,
    color: '#6B6B6B',
    textAlign: 'center',
    lineHeight: 20,
  },
  followCta: {
    marginTop: 8,
    backgroundColor: '#3D5C35',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
  },
  followCtaText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileSummaryContainer: {
    paddingTop: 4,
    paddingBottom: 10,
  },
  profileSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  profileSummaryAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E6E6E6',
  },
  profileSummaryFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSummaryInitials: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileSummaryCopy: {
    flex: 1,
    gap: 4,
  },
  profileSummaryName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  profileSummaryEmail: {
    fontSize: 13,
    color: '#6B6B6B',
  },
  profileSummaryBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  profileSummaryBadge: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  profileSummaryBadgeFollowing: {
    backgroundColor: '#D7F9C4',
  },
  profileSummaryBadgePending: {
    backgroundColor: '#FFE8C7',
  },
  profileSummaryBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  profileSummaryBadgeTextDark: {
    color: '#1F4412',
  },
  profileSummaryBadgeTextLight: {
    color: '#7A4A00',
  },
  profileSummaryDivider: {
    height: 1,
    backgroundColor: '#E8E8E8',
    marginTop: 16,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    paddingTop: 10,
    flexGrow: 1,
  },
  emptyConversation: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyConversationTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  emptyConversationCopy: {
    fontSize: 14,
    color: '#6B6B6B',
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  messageRow: {
    marginBottom: 12,
    flexDirection: 'row',
  },
  messageRowOutgoing: {
    justifyContent: 'flex-end',
  },
  messageRowIncoming: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '78%',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  messageBubbleOutgoing: {
    backgroundColor: '#C8FF9E',
    alignItems: 'flex-end',
  },
  messageBubbleIncoming: {
    backgroundColor: '#EFEFEF',
    alignItems: 'flex-start',
  },
  messageBody: {
    fontSize: 15,
    color: '#111111',
  },
  messageMeta: {
    fontSize: 11,
    color: '#6B6B6B',
  },
  attachmentImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: '#EDEDED',
  },
  attachmentVideoWrapper: {
    width: 220,
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#EDEDED',
  },
  attachmentVideo: {
    width: '100%',
    height: '100%',
  },
  composerRow: {
    borderTopWidth: 1,
    borderTopColor: '#E6E6E6',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    backgroundColor: '#FFFFFF',
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D8D8D8',
    fontSize: 15,
    color: '#111111',
    backgroundColor: '#F8F8F8',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A8FF6F',
  },
  sendButtonDisabled: {
    backgroundColor: '#E0E0E0',
  },
});
