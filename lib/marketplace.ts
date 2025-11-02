import type { PostgrestError, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { supabase } from '@/config/supabase';
import { ensureUserProfileExists } from '@/lib/user-profile';
import { extractMissingColumnName } from '@/lib/supabase-errors';

export const MARKETPLACE_CURRENCY = 'PHP';

const TABLE_LISTINGS = 'marketplace_listings';
const TABLE_WISHLIST = 'marketplace_wishlist';
const TABLE_CART = 'marketplace_cart_items';
const TABLE_ORDERS = 'marketplace_orders';
const TABLE_ORDER_ITEMS = 'marketplace_order_items';
const TABLE_PAYMENTS = 'marketplace_payments';
const TABLE_REVIEWS = 'marketplace_reviews';
const TABLE_TRADE_OFFERS = 'marketplace_trade_offers';
const TABLE_NOTIFICATIONS = 'marketplace_notifications';
const TABLE_USERS = 'users';
const TABLE_SELLER_APPLICATIONS = 'seller_applications';

export type ReviewMediaType = 'image' | 'video' | 'unknown';

export type ReviewMedia = {
  url: string;
  type: ReviewMediaType;
  thumbnailUrl: string | null;
};

export type ReviewMediaInput = {
  url: string;
  type?: ReviewMediaType;
  thumbnailUrl?: string | null;
};

export type QueryResult<T> = {
  data: T;
  error: string | null;
};

export type ActionResult<T = void> = {
  data: T;
  error: string | null;
};

const resolveErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (error && typeof error === 'object') {
    const postgrest = error as PostgrestError;
    if (postgrest.message) {
      const trimmed = postgrest.message.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return fallback;
};

const ensureClient = (): SupabaseClient | undefined => supabase;

const requireClient = (): SupabaseClient => {
  const client = ensureClient();
  if (!client) {
    throw new Error('Supabase is not configured yet.');
  }
  return client;
};

const normaliseCurrency = (value?: string | null) => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : MARKETPLACE_CURRENCY;
};

const normaliseListingStatus = (value?: string | null): ListingStatus => {
  const status = (value ?? '').toLowerCase();
  if (status === 'draft' || status === 'inactive') {
    return status;
  }
  return 'active';
};

const parseListingImageUrls = (value?: string | null): string[] => {
  const raw = (value ?? '').trim();
  if (!raw) {
    return [];
  }

  const dedupe = (urls: string[]) =>
    urls.filter((url, index) => urls.findIndex((candidate) => candidate === url) === index);

  const sanitise = (candidate: unknown): string[] => {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      return trimmed ? [trimmed] : [];
    }
    if (Array.isArray(candidate)) {
      const mapped = candidate
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
      return dedupe(mapped);
    }
    if (candidate && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      if (Array.isArray(record.urls)) {
        return sanitise(record.urls);
      }
      if (Array.isArray(record.images)) {
        return sanitise(record.images);
      }
    }
    return [];
  };

  if (raw.startsWith('{') || raw.startsWith('[') || raw.startsWith('"')) {
    try {
      const parsed = JSON.parse(raw);
      const urls = sanitise(parsed);
      if (urls.length > 0) {
        return urls;
      }
    } catch {
      // Ignore JSON parse failures and fall back to treating the value as a single URL.
    }
  }

  return [raw];
};

const normaliseReviewMediaType = (value?: string | null): ReviewMedia['type'] => {
  const type = (value ?? '').toLowerCase();
  if (type === 'image' || type === 'video') {
    return type;
  }
  return 'unknown';
};

const detectReviewMediaTypeFromUrl = (url: string): ReviewMedia['type'] => {
  const lower = url.toLowerCase();
  if (lower.match(/\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff)(\?.*)?$/)) {
    return 'image';
  }
  if (lower.match(/\.(mp4|mov|m4v|webm|avi|mkv|3gp)(\?.*)?$/)) {
    return 'video';
  }
  return 'unknown';
};

const sanitiseReviewMediaEntry = (input: unknown): ReviewMedia | null => {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const record = input as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!url) {
    return null;
  }

  const declaredType = typeof record.type === 'string' ? record.type : null;
  const resolvedType =
    declaredType && declaredType.length > 0
      ? normaliseReviewMediaType(declaredType)
      : detectReviewMediaTypeFromUrl(url);

  const thumbnail =
    typeof record.thumbnailUrl === 'string' ? record.thumbnailUrl.trim() || null : null;

  return {
    url,
    type: resolvedType,
    thumbnailUrl: thumbnail,
  };
};

const normaliseReviewMediaList = (value: unknown): ReviewMedia[] => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    const items = value
      .map((entry) => sanitiseReviewMediaEntry(entry))
      .filter((entry): entry is ReviewMedia => Boolean(entry));
    return items;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normaliseReviewMediaList(parsed);
    } catch {
      const url = value.trim();
      if (!url) {
        return [];
      }
      return [
        {
          url,
          type: detectReviewMediaTypeFromUrl(url),
          thumbnailUrl: null,
        },
      ];
    }
  }

  return [];
};

const serialiseReviewMediaInput = (media?: ReviewMediaInput[] | null): ReviewMedia[] => {
  if (!Array.isArray(media)) {
    return [];
  }
  const entries: ReviewMedia[] = [];
  for (const item of media) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url) {
      continue;
    }
    const declaredType = typeof item.type === 'string' ? item.type : undefined;
    const resolvedType = declaredType
      ? normaliseReviewMediaType(declaredType)
      : detectReviewMediaTypeFromUrl(url);
    const thumbnail =
      typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl.trim() || null : null;
    entries.push({
      url,
      type: resolvedType,
      thumbnailUrl: thumbnail,
    });
  }
  return entries;
};

const resolveListingImageUrlsInput = (input: { imageUrl?: string | null; imageUrls?: string[] }) => {
  const urls: string[] = [];

  if (Array.isArray(input.imageUrls)) {
    for (const value of input.imageUrls) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          urls.push(trimmed);
        }
      }
    }
  }

  if (typeof input.imageUrl === 'string') {
    const trimmed = input.imageUrl.trim();
    if (trimmed.length > 0) {
      urls.push(trimmed);
    }
  }

  return urls.filter((url, index) => urls.findIndex((candidate) => candidate === url) === index);
};

const serialiseListingImageUrls = (urls: string[]): string | null => {
  if (urls.length === 0) {
    return null;
  }

  if (urls.length === 1) {
    return urls[0];
  }

  return JSON.stringify(urls);
};

