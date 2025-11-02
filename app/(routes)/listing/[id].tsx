import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';

import {
  addToCart,
  addToWishlist,
  fetchListingById,
  fetchListingStats,
  fetchReviewsForListing,
  syncMarketplaceStatsToProfile,
  ListingRecord,
  ReviewRecord,
} from '@/lib/marketplace';
import { formatCurrency } from '@/utils/currency';
import { useSupabaseUser } from '@/hooks/use-supabase-user';

const ACCENT = '#3D5C35';
const TEXT_PRIMARY = '#111111';
const TEXT_MUTED = '#6B6B6B';
const CARD_BG = '#FFFFFF';
const BORDER = '#EAEAEA';

export default function ListingDetailsScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const listingId = (params.id ?? '').toString();
  const { user, refresh: refreshAuth } = useSupabaseUser();

  const [listing, setListing] = useState<ListingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingToCart, setAddingToCart] = useState(false);
  const [wishLoading, setWishLoading] = useState(false);
  const [soldCount, setSoldCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [averageRating, setAverageRating] = useState(0);
  const [remainingStock, setRemainingStock] = useState<number | null>(null);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const listingIdForRealtime = listing?.id ?? null;

  const load = useCallback(async () => {
    if (!listingId) {
      setError('Missing listing id.');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchListingById(listingId);
      setListing(result.data);
      setError(result.error);
      if (result.data) {
        const stats = await fetchListingStats(result.data.id);
        if (!stats.error) {
          setSoldCount(stats.data.soldCount);
          setReviewCount(stats.data.reviewCount);
          setAverageRating(stats.data.averageRating);
        }
        try {
          const stock = await import('@/lib/marketplace').then((m) => m.fetchRemainingStock(result.data!.id));
          if (!stock.error) {
            setRemainingStock(stock.data.remaining);
          } else {
            setRemainingStock(null);
          }
        } catch {
          setRemainingStock(null);
        }
      } else {
        setSoldCount(0);
        setReviewCount(0);
        setAverageRating(0);
        setRemainingStock(null);
      }
    } catch (e) {
      console.warn('Failed to load listing details', e);
      setError('Something went wrong while loading the listing.');
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!listing?.id) {
      setReviews([]);
      setReviewsError(null);
      setReviewsLoading(false);
      return;
    }

    let active = true;
    setReviewsLoading(true);
    setReviewsError(null);

    fetchReviewsForListing(listing.id, { limit: 10 })
      .then((result) => {
        if (!active) return;
        if (result.error) {
          setReviewsError(result.error);
        }
        setReviews(result.data ?? []);
      })
      .catch((err) => {
        if (!active) return;
        console.warn('Failed to load reviews', err);
        setReviewsError('Unable to load reviews right now.');
        setReviews([]);
      })
      .finally(() => {
        if (active) {
          setReviewsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [listing?.id]);

  // Realtime updates for remaining stock
  useEffect(() => {
    if (!listingIdForRealtime) return;
    let active = true;
    let channel: any = null;
    import('@/config/supabase').then(({ supabase }) => {
      if (!supabase) return;
      channel = supabase
        .channel(`listing-stock:${listingIdForRealtime}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'marketplace_order_items', filter: `listing_id=eq.${listingIdForRealtime}` }, async () => {
          try {
            const stock = await import('@/lib/marketplace').then((m) => m.fetchRemainingStock(listingIdForRealtime));
            if (!stock.error && active) setRemainingStock(stock.data.remaining);
          } catch {}
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'marketplace_orders' }, async () => {
          try {
            const stock = await import('@/lib/marketplace').then((m) => m.fetchRemainingStock(listingIdForRealtime));
            if (!stock.error && active) setRemainingStock(stock.data.remaining);
          } catch {}
        })
        .subscribe();
    });
    return () => {
      active = false;
      import('@/config/supabase').then(({ supabase }) => {
        if (supabase && channel) supabase.removeChannel(channel);
      });
    };
  }, [listingIdForRealtime]);

  const price = useMemo(
    () => (listing ? formatCurrency(listing.priceCents, listing.currency) : ''),
    [listing],
  );

  const handleAddToCart = useCallback(async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Sign in to add items to your cart.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go to Login', onPress: () => router.push('/login') },
      ]);
      refreshAuth();
      return;
    }
    if (!listing) return;
    if (typeof remainingStock === 'number' && remainingStock <= 0) {
      Alert.alert('Out of stock', 'This item is currently out of stock.');
      return;
    }
    if (listing.sellerId === user.id) {
      Alert.alert('Not allowed', 'You cannot purchase your own listing.');
      return;
    }

    try {
      setAddingToCart(true);
      const result = await addToCart(user.id, listing.id, 1);
      if (result.error) {
        Alert.alert('Unable to add to cart', result.error);
        return;
      }
      Alert.alert('Added to cart', 'The item was added to your cart.');
      if (user) {
        // Keep profile counters in sync
        await syncMarketplaceStatsToProfile(user.id);
      }
    } catch (e) {
      console.warn('Add to cart failed', e);
      Alert.alert('Something went wrong', 'Unable to add the item to your cart.');
    } finally {
      setAddingToCart(false);
    }
  }, [user, listing, remainingStock, refreshAuth]);

  const handleWishlist = useCallback(async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Sign in to use your wishlist.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go to Login', onPress: () => router.push('/login') },
      ]);
      refreshAuth();
      return;
    }
    if (!listing) return;

    try {
      setWishLoading(true);
      const result = await addToWishlist(user.id, listing.id);
      if (result.error) {
        Alert.alert('Unable to update wishlist', result.error);
        return;
      }
      Alert.alert('Saved', 'Item added to your wishlist.');
    } catch (e) {
      console.warn('Add to wishlist failed', e);
      Alert.alert('Something went wrong', 'Unable to update your wishlist.');
    } finally {
      setWishLoading(false);
    }
  }, [user, listing, refreshAuth]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeAreaCenter}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>Loading product details...</Text>
      </SafeAreaView>
    );
  }

  if (error || !listing) {
    return (
      <SafeAreaView style={styles.safeAreaCenter}>
        <Ionicons name="alert-circle" size={36} color={ACCENT} />
        <Text style={styles.errorTitle}>Unable to load details</Text>
        <Text style={styles.errorCopy}>{error || 'Listing not found.'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={load}>
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={TEXT_PRIMARY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Product Details</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.imageWrapper}>
          {listing.imageUrl ? (
            <Image source={{ uri: listing.imageUrl }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={styles.imageFallback}>
              <Ionicons name="image-outline" size={40} color={ACCENT} />
            </View>
          )}
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.title}>{listing.title || 'Untitled listing'}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="star" size={14} color="#F3B400" />
            <Text style={styles.metaText}>
              {averageRating > 0 ? averageRating.toFixed(1) : '0.0'} (
              {reviewCount} {reviewCount === 1 ? 'Review' : 'Reviews'})
            </Text>
            <View style={styles.dot} />
            <Text style={styles.metaText}>{soldCount} sold</Text>
          </View>
          {typeof remainingStock === 'number' ? (
            <Text style={styles.remainingStock}>
              {remainingStock > 0 ? `${remainingStock} available` : 'Out of stock'}
            </Text>
          ) : null}
          <Text style={styles.price}>{price}</Text>
          <View style={styles.sellerRow}>
            <Ionicons name="person-circle" size={20} color={ACCENT} />
            <Text style={styles.sellerName} numberOfLines={1}>
              {listing.sellerDisplayName}
            </Text>
          </View>
        </View>

        <View style={styles.reviewsCard}>
          <View style={styles.reviewsHeader}>
            <Text style={styles.sectionTitle}>Customer Reviews</Text>
            {reviewCount > 0 ? (
              <Text style={styles.sectionSummary}>
                {reviewCount === 1 ? '1 review' : `${reviewCount} reviews`}
              </Text>
            ) : null}
          </View>

          {reviewsLoading ? (
            <ActivityIndicator size="small" color={ACCENT} />
          ) : reviewsError ? (
            <Text style={styles.reviewError}>{reviewsError}</Text>
          ) : reviews.length === 0 ? (
            <Text style={styles.reviewsEmpty}>No reviews yet.</Text>
          ) : (
            reviews.map((review) => {
              const parsed = new Date(review.createdAt);
              const hasValidDate = !Number.isNaN(parsed.getTime());
              const dateLabel = hasValidDate ? parsed.toLocaleDateString() : null;
              return (
                <View key={review.id} style={styles.reviewItem}>
                  <View style={styles.reviewHeader}>
                    <View style={styles.reviewStars}>
                      {Array.from({ length: 5 }).map((_, index) => (
                        <Ionicons
                          key={index}
                          name={index < review.rating ? 'star' : 'star-outline'}
                          size={14}
                          color="#F3B400"
                        />
                      ))}
                    </View>
                    {dateLabel ? <Text style={styles.reviewDate}>{dateLabel}</Text> : null}
                  </View>
                  {review.comment ? (
                    <Text style={styles.reviewComment}>{review.comment}</Text>
                  ) : (
                    <Text style={styles.reviewCommentMuted}>No comment left.</Text>
                  )}
                  {review.media.length > 0 ? (
                    <View style={styles.reviewMediaList}>
                      {review.media.map((item, index) =>
                        item.type === 'video' ? (
                          <ReviewMediaVideo
                            key={`${review.id}-media-${index}`}
                            uri={item.url}
                          />
                        ) : (
                          <Image
                            key={`${review.id}-media-${index}`}
                            source={{ uri: item.url }}
                            style={styles.reviewMediaImage}
                          />
                        )
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <View style={styles.actionsBar}>
        <TouchableOpacity
          style={[styles.actionPill, styles.messagePill]}
          onPress={() =>
            router.push({ pathname: '/(routes)/messages/[userId]', params: { userId: listing.sellerId } })
          }
          activeOpacity={0.9}
          disabled={user?.id === listing.sellerId}
        >
          <Ionicons name="chatbubble-ellipses" size={18} color={ACCENT} />
          <Text style={styles.actionText}>Message with Seller</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.squareButton, styles.wishButton]}
          onPress={handleWishlist}
          activeOpacity={0.9}
          disabled={wishLoading}
        >
          <Ionicons name="heart" size={22} color={ACCENT} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.squareButton, styles.cartButton]}
          onPress={handleAddToCart}
          activeOpacity={0.9}
          disabled={
            addingToCart || user?.id === listing.sellerId || (typeof remainingStock === 'number' && remainingStock <= 0)
          }
        >
          <Ionicons name="cart" size={22} color={TEXT_PRIMARY} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safeAreaCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    fontSize: 14,
    color: TEXT_MUTED,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  errorCopy: {
    fontSize: 14,
    color: TEXT_MUTED,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  retryButton: {
    borderRadius: 14,
    backgroundColor: ACCENT,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F3F3',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: TEXT_PRIMARY,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    gap: 16,
  },
  imageWrapper: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#F5F5F5',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: TEXT_PRIMARY,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    fontSize: 12,
    color: TEXT_MUTED,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D0D0D0',
  },
  price: {
    fontSize: 22,
    fontWeight: '800',
    color: TEXT_PRIMARY,
    marginTop: 4,
  },
  remainingStock: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2D7A36',
    marginTop: 6,
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  sellerName: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT_MUTED,
  },
  reviewsCard: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 12,
  },
  reviewsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  sectionSummary: {
    fontSize: 12,
    color: TEXT_MUTED,
  },
  reviewsEmpty: {
    fontSize: 13,
    color: TEXT_MUTED,
  },
  reviewError: {
    fontSize: 13,
    color: '#C73535',
  },
  reviewItem: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 12,
    gap: 6,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewStars: {
    flexDirection: 'row',
    gap: 4,
  },
  reviewDate: {
    fontSize: 11,
    color: TEXT_MUTED,
  },
  reviewComment: {
    fontSize: 13,
    color: TEXT_PRIMARY,
  },
  reviewCommentMuted: {
    fontSize: 13,
    color: TEXT_MUTED,
  },
  reviewMediaList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  reviewMediaImage: {
    width: 110,
    height: 110,
    borderRadius: 12,
    backgroundColor: '#F0F0F0',
  },
  reviewMediaVideoWrapper: {
    width: 180,
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  reviewMediaVideo: {
    width: '100%',
    height: '100%',
  },
  actionsBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionPill: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EAF7E5',
  },
  messagePill: {},
  actionText: {
    fontSize: 14,
    fontWeight: '700',
    color: ACCENT,
  },
  squareButton: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wishButton: {
    backgroundColor: '#EAF7E5',
  },
  cartButton: {
    backgroundColor: '#C8FF9E',
  },
});

function ReviewMediaVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(
    uri,
    useCallback((playerInstance) => {
      playerInstance.loop = false;
      playerInstance.pause();
    }, [uri]),
  );

  return (
    <View style={styles.reviewMediaVideoWrapper}>
      <VideoView
        player={player}
        style={styles.reviewMediaVideo}
        nativeControls
        allowsFullscreen
        contentFit="cover"
        allowsPictureInPicture
      />
    </View>
  );
}

