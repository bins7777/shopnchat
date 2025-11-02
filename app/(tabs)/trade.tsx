import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
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
  TradeOffer,
  TradeStatus,
  createTradeOffer,
  fetchListings,
  fetchSellerStatus,
  fetchTradeOffers,
  updateTradeStatus,
} from '@/lib/marketplace';
import { formatCurrency, parsePriceInput } from '@/utils/currency';
import { useSupabaseUser } from '@/hooks/use-supabase-user';

type TradeTab = 'outgoing' | 'incoming';

const ACCENT = '#3D5C35';
const BORDER = '#E6E6E6';
const MUTED = '#6F6F6F';
const CTA_RED = '#FF6961';
const CTA_GREEN = '#9BFF67';

const STATUS_COLORS: Record<TradeStatus, string> = {
  pending: '#FFF4D1',
  accepted: '#E0F7D9',
  declined: '#FFE1E1',
  cancelled: '#E9EBED',
  completed: '#DDEBFF',
};

const getStatusBadgeStyle = (status: TradeStatus) => ({
  backgroundColor: STATUS_COLORS[status] ?? '#E9EBED',
});

const keyExtractor = (item: TradeOffer) => item.id;

type TradeCardProps = {
  offer: TradeOffer;
  mode: TradeTab;
  onAccept: (offer: TradeOffer) => void;
  onDecline: (offer: TradeOffer) => void;
};

const TradeCard = ({ offer, mode, onAccept, onDecline }: TradeCardProps) => {
  const listing = offer.listing;
  const price =
    listing && listing.priceCents > 0
      ? formatCurrency(listing.priceCents, listing.currency)
      : null;

  const valueContribution =
    offer.offeredValueCents && offer.offeredValueCents > 0
      ? formatCurrency(offer.offeredValueCents, offer.currency)
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.counterpartyLabel}>
            {mode === 'outgoing' ? 'Offered to' : 'From'}
          </Text>
          <Text style={styles.counterpartyName}>{offer.counterpartyName}</Text>
        </View>
      <View style={[styles.statusBadge, getStatusBadgeStyle(offer.status)]}>
        <Text style={styles.statusText}>{offer.status.toUpperCase()}</Text>
      </View>
      </View>
      {listing ? (
        <View style={styles.listingSnippet}>
          <Ionicons name="pricetag" size={16} color={ACCENT} />
          <View style={styles.listingCopy}>
            <Text style={styles.listingTitle} numberOfLines={1}>
              {listing.title || 'Untitled listing'}
            </Text>
            <Text style={styles.listingMeta}>
              {price ? `${price} • ` : ''}
              Seller: {listing.sellerDisplayName}
            </Text>
          </View>
        </View>
      ) : null}
      {offer.offeredItemDescription ? (
        <Text style={styles.offerNote}>{offer.offeredItemDescription}</Text>
      ) : null}
      {valueContribution ? (
        <Text style={styles.offerNote}>Estimated value: {valueContribution}</Text>
      ) : null}

      {mode === 'incoming' && offer.status === 'pending' ? (
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.acceptButton]}
            onPress={() => onAccept(offer)}
            activeOpacity={0.8}
          >
            <Text style={styles.acceptButtonText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.declineButton]}
            onPress={() => onDecline(offer)}
            activeOpacity={0.8}
          >
            <Text style={styles.declineButtonText}>Decline</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

type EmptyStateProps = {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  label: string;
};

const EmptyState = ({ loading, error, onRetry, label }: EmptyStateProps) => (
  <View style={styles.emptyState}>
    {loading ? (
      <>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.emptyTitle}>Loading {label}…</Text>
      </>
    ) : (
      <>
        <Ionicons name="swap-horizontal" size={32} color={ACCENT} />
        <Text style={styles.emptyTitle}>
          {error ? `Unable to load ${label}` : `No ${label} yet`}
        </Text>
        <Text style={styles.emptySubtitle}>
          {error ? error : 'Once a trade is started, it will appear here.'}
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.85}>
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>Refresh</Text>
        </TouchableOpacity>
      </>
    )}
  </View>
);