const normaliseListingRow = (row: RawListingRow): ListingRecord => {
  const sellerName = (row.seller_profile?.display_name ?? '').trim();
  const fallbackName = row.seller_id ? `Seller ${row.seller_id.slice(0, 6)}` : 'Seller';
  const imageUrls = parseListingImageUrls(row.image_url);

  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerDisplayName: sellerName.length > 0 ? sellerName : fallbackName,
    sellerAvatarUrl: (row.seller_profile?.photo_url ?? '').trim() || null,
    title: (row.title ?? '').trim(),
    description: (row.description ?? '').trim(),
    priceCents: Math.max(0, Math.round(row.price_cents ?? 0)),
    currency: normaliseCurrency(row.currency),
    quantity: Math.max(0, Math.round(row.quantity ?? 0)),
    status: normaliseListingStatus(row.status),
    allowTrade: Boolean(row.allow_trade),
    imageUrl: imageUrls[0] ?? null,
    imageUrls,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const fetchRemainingStock = async (
  listingId: string,
): Promise<QueryResult<{ initial: number; remaining: number }>> => {
  if (!supabase) {
    return { data: { initial: 0, remaining: 0 }, error: 'Supabase is not configured yet.' };
  }

  try {
    // Load initial quantity from listing
    const { data: listingRow, error: listingError } = await supabase
      .from(TABLE_LISTINGS)
      .select('quantity')
      .eq('id', listingId)
      .maybeSingle();

    if (listingError) {
      throw listingError;
    }
    if (!listingRow) {
      return { data: { initial: 0, remaining: 0 }, error: 'Listing not found.' };
    }

    const initial = Math.max(0, Math.round((listingRow as any).quantity ?? 0));

    // Sum quantities from order items for successful orders
    const projection =
      'quantity, order:marketplace_orders(status, payment_status)';
    const { data: items, error: itemsError } = await supabase
      .from(TABLE_ORDER_ITEMS)
      .select(projection)
      .eq('listing_id', listingId);

    if (itemsError) {
      throw itemsError;
    }

    const sold = (items ?? []).reduce((sum, row: any) => {
      const status = String(row?.order?.status ?? '').toLowerCase();
      const payment = String(row?.order?.payment_status ?? '').toLowerCase();
      const okStatus = status && status !== 'cancelled';
      const okPayment = payment === 'paid';
      const qualifies = okStatus && (okPayment || ['paid', 'preparing', 'shipped', 'completed'].includes(status));
      const qty = Math.max(0, Math.round(row?.quantity ?? 0));
      return qualifies ? sum + qty : sum;
    }, 0);

    const remaining = Math.max(0, initial - sold);
    return { data: { initial, remaining }, error: null };
  } catch (error) {
    return {
      data: { initial: 0, remaining: 0 },
      error: resolveErrorMessage(error, 'Unable to calculate remaining stock right now.'),
    };
  }
};

const normaliseWishlistRow = (row: RawWishlistRow): WishlistEntry | null => {
  if (!row.listing) {
    return null;
  }

  return {
    id: row.id,
    listing: normaliseListingRow(row.listing),
    createdAt: row.created_at,
  };
};

const normaliseCartRow = (row: RawCartRow): CartEntry | null => {
  if (!row.listing) {
    return null;
  }

  return {
    id: row.id,
    quantity: Math.max(1, Math.round(row.quantity ?? 1)),
    listing: normaliseListingRow(row.listing),
    createdAt: row.created_at,
  };
};

const normaliseOrderItemRow = (row: RawOrderItemRow): OrderItem => ({
  id: row.id,
  orderId: row.order_id,
  listingId: row.listing_id ?? '',
  title: (row.title ?? '').trim(),
  priceCents: Math.max(0, Math.round(row.price_cents ?? 0)),
  quantity: Math.max(1, Math.round(row.quantity ?? 1)),
  currency: normaliseCurrency(row.currency),
});

const normaliseOrderRow = (row: RawOrderRow): OrderRecord => ({
  id: row.id,
  buyerId: row.buyer_id,
  totalCents: Math.max(0, Math.round(row.total_cents ?? 0)),
  currency: normaliseCurrency(row.currency),
  status: (row.status as OrderStatus) ?? 'pending',
  paymentStatus: (row.payment_status as PaymentStatus) ?? 'pending',
  paymentMethod: (row.payment_method as PaymentMethod) ?? 'cod',
  createdAt: row.created_at,
  items: (row.order_items ?? []).map(normaliseOrderItemRow),
});

const normaliseTradeRow = (row: RawTradeRow, userId: string): TradeOffer => {
  const direction = row.initiator_id === userId ? 'outgoing' : 'incoming';
  const counterparty =
    direction === 'outgoing'
      ? (row.recipient_profile?.display_name ?? '').trim() ||
        (row.recipient_id ? `Trader ${row.recipient_id.slice(0, 6)}` : 'Trader')
      : (row.initiator_profile?.display_name ?? '').trim() ||
        (row.initiator_id ? `Trader ${row.initiator_id.slice(0, 6)}` : 'Trader');

  return {
    id: row.id,
    listing: row.listing ? normaliseListingRow(row.listing) : null,
    initiatorId: row.initiator_id,
    recipientId: row.recipient_id,
    status: (row.status as TradeStatus) ?? 'pending',
    offeredItemDescription: (row.offered_item_description ?? '').trim() || null,
    offeredValueCents:
      row.offered_value_cents === null || typeof row.offered_value_cents === 'undefined'
        ? null
        : Math.max(0, Math.round(row.offered_value_cents)),
    currency: normaliseCurrency(row.currency),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    direction,
    counterpartyName: counterparty,
  };
};

const sanitiseListingPayload = (sellerId: string, input: ListingInput) => {
  const title = input.title.trim();
  if (!title) {
    throw new Error('A title is required.');
  }

  const imageUrls = resolveListingImageUrlsInput(input);

  return {
    seller_id: sellerId,
    title,
    description: (input.description ?? '').trim() || null,
    price_cents: Math.max(0, Math.round(input.priceCents)),
    currency: normaliseCurrency(input.currency),
    quantity: Math.max(0, Math.round(input.quantity ?? 1)),
    status: normaliseListingStatus(input.status),
    allow_trade: Boolean(input.allowTrade),
    image_url: serialiseListingImageUrls(imageUrls),
  };
};

export const createListing = async (
  sellerId: string,
  input: ListingInput,
): Promise<ActionResult<ListingRecord>> => {
  if (!supabase) {
    const imageUrls = resolveListingImageUrlsInput(input);

    return {
      data: {
        id: 'local',
        sellerId,
        sellerDisplayName: 'You',
        sellerAvatarUrl: null,
        title: input.title,
        description: input.description ?? '',
        priceCents: Math.max(0, Math.round(input.priceCents)),
        currency: normaliseCurrency(input.currency),
        quantity: Math.max(0, Math.round(input.quantity ?? 1)),
        status: normaliseListingStatus(input.status),
        allowTrade: Boolean(input.allowTrade),
        imageUrl: imageUrls[0] ?? null,
        imageUrls,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      },
      error: 'Supabase is not configured yet.',
    };
  }

  try {
    const profileReady = await ensureUserProfileExists({ id: sellerId });
    if (!profileReady) {
      throw new Error(
        'Your seller profile is still synchronising. Please try again in a moment.',
      );
    }

    const payload = sanitiseListingPayload(sellerId, input);
    const { data, error } = await supabase
      .from(TABLE_LISTINGS)
      .insert(payload)
      .select(
        'id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url)',
      )
      .single();

    if (error) {
      throw error;
    }

    return {
      data: normaliseListingRow(data as RawListingRow),
      error: null,
    };
  } catch (error) {
    const imageUrls = resolveListingImageUrlsInput(input);

    return {
      data: {
        id: 'error',
        sellerId,
        sellerDisplayName: 'You',
        sellerAvatarUrl: null,
        title: input.title,
        description: input.description ?? '',
        priceCents: Math.max(0, Math.round(input.priceCents)),
        currency: normaliseCurrency(input.currency),
        quantity: Math.max(0, Math.round(input.quantity ?? 1)),
        status: normaliseListingStatus(input.status),
        allowTrade: Boolean(input.allowTrade),
        imageUrl: imageUrls[0] ?? null,
        imageUrls,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      },
      error: resolveErrorMessage(error, 'Unable to publish the listing. Please try again.'),
    };
  }
};

export const updateListing = async (
  listingId: string,
  input: ListingUpdate,
): Promise<ActionResult<ListingRecord>> => {
  if (!supabase) {
    const imageUrls = resolveListingImageUrlsInput(input);

    return {
      data: {
        id: listingId,
        sellerId: '',
        sellerDisplayName: '',
        sellerAvatarUrl: null,
        title: input.title ?? '',
        description: input.description ?? '',
        priceCents: Math.max(0, Math.round(input.priceCents ?? 0)),
        currency: normaliseCurrency(input.currency),
        quantity: Math.max(0, Math.round(input.quantity ?? 0)),
        status: normaliseListingStatus(input.status),
        allowTrade: Boolean(input.allowTrade),
        imageUrl: imageUrls[0] ?? null,
        imageUrls,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      error: 'Supabase is not configured yet.',
    };
  }

  try {
    const payload: Record<string, unknown> = {};

    if (typeof input.title === 'string') {
      payload.title = input.title.trim();
    }
    if (typeof input.description === 'string') {
      payload.description = input.description.trim() || null;
    }
    if (typeof input.priceCents === 'number') {
      payload.price_cents = Math.max(0, Math.round(input.priceCents));
    }
    if (typeof input.currency === 'string') {
      payload.currency = normaliseCurrency(input.currency);
    }
    if (typeof input.quantity === 'number') {
      payload.quantity = Math.max(0, Math.round(input.quantity));
    }
    if (typeof input.status === 'string') {
      payload.status = normaliseListingStatus(input.status);
    }
    if (typeof input.allowTrade === 'boolean') {
      payload.allow_trade = input.allowTrade;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'imageUrls')) {
      const urls = Array.isArray(input.imageUrls)
        ? resolveListingImageUrlsInput({ imageUrls: input.imageUrls })
        : [];
      payload.image_url = serialiseListingImageUrls(urls);
    } else if (Object.prototype.hasOwnProperty.call(input, 'imageUrl')) {
      if (typeof input.imageUrl === 'string') {
        const urls = resolveListingImageUrlsInput({ imageUrl: input.imageUrl });
        payload.image_url = serialiseListingImageUrls(urls);
      } else if (input.imageUrl === null) {
        payload.image_url = null;
      }
    }

    if (Object.keys(payload).length === 0) {
      const existing = await supabase
        .from(TABLE_LISTINGS)
        .select(
          'id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url)',
        )
        .eq('id', listingId)
        .maybeSingle();

      if (existing.data) {
        return {
          data: normaliseListingRow(existing.data as RawListingRow),
          error: null,
        };
      }
    }

    const { data, error } = await supabase
      .from(TABLE_LISTINGS)
      .update(payload)
      .eq('id', listingId)
      .select(
        'id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url)',
      )
      .single();

    if (error) {
      throw error;
    }

    return {
      data: normaliseListingRow(data as RawListingRow),
      error: null,
    };
  } catch (error) {
    return {
      data: {
        id: listingId,
        sellerId: '',
        sellerDisplayName: '',
        sellerAvatarUrl: null,
        title: input.title ?? '',
        description: input.description ?? '',
        priceCents: Math.max(0, Math.round(input.priceCents ?? 0)),
        currency: normaliseCurrency(input.currency),
        quantity: Math.max(0, Math.round(input.quantity ?? 0)),
        status: normaliseListingStatus(input.status),
        allowTrade: Boolean(input.allowTrade),
        imageUrl: input.imageUrl ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      error: resolveErrorMessage(error, 'Unable to update the listing right now.'),
    };
  }
};

export const deleteListing = async (listingId: string): Promise<ActionResult> => {
  if (!supabase) {
    return { data: undefined, error: 'Supabase is not configured yet.' };
  }

  try {
    const { error } = await supabase.from(TABLE_LISTINGS).delete().eq('id', listingId);
    if (error) {
      throw error;
    }

    return { data: undefined, error: null };
  } catch (error) {
    return {
      data: undefined,
      error: resolveErrorMessage(error, 'Unable to remove the listing right now.'),
    };
  }
};

export const fetchWishlist = async (userId: string): Promise<QueryResult<WishlistEntry[]>> => {
  if (!supabase) {
    return { data: [], error: 'Supabase is not configured yet.' };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_WISHLIST)
      .select(
        'id, created_at, listing:marketplace_listings(id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url))',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const entries = (data ?? [])
      .map((row) => normaliseWishlistRow(row as RawWishlistRow))
      .filter((entry): entry is WishlistEntry => Boolean(entry));

    return { data: entries, error: null };
  } catch (error) {
    return {
      data: [],
      error: resolveErrorMessage(error, 'Unable to load your wishlist right now.'),
    };
  }
};

export const addToWishlist = async (
  userId: string,
  listingId: string,
): Promise<ActionResult<{ id: string }>> => {
  if (!supabase) {
    return { data: { id: 'local' }, error: 'Supabase is not configured yet.' };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_WISHLIST)
      .upsert({ user_id: userId, listing_id: listingId }, { onConflict: 'user_id,listing_id' })
      .select('id')
      .single();

    if (error) {
      throw error;
    }

    return { data, error: null };
  } catch (error) {
    return {
      data: { id: 'error' },
      error: resolveErrorMessage(error, 'Unable to add the item to your wishlist.'),
    };
  }
};

export const removeFromWishlist = async (
  userId: string,
  listingId: string,
): Promise<ActionResult> => {
  if (!supabase) {
    return { data: undefined, error: 'Supabase is not configured yet.' };
  }

  try {
    const { error } = await supabase
      .from(TABLE_WISHLIST)
      .delete()
      .match({ user_id: userId, listing_id: listingId });

    if (error) {
      throw error;
    }

    return { data: undefined, error: null };
  } catch (error) {
    return {
      data: undefined,
      error: resolveErrorMessage(error, 'Unable to remove the item from your wishlist.'),
    };
  }
};

export const fetchCart = async (userId: string): Promise<QueryResult<CartEntry[]>> => {
  if (!supabase) {
    return { data: [], error: 'Supabase is not configured yet.' };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_CART)
      .select(
        'id, created_at, quantity, listing:marketplace_listings(id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url))',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const entries = (data ?? [])
      .map((row) => normaliseCartRow(row as RawCartRow))
      .filter((entry): entry is CartEntry => Boolean(entry));

    return { data: entries, error: null };
  } catch (error) {
    return {
      data: [],
      error: resolveErrorMessage(error, 'Unable to load your cart right now.'),
    };
  }
};

export const addToCart = async (
  userId: string,
  listingId: string,
  quantity = 1,
): Promise<ActionResult<CartEntry>> => {
  if (!supabase) {
    return {
      data: {
        id: 'local',
        quantity,
        listing: {
          id: listingId,
          sellerId: '',
          sellerDisplayName: '',
          sellerAvatarUrl: null,
          title: '',
          description: '',
          priceCents: 0,
          currency: MARKETPLACE_CURRENCY,
          quantity,
          status: 'active',
          allowTrade: false,
          imageUrl: null,
          createdAt: new Date().toISOString(),
          updatedAt: null,
        },
        createdAt: new Date().toISOString(),
      },
      error: 'Supabase is not configured yet.',
    };
  }

  try {
    // Prevent adding own listings to cart
    try {
      const { data: listingRow, error: listingError } = await supabase
        .from(TABLE_LISTINGS)
        .select('id, seller_id')
        .eq('id', listingId)
        .maybeSingle();
      if (listingError) {
        throw listingError;
      }
      if (!listingRow) {
        throw new Error('The requested listing could not be found.');
      }
      if ((listingRow as any).seller_id === userId) {
        return {
          data: {
            id: 'blocked',
            quantity,
            listing: {
              id: listingId,
              sellerId: userId,
              sellerDisplayName: 'You',
              sellerAvatarUrl: null,
              title: '',
              description: '',
              priceCents: 0,
              currency: MARKETPLACE_CURRENCY,
              quantity,
              status: 'active',
              allowTrade: false,
              imageUrl: null,
              createdAt: new Date().toISOString(),
              updatedAt: null,
            },
            createdAt: new Date().toISOString(),
          },
          error: 'You cannot purchase your own listing.',
        };
      }
    } catch (guardError) {
      // If guard fails due to connectivity, proceed with best-effort insert; downstream will still return a joined listing
      if (guardError instanceof Error) {
        const msg = (guardError.message || '').toLowerCase();
        if (msg.includes('could not find') || msg.includes('not found')) {
          return { data: (undefined as unknown) as CartEntry, error: 'The requested listing could not be found.' };
        }
      }
    }

    // Ensure stock is available
    try {
      const stock = await fetchRemainingStock(listingId);
      if (!stock.error && stock.data.remaining < quantity) {
        return {
          data: {
            id: 'blocked',
            quantity,
            listing: {
              id: listingId,
              sellerId: '',
              sellerDisplayName: '',
              sellerAvatarUrl: null,
              title: '',
              description: '',
              priceCents: 0,
              currency: MARKETPLACE_CURRENCY,
              quantity,
              status: 'active',
              allowTrade: false,
              imageUrl: null,
              createdAt: new Date().toISOString(),
              updatedAt: null,
            },
            createdAt: new Date().toISOString(),
          },
          error: `Only ${stock.data.remaining} left in stock.`,
        };
      }
    } catch {}

    const { data, error } = await supabase
      .from(TABLE_CART)
      .upsert(
        {
          user_id: userId,
          listing_id: listingId,
          quantity,
        },
        { onConflict: 'user_id,listing_id' },
      )
      .select(
        'id, created_at, quantity, listing:marketplace_listings(id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url))',
      )
      .single();

    if (error) {
      throw error;
    }

    const normalised = normaliseCartRow(data as RawCartRow);
    if (!normalised) {
      throw new Error('The requested listing could not be found.');
    }

    return { data: normalised, error: null };
  } catch (error) {
    return {
      data: {
        id: 'error',
        quantity,
        listing: {
          id: listingId,
          sellerId: '',
          sellerDisplayName: '',
          sellerAvatarUrl: null,
          title: '',
          description: '',
          priceCents: 0,
          currency: MARKETPLACE_CURRENCY,
          quantity,
          status: 'active',
          allowTrade: false,
          imageUrl: null,
          createdAt: new Date().toISOString(),
          updatedAt: null,
        },
        createdAt: new Date().toISOString(),
      },
      error: resolveErrorMessage(error, 'Unable to add the item to your cart.'),
    };
  }
};

export const updateCartQuantity = async (
  userId: string,
  listingId: string,
  quantity: number,
): Promise<ActionResult<CartEntry | null>> => {
  if (!supabase) {
    return { data: null, error: 'Supabase is not configured yet.' };
  }

  try {
    if (quantity <= 0) {
      const { error } = await supabase
        .from(TABLE_CART)
        .delete()
        .match({ user_id: userId, listing_id: listingId });

      if (error) {
        throw error;
      }

      return { data: null, error: null };
    }

    // Guard against exceeding stock
    try {
      const stock = await fetchRemainingStock(listingId);
      if (!stock.error && quantity > stock.data.remaining) {
        return { data: null, error: `Only ${stock.data.remaining} left in stock.` };
      }
    } catch {}

    const { data, error } = await supabase
      .from(TABLE_CART)
      .update({ quantity })
      .match({ user_id: userId, listing_id: listingId })
      .select(
        'id, created_at, quantity, listing:marketplace_listings(id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url))',
      )
      .single();

    if (error) {
      throw error;
    }

    const normalised = normaliseCartRow(data as RawCartRow);
    if (!normalised) {
      throw new Error('The requested listing could not be found.');
    }

    return { data: normalised, error: null };
  } catch (error) {
    return {
      data: null,
      error: resolveErrorMessage(error, 'Unable to update the cart right now.'),
    };
  }
};

export const clearCart = async (userId: string): Promise<ActionResult> => {
  if (!supabase) {
    return { data: undefined, error: 'Supabase is not configured yet.' };
  }

  try {
    const { error } = await supabase.from(TABLE_CART).delete().eq('user_id', userId);
    if (error) {
      throw error;
    }

    return { data: undefined, error: null };
  } catch (error) {
    return {
      data: undefined,
      error: resolveErrorMessage(error, 'Unable to clear your cart right now.'),
    };
  }
};

export const checkoutCart = async (
  userId: string,
  paymentMethod: PaymentMethod,
): Promise<ActionResult<CheckoutResult>> => {
  if (!supabase) {
    return {
      data: {
        order: {
          id: 'local',
          buyerId: userId,
          totalCents: 0,
          currency: MARKETPLACE_CURRENCY,
          status: 'paid',
          paymentStatus: 'paid',
          paymentMethod,
          createdAt: new Date().toISOString(),
          items: [],
        },
      },
      error: 'Supabase is not configured yet.',
    };
  }

  const client = requireClient();

  try {
    const { data: rawCart, error: cartError } = await client
      .from(TABLE_CART)
      .select(
        'id, quantity, listing:marketplace_listings(id, seller_id, title, price_cents, currency, allow_trade)',
      )
      .eq('user_id', userId);

    if (cartError) {
      throw cartError;
    }

    const cartRows = rawCart ?? [];
    if (cartRows.length === 0) {
      throw new Error('Your cart is empty.');
    }

    const normalised = cartRows.map((row) => ({
      id: row.id as string,
      quantity: Math.max(1, Math.round((row.quantity ?? 1) as number)),
      listing: row.listing as RawListingRow | null,
    }));

    const missingListing = normalised.find((row) => !row.listing);
    if (missingListing) {
      throw new Error('One of the items in your cart is no longer available.');
    }

    const listings = normalised.map((row) => row.listing as RawListingRow);
    // Prevent checkout if cart contains own listings
    const hasOwnListing = listings.some((l) => (l as RawListingRow).seller_id === userId);
    if (hasOwnListing) {
      throw new Error('Remove your own listing from the cart before checkout.');
    }
    // Prevent checkout quantities exceeding stock
    for (const row of normalised) {
      const l = row.listing as RawListingRow;
      const stock = await fetchRemainingStock(l.id);
      if (!stock.error && row.quantity > stock.data.remaining) {
        throw new Error(`Only ${stock.data.remaining} left for "${(l.title ?? '').trim() || 'item'}".`);
      }
    }
    const currency = normaliseCurrency(listings[0].currency);
    const totalCents = normalised.reduce((sum, row) => {
      const price = Math.max(0, Math.round(row.listing?.price_cents ?? 0));
      return sum + price * row.quantity;
    }, 0);

    // Resolve buyer's default shipping address from auth metadata
    const resolveDefaultShipping = async (): Promise<ShippingAddress | null> => {
      try {
        const { data } = await client.auth.getUser();
        const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
        const raw = (meta['shipping_addresses'] ?? meta['shipping_address']) as unknown;

        const normalise = (entry: Record<string, unknown>): ShippingAddress => {
          const norm = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
          return {
            fullName: norm(entry.fullName ?? (entry['full_name'] as unknown)),
            phone: norm(entry.phone),
            line1: norm(entry.line1),
            line2: norm(entry.line2),
            city: norm(entry.city),
            region: norm(entry.region),
            postalCode: norm(entry.postalCode ?? (entry['postal_code'] as unknown)),
          };
        };

        if (Array.isArray(raw)) {
          const array = raw as Array<Record<string, unknown>>;
          const index = array.findIndex((e) => Boolean((e as any).isDefault));
          const picked = index >= 0 ? array[index] : array[0];
          return normalise(picked || {});
        }
        if (raw && typeof raw === 'object') {
          return normalise(raw as Record<string, unknown>);
        }
        if (typeof raw === 'string' && raw.trim().length > 0) {
          return normalise({ line1: raw } as unknown as Record<string, unknown>);
        }
      } catch (e) {
        console.warn('Unable to resolve default shipping address', e);
      }
      return null;
    };

    const shippingAddress = await resolveDefaultShipping();
    if (!shippingAddress || !shippingAddress.line1) {
      throw new Error(
        'A shipping address is required. Add one in Profile > Shipping before checkout.',
      );
    }

    // Insert order with shipping address when supported; fallback without it if the column is missing.
    let orderRow: any = null;
    let orderError: any = null;
    const insertPayload: Record<string, unknown> = {
      buyer_id: userId,
      total_cents: totalCents,
      currency,
      status: 'paid',
      payment_status: 'paid',
      payment_method: paymentMethod,
      shipping_address: shippingAddress,
    };

    const performInsert = async (payload: Record<string, unknown>) =>
      client
        .from(TABLE_ORDERS)
        .insert(payload)
        .select(
          'id, buyer_id, total_cents, currency, status, payment_status, payment_method, created_at',
        )
        .single();

    let insertResult = await performInsert(insertPayload);
    orderRow = insertResult.data as any;
    orderError = insertResult.error as any;

    if (orderError) {
      const message = String(orderError.message || '').toLowerCase();
      const mentionsShippingColumn =
        message.includes('shipping_address') || message.includes('schema cache');
      if (mentionsShippingColumn) {
        const { data, error } = await performInsert({
          buyer_id: userId,
          total_cents: totalCents,
          currency,
          status: 'paid',
          payment_status: 'paid',
          payment_method: paymentMethod,
        });
        orderRow = data as any;
        orderError = error as any;
      }
    }

    if (orderError || !orderRow) {
      throw orderError ?? new Error('Unable to create the order.');
    }

    const orderId = orderRow.id as string;
    const orderItemsPayload = normalised.map((row) => ({
      order_id: orderId,
      listing_id: row.listing!.id,
      seller_id: row.listing!.seller_id,
      title: row.listing!.title,
      price_cents: Math.max(0, Math.round(row.listing!.price_cents ?? 0)),
      quantity: row.quantity,
      currency: normaliseCurrency(row.listing!.currency),
    }));

    const { data: insertedItems, error: orderItemsError } = await client
      .from(TABLE_ORDER_ITEMS)
      .insert(orderItemsPayload)
      .select('id, order_id, listing_id, title, price_cents, quantity, currency');

    if (orderItemsError) {
      throw orderItemsError;
    }

    const { error: paymentError } = await client.from(TABLE_PAYMENTS).insert({
      order_id: orderId,
      amount_cents: totalCents,
      currency,
      method: paymentMethod,
      status: 'paid',
    });

    if (paymentError) {
      console.warn('Failed to record payment', paymentError);
    }

    // Notify all sellers who have items in this order
    try {
      const sellerIds = Array.from(
        new Set(listings.map((l) => (l as RawListingRow).seller_id).filter(Boolean) as string[]),
      );
      if (sellerIds.length > 0) {
        const notificationPayload = sellerIds.map((sellerId) => ({
          user_id: sellerId,
          type: 'order_placed',
          title: 'New order received',
          body: `Order ${orderId} is confirmed. Prepare for delivery.`,
          data: { order_id: orderId, buyer_id: userId, shipping_city: shippingAddress.city },
        }));
        const { error: notifError } = await client
          .from(TABLE_NOTIFICATIONS)
          .insert(notificationPayload);
        if (notifError) {
          console.warn('Failed to create seller notifications', notifError);
        }
      }
    } catch (notifError) {
      console.warn('Seller notification flow failed', notifError);
    }

    const { error: clearError } = await client.from(TABLE_CART).delete().eq('user_id', userId);
    if (clearError) {
      console.warn('Failed to clear cart after checkout', clearError);
    }

    const order: OrderRecord = {
      id: orderId,
      buyerId: orderRow.buyer_id as string,
      totalCents: Math.max(0, Math.round(orderRow.total_cents ?? totalCents)),
      currency: normaliseCurrency(orderRow.currency),
      status: (orderRow.status as OrderStatus) ?? 'paid',
      paymentStatus: (orderRow.payment_status as PaymentStatus) ?? 'paid',
      paymentMethod: (orderRow.payment_method as PaymentMethod) ?? paymentMethod,
      createdAt: orderRow.created_at as string,
      items: (insertedItems ?? []).map((row) => normaliseOrderItemRow(row as RawOrderItemRow)),
    };

    return { data: { order }, error: null };
  } catch (error) {
    return {
      data: {
        order: {
          id: 'error',
          buyerId: userId,
          totalCents: 0,
          currency: MARKETPLACE_CURRENCY,
          status: 'pending',
          paymentStatus: 'pending',
          paymentMethod,
          createdAt: new Date().toISOString(),
          items: [],
        },
      },
      error: resolveErrorMessage(error, 'Checkout failed. Please try again.'),
    };
  }
};

export const fetchOrders = async (userId: string): Promise<QueryResult<OrderRecord[]>> => {
  if (!supabase) {
    return { data: [], error: 'Supabase is not configured yet.' };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_ORDERS)
      .select(
        'id, buyer_id, total_cents, currency, status, payment_status, payment_method, created_at, order_items:marketplace_order_items(id, order_id, listing_id, title, price_cents, quantity, currency)',
      )
      .eq('buyer_id', userId)
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return {
      data: (data ?? []).map((row) => normaliseOrderRow(row as RawOrderRow)),
      error: null,
    };
  } catch (error) {
    return {
      data: [],
      error: resolveErrorMessage(error, 'Unable to load your orders right now.'),
    };
  }
};

