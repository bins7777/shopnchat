import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
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
  AVAILABLE_PAYMENT_METHODS,
  CartEntry,
  PaymentMethod,
  checkoutCart,
  fetchCart,
  syncMarketplaceStatsToProfile,
  updateCartQuantity,
} from '@/lib/marketplace';
import { formatCurrency } from '@/utils/currency';
import { useSupabaseUser } from '@/hooks/use-supabase-user';

const CARD_BORDER = '#F0F0F0';
const CARD_BACKGROUND = '#FFFFFF';
const ACCENT = '#3D5C35';
const MUTED = '#6F6F6F';
const CTA_RED = '#FF5C5C';

const keyExtractor = (item: CartEntry) => item.id;

type CartCardProps = {
  entry: CartEntry;
  onIncrement: (entry: CartEntry) => void;
  onDecrement: (entry: CartEntry) => void;
  onRemove: (entry: CartEntry) => void;
};

const CartCard = ({ entry, onIncrement, onDecrement, onRemove }: CartCardProps) => {
  const price = formatCurrency(entry.listing.priceCents, entry.listing.currency);
  const lineTotal = formatCurrency(
    entry.listing.priceCents * entry.quantity,
    entry.listing.currency,
  );

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
            <Ionicons name="cube-outline" size={26} color={ACCENT} />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {entry.listing.title || 'Untitled listing'}
        </Text>
        <Text style={styles.cardPrice}>{price}</Text>
        <View style={styles.quantityRow}>
          <TouchableOpacity
            style={styles.quantityButton}
            onPress={() => onDecrement(entry)}
            activeOpacity={0.7}
          >
            <Ionicons name="remove" size={18} color={ACCENT} />
          </TouchableOpacity>
          <Text style={styles.quantityValue}>{entry.quantity}</Text>
          <TouchableOpacity
            style={styles.quantityButton}
            onPress={() => onIncrement(entry)}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={18} color={ACCENT} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.cardAside}>
        <Text style={styles.lineTotal}>{lineTotal}</Text>
        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => onRemove(entry)}
          activeOpacity={0.75}
        >
          <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
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
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.emptyTitle}>Loading your cart…</Text>
      </>
    ) : (
      <>
        <Ionicons name="cart-outline" size={38} color={ACCENT} />
        <Text style={styles.emptyTitle}>
          {error ? 'Unable to load cart' : 'Your cart is empty'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {error
            ? error
            : 'Browse the marketplace and add items you want to purchase.'}
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry} activeOpacity={0.85}>
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>Refresh</Text>
        </TouchableOpacity>
      </>
    )}
  </View>
);

type PaymentSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (method: PaymentMethod) => void;
  busy: boolean;
};

