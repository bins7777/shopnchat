import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';

import {
  WishlistEntry,
  addToCart,
  fetchWishlist,
  removeFromWishlist,
  syncMarketplaceStatsToProfile,
} from '@/lib/marketplace';
import { formatCurrency } from '@/utils/currency';
import { useSupabaseUser } from '@/hooks/use-supabase-user';

const CARD_BORDER = '#ECECEC';
const CARD_BACKGROUND = '#FFFFFF';
const CTA_BLUE = '#4E8DF7';
const CTA_RED = '#FF5C5C';
const ACCENT = '#3D5C35';
const MUTED = '#6F6F6F';

const keyExtractor = (item: WishlistEntry) => item.id;

type WishlistCardProps = {
  entry: WishlistEntry;
  onAddToCart: (entry: WishlistEntry) => void;
  onRemove: (entry: WishlistEntry) => void;
};

const WishlistCard = ({ entry, onAddToCart, onRemove }: WishlistCardProps) => {
  const price = formatCurrency(entry.listing.priceCents, entry.listing.currency);
  return (
    <View style={styles.card}>
      <View style={styles.thumbnailWrapper}>
        {entry.listing.imageUrl ? (
          <Image
            source={{ uri: entry.listing.imageUrl }}
            style={styles.thumbnailImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.thumbnailFallback}>
            <Ionicons name="sparkles-outline" size={22} color={ACCENT} />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {entry.listing.title || 'Untitled listing'}
        </Text>
        <Text style={styles.cardPrice}>{price}</Text>
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.addButton]}
            onPress={() => onAddToCart(entry)}
            activeOpacity={0.85}
          >
            <Text style={styles.addButtonText}>Add to cart</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.removeButton]}
            onPress={() => onRemove(entry)}
            activeOpacity={0.85}
          >
            <Text style={styles.removeButtonText}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

type EmptyStateProps = {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  canRetry: boolean;
};

const EmptyState = ({ loading, error, onRetry, canRetry }: EmptyStateProps) => (
  <View style={styles.emptyState}>
    {loading ? (
      <>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.emptyTitle}>Loading your wishlist…</Text>
      </>
    ) : (
      <>
        <Ionicons name="heart-outline" size={36} color={ACCENT} />
        <Text style={styles.emptyTitle}>
          {error ? 'Unable to load wishlist' : 'Your wishlist is empty'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {error
            ? error
            : 'Save items you love and revisit them anytime from here.'}
        </Text>
        {canRetry ? (
          <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.85}>
            <Ionicons name="refresh" size={16} color="#FFFFFF" />
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        ) : null}
      </>
    )}
  </View>
);

export default function WishlistScreen() {
  const { user, loading: authLoading } = useSupabaseUser();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadWishlist = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!user) {
        setEntries([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const result = await fetchWishlist(user.id);
        if (result.error) {
          setErrorMessage(result.error);
        } else {
          setErrorMessage(null);
        }
        setEntries(result.data);
      } catch (error) {
        console.warn('Failed to load wishlist', error);
        setErrorMessage('Something went wrong while loading your wishlist.');
      } finally {
        if (mode === 'initial') {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [user],
  );

  useEffect(() => {
    if (!authLoading) {
      loadWishlist().catch((internalError) =>
        console.warn('Initial wishlist load failed', internalError),
      );
    }
  }, [authLoading, loadWishlist]);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        return;
      }
      loadWishlist('refresh').catch((internalError) =>
        console.warn('Wishlist focus refresh failed', internalError),
      );
    }, [loadWishlist, user]),
  );

  const handleAddToCart = useCallback(
    async (entry: WishlistEntry) => {
      if (!user) {
        router.push('/login');
        return;
      }

      try {
        const result = await addToCart(user.id, entry.listing.id, 1);
        if (result.error) {
          Alert.alert('Unable to add', result.error);
          return;
        }
        Alert.alert(
          'Added to cart',
          `${entry.listing.title || 'Item'} is now in your cart.`,
        );
        await syncMarketplaceStatsToProfile(user.id);
      } catch (error) {
        console.warn('Add to cart from wishlist failed', error);
        Alert.alert('Something went wrong', 'We could not add the item to your cart.');
      }
    },
    [user],
  );

  const handleRemove = useCallback(
    async (entry: WishlistEntry) => {
      if (!user) {
        return;
      }

      try {
        const result = await removeFromWishlist(user.id, entry.listing.id);
        if (result.error) {
          Alert.alert('Unable to remove', result.error);
          return;
        }
        setEntries((current) => current.filter((item) => item.id !== entry.id));
      } catch (error) {
        console.warn('Failed to remove wishlist item', error);
        Alert.alert('Something went wrong', 'Unable to remove the item right now.');
      }
    },
    [user],
  );

  const emptyState = useMemo(() => {
    if (authLoading) {
      return (
        <View style={styles.authLoadingState}>
          <ActivityIndicator size="small" color={ACCENT} />
          <Text style={styles.authLoadingText}>Checking your account…</Text>
        </View>
      );
    }

    if (!user) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="log-in-outline" size={36} color={ACCENT} />
          <Text style={styles.emptyTitle}>Sign in to build your wishlist</Text>
          <Text style={styles.emptySubtitle}>
            Save favourites and revisit them across devices.
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => router.push('/login')}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            <Text style={styles.retryButtonText}>Go to login</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <EmptyState
        loading={loading}
        error={errorMessage}
        onRetry={() => loadWishlist('refresh')}
        canRetry={true}
      />
    );
  }, [authLoading, errorMessage, loading, loadWishlist, user]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Wishlist</Text>
        <Text style={styles.headerSubtitle}>
          {entries.length === 0 ? 'No saved items yet' : `${entries.length} saved item(s)`}
        </Text>
      </View>
      <FlatList
        data={entries}
        keyExtractor={keyExtractor}
        renderItem={({ item }) => (
          <WishlistCard entry={item} onAddToCart={handleAddToCart} onRemove={handleRemove} />
        )}
        contentContainerStyle={[
          styles.listContent,
          entries.length === 0 ? styles.emptyListContent : null,
        ]}
        refreshing={refreshing}
        onRefresh={() => loadWishlist('refresh')}
        ListEmptyComponent={emptyState}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  headerRow: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111111',
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: MUTED,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_BACKGROUND,
    padding: 16,
    gap: 16,
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 4,
        blurRadius: 6,
        color: 'rgba(0, 0, 0, 0.05)',
      },
    ],
    elevation: 2,
  },
  thumbnailWrapper: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: '#F3F3F3',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#222222',
  },
  cardPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: MUTED,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    backgroundColor: CTA_BLUE,
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  removeButton: {
    backgroundColor: CTA_RED,
  },
  removeButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  authLoadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  authLoadingText: {
    fontSize: 14,
    color: MUTED,
  },
});