export const fetchSellerSales = async (
  sellerId: string,
): Promise<QueryResult<SellerSale[]>> => {
  if (!supabase) {
    return { data: [], error: 'Supabase is not configured yet.' };
  }

  try {
    const performSelect = async (
      withShipping: boolean,
      listingIds?: string[] | null,
      includeListing = true,
    ) => {
      let projection = withShipping
        ? 'order_id, listing_id, title, price_cents, quantity, currency, order:marketplace_orders(id, buyer_id, created_at, status, shipping_address)'
        : 'order_id, listing_id, title, price_cents, quantity, currency, order:marketplace_orders(id, buyer_id, created_at, status)';
      if (includeListing) {
        projection = `${projection}, listing:marketplace_listings(id)`;
      }
      let query = supabase.from(TABLE_ORDER_ITEMS).select(projection);
      if (Array.isArray(listingIds) && listingIds.length > 0) {
        query = query.in('listing_id', listingIds);
      } else {
        query = query.eq('seller_id', sellerId);
      }
      return query;
    };

    let withShipping = true;
    let includeListing = true;
    let listingIds: string[] | undefined;

    const toMessage = (input: unknown) => String((input as any)?.message ?? input ?? '').toLowerCase();

    let { data, error } = await performSelect(withShipping, listingIds, includeListing);
    if (error) {
      const message = toMessage(error);
      const missingShipping = message.includes('shipping_address') || message.includes('schema cache');
      if (missingShipping) {
        withShipping = false;
        const fallback = await performSelect(withShipping, listingIds, includeListing);
        data = fallback.data;
        error = fallback.error as any;
      }
    }

    if (error) {
      const message = toMessage(error);
      const listingJoinUnsupported =
        message.includes('more than one relationship') ||
        message.includes('no foreign key') ||
        message.includes('no relationship') ||
        message.includes('failed to find relation');
      if (includeListing && listingJoinUnsupported) {
        includeListing = false;
        const fallback = await performSelect(withShipping, listingIds, includeListing);
        data = fallback.data;
        error = fallback.error as any;
      }
    }

    if (error) {
      const message = toMessage(error);
      const missingSellerId =
        message.includes('seller_id') || message.includes('column') || message.includes('42703');
      if (missingSellerId) {
        const { data: listingRows, error: listErr } = await supabase
          .from(TABLE_LISTINGS)
          .select('id')
          .eq('seller_id', sellerId);
        if (listErr) {
          throw listErr;
        }
        listingIds = (listingRows ?? [])
          .map((r: any) => r.id as string)
          .filter((id) => typeof id === 'string' && id.length > 0);

        if (!listingIds || listingIds.length === 0) {
          data = [];
          error = null;
        } else {
          const fallback = await performSelect(withShipping, listingIds, includeListing);
          data = fallback.data;
          error = fallback.error as any;

          if (error && includeListing) {
            includeListing = false;
            const secondary = await performSelect(withShipping, listingIds, includeListing);
            data = secondary.data;
            error = secondary.error as any;
          }
        }
      }
    }

    if (error) {
      throw error;
    }

    const rows = (data ?? []) as any[];
    const hasListingProperty = rows.some((row) =>
      Object.prototype.hasOwnProperty.call(row, 'listing'),
    );
    const filteredRows = hasListingProperty ? rows.filter((row) => row.listing) : rows;
    // Hide sales whose listings were deleted after the order was created.
    const sales: SellerSale[] = filteredRows.map((row) => ({
      orderId: row.order_id,
      createdAt: row.order?.created_at ?? new Date().toISOString(),
      buyerId: row.order?.buyer_id ?? '',
      listingId: row.listing_id,
      listingTitle: (row.title ?? '').trim(),
      priceCents: Math.max(0, Math.round(row.price_cents ?? 0)),
      quantity: Math.max(1, Math.round(row.quantity ?? 1)),
      currency: normaliseCurrency(row.currency),
      orderStatus: ((row.order?.status as string | null) ?? 'pending') as OrderStatus,
      shippingAddress: (row.order?.shipping_address ?? null) as ShippingAddress | null,
    }));

    // Sort newest first if server-side order not applied
    sales.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return { data: sales, error: null };
  } catch (error) {
    return { data: [], error: resolveErrorMessage(error, 'Unable to load your sales right now.') };
  }
};