const PaymentSheet = ({ visible, onClose, onSelect, busy }: PaymentSheetProps) => (
  <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
    <View style={styles.paymentOverlay}>
      <View style={styles.paymentSheet}>
        <View style={styles.paymentHeader}>
          <Text style={styles.paymentTitle}>Choose a payment method</Text>
          <TouchableOpacity
            onPress={onClose}
            disabled={busy}
            style={[styles.paymentClose, busy ? styles.paymentCloseDisabled : null]}
          >
            <Ionicons name="close" size={20} color={busy ? '#B5B5B5' : '#111111'} />
          </TouchableOpacity>
        </View>
        {AVAILABLE_PAYMENT_METHODS.map((method) => (
          <TouchableOpacity
            key={method.method}
            style={styles.paymentOption}
            onPress={() => onSelect(method.method)}
            activeOpacity={0.85}
            disabled={busy}
          >
            <View style={styles.paymentOptionIcon}>
              <Ionicons name="card-outline" size={18} color={ACCENT} />
            </View>
            <View style={styles.paymentOptionCopy}>
              <Text style={styles.paymentOptionTitle}>{method.label}</Text>
              <Text style={styles.paymentOptionDescription}>{method.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9E9E9E" />
          </TouchableOpacity>
        ))}
        <Text style={styles.paymentFootnote}>
          Payments are processed instantly for demo purposes. You will see the order immediately in
          your history.
        </Text>
      </View>
    </View>
  </Modal>
);

export default function CartScreen() {
  const { user, loading: authLoading } = useSupabaseUser();
  const [items, setItems] = useState<CartEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [processingCheckout, setProcessingCheckout] = useState(false);

  const totalCents = useMemo(
    () => items.reduce((sum, entry) => sum + entry.listing.priceCents * entry.quantity, 0),
    [items],
  );

  const currency = items[0]?.listing.currency ?? 'PHP';
  const totalDisplay = formatCurrency(totalCents, currency);

  const canInteract = Boolean(user);

  const loadCart = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!user) {
        setItems([]);
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
        const result = await fetchCart(user.id);
        if (result.error) {
          setErrorMessage(result.error);
        } else {
          setErrorMessage(null);
        }
        setItems(result.data);
      } catch (error) {
        console.warn('Failed to load cart', error);
        setErrorMessage('Something went wrong while loading your cart.');
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
      loadCart().catch((internalError) =>
        console.warn('Initial cart load failed', internalError),
      );
    }
  }, [authLoading, loadCart]);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        return;
      }
      loadCart('refresh').catch((internalError) =>
        console.warn('Cart focus refresh failed', internalError),
      );
    }, [loadCart, user]),
  );

  const adjustQuantity = useCallback(
    async (entry: CartEntry, delta: number) => {
      if (!user) {
        return;
      }

      const nextQuantity = entry.quantity + delta;
      try {
        const result = await updateCartQuantity(user.id, entry.listing.id, nextQuantity);
        if (result.error) {
          Alert.alert('Unable to update', result.error);
          return;
        }

        if (!result.data) {
          setItems((current) => current.filter((item) => item.id !== entry.id));
          return;
        }

        setItems((current) =>
          current.map((item) => (item.id === entry.id ? result.data! : item)),
        );
        // Sync profile counters so Profile tab reflects updated cart count
        await syncMarketplaceStatsToProfile(user.id);
      } catch (error) {
        console.warn('Failed to update cart quantity', error);
        Alert.alert('Something went wrong', 'Unable to update the item right now.');
      }
    },
    [user],
  );

  const handleRemove = useCallback(
    (entry: CartEntry) => {
      adjustQuantity(entry, -entry.quantity);
    },
    [adjustQuantity],
  );

  const handleCheckout = useCallback(
    async (method: PaymentMethod) => {
      if (!user) {
        setPaymentVisible(false);
        router.push('/login');
        return;
      }

      setProcessingCheckout(true);

      try {
        const result = await checkoutCart(user.id, method);
        if (result.error) {
          Alert.alert('Checkout failed', result.error);
          return;
        }

        const order = result.data.order;
        Alert.alert(
          'Payment successful',
          `Order ${order.id} is confirmed. We charged ${formatCurrency(
            order.totalCents,
            order.currency,
          )} via ${method.toUpperCase()}.`,
        );

        await loadCart('refresh');
        await syncMarketplaceStatsToProfile(user.id);
      } catch (error) {
        console.warn('Checkout flow failed', error);
        Alert.alert('Something went wrong', 'Unable to complete checkout right now.');
      } finally {
        setProcessingCheckout(false);
        setPaymentVisible(false);
      }
    },
    [loadCart, user],
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
          <Text style={styles.emptyTitle}>Sign in to view your cart</Text>
          <Text style={styles.emptySubtitle}>
            Items you add while browsing will show up here once you are logged in.
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
        onRetry={() => loadCart('refresh')}
      />
    );
  }, [authLoading, errorMessage, loadCart, loading, user]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Cart</Text>
        <Text style={styles.headerSubtitle}>
          {items.length === 0 ? 'No items yet' : `${items.length} item(s) in cart`}
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={({ item }) => (
          <CartCard
            entry={item}
            onIncrement={(entry) => adjustQuantity(entry, 1)}
            onDecrement={(entry) => adjustQuantity(entry, -1)}
            onRemove={handleRemove}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          items.length === 0 ? styles.emptyListContent : null,
        ]}
        refreshing={refreshing}
        onRefresh={() => loadCart('refresh')}
        ListEmptyComponent={emptyState}
        showsVerticalScrollIndicator={false}
      />

      {items.length > 0 && canInteract ? (
        <View style={styles.checkoutBar}>
          <View>
            <Text style={styles.checkoutLabel}>Total</Text>
            <Text style={styles.checkoutTotal}>{totalDisplay}</Text>
          </View>
          <TouchableOpacity
            style={styles.checkoutButton}
            onPress={() => setPaymentVisible(true)}
            activeOpacity={0.85}
            disabled={processingCheckout}
          >
            {processingCheckout ? (
              <ActivityIndicator color="#111111" />
            ) : (
              <View style={styles.checkoutButtonContent}>
                <Ionicons name="card-outline" size={18} color="#111111" />
                <Text style={styles.checkoutButtonText}>Checkout</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      <PaymentSheet
        visible={paymentVisible}
        onClose={() => {
          if (!processingCheckout) {
            setPaymentVisible(false);
          }
        }}
        onSelect={handleCheckout}
        busy={processingCheckout}
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
    paddingBottom: 120,
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
    padding: 14,
    gap: 14,
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
    width: 70,
    height: 70,
    borderRadius: 16,
    backgroundColor: '#F3F3F3',
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: 6,
  },
  cardAside: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#222222',
  },
  cardPrice: {
    fontSize: 13,
    color: MUTED,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  quantityButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D9EBD2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  lineTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111111',
  },
  removeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: CTA_RED,
    alignItems: 'center',
    justifyContent: 'center',
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
  checkoutBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EFEFEF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  checkoutLabel: {
    fontSize: 12,
    color: MUTED,
  },
  checkoutTotal: {
    marginTop: 2,
    fontSize: 20,
    fontWeight: '800',
    color: '#111111',
  },
  checkoutButton: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: '#E6F9D1',
    borderWidth: 1,
    borderColor: '#B7E89A',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkoutButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkoutButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  paymentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  paymentSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 16,
  },
  paymentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paymentTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
  },
  paymentClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentCloseDisabled: {
    backgroundColor: '#F3F3F3',
  },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  paymentOptionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EAF7E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentOptionCopy: {
    flex: 1,
  },
  paymentOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  paymentOptionDescription: {
    marginTop: 2,
    fontSize: 12,
    color: MUTED,
  },
  paymentFootnote: {
    fontSize: 12,
    color: MUTED,
    lineHeight: 18,
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
