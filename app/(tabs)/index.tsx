import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';

import {
  ListingRecord,
  fetchListings,
  subscribeToListings,
} from '@/lib/marketplace';
import { formatCurrency } from '@/utils/currency';

const SECTION_TITLE_COLOR = '#1F3D2B';
const MUTED_TEXT = '#5B7A6F';
const SEARCH_BAR_BACKGROUND = '#EFF8F1';
const CARD_BACKGROUND = '#FFFFFF';
const CARD_BORDER = '#D7E6D8';
const PRIMARY_ACCENT = '#3A8C66';
const SECONDARY_ACCENT = '#F1F8F2';
const SAFE_AREA_BACKGROUND = '#F6FBF5';

const SHOP_LOGO = require('@/assets/images/shopnchat-logo.png');


type ListingCardProps = {
  listing: ListingRecord;
  onPress?: (listing: ListingRecord) => void;
};

const ListingCard = ({ listing, onPress }: ListingCardProps) => {
  const price = formatCurrency(listing.priceCents, listing.currency);

  return (
    <TouchableOpacity
      style={styles.listingCard}
      activeOpacity={0.9}
      onPress={() => onPress?.(listing)}
    >
      <View style={styles.thumbnailWrapper}>
        {listing.imageUrl ? (
          <Image source={{ uri: listing.imageUrl }} style={styles.thumbnail} resizeMode="cover" />
        ) : (
          <View style={styles.thumbnailFallback}>
            <Ionicons name="image-outline" size={28} color={PRIMARY_ACCENT} />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.sellerRow}>
          <Ionicons name="person-circle" size={18} color={PRIMARY_ACCENT} />
          <Text style={styles.sellerName} numberOfLines={1}>
            {listing.sellerDisplayName}
          </Text>
        </View>
        <Text style={styles.listingTitle} numberOfLines={2}>
          {listing.title || 'Untitled listing'}
        </Text>
        {listing.description ? (
          <Text style={styles.listingDescription} numberOfLines={2}>
            {listing.description}
          </Text>
        ) : null}
        <View style={styles.cardFooter}>
          <Text style={styles.listingPrice}>{price}</Text>
          {listing.allowTrade ? (
            <View style={styles.tradeBadge}>
              <Ionicons name="swap-horizontal" size={14} color={PRIMARY_ACCENT} />
              <Text style={styles.tradeBadgeText}>Trade-ready</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

type EmptyStateProps = {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

const EmptyState = ({ loading, error, onRetry }: EmptyStateProps) => (
  <View style={styles.emptyState}>
    {loading ? (
      <>
        <ActivityIndicator size="large" color={PRIMARY_ACCENT} />
        <Text style={styles.emptyTitle}>Loading marketplace...</Text>
        <Text style={styles.emptySubtitle}>Fetching the latest listings for you.</Text>
      </>
    ) : (
      <>
        <Ionicons name="leaf-outline" size={42} color={PRIMARY_ACCENT} />
        <Text style={styles.emptyTitle}>
          {error ? 'Unable to load listings' : 'No listings just yet'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {error
            ? error
            : 'Once sellers publish items, they will appear here instantly.'}
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.85}>
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>Refresh feed</Text>
        </TouchableOpacity>
      </>
    )}
  </View>
);

const KEY_EXTRACTOR = (item: ListingRecord) => item.id;

export default function HomeScreen() {
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const handleLoad = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const result = await fetchListings();
        if (result.error) {
          setErrorMessage(result.error);
        } else {
          setErrorMessage(null);
        }
        setListings(result.data);
      } catch (error) {
        console.warn('Failed to fetch listings', error);
        setErrorMessage('Something went wrong while loading listings.');
      } finally {
        if (mode === 'initial') {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    handleLoad().catch((internalError) => console.warn('Initial listing load failed', internalError));
  }, [handleLoad]);

  useEffect(() => {
    unsubscribeRef.current?.();
    const unsubscribe = subscribeToListings((data) => {
      setListings(data);
      if (data.length > 0) {
        setErrorMessage(null);
      }
    });
    unsubscribeRef.current = unsubscribe;
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      handleLoad('refresh').catch((internalError) =>
        console.warn('Focus refresh failed', internalError),
      );
    }, [handleLoad]),
  );

  const filteredListings = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed) {
      return listings;
    }

    return listings.filter((listing) => {
      const haystack = [
        listing.title,
        listing.description,
        listing.sellerDisplayName,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [listings, searchQuery]);

  const handleRefresh = useCallback(() => {
    handleLoad('refresh').catch((error) => console.warn('Manual refresh failed', error));
  }, [handleLoad]);

  const header = useMemo(
    () => (
      <View style={styles.headerContainer}>
          <View style={styles.heroHeader}>
            <View style={styles.heroLogoWrapper}>
              <Image source={SHOP_LOGO} style={styles.heroLogo} resizeMode="contain" />
            </View>
          <View style={styles.heroTextGroup}>
            <Text style={styles.heroTitle}>ShopNChat</Text>
            <Text style={styles.heroSubtitle}>Discover community-powered finds around you.</Text>
          </View>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={MUTED_TEXT} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search sustainable finds, shops, or neighbors"
            placeholderTextColor={MUTED_TEXT}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
        </View>

        <Text style={styles.sectionTitle}>
          {filteredListings.length > 0 ? 'Fresh community listings' : 'Nothing posted yet'}
        </Text>
      </View>
    ),
    [filteredListings.length, searchQuery],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={filteredListings}
        keyExtractor={KEY_EXTRACTOR}
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            onPress={(l) =>
              router.push({ pathname: '/(routes)/listing/[id]', params: { id: l.id } })
            }
          />
        )}
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          filteredListings.length === 0 ? styles.emptyListContent : null,
        ]}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState loading={loading} error={errorMessage} onRetry={handleRefresh} />
        }
        refreshing={refreshing}
        onRefresh={handleRefresh}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: SAFE_AREA_BACKGROUND,
  },
  list: {
    flex: 1,
    backgroundColor: SAFE_AREA_BACKGROUND,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
    gap: 20,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  headerContainer: {
    gap: 20,
  },
  heroHeader: {
    alignItems: 'center',
    gap: 16,
  },
  heroLogoWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLogo: {
    width: '90%',
    height: '90%',
  },
  heroTextGroup: {
    alignItems: 'center',
    gap: 6,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: SECTION_TITLE_COLOR,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: MUTED_TEXT,
    textAlign: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SEARCH_BAR_BACKGROUND,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 46,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 4,
        blurRadius: 10,
        color: 'rgba(58, 140, 102, 0.04)',
      },
    ],
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    color: SECTION_TITLE_COLOR,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: SECTION_TITLE_COLOR,
  },
  listingCard: {
    flexDirection: 'row',
    backgroundColor: CARD_BACKGROUND,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    gap: 14,
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 6,
        blurRadius: 12,
        color: 'rgba(58, 140, 102, 0.06)',
      },
    ],
    elevation: 3,
  },
  thumbnailWrapper: {
    width: 86,
    height: 86,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F1F7F0',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SECONDARY_ACCENT,
  },
  cardBody: {
    flex: 1,
    gap: 6,
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sellerName: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED_TEXT,
  },
  listingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: SECTION_TITLE_COLOR,
    lineHeight: 20,
  },
  listingDescription: {
    fontSize: 12,
    color: MUTED_TEXT,
    lineHeight: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  listingPrice: {
    fontSize: 17,
    fontWeight: '700',
    color: SECTION_TITLE_COLOR,
  },
  tradeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: SECONDARY_ACCENT,
  },
  tradeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: PRIMARY_ACCENT,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: SECTION_TITLE_COLOR,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: MUTED_TEXT,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: PRIMARY_ACCENT,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