export const updateOrderStatus = async (
  orderId: string,
  status: OrderStatus,
): Promise<ActionResult> => {
  if (!supabase) {
    return { data: undefined, error: 'Supabase is not configured yet.' };
  }

  try {
    const { error } = await supabase
      .from(TABLE_ORDERS)
      .update({ status })
      .eq('id', orderId);

    if (error) {
      throw error;
    }

    return { data: undefined, error: null };
  } catch (error) {
    return { data: undefined, error: resolveErrorMessage(error, 'Unable to update order status right now.') };
  }
};

export const fetchTradeOffers = async (
  userId: string,
  direction: 'outgoing' | 'incoming',
): Promise<QueryResult<TradeOffer[]>> => {
  if (!supabase) {
    return { data: [], error: 'Supabase is not configured yet.' };
  }

  const column = direction === 'outgoing' ? 'initiator_id' : 'recipient_id';

  try {
    const projectionWithExplicitJoins =
      'id, initiator_id, recipient_id, status, offered_item_description, offered_value_cents, currency, created_at, updated_at, ' +
      'listing:marketplace_listings(id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at), ' +
      'initiator_profile:users!marketplace_trade_offers_initiator_id_fkey(display_name), ' +
      'recipient_profile:users!marketplace_trade_offers_recipient_id_fkey(display_name)';

    const performSelect = async (withProfiles: boolean) =>
      supabase
        .from(TABLE_TRADE_OFFERS)
        .select(
          withProfiles
            ? projectionWithExplicitJoins
            : 'id, initiator_id, recipient_id, status, offered_item_description, offered_value_cents, currency, created_at, updated_at, listing:marketplace_listings(id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at)',
        )
        .eq(column, userId)
        .order('created_at', { ascending: false });

    let { data, error } = await performSelect(true);
    if (error) {
      const message = String(error.message || '').toLowerCase();
      if (message.includes('more than one relationship') || message.includes('no foreign key')) {
        const fallback = await performSelect(false);
        data = fallback.data;
        error = fallback.error as any;
      }
    }

    if (error) {
      throw error;
    }

    return {
      data: (data ?? []).map((row) => normaliseTradeRow(row as RawTradeRow, userId)),
      error: null,
    };
  } catch (error) {
    return {
      data: [],
      error: resolveErrorMessage(error, 'Unable to load trade offers right now.'),
    };
  }
};

