import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';

import { SellerSale, fetchSellerSales, fetchSellerStatus, updateOrderStatus, fetchOrders, OrderRecord } from '@/lib/marketplace';
import { supabase } from '@/config/supabase';
import { useSupabaseUser } from '@/hooks/use-supabase-user';
import { formatCurrency } from '@/utils/currency';

const ACCENT = '#3D5C35';
const MUTED = '#6F6F6F';
const CARD_BORDER = '#EAEAEA';
const CARD_BG = '#FFFFFF';

const keyExtractor = (item: SellerSale) => `${item.orderId}:${item.listingId}`;

type SaleCardProps = {
  sale: SellerSale;
  onMessage: (buyerId: string) => void;
  onMarkShipped: (orderId: string) => void;
  busy?: boolean;
};

const SaleCard = ({ sale, onMessage, onMarkShipped, busy = false }: SaleCardProps) => {
  const total = sale.priceCents * sale.quantity;
  const shipping = sale.shippingAddress;
  const canMarkShipped = sale.orderStatus !== 'shipped' && sale.orderStatus !== 'completed' && sale.orderStatus !== 'cancelled';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {sale.listingTitle || 'Untitled listing'}
        </Text>
        <TouchableOpacity style={styles.messageBtn} onPress={() => onMessage(sale.buyerId)}>
          <Ionicons name="chatbubble-ellipses" size={18} color={ACCENT} />
          <Text style={styles.messageBtnText}>Message buyer</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.metaRow}>
        {sale.quantity} × {formatCurrency(sale.priceCents, sale.currency)} · Order {sale.orderId}
      </Text>
      <Text style={styles.totalText}>Total {formatCurrency(total, sale.currency)}</Text>
      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Deliver to</Text>
      {shipping ? (
        <View style={styles.addressBlock}>
          {shipping.fullName ? (
            <Text style={styles.addressLine}>{shipping.fullName}</Text>
          ) : null}
          {shipping.phone ? <Text style={styles.addressLine}>{shipping.phone}</Text> : null}
          <Text style={styles.addressLine}>{shipping.line1}</Text>
          {shipping.line2 ? <Text style={styles.addressLine}>{shipping.line2}</Text> : null}
          <Text style={styles.addressLine}>
            {shipping.city} {shipping.region} {shipping.postalCode}
          </Text>
        </View>
      ) : (
        <Text style={styles.addressMissing}>No shipping address captured.</Text>
      )}
      <Text style={styles.dateText}>{new Date(sale.createdAt).toLocaleString()}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: '#F1F1F1' }}>
          <Text style={{ fontSize: 12, color: MUTED }}>Order status: {sale.orderStatus}</Text>
        </View>
        {canMarkShipped ? (
          <TouchableOpacity
            style={[styles.messageBtn, { backgroundColor: '#A8FF6F' }]}
            onPress={() => onMarkShipped(sale.orderId)}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator size='small' color='#111111' />
            ) : (
              <>
                <Ionicons name='cube' size={16} color='#111111' />
                <Text style={[styles.messageBtnText, { color: '#111111' }]}>Mark shipped</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

type BuyerOrderCardProps = {
  order: OrderRecord;
  onOrderReceived: (orderId: string) => void;
  busy?: boolean;
};

const BuyerOrderCard = ({ order, onOrderReceived, busy = false }: BuyerOrderCardProps) => {
  const total = order.totalCents;
  const canMarkReceived = order.status === 'shipped';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Order {order.id.slice(0, 8)}</Text>
      </View>
      <Text style={styles.metaRow}>
        {order.items.length} item{order.items.length !== 1 ? 's' : ''} · {new Date(order.createdAt).toLocaleString()}
      </Text>
      <View style={styles.divider} />
      <View style={styles.orderItemsList}>
        {order.items.map((item) => (
          <View key={item.id} style={styles.orderItemRow}>
            <Text style={styles.orderItemTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.orderItemMeta}>
              {item.quantity} × {formatCurrency(item.priceCents, item.currency)}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.divider} />
      <Text style={styles.totalText}>Total {formatCurrency(total, order.currency)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: '#F1F1F1' }}>
          <Text style={{ fontSize: 12, color: MUTED }}>Status: {order.status}</Text>
        </View>
        {canMarkReceived ? (
          <TouchableOpacity
            style={[styles.messageBtn, { backgroundColor: '#A8FF6F' }]}
            onPress={() => onOrderReceived(order.id)}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator size='small' color='#111111' />
            ) : (
              <>
                <Ionicons name='checkmark-circle' size={16} color='#111111' />
                <Text style={[styles.messageBtnText, { color: '#111111' }]}>Order Received</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

export default function SalesScreen() {
  const { user, loading: authLoading } = useSupabaseUser();
  const [isSeller, setIsSeller] = useState<boolean>(false);
  const [requiresApproval, setRequiresApproval] = useState<boolean>(false);
  const [sales, setSales] = useState<SellerSale[]>([]);
  const [buyerOrders, setBuyerOrders] = useState<OrderRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [markingOrderId, setMarkingOrderId] = useState<string | null>(null);

  const canInteract = Boolean(user);

  const loadSellerStatus = useCallback(async () => {
    if (!user) {
      setIsSeller(false);
      setRequiresApproval(false);
      return;
    }
    try {
      const status = await fetchSellerStatus(user.id);
      const approved = !status.error && status.data.state === 'approved';
      setIsSeller(approved);
      setRequiresApproval(status.error ? false : status.data.state !== 'approved');
    } catch (e) {
      console.warn('Failed to load seller status', e);
      setIsSeller(false);
      setRequiresApproval(false);
    }
  }, [user]);

  const loadSales = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!user) {
        setSales([]);
        setBuyerOrders([]);
        setRefreshing(false);
        return;
      }
      if (mode === 'refresh') {
        setRefreshing(true);
      }

      try {
        // Load seller sales if user is a seller
        if (isSeller) {
          const result = await fetchSellerSales(user.id);
          if (result.error) {
            setErrorMessage(result.error);
          } else {
            setErrorMessage(null);
          }
          setSales(result.data);
          setBuyerOrders([]);
        } else {
          // Load buyer orders if user is not a seller
          const result = await fetchOrders(user.id);
          if (result.error) {
            setErrorMessage(result.error);
          } else {
            setErrorMessage(null);
          }
          setBuyerOrders(result.data);
          setSales([]);
        }
      } catch (e) {
        console.warn('Failed to load data', e);
        setErrorMessage('Unable to load data right now.');
      } finally {
        setRefreshing(false);
      }
    },
    [user, isSeller],
  );

  const handleMarkShipped = useCallback(async (orderId: string) => {
    try {
      setMarkingOrderId(orderId);
      const result = await updateOrderStatus(orderId, 'shipped');
      if (result.error) {
        Alert.alert('Unable to update', result.error);
        return;
      }
      setSales((current) =>
        current.map((sale) =>
          sale.orderId === orderId ? { ...sale, orderStatus: 'shipped' } : sale,
        ),
      );
      await loadSales('refresh');
    } catch (e) {
      console.warn('Mark shipped failed', e);
      Alert.alert('Something went wrong', 'Unable to mark this order as shipped.');
    } finally {
      setMarkingOrderId(null);
    }
  }, [loadSales]);

  const handleOrderReceived = useCallback(async (orderId: string) => {
    try {
      setMarkingOrderId(orderId);
      const result = await updateOrderStatus(orderId, 'completed');
      if (result.error) {
        Alert.alert('Unable to update', result.error);
        return;
      }
      setBuyerOrders((current) =>
        current.map((order) =>
          order.id === orderId ? { ...order, status: 'completed' } : order,
        ),
      );
      await loadSales('refresh');
    } catch (e) {
      console.warn('Mark received failed', e);
      Alert.alert('Something went wrong', 'Unable to mark this order as received.');
    } finally {
      setMarkingOrderId(null);
    }
  }, [loadSales]);

  useEffect(() => {
    if (!authLoading && user) {
      loadSellerStatus().then(() => {
        // After seller status is loaded, we can load sales/orders
        loadSales().catch(() => {});
      }).catch(() => {});
    }
  }, [authLoading, user, loadSales, loadSellerStatus]);

  useEffect(() => {
    if (user && !authLoading) {
      loadSales().catch(() => {});
    }
  }, [authLoading, isSeller, loadSales, user]);

  // Realtime: refresh when orders change
  useEffect(() => {
    if (!supabase || !user) {
      return;
    }
    const channel = supabase.channel(`sales-orders:${user.id}`);
    
    if (isSeller) {
      // Seller: listen to order items with their seller_id
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketplace_order_items', filter: `seller_id=eq.${user.id}` },
        () => {
          loadSales('refresh').catch(() => {});
        },
      );
    } else {
      // Buyer: listen to orders with their buyer_id
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketplace_orders', filter: `buyer_id=eq.${user.id}` },
        () => {
          loadSales('refresh').catch(() => {});
        },
      );
    }
    
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadSales, user, isSeller]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      loadSales('refresh').catch(() => {});
    }, [loadSales, user]),
  );

  const empty = useMemo(() => {
    if (authLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={ACCENT} />
          <Text style={styles.muted}>Checking your account…</Text>
        </View>
      );
    }
    if (!canInteract) {
      return (
        <View style={styles.center}>
          <Ionicons name="log-in-outline" size={36} color={ACCENT} />
          <Text style={styles.title}>Sign in to view {isSeller ? 'sales' : 'orders'}</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.push('/login')}>
            <Ionicons name="arrow-forward" size={16} color="#111111" />
            <Text style={styles.ctaText}>Go to login</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (isSeller && requiresApproval) {
      return (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={36} color={ACCENT} />
          <Text style={styles.title}>Seller access required</Text>
          <Text style={styles.muted}>Apply as a seller in Profile to receive orders.</Text>
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <Ionicons name="cube-outline" size={36} color={ACCENT} />
        <Text style={styles.title}>{errorMessage ? 'Unable to load' : isSeller ? 'No sales yet' : 'No orders yet'}</Text>
        <Text style={styles.muted}>
          {errorMessage || (isSeller ? 'Once buyers order your listings, they will appear here.' : 'Your paid orders will appear here.')}
        </Text>
      </View>
    );
  }, [authLoading, canInteract, errorMessage, requiresApproval, isSeller]);

  const dataCount = isSeller ? sales.length : buyerOrders.length;
  const displayTitle = isSeller ? 'Sales' : 'My Orders';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>{displayTitle}</Text>
        <Text style={styles.headerSubtitle}>
          {dataCount === 0 ? (isSeller ? 'No orders yet' : 'No orders yet') : (isSeller ? `${sales.length} sale(s)` : `${buyerOrders.length} order(s)`)}
        </Text>
      </View>
      {isSeller ? (
        <FlatList
          data={sales}
          keyExtractor={keyExtractor}
          renderItem={({ item }) => (
            <SaleCard
              sale={item}
              onMessage={(buyerId) => router.push({ pathname: '/(routes)/messages/[userId]', params: { userId: buyerId } })}
              onMarkShipped={handleMarkShipped}
              busy={markingOrderId === item.orderId}
            />
          )}
          contentContainerStyle={[styles.listContent, sales.length === 0 ? styles.fill : null]}
          refreshing={refreshing}
          onRefresh={() => loadSales('refresh')}
          ListEmptyComponent={empty}
        />
      ) : (
        <FlatList
          data={buyerOrders}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BuyerOrderCard
              order={item}
              onOrderReceived={handleOrderReceived}
              busy={markingOrderId === item.id}
            />
          )}
          contentContainerStyle={[styles.listContent, buyerOrders.length === 0 ? styles.fill : null]}
          refreshing={refreshing}
          onRefresh={() => loadSales('refresh')}
          ListEmptyComponent={empty}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  headerRow: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: '#111111' },
  headerSubtitle: { marginTop: 4, fontSize: 13, color: MUTED },
  listContent: { paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  fill: { flexGrow: 1, justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  title: { fontSize: 18, fontWeight: '700', color: '#111111', textAlign: 'center' },
  muted: { fontSize: 14, color: MUTED, textAlign: 'center' },
  cta: { marginTop: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: '#E6F9D1', flexDirection: 'row', gap: 8, alignItems: 'center' },
  ctaText: { color: '#111111', fontWeight: '700', fontSize: 13 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: CARD_BORDER, backgroundColor: CARD_BG, padding: 14, gap: 8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: '#111111' },
  messageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EAF7E5', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  messageBtnText: { color: ACCENT, fontWeight: '700', fontSize: 12 },
  metaRow: { fontSize: 13, color: MUTED },
  totalText: { fontSize: 14, fontWeight: '700', color: '#111111' },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 6 },
  sectionTitle: { fontSize: 12, color: MUTED },
  addressBlock: { gap: 2 },
  addressLine: { fontSize: 13, color: '#222222' },
  addressMissing: { fontSize: 13, color: MUTED },
  dateText: { marginTop: 4, fontSize: 12, color: MUTED },
  orderItemsList: { gap: 8 },
  orderItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderItemTitle: { flex: 1, fontSize: 14, color: '#222222' },
  orderItemMeta: { fontSize: 13, color: MUTED },
});