type TradeComposerProps = {
  visible: boolean;
  listings: ListingRecord[];
  onClose: () => void;
  onSubmit: (listingId: string, comment: string, valueCents: number | null) => void;
  submitting: boolean;
};

const TradeComposer = ({
  visible,
  listings,
  onClose,
  onSubmit,
  submitting,
}: TradeComposerProps) => {
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [valueInput, setValueInput] = useState('');

  useEffect(() => {
    if (!visible) {
      setSelectedListingId(null);
      setMessage('');
      setValueInput('');
    }
  }, [visible]);

  const handleSubmit = () => {
    if (!selectedListingId) {
      Alert.alert('Pick a listing', 'Select an item you want to trade for.');
      return;
    }
    const cents = valueInput ? parsePriceInput(valueInput) : null;
    onSubmit(selectedListingId, message.trim(), cents && cents > 0 ? cents : null);
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.composerOverlay}>
        <View style={styles.composerSheet}>
          <View style={styles.composerHeader}>
            <Text style={styles.composerTitle}>New Trade Offer</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.composerClose}
              disabled={submitting}
            >
              <Ionicons name="close" size={20} color={submitting ? '#AAA' : '#111'} />
            </TouchableOpacity>
          </View>

          {listings.length === 0 ? (
            <View style={styles.composerEmptyListings}>
              <Text style={styles.composerEmptyText}>
                There are no listings available to trade right now. Check back later.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.composerListings}
              contentContainerStyle={styles.composerListingsContent}
            >
              {listings.map((listing) => {
                const selected = listing.id === selectedListingId;
                return (
                  <TouchableOpacity
                    key={listing.id}
                    style={[
                      styles.composerListing,
                      selected ? styles.composerListingSelected : null,
                    ]}
                    onPress={() => setSelectedListingId(listing.id)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.composerListingIcon}>
                      <Ionicons name="cube-outline" size={18} color={ACCENT} />
                    </View>
                    <View style={styles.composerListingCopy}>
                      <Text style={styles.composerListingTitle} numberOfLines={1}>
                        {listing.title || 'Untitled listing'}
                      </Text>
                      <Text style={styles.composerListingMeta} numberOfLines={1}>
                        {formatCurrency(listing.priceCents, listing.currency)} •{' '}
                        {listing.sellerDisplayName}
                      </Text>
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={20} color={ACCENT} />
                    ) : (
                      <Ionicons name="ellipse-outline" size={20} color="#C9C9C9" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.composerField}>
            <Text style={styles.composerLabel}>MESSAGE</Text>
            <TextInput
              style={styles.composerInput}
              placeholder="What can you offer in exchange?"
              placeholderTextColor={MUTED}
              value={message}
              onChangeText={setMessage}
              multiline
            />
          </View>

          <View style={styles.composerField}>
            <Text style={styles.composerLabel}>ESTIMATED VALUE (OPTIONAL)</Text>
            <TextInput
              style={styles.composerInput}
              placeholder="e.g. 500"
              placeholderTextColor={MUTED}
              keyboardType="decimal-pad"
              value={valueInput}
              onChangeText={setValueInput}
            />
          </View>

          <TouchableOpacity
            style={[styles.composerSubmit, submitting ? styles.composerSubmitDisabled : null]}
            onPress={handleSubmit}
            activeOpacity={0.85}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.composerSubmitText}>Send offer</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default function TradeScreen() {
  const { user, loading: authLoading } = useSupabaseUser();
  const [activeTab, setActiveTab] = useState<TradeTab>('outgoing');
  const [outgoing, setOutgoing] = useState<TradeOffer[]>([]);
  const [incoming, setIncoming] = useState<TradeOffer[]>([]);
  const [loadingOutgoing, setLoadingOutgoing] = useState(true);
  const [loadingIncoming, setLoadingIncoming] = useState(true);
  const [errorOutgoing, setErrorOutgoing] = useState<string | null>(null);
  const [errorIncoming, setErrorIncoming] = useState<string | null>(null);
  const [sellerStatus, setSellerStatus] = useState<'none' | 'pending' | 'approved' | 'rejected'>(
    'none',
  );
  const [composerVisible, setComposerVisible] = useState(false);
  const [availableListings, setAvailableListings] = useState<ListingRecord[]>([]);
  const [composerBusy, setComposerBusy] = useState(false);

  const loadSellerStatus = useCallback(async () => {
    if (!user) {
      setSellerStatus('none');
      return;
    }
    try {
      const status = await fetchSellerStatus(user.id);
      if (status.error) {
        console.warn('Unable to load seller status', status.error);
      }
      setSellerStatus(status.data.state);
    } catch (error) {
      console.warn('Seller status fetch failed', error);
      setSellerStatus('none');
    }
  }, [user]);

  const loadOutgoing = useCallback(async () => {
    if (!user) {
      setOutgoing([]);
      setLoadingOutgoing(false);
      setErrorOutgoing(null);
      return;
    }
    setLoadingOutgoing(true);

    try {
      const result = await fetchTradeOffers(user.id, 'outgoing');
      if (result.error) {
        setErrorOutgoing(result.error);
      } else {
        setErrorOutgoing(null);
      }
      setOutgoing(result.data);
    } catch (error) {
      console.warn('Failed to load outgoing offers', error);
      setErrorOutgoing('Something went wrong while loading your offers.');
    } finally {
      setLoadingOutgoing(false);
    }
  }, [user]);

  const loadIncoming = useCallback(async () => {
    if (!user) {
      setIncoming([]);
      setLoadingIncoming(false);
      setErrorIncoming(null);
      return;
    }
    setLoadingIncoming(true);

    try {
      const result = await fetchTradeOffers(user.id, 'incoming');
      if (result.error) {
        setErrorIncoming(result.error);
      } else {
        setErrorIncoming(null);
      }
      setIncoming(result.data);
    } catch (error) {
      console.warn('Failed to load incoming offers', error);
      setErrorIncoming('Something went wrong while loading incoming offers.');
    } finally {
      setLoadingIncoming(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) {
      loadSellerStatus().catch((error) => console.warn('Seller status init failed', error));
      loadOutgoing().catch((error) => console.warn('Outgoing init failed', error));
      loadIncoming().catch((error) => console.warn('Incoming init failed', error));
    }
  }, [authLoading, loadIncoming, loadOutgoing, loadSellerStatus]);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        return;
      }
      loadOutgoing().catch((error) => console.warn('Outgoing refresh failed', error));
      loadIncoming().catch((error) => console.warn('Incoming refresh failed', error));
      loadSellerStatus().catch((error) => console.warn('Seller status refresh failed', error));
    }, [loadIncoming, loadOutgoing, loadSellerStatus, user]),
  );

  // Allow all signed-in users to trade without seller approval
  const requiresSellerApproval = false;

  const openComposer = useCallback(async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    try {
      const listingResult = await fetchListings();
      if (listingResult.error) {
        Alert.alert('Unable to load listings', listingResult.error);
        return;
      }

      const filtered = listingResult.data.filter((listing) => listing.sellerId !== user.id);
      setAvailableListings(filtered);
      setComposerVisible(true);
    } catch (error) {
      console.warn('Failed to load listings for trade composer', error);
      Alert.alert('Something went wrong', 'Unable to load listings for trade offers.');
    }
  }, [user]);

  const handleComposerSubmit = useCallback(
    async (listingId: string, comment: string, valueCents: number | null) => {
      if (!user) {
        setComposerVisible(false);
        router.push('/login');
        return;
      }

      setComposerBusy(true);

      try {
        const result = await createTradeOffer(user.id, {
          listingId,
          offeredItemDescription: comment,
          offeredValueCents: valueCents ?? undefined,
        });

        if (result.error) {
          Alert.alert('Unable to send offer', result.error);
          return;
        }

        Alert.alert('Offer sent', 'The seller has been notified about your trade offer.');
        await loadOutgoing();
        setComposerVisible(false);
      } catch (error) {
        console.warn('Trade offer creation failed', error);
        Alert.alert('Something went wrong', 'Unable to create the trade offer right now.');
      } finally {
        setComposerBusy(false);
      }
    },
    [loadOutgoing, user],
  );

  const updateStatus = useCallback(
    async (offer: TradeOffer, status: TradeStatus) => {
      try {
        const result = await updateTradeStatus(offer.id, status);
        if (result.error) {
          Alert.alert('Unable to update offer', result.error);
          return;
        }
        await Promise.all([loadIncoming(), loadOutgoing()]);
      } catch (error) {
        console.warn('Failed to update trade status', error);
        Alert.alert('Something went wrong', 'Unable to update the trade offer right now.');
      }
    },
    [loadIncoming, loadOutgoing],
  );

  const outgoingList = useMemo(
    () => (
      <FlatList
        data={outgoing}
        keyExtractor={keyExtractor}
        renderItem={({ item }) => (
          <TradeCard
            offer={item}
            mode="outgoing"
            onAccept={() => {}}
            onDecline={() => {}}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          outgoing.length === 0 ? styles.emptyListContent : null,
        ]}
        ListEmptyComponent={
          <EmptyState
            loading={loadingOutgoing}
            error={errorOutgoing}
            onRetry={loadOutgoing}
            label="outgoing offers"
          />
        }
        showsVerticalScrollIndicator={false}
      />
    ),
    [errorOutgoing, loadOutgoing, loadingOutgoing, outgoing],
  );

  const incomingList = useMemo(
    () => (
      <FlatList
        data={incoming}
        keyExtractor={keyExtractor}
        renderItem={({ item }) => (
          <TradeCard
            offer={item}
            mode="incoming"
            onAccept={(offer) => updateStatus(offer, 'accepted')}
            onDecline={(offer) => updateStatus(offer, 'declined')}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          incoming.length === 0 ? styles.emptyListContent : null,
        ]}
        ListEmptyComponent={
          <EmptyState
            loading={loadingIncoming}
            error={errorIncoming}
            onRetry={loadIncoming}
            label="incoming offers"
          />
        }
        showsVerticalScrollIndicator={false}
      />
    ),
    [errorIncoming, incoming, loadIncoming, loadingIncoming, updateStatus],
  );

  const body = useMemo(() => {
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
        <View style={styles.gateContainer}>
          <Ionicons name="log-in-outline" size={36} color={ACCENT} />
          <Text style={styles.gateTitle}>Sign in to access trades</Text>
          <Text style={styles.gateSubtitle}>
            Log in to manage offers and negotiate with other sellers.
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

    if (requiresSellerApproval) {
      return (
        <View style={styles.gateContainer}>
          <Ionicons name="alert-circle-outline" size={36} color={ACCENT} />
          <Text style={styles.gateTitle}>Seller tools locked</Text>
          <Text style={styles.gateSubtitle}>
            {sellerStatus === 'pending'
              ? 'Your seller application is under review. We will unlock trading once it is approved.'
              : 'You need an approved seller profile before you can negotiate trades.'}
          </Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => router.push('/seller/register')}
            activeOpacity={0.85}
          >
            <Ionicons name="document-text-outline" size={16} color="#FFFFFF" />
            <Text style={styles.retryButtonText}>Apply as seller</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return activeTab === 'outgoing' ? outgoingList : incomingList;
  }, [
    activeTab,
    authLoading,
    outgoingList,
    incomingList,
    requiresSellerApproval,
    sellerStatus,
    user,
  ]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Trade</Text>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'outgoing' ? styles.tabButtonActive : null]}
          onPress={() => setActiveTab('outgoing')}
          activeOpacity={0.85}
        >
          <Text
            style={[styles.tabLabel, activeTab === 'outgoing' ? styles.tabLabelActive : null]}
          >
            My Offers
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'incoming' ? styles.tabButtonActive : null]}
          onPress={() => setActiveTab('incoming')}
          activeOpacity={0.85}
        >
          <Text
            style={[styles.tabLabel, activeTab === 'incoming' ? styles.tabLabelActive : null]}
          >
            Incoming
          </Text>
        </TouchableOpacity>
      </View>

      {body}

      {user && !requiresSellerApproval ? (
        <TouchableOpacity
          style={styles.fab}
          onPress={openComposer}
          activeOpacity={0.9}
        >
          <Ionicons name="add" size={26} color="#111111" />
          <Text style={styles.fabText}>New trade offer</Text>
        </TouchableOpacity>
      ) : null}

      <TradeComposer
        visible={composerVisible}
        listings={availableListings}
        onClose={() => {
          if (!composerBusy) {
            setComposerVisible(false);
          }
        }}
        onSubmit={handleComposerSubmit}
        submitting={composerBusy}
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
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111111',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  tabButtonActive: {
    borderBottomWidth: 3,
    borderBottomColor: ACCENT,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: MUTED,
  },
  tabLabelActive: {
    color: '#111111',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 140,
    gap: 16,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 12,
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counterpartyLabel: {
    fontSize: 12,
    color: MUTED,
  },
  counterpartyName: {
    marginTop: 2,
    fontSize: 17,
    fontWeight: '700',
    color: '#111111',
  },
  statusBadge: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111111',
  },
  listingSnippet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  listingCopy: {
    flex: 1,
    gap: 2,
  },
  listingTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  listingMeta: {
    fontSize: 12,
    color: MUTED,
  },
  offerNote: {
    fontSize: 13,
    color: MUTED,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  actionButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButton: {
    backgroundColor: CTA_GREEN,
  },
  declineButton: {
    backgroundColor: CTA_RED,
  },
  acceptButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111111',
  },
  declineButtonText: {
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
  fab: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 24,
    borderRadius: 18,
    backgroundColor: '#E6F9D1',
    borderWidth: 1,
    borderColor: '#B7E89A',
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 4,
        blurRadius: 6,
        color: 'rgba(0, 0, 0, 0.08)',
      },
    ],
    elevation: 4,
  },
  fabText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  composerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  composerSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 30,
    gap: 16,
  },
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  composerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  composerClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerListings: {
    maxHeight: 180,
  },
  composerListingsContent: {
    gap: 10,
  },
  composerListing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    padding: 12,
  },
  composerListingSelected: {
    borderColor: ACCENT,
    backgroundColor: '#F3FAEF',
  },
  composerListingIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EAF7E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerListingCopy: {
    flex: 1,
  },
  composerListingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111111',
  },
  composerListingMeta: {
    fontSize: 12,
    color: MUTED,
  },
  composerField: {
    gap: 6,
  },
  composerLabel: {
    fontSize: 12,
    color: MUTED,
    letterSpacing: 1,
  },
  composerInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    color: '#111111',
  },
  composerSubmit: {
    borderRadius: 16,
    backgroundColor: ACCENT,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerSubmitDisabled: {
    opacity: 0.6,
  },
  composerSubmitText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  composerEmptyListings: {
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    backgroundColor: '#F9F9F9',
  },
  composerEmptyText: {
    fontSize: 13,
    color: MUTED,
  },
  authLoadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  authLoadingText: {
    fontSize: 14,
    color: MUTED,
  },
  gateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  gateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
    textAlign: 'center',
  },
  gateSubtitle: {
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 20,
  },
});