export const createTradeOffer = async (
  userId: string,
  input: TradeOfferInput,
): Promise<ActionResult<TradeOffer>> => {
  if (!supabase) {
    return {
      data: {
        id: 'local',
        listing: null,
        initiatorId: userId,
        recipientId: '',
        status: 'pending',
        offeredItemDescription: input.offeredItemDescription ?? null,
        offeredValueCents:
          typeof input.offeredValueCents === 'number'
            ? Math.max(0, Math.round(input.offeredValueCents))
            : null,
        currency: normaliseCurrency(input.currency),
        createdAt: new Date().toISOString(),
        updatedAt: null,
        direction: 'outgoing',
        counterpartyName: 'Trader',
      },
      error: 'Supabase is not configured yet.',
    };
  }

  try {
    const client = requireClient();

    const { data: listingRow, error: listingError } = await client
      .from(TABLE_LISTINGS)
      .select('id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at')
      .eq('id', input.listingId)
      .maybeSingle();

    if (listingError) {
      throw listingError;
    }

    if (!listingRow) {
      throw new Error('The selected listing could not be found.');
    }

    const recipientId = (listingRow as RawListingRow).seller_id;
    if (!recipientId) {
      throw new Error('The selected listing does not have a seller.');
    }

    const payload = {
      listing_id: input.listingId,
      initiator_id: userId,
      recipient_id: recipientId,
      offered_item_description: (input.offeredItemDescription ?? '').trim() || null,
      offered_value_cents:
        typeof input.offeredValueCents === 'number'
          ? Math.max(0, Math.round(input.offeredValueCents))
          : null,
      currency: normaliseCurrency(input.currency ?? (listingRow as RawListingRow).currency),
      status: 'pending',
    };

    const projectionWithExplicitJoins =
      'id, initiator_id, recipient_id, status, offered_item_description, offered_value_cents, currency, created_at, updated_at, ' +
      'listing:marketplace_listings(id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at), ' +
      'initiator_profile:users!marketplace_trade_offers_initiator_id_fkey(display_name), ' +
      'recipient_profile:users!marketplace_trade_offers_recipient_id_fkey(display_name)';

    const performInsert = (projection: string) =>
      client
        .from(TABLE_TRADE_OFFERS)
        .insert(payload)
        .select(projection)
        .single();

    let { data, error } = await performInsert(projectionWithExplicitJoins);
    if (error) {
      const message = String(error.message || '').toLowerCase();
      if (message.includes('more than one relationship') || message.includes('no foreign key')) {
        const fallback = await performInsert(
          'id, initiator_id, recipient_id, status, offered_item_description, offered_value_cents, currency, created_at, updated_at, listing:marketplace_listings(id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at)'
        );
        data = fallback.data as any;
        error = fallback.error as any;
      }
    }

    if (error) {
      throw error;
    }

    return {
      data: normaliseTradeRow(data as RawTradeRow, userId),
      error: null,
    };
  } catch (error) {
    return {
      data: {
        id: 'error',
        listing: null,
        initiatorId: userId,
        recipientId: '',
        status: 'pending',
        offeredItemDescription: input.offeredItemDescription ?? null,
        offeredValueCents:
          typeof input.offeredValueCents === 'number'
            ? Math.max(0, Math.round(input.offeredValueCents))
            : null,
        currency: normaliseCurrency(input.currency),
        createdAt: new Date().toISOString(),
        updatedAt: null,
        direction: 'outgoing',
        counterpartyName: 'Trader',
      },
      error: resolveErrorMessage(error, 'Unable to create the trade offer right now.'),
    };
  }
};

export const updateTradeStatus = async (
  offerId: string,
  status: TradeStatus,
): Promise<ActionResult> => {
  if (!supabase) {
    return { data: undefined, error: 'Supabase is not configured yet.' };
  }

  try {
    const { error } = await supabase
      .from(TABLE_TRADE_OFFERS)
      .update({ status })
      .eq('id', offerId);

    if (error) {
      throw error;
    }

    return { data: undefined, error: null };
  } catch (error) {
    return {
      data: undefined,
      error: resolveErrorMessage(error, 'Unable to update the trade offer right now.'),
    };
  }
};

export const fetchSellerStatus = async (
  userId: string,
): Promise<QueryResult<SellerStatus>> => {
  if (!supabase) {
    return {
      data: {
        state: 'none',
        shopName: null,
        businessType: null,
        submittedAt: null,
        reviewedAt: null,
      },
      error: 'Supabase is not configured yet.',
    };
  }

  try {
    const baseColumns = ['status', 'shop_name', 'submitted_at'];
    const optionalColumns = ['business_type', 'reviewed_at'];

    const runQuery = async (columns: string[]) =>
      supabase
        .from(TABLE_SELLER_APPLICATIONS)
        .select(columns.join(', '))
        .eq('user_id', userId)
        .order('submitted_at', { ascending: false })
        .maybeSingle();

    let selectedColumns = [...baseColumns, ...optionalColumns];
    let resolvedColumns = new Set<string>();
    let row: RawSellerApplication | null = null;

    // Optional columns are not present on every Supabase instance.
    // Retry without any missing columns so the query can still succeed.
    while (selectedColumns.length > 0) {
      const { data, error } = await runQuery(selectedColumns);
      if (!error) {
        row = (data ?? null) as RawSellerApplication | null;
        resolvedColumns = new Set(selectedColumns);
        break;
      }

      const missingColumn = extractMissingColumnName(error);
      if (!missingColumn || !selectedColumns.includes(missingColumn)) {
        throw error;
      }

      if (baseColumns.includes(missingColumn)) {
        throw error;
      }

      selectedColumns = selectedColumns.filter((column) => column !== missingColumn);
    }

    if (!row) {
      return {
        data: {
          state: 'none',
          shopName: null,
          businessType: null,
          submittedAt: null,
          reviewedAt: null,
        },
        error: null,
      };
    }

    const record = row;
    const status = (record.status ?? '').toLowerCase();

    let state: SellerStatusState = 'pending';
    if (!status || status === 'pending') {
      state = 'pending';
    } else if (status === 'approved' || status === 'active') {
      state = 'approved';
    } else if (status === 'rejected' || status === 'denied') {
      state = 'rejected';
    }

    return {
      data: {
        state,
        shopName: record.shop_name ?? null,
        businessType: resolvedColumns.has('business_type') ? record.business_type ?? null : null,
        submittedAt: record.submitted_at ?? null,
        reviewedAt: resolvedColumns.has('reviewed_at') ? record.reviewed_at ?? null : null,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: {
        state: 'none',
        shopName: null,
        businessType: null,
        submittedAt: null,
        reviewedAt: null,
      },
      error: resolveErrorMessage(error, 'Unable to load seller status right now.'),
    };
  }
};

export const fetchMarketplaceStats = async (
  userId: string,
): Promise<QueryResult<MarketplaceStats>> => {
  if (!supabase) {
    return { data: { ordersCount: 0, cartCount: 0 }, error: 'Supabase is not configured yet.' };
  }

  try {
    const [ordersResult, cartResult] = await Promise.all([
      supabase
        .from(TABLE_ORDERS)
        .select('id', { count: 'exact', head: true })
        .eq('buyer_id', userId),
      supabase
        .from(TABLE_CART)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);

    if (ordersResult.error) {
      throw ordersResult.error;
    }
    if (cartResult.error) {
      throw cartResult.error;
    }

    return {
      data: {
        ordersCount: ordersResult.count ?? 0,
        cartCount: cartResult.count ?? 0,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: { ordersCount: 0, cartCount: 0 },
      error: resolveErrorMessage(error, 'Unable to load marketplace stats right now.'),
    };
  }
};

export const syncMarketplaceStatsToProfile = async (
  userId: string,
): Promise<ActionResult<MarketplaceStats>> => {
  if (!supabase) {
    return {
      data: { ordersCount: 0, cartCount: 0 },
      error: 'Supabase is not configured yet.',
    };
  }

  try {
    const stats = await fetchMarketplaceStats(userId);
    if (stats.error) {
      throw new Error(stats.error);
    }

    const { error } = await supabase
      .from(TABLE_USERS)
      .upsert(
        {
          id: userId,
          orders_count: stats.data.ordersCount,
          cart_items: stats.data.cartCount,
        },
        { onConflict: 'id' },
      );

    if (error) {
      throw error;
    }

    return { data: stats.data, error: null };
  } catch (error) {
    return {
      data: { ordersCount: 0, cartCount: 0 },
      error: resolveErrorMessage(
        error,
        'Unable to sync marketplace stats to your profile right now.',
      ),
    };
  }
};
export const fetchListings = async (): Promise<QueryResult<ListingRecord[]>> => {
  if (!supabase) {
    return { data: [], error: 'Supabase is not configured yet.' };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_LISTINGS)
      .select(
        'id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url)',
      )
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return {
      data: (data ?? []).map((row) => normaliseListingRow(row as RawListingRow)),
      error: null,
    };
  } catch (error) {
    return {
      data: [],
      error: resolveErrorMessage(error, 'Unable to load listings right now.'),
    };
  }
};

export const fetchListingById = async (
  listingId: string,
): Promise<QueryResult<ListingRecord | null>> => {
  if (!supabase) {
    return { data: null, error: 'Supabase is not configured yet.' };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_LISTINGS)
      .select(
        'id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url)'
      )
      .eq('id', listingId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return { data: null, error: 'Listing not found.' };
    }

    return { data: normaliseListingRow(data as RawListingRow), error: null };
  } catch (error) {
    return {
      data: null,
      error: resolveErrorMessage(error, 'Unable to load listing details right now.'),
    };
  }
};

export const fetchListingStats = async (
  listingId: string,
): Promise<QueryResult<ListingStats>> => {
  if (!supabase) {
    return { data: { soldCount: 0, reviewCount: 0, averageRating: 0 }, error: 'Supabase is not configured yet.' };
  }

  try {
    const [orderItemsResult, reviewsResult] = await Promise.all([
      supabase.from(TABLE_ORDER_ITEMS).select('quantity').eq('listing_id', listingId),
      supabase.from(TABLE_REVIEWS).select('rating').eq('listing_id', listingId),
    ]);

    if (orderItemsResult.error) {
      throw orderItemsResult.error;
    }
    if (reviewsResult.error) {
      throw reviewsResult.error;
    }

    const soldCount = (orderItemsResult.data ?? []).reduce((sum, row) => {
      const q = (row as any).quantity;
      const qty = typeof q === 'number' ? q : 0;
      return sum + Math.max(0, Math.round(qty));
    }, 0);

    const ratings: number[] = (reviewsResult.data ?? []).map((row) => {
      const r = (row as any).rating;
      const val = typeof r === 'number' ? r : 0;
      return Math.max(0, Math.min(5, val));
    });
    const reviewCount = ratings.length;
    const averageRating = reviewCount === 0 ? 0 : ratings.reduce((a, b) => a + b, 0) / reviewCount;

    return { data: { soldCount, reviewCount, averageRating }, error: null };
  } catch (error) {
    return {
      data: { soldCount: 0, reviewCount: 0, averageRating: 0 },
      error: resolveErrorMessage(error, 'Unable to load listing stats right now.'),
    };
  }
};

export const fetchReviewsForListing = async (
  listingId: string,
  options?: { limit?: number },
): Promise<QueryResult<ReviewRecord[]>> => {
  if (!supabase) {
    return { data: [], error: 'Supabase is not configured yet.' };
  }

  try {
    const query = supabase
      .from(TABLE_REVIEWS)
      .select('id, listing_id, buyer_id, order_item_id, rating, comment, media, created_at')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false });

    const { data, error } =
      typeof options?.limit === 'number' && options.limit > 0
        ? await query.limit(options.limit)
        : await query;

    if (error) {
      throw error;
    }

    const records: ReviewRecord[] = (data ?? []).map((row: any) => ({
      id: row.id,
      listingId: row.listing_id,
      buyerId: row.buyer_id,
      orderItemId: row.order_item_id ?? null,
      rating: Math.max(1, Math.min(5, Math.round(row.rating ?? 0))),
      comment: (row.comment ?? '').trim() || null,
      media: normaliseReviewMediaList(row.media),
      createdAt: row.created_at,
    }));

    return { data: records, error: null };
  } catch (error) {
    return {
      data: [],
      error: resolveErrorMessage(error, 'Unable to load reviews right now.'),
    };
  }
};

export const addReview = async ({
  buyerId,
  listingId,
  orderItemId,
  rating,
  comment,
  media,
}: {
  buyerId: string;
  listingId: string;
  orderItemId?: string | null;
  rating: number;
  comment?: string;
  media?: ReviewMediaInput[] | null;
}): Promise<ActionResult<ReviewRecord>> => {
  if (!supabase) {
    return {
      data: {
        id: 'local',
        listingId,
        buyerId,
        orderItemId: orderItemId ?? null,
        rating: Math.max(1, Math.min(5, Math.round(rating))),
        comment: (comment ?? '').trim() || null,
        media: serialiseReviewMediaInput(media),
        createdAt: new Date().toISOString(),
      },
      error: 'Supabase is not configured yet.',
    };
  }

  try {
    const mediaPayload = serialiseReviewMediaInput(media);
    const payload = {
      buyer_id: buyerId,
      listing_id: listingId,
      order_item_id: orderItemId ?? null,
      rating: Math.max(1, Math.min(5, Math.round(rating))),
      comment: (comment ?? '').trim() || null,
      media: mediaPayload,
    };

    const { data, error } = await supabase
      .from(TABLE_REVIEWS)
      .insert(payload)
      .select('id, listing_id, buyer_id, order_item_id, rating, comment, media, created_at')
      .single();

    if (error) {
      throw error;
    }

    return {
      data: {
        id: (data as any).id,
        listingId: (data as any).listing_id,
        buyerId: (data as any).buyer_id,
        orderItemId: ((data as any).order_item_id ?? null) as string | null,
        rating: Math.max(1, Math.min(5, Math.round(((data as any).rating ?? 0)))),
        comment: (((data as any).comment ?? '') as string).trim() || null,
        media: normaliseReviewMediaList((data as any).media),
        createdAt: (data as any).created_at,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: {
        id: 'error',
        listingId,
        buyerId,
        orderItemId: orderItemId ?? null,
        rating: Math.max(1, Math.min(5, Math.round(rating))),
        comment: (comment ?? '').trim() || null,
        media: serialiseReviewMediaInput(media),
        createdAt: new Date().toISOString(),
      },
      error: resolveErrorMessage(error, 'Unable to submit your review right now.'),
    };
  }
};

export const fetchListingsForSeller = async (
  sellerId: string,
): Promise<QueryResult<ListingRecord[]>> => {
  if (!supabase) {
    return { data: [], error: 'Supabase is not configured yet.' };
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_LISTINGS)
      .select(
        'id, seller_id, title, description, price_cents, currency, quantity, status, allow_trade, image_url, created_at, updated_at, seller_profile:users(display_name, photo_url)',
      )
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return {
      data: (data ?? []).map((row) => normaliseListingRow(row as RawListingRow)),
      error: null,
    };
  } catch (error) {
    return {
      data: [],
      error: resolveErrorMessage(error, 'Unable to load your listings right now.'),
    };
  }
};

export const subscribeToListings = (
  callback: (listings: ListingRecord[]) => void,
  options?: { sellerId?: string },
): (() => void) | null => {
  if (!supabase) {
    return null;
  }

  const filter =
    options?.sellerId && options.sellerId.length > 0
      ? `seller_id=eq.${options.sellerId}`
      : undefined;

  const channel: RealtimeChannel = supabase
    .channel(`listings:${options?.sellerId ?? 'all'}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: TABLE_LISTINGS, filter },
      async () => {
        const result = options?.sellerId
          ? await fetchListingsForSeller(options.sellerId)
          : await fetchListings();
        callback(result.data);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};
export type ListingStatus = 'draft' | 'active' | 'inactive';

export type ListingRecord = {
  id: string;
  sellerId: string;
  sellerDisplayName: string;
  sellerAvatarUrl: string | null;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  quantity: number;
  status: ListingStatus;
  allowTrade: boolean;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type ListingInput = {
  title: string;
  description?: string;
  priceCents: number;
  currency?: string;
  quantity?: number;
  status?: ListingStatus;
  allowTrade?: boolean;
  imageUrl?: string | null;
  // Optional array support: when provided, we will serialise to JSON in image_url
  imageUrls?: string[];
};

export type ListingUpdate = Partial<
  Pick<
    ListingInput,
    | 'title'
    | 'description'
    | 'priceCents'
    | 'currency'
    | 'quantity'
    | 'status'
    | 'allowTrade'
    | 'imageUrl'
    | 'imageUrls'
  >
>;

export type WishlistEntry = {
  id: string;
  listing: ListingRecord;
  createdAt: string;
};

export type CartEntry = {
  id: string;
  quantity: number;
  listing: ListingRecord;
  createdAt: string;
};

export type OrderStatus = 'pending' | 'paid' | 'preparing' | 'shipped' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type PaymentMethod = 'cod' | 'card' | 'gcash' | 'maya' | 'bank_transfer';

export const AVAILABLE_PAYMENT_METHODS: Array<{
  method: PaymentMethod;
  label: string;
  description: string;
}> = [
  { method: 'cod', label: 'Cash on Delivery', description: 'Pay when your parcel arrives.' },
  { method: 'card', label: 'Credit / Debit Card', description: 'Visa, Mastercard, and more.' },
  { method: 'gcash', label: 'GCash', description: 'Instant e-wallet payment.' },
  { method: 'maya', label: 'Maya', description: 'Link your Maya wallet for quick checkout.' },
  {
    method: 'bank_transfer',
    label: 'Bank Transfer',
    description: 'Use any InstaPay-compatible banking app.',
  },
];

export type OrderItem = {
  id: string;
  orderId: string;
  listingId: string;
  title: string;
  priceCents: number;
  quantity: number;
  currency: string;
};

export type OrderRecord = {
  id: string;
  buyerId: string;
  totalCents: number;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  createdAt: string;
  items: OrderItem[];
};

export type CheckoutResult = {
  order: OrderRecord;
};

export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'completed';

export type TradeOffer = {
  id: string;
  listing: ListingRecord | null;
  initiatorId: string;
  recipientId: string;
  status: TradeStatus;
  offeredItemDescription: string | null;
  offeredValueCents: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string | null;
  direction: 'outgoing' | 'incoming';
  counterpartyName: string;
};

export type TradeOfferInput = {
  listingId: string;
  offeredItemDescription?: string;
  offeredValueCents?: number;
  currency?: string;
};

export type MarketplaceStats = {
  ordersCount: number;
  cartCount: number;
};

export type ListingStats = {
  soldCount: number;
  reviewCount: number;
  averageRating: number;
};

export type ReviewRecord = {
  id: string;
  listingId: string;
  buyerId: string;
  orderItemId: string | null;
  rating: number; // 1-5
  comment: string | null;
  media: ReviewMedia[];
  createdAt: string;
};

export type ShippingAddress = {
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
};

export type NotificationRecord = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
};

export type SellerSale = {
  orderId: string;
  createdAt: string;
  buyerId: string;
  listingId: string;
  listingTitle: string;
  priceCents: number;
  quantity: number;
  currency: string;
  orderStatus: OrderStatus;
  shippingAddress: ShippingAddress | null;
};

export type SellerStatusState = 'none' | 'pending' | 'approved' | 'rejected';

export type SellerStatus = {
  state: SellerStatusState;
  shopName: string | null;
  businessType: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
};

type RawListingRow = {
  id: string;
  seller_id: string;
  title: string | null;
  description: string | null;
  price_cents: number | null;
  currency: string | null;
  quantity: number | null;
  status: string | null;
  allow_trade: boolean | null;
  image_url: string | null;
  created_at: string;
  updated_at: string | null;
  seller_profile?: {
    display_name?: string | null;
    photo_url?: string | null;
  } | null;
};

type RawWishlistRow = {
  id: string;
  created_at: string;
  listing: RawListingRow | null;
};

type RawCartRow = {
  id: string;
  created_at: string;
  quantity: number | null;
  listing: RawListingRow | null;
};

type RawOrderItemRow = {
  id: string;
  order_id: string;
  listing_id: string | null;
  title: string | null;
  price_cents: number | null;
  quantity: number | null;
  currency: string | null;
};

type RawOrderRow = {
  id: string;
  buyer_id: string;
  total_cents: number | null;
  currency: string | null;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  created_at: string;
  order_items?: RawOrderItemRow[] | null;
};

type RawTradeRow = {
  id: string;
  initiator_id: string;
  recipient_id: string;
  listing_id: string | null;
  listing: RawListingRow | null;
  status: string | null;
  offered_item_description: string | null;
  offered_value_cents: number | null;
  currency: string | null;
  created_at: string;
  updated_at: string | null;
  initiator_profile?: {
    display_name?: string | null;
  } | null;
  recipient_profile?: {
    display_name?: string | null;
  } | null;
};

type RawSellerApplication = {
  status: string | null;
  shop_name: string | null;
  submitted_at: string | null;
  business_type?: string | null;
  reviewed_at?: string | null;
};
