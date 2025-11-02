import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Switch,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, storageBucket, signOutSafely } from '@/config/supabase';
import { DEFAULT_AVATAR_URI } from '@/constants/avatar';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  createListing,
  deleteListing,
  fetchListingsForSeller,
  fetchMarketplaceStats,
  fetchSellerStatus,
  updateListing,
  fetchOrders,
  updateOrderStatus,
  addReview,
} from '@/lib/marketplace';
import type {
  ListingRecord,
  ListingStatus,
  SellerStatusState,
  OrderRecord,
  ReviewMedia,
} from '@/lib/marketplace';
import { formatCurrency, parsePriceInput } from '@/utils/currency';

type ProfileActionConfig = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
};

type ProfileStats = {
  orders: number;
  cart: number;
};

type ProfilePanel =
  | 'orders'
  | 'inbox'
  | 'shipping'
  | 'password'
  | 'seller'
  | 'toReview'
  | 'followers'
  | 'following';

type ShippingAddress = {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  isDefault: boolean;
};

type ShippingAddressInput = Omit<ShippingAddress, 'id'>;

type FollowProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
  photo_url: string | null;
};

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Uint8Array(256).fill(255);
const DATA_URI_MAX_BASE64_LENGTH = 120_000;
const DATA_URI_RESIZE_TARGET = 512;
const DATA_URI_COMPRESS_RATIO = 0.65;
// Metadata stored in Supabase auth ends up inside the JWT; keep inline values small to avoid 431 errors.
const AUTH_METADATA_DATA_URI_THRESHOLD = 4_096;

const SHIPPING_FORM_BLANK: ShippingAddressInput = {
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  isDefault: false,
};

const LISTING_FORM_BLANK = {
  title: '',
  price: '',
  description: '',
  quantity: '1',
  imageUrl: '',
  allowTrade: true,
};

const FOLLOW_AVATAR_COLORS = ['#6D4BD1', '#2D1F1D', '#F26B5A', '#4E2F39', '#3D5C35', '#FFB84D', '#2E8B57'];

const resolveFollowDisplayName = (profile: FollowProfile) =>
  (profile.display_name ?? '').trim() || profile.email || 'Unnamed user';

const buildInitialsFromName = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const getAccentForFollowId = (id: string) => {
  const sum = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return FOLLOW_AVATAR_COLORS[sum % FOLLOW_AVATAR_COLORS.length];
};

const MAX_REVIEW_MEDIA_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB per photo
const MAX_REVIEW_MEDIA_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB per video
const FILESYSTEM_BASE64_ENCODING = 'base64' as FileSystem.EncodingType;

for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
  BASE64_LOOKUP[BASE64_ALPHABET.charCodeAt(index)] = index;
}

const decodeBase64ToUint8Array = (base64: string) => {
  const sanitized = base64.replace(/[^A-Za-z0-9+/=]/g, '');

  if (sanitized.length % 4 !== 0) {
    throw new Error('Invalid base64 string length.');
  }

  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  const outputLength = (sanitized.length / 4) * 3 - padding;
  const result = new Uint8Array(outputLength);

  let outputIndex = 0;

  for (let i = 0; i < sanitized.length; i += 4) {
    const c1 = sanitized.charCodeAt(i);
    const c2 = sanitized.charCodeAt(i + 1);
    const c3 = sanitized.charCodeAt(i + 2);
    const c4 = sanitized.charCodeAt(i + 3);

    const b1 = BASE64_LOOKUP[c1];
    const b2 = BASE64_LOOKUP[c2];
    const b3 = c3 === 61 ? 0 : BASE64_LOOKUP[c3];
    const b4 = c4 === 61 ? 0 : BASE64_LOOKUP[c4];

    if (b1 === 255 || b2 === 255 || (c3 !== 61 && b3 === 255) || (c4 !== 61 && b4 === 255)) {
      throw new Error('Invalid character encountered in base64 string.');
    }

    const chunk = (b1 << 18) | (b2 << 12) | (b3 << 6) | b4;

    result[outputIndex] = (chunk >> 16) & 0xff;
    outputIndex += 1;

    if (c3 !== 61) {
      result[outputIndex] = (chunk >> 8) & 0xff;
      outputIndex += 1;
    }

    if (c4 !== 61) {
      result[outputIndex] = chunk & 0xff;
      outputIndex += 1;
    }
  }

  return result;
};

const PROFILE_UPDATE_FALLBACK_MESSAGE =
  'We could not update your profile picture right now. Please try again shortly.';

const resolveErrorMessage = (error: unknown, fallbackMessage = PROFILE_UPDATE_FALLBACK_MESSAGE) => {
  if (error instanceof Error) {
    const trimmed = error.message.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (typeof error === 'string') {
    const trimmed = error.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (error && typeof error === 'object') {
    const potentialKeys = ['message', 'msg', 'error_description', 'error', 'hint', 'details'] as const;
    for (const key of potentialKeys) {
      const value = (error as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }

  return fallbackMessage;
};

const buildDataUri = (base64: string, contentType: string) =>
  `data:${contentType.startsWith('image/') ? contentType : 'image/jpeg'};base64,${base64}`;

const shouldTrimAuthPhotoMetadata = (value: unknown) =>
  typeof value === 'string' &&
  value.startsWith('data:') &&
  value.length > AUTH_METADATA_DATA_URI_THRESHOLD;

const ensureDataUriReady = async ({
  assetUri,
  base64,
  preferredContentType,
}: {
  assetUri?: string;
  base64: string;
  preferredContentType: string;
}) => {
  let cleanedBase64 = base64.replace(/\s/g, '');
  let contentType = preferredContentType.startsWith('image/')
    ? preferredContentType
    : 'image/jpeg';

  if (cleanedBase64.length <= DATA_URI_MAX_BASE64_LENGTH || !assetUri) {
    return { base64: cleanedBase64, contentType };
  }

  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      assetUri,
      [{ resize: { width: DATA_URI_RESIZE_TARGET } }],
      {
        compress: DATA_URI_COMPRESS_RATIO,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );

    if (manipulated.base64) {
      cleanedBase64 = manipulated.base64.replace(/\s/g, '');
      contentType = 'image/jpeg';
    }
  } catch (manipulationError) {
    console.warn('Failed to resize avatar before generating data URI', manipulationError);
  }

  return { base64: cleanedBase64, contentType };
};

const sortAddressBook = (addresses: ShippingAddress[]) =>
  [...addresses].sort((first, second) => {
    if (first.isDefault === second.isDefault) {
      return 0;
    }
    return first.isDefault ? -1 : 1;
  });

const parseShippingAddresses = (value: unknown): ShippingAddress[] => {
  if (!value) {
    return [];
  }

  const normalise = (entry: Partial<ShippingAddress>, index: number): ShippingAddress => {
    const {
      fullName,
      phone,
      line1,
      line2,
      city,
      region,
      postalCode,
      isDefault,
      id,
    } = entry;

    const fallbackId = `addr-${index}-${Date.now()}`;

    return {
      id: typeof id === 'string' && id.trim().length > 0 ? id : fallbackId,
      fullName: typeof fullName === 'string' ? fullName.trim() : '',
      phone: typeof phone === 'string' ? phone.trim() : '',
      line1: typeof line1 === 'string' ? line1.trim() : '',
      line2: typeof line2 === 'string' ? line2.trim() : '',
      city: typeof city === 'string' ? city.trim() : '',
      region: typeof region === 'string' ? region.trim() : '',
      postalCode: typeof postalCode === 'string' ? postalCode.trim() : '',
      isDefault: Boolean(isDefault) || index === 0,
    };
  };

  if (Array.isArray(value)) {
    return sortAddressBook(
      value.map((entry, index) => {
        if (typeof entry === 'string') {
          return normalise({ line1: entry, isDefault: index === 0 }, index);
        }
        if (entry && typeof entry === 'object') {
          return normalise(entry as Partial<ShippingAddress>, index);
        }
        return normalise({}, index);
      }),
    );
  }

  if (typeof value === 'string') {
    return [
      normalise(
        {
          line1: value,
          isDefault: true,
        },
        0,
      ),
    ];
  }

  if (value && typeof value === 'object') {
    return [
      normalise(value as Partial<ShippingAddress>, 0),
    ];
  }

  return [];
};

const ProfileActionRow = ({ icon, label, description, onPress }: ProfileActionConfig) => (
  <TouchableOpacity style={styles.actionRow} onPress={onPress} activeOpacity={0.85}>
    <View style={styles.actionIconWrapper}>
      <Ionicons name={icon} size={26} color="#111111" />
    </View>
    <View style={styles.actionCopy}>
      <Text style={styles.actionLabel}>{label}</Text>
      <Text style={styles.actionDescription}>{description}</Text>
    </View>
    <Ionicons name="chevron-forward" size={22} color="#111111" />
  </TouchableOpacity>
);

type PanelModalProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  presentation?: 'bottom' | 'center';
  children: React.ReactNode;
};

const PanelModal = ({
  visible,
  title,
  onClose,
  closeDisabled = false,
  presentation = 'bottom',
  children,
}: PanelModalProps) => (
  <Modal
    animationType="fade"
    transparent
    visible={visible}
    onRequestClose={() => {
      if (!closeDisabled) {
        onClose();
      }
    }}
  >
    <View
      style={[
        styles.modalOverlay,
        presentation === 'center' ? styles.modalOverlayCenter : styles.modalOverlayBottom,
      ]}
    >
      <View
        style={[
          styles.modalContainer,
          presentation === 'center' ? styles.modalContainerCentered : styles.modalContainerBottom,
        ]}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TouchableOpacity
            style={[
              styles.modalCloseButton,
              closeDisabled ? styles.modalCloseButtonDisabled : null,
            ]}
            activeOpacity={closeDisabled ? 1 : 0.7}
            onPress={closeDisabled ? undefined : onClose}
            disabled={closeDisabled}
          >
            <Ionicons name="close" size={20} color={closeDisabled ? '#9E9E9E' : '#111111'} />
          </TouchableOpacity>
        </View>
        <View style={styles.modalContentContainer}>{children}</View>
      </View>
    </View>
  </Modal>
);

export default function ProfileScreen() {
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [displayName, setDisplayName] = useState('Guest');
  const [email, setEmail] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string>(DEFAULT_AVATAR_URI);
  const [stats, setStats] = useState<ProfileStats>({ orders: 0, cart: 0 });
  const [initializing, setInitializing] = useState(true);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [activePanel, setActivePanel] = useState<ProfilePanel | null>(null);
  const [addressBook, setAddressBook] = useState<ShippingAddress[]>([]);
  const [shippingForm, setShippingForm] = useState<ShippingAddressInput>({
    ...SHIPPING_FORM_BLANK,
  });
  const [shippingSaving, setShippingSaving] = useState(false);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [shippingFeedback, setShippingFeedback] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    next: '',
    confirm: '',
  });
  const [passwordUpdating, setPasswordUpdating] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);
  const [reviewedOrderItems, setReviewedOrderItems] = useState<Set<string>>(new Set());
  const [legacyReviewedListings, setLegacyReviewedListings] = useState<Set<string>>(new Set());
  const [reviewTarget, setReviewTarget] = useState<{ listingId: string; listingTitle: string; orderItemId: string | null } | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewMedia, setReviewMedia] = useState<ReviewMedia[]>([]);
  const [reviewMediaUploading, setReviewMediaUploading] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [sellerStatus, setSellerStatus] = useState<SellerStatusState>('none');
  const [sellerListings, setSellerListings] = useState<ListingRecord[]>([]);
  const [listingForm, setListingForm] = useState({ ...LISTING_FORM_BLANK });
  const [listingSaving, setListingSaving] = useState(false);
  const [listingFeedback, setListingFeedback] = useState<string | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  const [listingImages, setListingImages] = useState<string[]>([]);
  const [listingImagesUploading, setListingImagesUploading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameFeedback, setNameFeedback] = useState<string | null>(null);
  const [followers, setFollowers] = useState<FollowProfile[]>([]);
  const [followingProfiles, setFollowingProfiles] = useState<FollowProfile[]>([]);
  const [followListsLoading, setFollowListsLoading] = useState(false);
  const [followListsError, setFollowListsError] = useState<string | null>(null);

  const LISTING_IMAGES_BUCKET = storageBucket || 'avatars';
  const REVIEW_MEDIA_BUCKET = storageBucket || 'avatars';

  const handlePickListingImages = useCallback(async () => {
    if (!supabase || !supabaseUser) {
      Alert.alert('Sign in required', 'You need to be logged in before adding photos.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow access to your photos to attach images.');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      base64: true,
    });

    if (pickerResult.canceled || pickerResult.assets.length === 0) {
      return;
    }

    setListingImagesUploading(true);

    try {
      const uploaded: string[] = [];
      for (const asset of pickerResult.assets) {
        try {
          if (!asset.base64) {
            console.warn('Selected asset did not include base64 payload; skipping.');
            continue;
          }

          const fileBytes = decodeBase64ToUint8Array(asset.base64);
          const fileBuffer = fileBytes.buffer.slice(
            fileBytes.byteOffset,
            fileBytes.byteOffset + fileBytes.byteLength,
          );

          const extension =
            asset.fileName?.split('.').pop()?.toLowerCase() ||
            asset.mimeType?.split('/')[1]?.toLowerCase() ||
            'jpg';
          const contentType = asset.mimeType || 'image/jpeg';
          const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
          const filePath = `listings/${supabaseUser.id}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from(LISTING_IMAGES_BUCKET)
            .upload(filePath, fileBuffer, { contentType, upsert: false });

          if (uploadError) {
            console.warn('Failed to upload listing image', uploadError);
            continue;
          }

          const { data: publicData } = supabase.storage
            .from(LISTING_IMAGES_BUCKET)
            .getPublicUrl(filePath);

          if (publicData?.publicUrl) {
            uploaded.push(publicData.publicUrl);
          }
        } catch (singleError) {
          console.warn('Listing image processing failed', singleError);
        }
      }

      if (uploaded.length === 0) {
        Alert.alert('Upload failed', 'We could not upload the selected images.');
        return;
      }

      setListingImages((prev) => {
        const all = [...prev, ...uploaded];
        return all.filter((url, i) => all.indexOf(url) === i);
      });
    } finally {
      setListingImagesUploading(false);
    }
  }, [LISTING_IMAGES_BUCKET, supabaseUser]);

  const handleRemoveListingImage = useCallback((url: string) => {
    setListingImages((prev) => prev.filter((u) => u !== url));
  }, []);

  const handlePickReviewMedia = useCallback(async () => {
    if (!supabase || !supabaseUser) {
      Alert.alert('Sign in required', 'You need to be logged in before attaching media.');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow access to your gallery to attach photos or videos.');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (pickerResult.canceled || pickerResult.assets.length === 0) {
      return;
    }

    setReviewMediaUploading(true);
    const skippedTooLarge: string[] = [];
    const failedUploads: string[] = [];

    try {
      const uploaded: ReviewMedia[] = [];
      for (const asset of pickerResult.assets) {
        try {
          if (!asset.uri) {
            console.warn('Review asset is missing a URI, skipping.');
            continue;
          }

          const displayName =
            asset.fileName ??
            asset.uri.split('/').filter(Boolean).pop() ??
            (asset.type === 'video' ? 'video' : 'image');
          const isVideo =
            (asset.type ?? '').toLowerCase() === 'video' ||
            (asset.mimeType ?? '').toLowerCase().startsWith('video/');

          let size =
            typeof asset.fileSize === 'number' && asset.fileSize > 0 ? asset.fileSize : undefined;
          if (!size) {
            const info = await FileSystem.getInfoAsync(asset.uri, { size: true });
            if (info.exists && typeof info.size === 'number') {
              size = info.size;
            }
          }

          const sizeLimit = isVideo
            ? MAX_REVIEW_MEDIA_VIDEO_BYTES
            : MAX_REVIEW_MEDIA_IMAGE_BYTES;
          if (size && size > sizeLimit) {
            skippedTooLarge.push(displayName);
            continue;
          }

          let binary: ArrayBuffer | null = null;
          let actualSize: number | null = size ?? null;

          try {
            const response = await fetch(asset.uri);
            if (!response.ok) {
              throw new Error(`Unable to read file (status ${response.status})`);
            }

            if (typeof response.arrayBuffer === 'function') {
              binary = await response.arrayBuffer();
            } else {
              const blob = await response.blob();
              if (blob && typeof (blob as any).arrayBuffer === 'function') {
                binary = await (blob as any).arrayBuffer();
              } else if ('_data' in (blob as any) && (blob as any)._data?.blobId) {
                // React Native blob fallback
                const buffer = await FileSystem.readAsStringAsync(asset.uri, {
                  encoding: FILESYSTEM_BASE64_ENCODING,
                });
                const bytes = decodeBase64ToUint8Array(buffer);
                binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                actualSize = bytes.byteLength;
              }
            }
          } catch (fetchError) {
            console.warn('Review media fetch failed, falling back to FileSystem.readAsStringAsync', fetchError);
          }

          if (!binary) {
            const base64Payload = await FileSystem.readAsStringAsync(asset.uri, {
              encoding: FILESYSTEM_BASE64_ENCODING,
            });
            const bytes = decodeBase64ToUint8Array(base64Payload);
            binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            actualSize = bytes.byteLength;
          }

          if (!binary) {
            failedUploads.push(`${displayName} (unreadable)`);
            continue;
          }

          if (typeof actualSize === 'number' && actualSize > sizeLimit) {
            skippedTooLarge.push(displayName);
            continue;
          }

          const contentType =
            asset.mimeType ||
            (isVideo
              ? 'video/mp4'
              : (asset.type ?? '').toLowerCase() === 'image'
              ? 'image/jpeg'
              : 'application/octet-stream');

          const extension =
            asset.fileName?.split('.').pop()?.toLowerCase() ||
            contentType.split('/')[1]?.toLowerCase() ||
            (isVideo ? 'mp4' : 'jpg');

          const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
          const storagePath = `reviews/${supabaseUser.id}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from(REVIEW_MEDIA_BUCKET)
            .upload(storagePath, binary, { contentType, upsert: false });

          if (uploadError) {
            console.warn('Failed to upload review media', uploadError);
            failedUploads.push(displayName);
            continue;
          }

          const { data: publicData } = supabase.storage
            .from(REVIEW_MEDIA_BUCKET)
            .getPublicUrl(storagePath);

          if (!publicData?.publicUrl) {
            failedUploads.push(displayName);
            continue;
          }

          const resolvedType =
            asset.type === 'video'
              ? 'video'
              : asset.type === 'image'
              ? 'image'
              : contentType.startsWith('video/')
              ? 'video'
              : contentType.startsWith('image/')
              ? 'image'
              : 'unknown';

          uploaded.push({
            url: publicData.publicUrl,
            type: resolvedType,
            thumbnailUrl: null,
          });
        } catch (assetError) {
          console.warn('Review media processing failed', assetError);
          failedUploads.push(`${asset.fileName ?? asset.uri ?? 'file'} (${assetError instanceof Error ? assetError.message : 'unknown error'})`);
        }
      }

      if (uploaded.length === 0) {
        if (skippedTooLarge.length > 0) {
          Alert.alert(
            'Files too large',
            'Some selected files exceeded the size limits (12 MB for photos, 200 MB for videos).',
          );
        } else if (failedUploads.length > 0) {
          Alert.alert(
            'Upload failed',
            'We could not upload your selected media. Please try again.',
          );
        } else {
          Alert.alert('Upload failed', 'We could not upload your selected media.');
        }
        return;
      }

      setReviewMedia((prev) => {
        const combined = [...prev, ...uploaded];
        return combined.filter(
          (entry, index, array) => array.findIndex((candidate) => candidate.url === entry.url) === index,
        );
      });

      if (skippedTooLarge.length > 0 || failedUploads.length > 0) {
        Alert.alert(
          'Some files skipped',
          'Some files were not uploaded because they were too large (photos up to 12 MB, videos up to 200 MB) or because the upload failed.',
        );
      }
    } finally {
      setReviewMediaUploading(false);
    }
  }, [REVIEW_MEDIA_BUCKET, supabaseUser]);

  const handleRemoveReviewMedia = useCallback((url: string) => {
    setReviewMedia((prev) => prev.filter((item) => item.url !== url));
  }, []);

  const handleListingSubmit = useCallback(async () => {
    if (!supabaseUser) {
      Alert.alert('Sign in required', 'You need to be logged in before publishing a listing.');
      return;
    }

    const trimmedTitle = listingForm.title.trim();
    const priceCents = parsePriceInput(listingForm.price);
    const quantityValue = Number.parseInt(listingForm.quantity, 10);
    const quantity = Number.isNaN(quantityValue) ? 1 : Math.max(1, quantityValue);

    if (!trimmedTitle) {
      setListingError('Add a title for your listing.');
      return;
    }

    if (priceCents <= 0) {
      setListingError('Set a price above zero.');
      return;
    }

    setListingSaving(true);
    setListingError(null);
    setListingFeedback(null);

    try {
      const manualUrl = (listingForm.imageUrl || '').trim();
      const combinedImages = [
        ...listingImages,
        ...(manualUrl ? [manualUrl] : []),
      ];

      const result = await createListing(supabaseUser.id, {
        title: trimmedTitle,
        description: listingForm.description.trim(),
        priceCents,
        quantity,
        // Pass multiple images when available; the server will serialise to JSON
        ...(combinedImages.length > 0
          ? { imageUrls: combinedImages }
          : { imageUrl: null as string | null }),
        allowTrade: listingForm.allowTrade,
        currency: 'PHP',
      } as any);

      if (result.error) {
        setListingError(result.error);
        return;
      }

      setListingFeedback('Listing published! It will appear on Home immediately.');
      setListingForm({ ...LISTING_FORM_BLANK });
      setListingImages([]);
      setSellerListings((current) => [result.data, ...current]);
    } catch (error) {
      console.warn('Failed to create listing', error);
      setListingError('Unable to publish the listing right now.');
    } finally {
      setListingSaving(false);
    }
  }, [listingForm, listingImages, supabaseUser]);

  // Refresh seller status/listings when returning from the registration screen
  useFocusEffect(
    useCallback(() => {
      if (supabaseUser) {
        loadSellerData(supabaseUser.id);
      }
    }, [loadSellerData, supabaseUser]),
  );

  const handleListingStatusToggle = useCallback(
    async (listing: ListingRecord) => {
      const nextStatus: ListingStatus = listing.status === 'active' ? 'inactive' : 'active';
      try {
        const result = await updateListing(listing.id, { status: nextStatus });
        if (result.error) {
          Alert.alert('Unable to update listing', result.error);
          return;
        }
        setSellerListings((current) =>
          current.map((item) => (item.id === listing.id ? result.data : item)),
        );
      } catch (error) {
        console.warn('Failed to update listing status', error);
        Alert.alert('Something went wrong', 'Unable to update the listing right now.');
      }
    },
    [],
  );

  const handleListingDelete = useCallback(async (listing: ListingRecord) => {
    Alert.alert(
      'Remove listing',
      `Do you want to remove "${listing.title || 'this listing'}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await deleteListing(listing.id);
              if (result.error) {
                Alert.alert('Unable to remove listing', result.error);
                return;
              }
              setSellerListings((current) => current.filter((item) => item.id !== listing.id));
            } catch (error) {
              console.warn('Failed to delete listing', error);
              Alert.alert('Something went wrong', 'Unable to remove the listing right now.');
            }
          },
        },
      ],
    );
  }, []);

  const inboxCount = useMemo(() => {
    const metadata = supabaseUser?.user_metadata;
    if (!metadata || typeof metadata !== 'object') {
      return 0;
    }
    const record = metadata as Record<string, unknown>;
    const potentialKeys = ['messages_count', 'inbox_count', 'notifications_count'];
    for (const key of potentialKeys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return 0;
  }, [supabaseUser]);

  const normalisePhotoUrl = useCallback((value?: string | null) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    return DEFAULT_AVATAR_URI;
  }, []);

  const handleStartNameEdit = useCallback(() => {
    if (!supabaseUser) {
      Alert.alert('Sign in required', 'You need to be logged in before updating your name.');
      return;
    }
    setNameDraft(displayName);
    setNameError(null);
    setNameFeedback(null);
    setEditingName(true);
  }, [displayName, supabaseUser]);

  const handleCancelNameEdit = useCallback(() => {
    setEditingName(false);
    setNameError(null);
    setNameDraft('');
  }, []);

  const handleSaveName = useCallback(async () => {
    if (!supabaseUser) {
      Alert.alert('Sign in required', 'You need to be logged in before updating your name.');
      return;
    }
    if (savingName) {
      return;
    }

    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError('Please enter a name.');
      return;
    }

    if (trimmed === displayName.trim()) {
      setEditingName(false);
      setNameError(null);
      return;
    }

    try {
      setSavingName(true);
      setNameError(null);

      const timestamp = new Date().toISOString();
      const { error: profileError } = await supabase
        .from('users')
        .upsert(
          {
            id: supabaseUser.id,
            display_name: trimmed,
            updated_at: timestamp,
          },
          { onConflict: 'id' },
        );

      if (profileError) {
        throw profileError;
      }

      const { data: authUpdateData, error: authError } = await supabase.auth.updateUser({
        data: { display_name: trimmed },
      });

      let feedbackMessage = 'Display name updated.';
      if (authError) {
        console.warn('Failed to update auth metadata', authError);
        feedbackMessage =
          'Name updated, but we could not sync all devices yet. Sign out and back in if it does not refresh.';
      } else if (authUpdateData?.user) {
        setSupabaseUser(authUpdateData.user);
      }

      setDisplayName(trimmed);
      setNameFeedback(feedbackMessage);
      setEditingName(false);
    } catch (error) {
      console.warn('Failed to update display name', error);
      setNameError(resolveErrorMessage(error, 'Unable to update your name right now. Please try again.'));
    } finally {
      setSavingName(false);
    }
  }, [displayName, nameDraft, savingName, supabaseUser]);

  const loadFollowLists = useCallback(async () => {
    if (!supabase || !supabaseUser) {
      setFollowers([]);
      setFollowingProfiles([]);
      setFollowListsError(null);
      return;
    }

    setFollowListsLoading(true);
    setFollowListsError(null);

    try {
      const { data: followerRows, error: followerError } = await supabase
        .from('user_follows')
        .select('follower_id')
        .eq('followed_id', supabaseUser.id);

      if (followerError) {
        throw followerError;
      }

      const followerIds = Array.from(
        new Set(
          (followerRows ?? [])
            .map((row: { follower_id: string | null }) => row.follower_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      let followerProfiles: FollowProfile[] = [];
      if (followerIds.length > 0) {
        const { data, error } = await supabase
          .from('users')
          .select('id, display_name, email, photo_url')
          .in('id', followerIds);

        if (error) {
          throw error;
        }

        followerProfiles = (data ?? []) as FollowProfile[];
      }

      const { data: followingRows, error: followingError } = await supabase
        .from('user_follows')
        .select('followed_id')
        .eq('follower_id', supabaseUser.id);

      if (followingError) {
        throw followingError;
      }

      const followingIds = Array.from(
        new Set(
          (followingRows ?? [])
            .map((row: { followed_id: string | null }) => row.followed_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      let followingProfilesList: FollowProfile[] = [];
      if (followingIds.length > 0) {
        const { data, error } = await supabase
          .from('users')
          .select('id, display_name, email, photo_url')
          .in('id', followingIds);

        if (error) {
          throw error;
        }

        followingProfilesList = (data ?? []) as FollowProfile[];
      }

      const sortProfiles = (entries: FollowProfile[]) =>
        [...entries].sort((a, b) =>
          resolveFollowDisplayName(a).localeCompare(resolveFollowDisplayName(b)),
        );

      setFollowers(sortProfiles(followerProfiles));
      setFollowingProfiles(sortProfiles(followingProfilesList));
    } catch (followError) {
      console.warn('Failed to load follow lists', followError);
      setFollowListsError(
        resolveErrorMessage(followError, 'Unable to load follow lists right now. Please try again.'),
      );
    } finally {
      setFollowListsLoading(false);
    }
  }, [supabaseUser]);

  const showPanel = useCallback(
    (panel: ProfilePanel) => {
      if (panel === 'password') {
        setPasswordForm({ current: '', next: '', confirm: '' });
        setPasswordError(null);
        setPasswordFeedback(null);
      }
      if (panel === 'shipping') {
        setShippingForm({
          ...SHIPPING_FORM_BLANK,
          isDefault: addressBook.length === 0,
        });
        setShippingError(null);
        setShippingFeedback(null);
        setShippingSaving(false);
      }
      if (panel === 'followers' || panel === 'following') {
        loadFollowLists();
      }
      setActivePanel(panel);
    },
    [addressBook.length, loadFollowLists],
  );

  useEffect(() => {
    if (supabaseUser) {
      loadFollowLists();
    } else {
      setFollowers([]);
      setFollowingProfiles([]);
    }
  }, [supabaseUser, loadFollowLists]);

  const closePanel = useCallback(() => {
    setActivePanel(null);
    setPasswordUpdating(false);
    setPasswordForm({ current: '', next: '', confirm: '' });
    setPasswordError(null);
    setPasswordFeedback(null);
    setShippingForm({
      ...SHIPPING_FORM_BLANK,
      isDefault: addressBook.length === 0,
    });
    setShippingError(null);
    setShippingFeedback(null);
    setShippingSaving(false);
    setListingError(null);
    setListingFeedback(null);
    setListingSaving(false);
    setListingForm({ ...LISTING_FORM_BLANK });
  }, [addressBook.length]);

  const dismissPasswordPanel = useCallback(() => {
    if (passwordUpdating) {
      return;
    }
    closePanel();
  }, [passwordUpdating, closePanel]);

  const persistAddressBookUpdate = useCallback(
    async (updatedAddresses: ShippingAddress[], successMessage: string) => {
      if (!supabase) {
        throw new Error('Supabase is not configured yet.');
      }
      if (!supabaseUser) {
        throw new Error('You need to be signed in to manage addresses.');
      }

      const orderedAddresses = sortAddressBook(updatedAddresses);

      const { data, error } = await supabase.auth.updateUser({
        data: {
          shipping_addresses: orderedAddresses,
        },
      });

      if (error) {
        throw error;
      }

      if (data?.user) {
        setSupabaseUser(data.user as SupabaseUser);
      } else {
        setSupabaseUser(prev =>
          prev
            ? ({
                ...prev,
                user_metadata: {
                  ...(prev.user_metadata ?? {}),
                  shipping_addresses: orderedAddresses,
                },
              } as SupabaseUser)
            : prev,
        );
      }

      setAddressBook(orderedAddresses);
      setShippingFeedback(successMessage);
    },
    [supabaseUser],
  );

  const handleShippingSubmit = useCallback(async () => {
    if (!supabase) {
      setShippingError('Supabase is not configured yet.');
      return;
    }

    if (!supabaseUser) {
      setShippingError('You need to be signed in to manage addresses.');
      return;
    }

    const trimmedFullName = shippingForm.fullName.trim();
    const trimmedLine1 = shippingForm.line1.trim();
    const trimmedCity = shippingForm.city.trim();
    const trimmedRegion = shippingForm.region.trim();
    const trimmedPostal = shippingForm.postalCode.trim();

    if (!trimmedFullName || !trimmedLine1 || !trimmedCity || !trimmedRegion || !trimmedPostal) {
      setShippingError('Please complete the name, address, city, region, and postal code fields.');
      return;
    }

    const effectiveDefault = addressBook.length === 0 ? true : shippingForm.isDefault;

    const newAddress: ShippingAddress = {
      id: `addr-${Date.now()}`,
      fullName: trimmedFullName,
      phone: shippingForm.phone.trim(),
      line1: trimmedLine1,
      line2: shippingForm.line2.trim(),
      city: trimmedCity,
      region: trimmedRegion,
      postalCode: trimmedPostal,
      isDefault: effectiveDefault,
    };

    const prepared = addressBook.map(address => ({
      ...address,
      isDefault: effectiveDefault ? false : address.isDefault,
    }));

    setShippingSaving(true);
    setShippingError(null);
    setShippingFeedback(null);

    try {
      await persistAddressBookUpdate([...prepared, newAddress], 'Address saved.');
      setShippingForm({
        ...SHIPPING_FORM_BLANK,
        isDefault: false,
      });
    } catch (error) {
      setShippingError(resolveErrorMessage(error, 'Unable to save address right now.'));
    } finally {
      setShippingSaving(false);
    }
  }, [
    supabaseUser,
    shippingForm.fullName,
    shippingForm.phone,
    shippingForm.line1,
    shippingForm.line2,
    shippingForm.city,
    shippingForm.region,
    shippingForm.postalCode,
    shippingForm.isDefault,
    addressBook,
    persistAddressBookUpdate,
  ]);

  const handleSetDefaultAddress = useCallback(
    async (addressId: string) => {
      if (!supabase) {
        setShippingError('Supabase is not configured yet.');
        return;
      }

      if (!supabaseUser) {
        setShippingError('You need to be signed in to manage addresses.');
        return;
      }

      setShippingSaving(true);
      setShippingError(null);
      setShippingFeedback(null);

      try {
        await persistAddressBookUpdate(
          addressBook.map(address => ({
            ...address,
            isDefault: address.id === addressId,
          })),
          'Default address updated.',
        );
      } catch (error) {
        setShippingError(resolveErrorMessage(error, 'Unable to set the default address right now.'));
      } finally {
        setShippingSaving(false);
      }
    },
    [supabaseUser, addressBook, persistAddressBookUpdate],
  );

  const handleRemoveAddress = useCallback(
    async (addressId: string) => {
      if (!supabase) {
        setShippingError('Supabase is not configured yet.');
        return;
      }

      if (!supabaseUser) {
        setShippingError('You need to be signed in to manage addresses.');
        return;
      }

      setShippingSaving(true);
      setShippingError(null);
      setShippingFeedback(null);

      const remaining = addressBook.filter(address => address.id !== addressId);

      if (remaining.length > 0 && !remaining.some(address => address.isDefault)) {
        remaining[0] = { ...remaining[0], isDefault: true };
      }

      try {
        await persistAddressBookUpdate(remaining, 'Address removed.');
        setShippingForm({
          ...SHIPPING_FORM_BLANK,
          isDefault: remaining.length === 0,
        });
      } catch (error) {
        setShippingError(resolveErrorMessage(error, 'Unable to remove the address right now.'));
      } finally {
        setShippingSaving(false);
      }
    },
    [supabaseUser, addressBook, persistAddressBookUpdate],
  );

  const handleOpenMessagesTab = useCallback(() => {
    closePanel();
    router.push('/(tabs)/messages');
  }, [closePanel]);

  const handlePasswordSubmit = useCallback(async () => {
    if (!supabase) {
      setPasswordError('Supabase is not configured yet.');
      return;
    }

    if (!supabaseUser) {
      setPasswordError('You need to be signed in to change your password.');
      return;
    }

    const trimmedCurrent = passwordForm.current.trim();
    const trimmedNext = passwordForm.next.trim();
    const trimmedConfirm = passwordForm.confirm.trim();

    if (!trimmedCurrent || !trimmedNext || !trimmedConfirm) {
      setPasswordError('Please complete all password fields.');
      return;
    }

    if (trimmedNext !== trimmedConfirm) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    if (trimmedNext.length < 8) {
      setPasswordError('Password must be at least 8 characters long.');
      return;
    }

    const emailAddress = supabaseUser.email;
    if (!emailAddress) {
      setPasswordError('Your account does not have an email associated with it.');
      return;
    }

    setPasswordError(null);
    setPasswordFeedback(null);
    setPasswordUpdating(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: emailAddress,
        password: trimmedCurrent,
      });

      if (signInError) {
        setPasswordError(resolveErrorMessage(signInError, 'Current password is incorrect.'));
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: trimmedNext });

      if (updateError) {
        throw updateError;
      }

      setPasswordForm({ current: '', next: '', confirm: '' });
      setPasswordFeedback('Password updated successfully.');
    } catch (error) {
      setPasswordError(resolveErrorMessage(error, 'Unable to update password right now.'));
    } finally {
      setPasswordUpdating(false);
    }
  }, [supabaseUser, passwordForm, setPasswordForm, setPasswordFeedback, setPasswordError]);

  const refreshMarketplaceStats = useCallback(async (userId: string) => {
    try {
      const result = await fetchMarketplaceStats(userId);
      if (result.error) {
        console.warn('Unable to refresh marketplace stats', result.error);
        return;
      }
      setStats({
        orders: result.data.ordersCount,
        cart: result.data.cartCount,
      });
    } catch (error) {
      console.warn('Failed to refresh marketplace stats', error);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    if (!supabase) {
      setOrders([]);
      setOrdersError('Supabase is not configured yet.');
      setOrdersLoading(false);
      setReviewedOrderItems(new Set());
      setLegacyReviewedListings(new Set());
      return;
    }
    if (!supabaseUser) {
      setOrders([]);
      setOrdersError('Sign in to view your orders.');
      setOrdersLoading(false);
      setReviewedOrderItems(new Set());
      setLegacyReviewedListings(new Set());
      return;
    }
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const result = await fetchOrders(supabaseUser.id);
      if (result.error) {
        setOrdersError(result.error);
      } else {
        setOrdersError(null);
      }
      setOrders(result.data);
      // Find which order items in completed orders are already reviewed by this user
      try {
        const completed = (result.data ?? []).filter((o) => o.status === 'completed');
        const orderItemIds = Array.from(
          new Set(
            completed
              .flatMap((o) => o.items.map((it) => it.id))
              .filter((value): value is string => typeof value === 'string' && value.length > 0),
          ),
        );
        const listingIds = Array.from(
          new Set(
            completed
              .flatMap((o) => o.items.map((it) => it.listingId))
              .filter((value): value is string => typeof value === 'string' && value.length > 0),
          ),
        );

        const nextReviewedOrderItems = new Set<string>();
        const nextLegacyReviewedListings = new Set<string>();

        if (supabase && orderItemIds.length > 0) {
          const { data, error } = await supabase
            .from('marketplace_reviews')
            .select('order_item_id, listing_id')
            .eq('buyer_id', supabaseUser.id)
            .in('order_item_id', orderItemIds);

          if (!error) {
            for (const row of data ?? []) {
              const orderItemId = (row as any).order_item_id as string | null;
              const listingId = (row as any).listing_id as string | null;
              if (typeof orderItemId === 'string' && orderItemId.length > 0) {
                nextReviewedOrderItems.add(orderItemId);
              } else if (typeof listingId === 'string' && listingId.length > 0) {
                nextLegacyReviewedListings.add(listingId);
              }
            }
          } else {
            const message = String(error.message || '').toLowerCase();
            const missingOrderItemColumn =
              message.includes('order_item_id') || message.includes('schema cache') || message.includes('42703');

            if (!missingOrderItemColumn) {
              console.warn('Failed to load review flags', error);
            }

            if (missingOrderItemColumn && listingIds.length > 0) {
              const fallback = await supabase
                .from('marketplace_reviews')
                .select('listing_id')
                .eq('buyer_id', supabaseUser.id)
                .in('listing_id', listingIds);

              if (!fallback.error) {
                for (const row of fallback.data ?? []) {
                  const listingId = (row as any).listing_id as string | null;
                  if (typeof listingId === 'string' && listingId.length > 0) {
                    nextLegacyReviewedListings.add(listingId);
                  }
                }
              }
            }
          }
        } else if (supabase && listingIds.length > 0) {
          const fallback = await supabase
            .from('marketplace_reviews')
            .select('listing_id')
            .eq('buyer_id', supabaseUser.id)
            .in('listing_id', listingIds);

          if (!fallback.error) {
            for (const row of fallback.data ?? []) {
              const listingId = (row as any).listing_id as string | null;
              if (typeof listingId === 'string' && listingId.length > 0) {
                nextLegacyReviewedListings.add(listingId);
              }
            }
          }
        }

        setReviewedOrderItems(nextReviewedOrderItems);
        setLegacyReviewedListings(nextLegacyReviewedListings);
      } catch (e) {
        console.warn('Failed to load review flags', e);
        setReviewedOrderItems(new Set());
        setLegacyReviewedListings(new Set());
      }
    } catch (e) {
      console.warn('Failed to load orders', e);
      setOrdersError('Unable to load your orders right now.');
    } finally {
      setOrdersLoading(false);
    }
  }, [supabaseUser]);

  useEffect(() => {
    if (activePanel === 'orders' || activePanel === 'toReview') {
      loadOrders();
    }
  }, [activePanel, loadOrders]);

  const loadSellerData = useCallback(
    async (userId: string) => {
      try {
        const statusResult = await fetchSellerStatus(userId);
        if (statusResult.error) {
          console.warn('Unable to load seller status', statusResult.error);
          setSellerStatus('none');
          setSellerListings([]);
        } else {
          setSellerStatus(statusResult.data.state);
          if (statusResult.data.state === 'approved') {
            const listingsResult = await fetchListingsForSeller(userId);
            if (listingsResult.error) {
              console.warn('Unable to load seller listings', listingsResult.error);
              setSellerListings([]);
            } else {
              setSellerListings(listingsResult.data);
            }
          } else {
            setSellerListings([]);
          }
        }
      } catch (error) {
        console.warn('Failed to load seller data', error);
        setSellerStatus('none');
        setSellerListings([]);
      }
    },
    [],
  );

  const applyUser = useCallback(
    async (user: SupabaseUser | null) => {
      setSupabaseUser(user);

      if (!user || !supabase) {
        setDisplayName('Guest');
        setEmail('');
        setPhotoUrl(DEFAULT_AVATAR_URI);
        setStats({ orders: 0, cart: 0 });
        setAddressBook([]);
        setSellerStatus('none');
        setSellerListings([]);
        setListingForm({ ...LISTING_FORM_BLANK });
        setInitializing(false);
        return;
      }

      const fallbackName =
        (user.user_metadata?.display_name as string | undefined) ||
        user.email?.split('@')[0] ||
        'User';

      setInitializing(true);

      setDisplayName(fallbackName);
      setEmail(user.email ?? '');
      setPhotoUrl(normalisePhotoUrl(user.user_metadata?.photo_url as string | undefined));

      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
      const metadataAddresses = parseShippingAddresses(
        metadata['shipping_addresses'] ?? metadata['shipping_address'],
      );
      setAddressBook(metadataAddresses);

      try {
        const { data: profile, error } = await supabase
          .from('users')
          .select('display_name, photo_url, orders_count, cart_items')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (profile) {
          if (profile.display_name) {
            setDisplayName(profile.display_name);
          }
          setPhotoUrl(normalisePhotoUrl(profile.photo_url));
          setStats({
            orders: typeof profile.orders_count === 'number' ? profile.orders_count : 0,
            cart: typeof profile.cart_items === 'number' ? profile.cart_items : 0,
          });
        } else {
          setStats({ orders: 0, cart: 0 });
        }
      } catch (error) {
        console.warn('Failed to load profile record', error);
        setStats({ orders: 0, cart: 0 });
      } finally {
        await refreshMarketplaceStats(user.id);
        await loadSellerData(user.id);
        setInitializing(false);
      }
    },
    [normalisePhotoUrl, refreshMarketplaceStats, loadSellerData],
  );

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      if (!supabase) {
        setInitializing(false);
        return;
      }

      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          throw error;
        }
        if (!isMounted) {
          return;
        }
        await applyUser(data.user ?? null);
      } catch (error) {
        console.warn('Failed to fetch authenticated user', error);
        if (isMounted) {
          await applyUser(null);
        }
      }
    };

    initialize();

    if (!supabase) {
      return () => {
        isMounted = false;
      };
    }

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) {
        return;
      }
      applyUser(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription?.subscription.unsubscribe();
    };
  }, [applyUser]);

  // Keep orders/cart counters fresh when returning to Profile
  useFocusEffect(
    useCallback(() => {
      if (supabaseUser) {
        refreshMarketplaceStats(supabaseUser.id).catch((e) =>
          console.warn('Profile focus: refresh stats failed', e),
        );
      }
    }, [refreshMarketplaceStats, supabaseUser]),
  );

  // Live updates via Supabase Realtime when orders/cart change for this user
  useEffect(() => {
    if (!supabase || !supabaseUser) {
      return;
    }

    const channel = supabase
      .channel(`profile-stats:${supabaseUser.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketplace_orders', filter: `buyer_id=eq.${supabaseUser.id}` },
        () => {
          refreshMarketplaceStats(supabaseUser.id).catch((e) =>
            console.warn('Realtime orders refresh failed', e),
          );
          if (activePanel === 'orders' || activePanel === 'toReview') {
            loadOrders();
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'marketplace_cart_items', filter: `user_id=eq.${supabaseUser.id}` },
        () => {
          refreshMarketplaceStats(supabaseUser.id).catch((e) =>
            console.warn('Realtime cart refresh failed', e),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activePanel, loadOrders, refreshMarketplaceStats, supabaseUser]);

  const handleChangePhoto = async () => {
    if (!supabase || !supabaseUser) {
      Alert.alert('Sign in required', 'You need to be logged in before changing your photo.');
      return;
    }

    if (!storageBucket) {
      Alert.alert(
        'Storage not configured',
        'Add a storageBucket value to expo.extra.supabase before uploading profile photos.',
      );
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow access to your photos to update the profile picture.');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });

    if (pickerResult.canceled || pickerResult.assets.length === 0) {
      return;
    }

    const asset = pickerResult.assets[0];

    if (!asset.base64) {
      Alert.alert(
        'Image unavailable',
        'We could not read the selected image. Please choose a different one.',
      );
      return;
    }

    try {
      setUploadingPhoto(true);

      const authMetadataTooLarge = shouldTrimAuthPhotoMetadata(
        supabaseUser.user_metadata?.photo_url,
      );

      if (authMetadataTooLarge) {
        console.warn(
          'Existing Supabase auth metadata includes an oversized data URI. Skipping auth metadata updates until it is cleared server-side.',
        );
      }

      const fileBytes = decodeBase64ToUint8Array(asset.base64);
      const fileBuffer = fileBytes.buffer.slice(
        fileBytes.byteOffset,
        fileBytes.byteOffset + fileBytes.byteLength,
      );

      const extension =
        asset.fileName?.split('.').pop()?.toLowerCase() ??
        asset.mimeType?.split('/')[1]?.toLowerCase() ??
        'jpg';
      const filePath = `users/${supabaseUser.id}/profile.${extension}`;
      const contentType = asset.mimeType ?? 'image/jpeg';

      let newPhotoUrl: string | null = null;
      let usedDataUriFallback = false;

      const { error: uploadError } = await supabase.storage
        .from(storageBucket)
        .upload(filePath, fileBuffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        const normalisedMessage = (uploadError.message || '').toLowerCase();
        usedDataUriFallback = true;

        if (normalisedMessage.includes('bucket not found')) {
          console.warn(
            'Supabase storage bucket not found. Falling back to storing avatar as a data URI. Configure storageBucket in app.json to enable hosted images.',
          );
        } else if (normalisedMessage.includes('json parse error')) {
          console.warn(
            'Supabase storage returned an unexpected response while uploading the avatar. Falling back to a data URI.',
            uploadError,
          );
        } else {
          console.warn(
            'Unable to upload avatar to Supabase storage. Falling back to a data URI.',
            uploadError,
          );
        }
      } else {
        const { data: publicData } = supabase.storage.from(storageBucket).getPublicUrl(filePath);

        if (publicData?.publicUrl) {
          const cacheBuster = Date.now();
          newPhotoUrl = `${publicData.publicUrl}${
            publicData.publicUrl.includes('?') ? '&' : '?'
          }v=${cacheBuster}`;
        } else {
          usedDataUriFallback = true;
          console.warn(
            'Supabase storage did not return a public URL for the uploaded avatar. Falling back to a data URI.',
          );
        }
      }

      if (!newPhotoUrl) {
        const { base64: resizedBase64, contentType: resizedContentType } = await ensureDataUriReady({
          assetUri: asset.uri,
          base64: asset.base64,
          preferredContentType: contentType,
        });
        newPhotoUrl = buildDataUri(resizedBase64, resizedContentType);
        usedDataUriFallback = true;
      }

      if (!newPhotoUrl) {
        throw new Error('No avatar data available after processing the selected image.');
      }

      let metadataSyncFailed = authMetadataTooLarge;
      let metadataSyncError: unknown = authMetadataTooLarge
        ? new Error(
            'The Supabase auth service still stores your previous photo inline. Auth metadata will be updated after the oversized copy is removed.',
          )
        : undefined;

      const { error: profileError } = await supabase
        .from('users')
        .upsert(
          {
            id: supabaseUser.id,
            photo_url: newPhotoUrl,
            display_name: displayName,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );

      if (profileError) {
        console.warn('Failed to update profile record', profileError);
        throw new Error(
          resolveErrorMessage(
            profileError,
            'Unable to save your profile photo to Supabase. Please try again shortly.',
          ),
        );
      }

      const trimmedDisplayName = displayName.trim();
      const authMetadataUpdates: Record<string, string | null> = {
        photo_url: usedDataUriFallback ? null : newPhotoUrl,
      };

      if (trimmedDisplayName.length > 0) {
        authMetadataUpdates.display_name = trimmedDisplayName;
      }

      if (!authMetadataTooLarge) {
        const { data: authUpdateData, error: userUpdateError } = await supabase.auth.updateUser({
          data: authMetadataUpdates,
        });

        if (userUpdateError) {
          metadataSyncFailed = true;
          metadataSyncError = userUpdateError;
          console.warn('Failed to update auth metadata', userUpdateError);
        } else if (authUpdateData?.user) {
          setSupabaseUser(authUpdateData.user);
        }
      }

      setPhotoUrl(newPhotoUrl);
      const successMessages = ['Your profile picture has been updated.'];

      if (usedDataUriFallback) {
        successMessages.push(
          'The image is stored directly with your profile record so it syncs like before, but it may be slower to load on other devices.',
        );
      }

      if (metadataSyncFailed && metadataSyncError) {
        successMessages.push(
          'We could not sync every copy of your profile information to Supabase. The change may take a moment to appear on other devices.',
        );
        successMessages.push(
          `Auth metadata error: ${resolveErrorMessage(
            metadataSyncError,
            'Try signing out and back in, then repeat the update.',
          )}`,
        );
      }

      Alert.alert('Profile updated', successMessages.join('\n\n'));
    } catch (error) {
      console.warn('Failed to update profile photo', error);
      Alert.alert('Update failed', resolveErrorMessage(error));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSignOut = useCallback(async () => {
    if (!supabase) {
      Alert.alert('Configuration missing', 'Supabase is not configured yet.');
      return;
    }

    try {
      await signOutSafely();

      setSupabaseUser(null);
      setDisplayName('Guest');
      setEmail('');
      setPhotoUrl(DEFAULT_AVATAR_URI);
      setStats({ orders: 0, cart: 0 });
      setAddressBook([]);
      setSellerStatus('none');
      setSellerListings([]);
      setListingForm({ ...LISTING_FORM_BLANK });
      router.replace('/login');
    } catch (error) {
      console.warn('Failed to sign out', error);
      Alert.alert('Sign out failed', resolveErrorMessage(error, 'Unable to sign out right now.'));
    }
  }, []);

  const actions = useMemo<ProfileActionConfig[]>(() => {
    const base: ProfileActionConfig[] = [
      {
        id: 'orders',
        label: 'My Orders',
        description: 'Track your orders and view history',
        icon: 'bag-handle',
        onPress: () => showPanel('orders'),
      },
      {
        id: 'to-review',
        label: 'To Review',
        description: 'Review your completed purchases',
        icon: 'star',
        onPress: () => showPanel('toReview'),
      },
      {
        id: 'inbox',
        label: 'Inbox',
        description: 'Check your notifications',
        icon: 'mail',
        onPress: () => showPanel('inbox'),
      },
      {
        id: 'followers',
        label: 'Followers',
        description: 'People who follow you',
        icon: 'people',
        onPress: () => showPanel('followers'),
      },
      {
        id: 'following',
        label: 'Following',
        description: 'Accounts you follow',
        icon: 'person-add',
        onPress: () => showPanel('following'),
      },
      {
        id: 'shipping',
        label: 'Shipping Address',
        description: 'View your addresses',
        icon: 'location',
        onPress: () => showPanel('shipping'),
      },
      {
        id: 'password',
        label: 'Change Password',
        description: 'Change your password',
        icon: 'lock-closed',
        onPress: () => showPanel('password'),
      },
    ];

    if (sellerStatus === 'approved') {
      base.splice(1, 0, {
        id: 'seller',
        label: 'Seller Tools',
        description: 'Manage listings and trade options',
        icon: 'storefront',
        onPress: () => showPanel('seller'),
      });
    }

    base.push({
      id: 'sign-out',
      label: 'Sign out',
      description: 'Exit your account and sign in again',
      icon: 'log-out-outline',
      onPress: handleSignOut,
    });

    return base;
  }, [handleSignOut, showPanel, sellerStatus]);

  const goToRegister = () => {
    router.push('/seller/register');
  };

  return (
    <>
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backButton}
              activeOpacity={0.75}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                }
              }}
            >
              <Ionicons name="arrow-back" size={22} color="#111111" />
            </TouchableOpacity>
            <View style={styles.headerTitles}>
              <Text style={styles.headerTitle}>Profile</Text>
              <Text style={styles.headerSubtitle}>
                Welcome back, {displayName || 'User'}
              </Text>
            </View>
          </View>

          <View style={styles.profileCard}>
            <View style={styles.avatarWrapper}>
              {initializing ? (
                <View style={styles.avatarLoader}>
                  <ActivityIndicator color="#3D5C35" />
                </View>
              ) : (
                <Image source={{ uri: photoUrl }} style={styles.avatar} />
              )}
              <TouchableOpacity
                style={styles.cameraBadge}
                onPress={handleChangePhoto}
                activeOpacity={0.8}
                disabled={uploadingPhoto}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="camera" size={16} color="#FFFFFF" />
                )}
              </TouchableOpacity>
          </View>
          <View style={styles.profileInfo}>
            {editingName ? (
              <View style={styles.nameEditor}>
                <TextInput
                  value={nameDraft}
                  onChangeText={(text) => {
                    setNameDraft(text);
                    if (nameError) {
                      setNameError(null);
                    }
                  }}
                  style={styles.nameInput}
                  autoCapitalize="words"
                  placeholder="Enter your name"
                  placeholderTextColor="#9E9E9E"
                  editable={!savingName}
                />
                {nameError ? <Text style={styles.nameError}>{nameError}</Text> : null}
                <View style={styles.nameActionRow}>
                  <TouchableOpacity
                    onPress={handleCancelNameEdit}
                    style={styles.nameCancelButton}
                    activeOpacity={0.75}
                    disabled={savingName}
                  >
                    <Text style={styles.nameCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSaveName}
                    style={[styles.nameSaveButton, savingName ? styles.nameSaveButtonDisabled : null]}
                    activeOpacity={0.85}
                    disabled={savingName}
                  >
                    {savingName ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.nameSaveText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.nameRow}>
                <Text style={styles.profileName}>{displayName}</Text>
                {supabaseUser ? (
                  <TouchableOpacity
                    style={styles.editNameButton}
                    onPress={handleStartNameEdit}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="create-outline" size={16} color="#3A8C66" />
                    <Text style={styles.editNameText}>Edit name</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}
            {nameFeedback && !editingName ? (
              <Text style={styles.nameFeedback}>{nameFeedback}</Text>
            ) : null}
            <Text style={styles.profileUsername}>{email || 'Sign in to personalise'}</Text>
            <TouchableOpacity
              onPress={handleChangePhoto}
              activeOpacity={0.7}
              style={styles.changePhotoButton}
              disabled={uploadingPhoto}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator size="small" color="#3D5C35" />
                ) : (
                  <Text style={styles.changePhotoText}>Change Photo</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={styles.statHeader}>
                <View style={styles.statIconWrapper}>
                  <Ionicons name="time-outline" size={18} color="#3D5C35" />
                </View>
                <Text style={styles.statLabel}>Orders</Text>
              </View>
              <Text style={styles.statValue}>{stats.orders}</Text>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statHeader}>
                <View style={styles.statIconWrapper}>
                  <Ionicons name="cart-outline" size={18} color="#3D5C35" />
                </View>
                <Text style={styles.statLabel}>Cart</Text>
              </View>
              <Text style={styles.statValue}>{stats.cart}</Text>
            </View>
          </View>

          <View style={styles.actionList}>
            {actions.map(action => (
              <ProfileActionRow key={action.id} {...action} />
            ))}
          </View>

          {sellerStatus === 'approved' ? (
            <View style={styles.sellerCard}>
              <View style={styles.sellerCopy}>
                <Text style={styles.sellerTitle}>Seller dashboard</Text>
                <Text style={styles.sellerSubtitle}>
                  {sellerListings.length === 0
                    ? 'Publish your first listing and start reaching buyers.'
                    : `You have ${sellerListings.length} listing${
                        sellerListings.length === 1 ? '' : 's'
                      } live.`}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.sellerButton}
                onPress={() => showPanel('seller')}
                activeOpacity={0.85}
              >
                <Text style={styles.sellerButtonText}>Manage</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.registerCard}>
              <View style={styles.registerCopy}>
                <Text style={styles.registerTitle}>
                  {sellerStatus === 'pending' ? 'Seller application in review' : 'Start Selling or Trading'}
                </Text>
                <Text style={styles.registerDescription}>
                  {sellerStatus === 'pending'
                    ? 'We are verifying your details. Trading will unlock once approved.'
                    : 'Register your shop details to unlock trade and seller tools.'}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.registerButton, sellerStatus === 'pending' ? styles.registerButtonDisabled : null]}
                onPress={goToRegister}
                activeOpacity={sellerStatus === 'pending' ? 1 : 0.85}
                disabled={sellerStatus === 'pending'}
              >
                <Text style={styles.registerButtonText}>
                  {sellerStatus === 'pending' ? 'Pending Approval' : 'Register Now'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <PanelModal visible={activePanel === 'orders'} title="My Orders" onClose={closePanel}>
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalBody}
          showsVerticalScrollIndicator={false}
        >
          {ordersLoading ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color="#3D5C35" />
              <Text style={styles.modalBodyText}>Loading your orders...</Text>
            </View>
          ) : ordersError ? (
            <Text style={styles.modalError}>{ordersError}</Text>
          ) : orders.length === 0 ? (
            <Text style={styles.modalBodyText}>You have not placed any orders yet.</Text>
          ) : (
            orders.map((order) => (
              <View key={order.id} style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <Text style={styles.orderTitle} numberOfLines={1}>
                    Order {order.id}
                  </Text>
                  <Text style={styles.orderMeta}>{new Date(order.createdAt).toLocaleString()}</Text>
                </View>
                <View style={styles.orderItems}>
                  {order.items.map((it) => (
                    <View key={it.id} style={styles.orderItemRow}>
                      <Text style={styles.orderItemTitle} numberOfLines={1}>{it.title}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={styles.orderItemMeta}>x{it.quantity}</Text>
                        {order.status === 'completed' ? (
                          reviewedOrderItems.has(it.id) || legacyReviewedListings.has(it.listingId) ? (
                            <View style={styles.reviewBadge}>
                              <Ionicons name="checkmark-circle" size={14} color="#2D7A36" />
                              <Text style={styles.reviewBadgeText}>Reviewed</Text>
                            </View>
                          ) : (
                            <View style={styles.reviewPendingBadge}>
                              <Ionicons name="time-outline" size={14} color="#8A6D00" />
                              <Text style={styles.reviewPendingText}>Pending review</Text>
                            </View>
                          )
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.orderFooter}>
                  <View style={styles.orderStatusPill}>
                    <Text style={styles.orderStatusText}>Status: {order.status}</Text>
                  </View>
                  {order.status === 'shipped' ? (
                    <TouchableOpacity
                      style={[
                        styles.orderConfirmBtn,
                        confirmingOrderId === order.id ? { opacity: 0.6 } : null,
                      ]}
                      onPress={async () => {
                        try {
                          setConfirmingOrderId(order.id);
                          const result = await updateOrderStatus(order.id, 'completed');
                          if (result.error) {
                            Alert.alert('Unable to update', result.error);
                            return;
                          }
                          setOrders((current) =>
                            current.map((existing) =>
                              existing.id === order.id ? { ...existing, status: 'completed' } : existing,
                            ),
                          );
                          await Promise.all([
                            loadOrders(),
                            refreshMarketplaceStats(supabaseUser!.id),
                          ]);
                        } catch (error) {
                          console.warn('Order received confirmation failed', error);
                          Alert.alert('Something went wrong', 'Unable to update this order right now.');
                        } finally {
                          setConfirmingOrderId(null);
                        }
                      }}
                      activeOpacity={0.85}
                      disabled={confirmingOrderId === order.id}
                    >
                      {confirmingOrderId === order.id ? (
                        <ActivityIndicator size="small" color="#111111" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={16} color="#111111" />
                          <Text style={styles.orderConfirmText}>Order Received</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </PanelModal>

      <PanelModal visible={activePanel === 'toReview'} title="To Review" onClose={closePanel}>
        <View style={styles.modalBody}>
          {ordersLoading ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color="#3D5C35" />
              <Text style={styles.modalBodyText}>Loading orders...</Text>
            </View>
          ) : ordersError ? (
            <Text style={styles.modalError}>{ordersError}</Text>
          ) : (
            (() => {
              const pending = orders
                .filter((o) => o.status === 'completed')
                .flatMap((o) => o.items)
                .filter(
                  (it) =>
                    !reviewedOrderItems.has(it.id) && !legacyReviewedListings.has(it.listingId),
                );
              return pending.length === 0 ? (
                <Text style={styles.modalBodyText}>No items awaiting your review.</Text>
              ) : (
                pending.map((it) => (
                  <View key={it.id} style={styles.orderItemRow}>
                    <Text style={styles.orderItemTitle} numberOfLines={1}>{it.title}</Text>
                    <TouchableOpacity
                      style={styles.reviewButton}
                      onPress={() => {
                        setReviewTarget({
                          listingId: it.listingId,
                          listingTitle: it.title,
                          orderItemId: it.id ?? null,
                        });
                        setReviewRating(5);
                        setReviewComment('');
                        setReviewMedia([]);
                        setReviewError(null);
                      }}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="star" size={14} color="#111111" />
                      <Text style={styles.reviewButtonText}>Write review</Text>
                    </TouchableOpacity>
                  </View>
                ))
              );
            })()
          )}
        </View>
      </PanelModal>

      <PanelModal
        visible={Boolean(reviewTarget)}
        title="Write a Review"
        onClose={() => {
          if (reviewBusy) {
            return;
          }
          setReviewTarget(null);
          setReviewMedia([]);
        }}
        closeDisabled={reviewBusy}
      >
        {reviewTarget ? (
          <View style={styles.modalBody}>
            <Text style={styles.modalBodyText}>{reviewTarget.listingTitle}</Text>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setReviewRating(n)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={n <= reviewRating ? 'star' : 'star-outline'}
                    size={24}
                    color={n <= reviewRating ? '#F3B400' : '#C9C9C9'}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={reviewComment}
              onChangeText={setReviewComment}
              placeholder="Share your experience (optional)"
              placeholderTextColor="#9E9E9E"
              multiline
              style={[styles.passwordInput, { minHeight: 80, textAlignVertical: 'top' }]}
              editable={!reviewBusy}
            />
            <View style={styles.reviewMediaSection}>
              {reviewMedia.length > 0 ? (
                <View style={styles.reviewMediaGrid}>
                  {reviewMedia.map((item) => (
                    <View key={item.url} style={styles.reviewMediaThumb}>
                      {item.type === 'video' ? (
                        <View style={styles.reviewMediaVideo}>
                          <Ionicons name="videocam" size={18} color="#FFFFFF" />
                          <Text style={styles.reviewMediaVideoText}>Video</Text>
                        </View>
                      ) : (
                        <Image source={{ uri: item.url }} style={styles.reviewMediaImage} />
                      )}
                      <TouchableOpacity
                        style={styles.reviewMediaRemove}
                        onPress={() => handleRemoveReviewMedia(item.url)}
                        activeOpacity={0.75}
                        disabled={reviewBusy}
                      >
                        <Ionicons name="close" size={14} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.reviewMediaButton,
                  (reviewBusy || reviewMediaUploading) && { opacity: 0.6 },
                ]}
                onPress={handlePickReviewMedia}
                disabled={reviewBusy || reviewMediaUploading}
                activeOpacity={0.85}
              >
                {reviewMediaUploading ? (
                  <ActivityIndicator size="small" color="#111111" />
                ) : (
                  <>
                    <Ionicons name="attach" size={16} color="#111111" />
                    <Text style={styles.reviewMediaButtonText}>Add photo or video</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
            {reviewError ? <Text style={styles.modalError}>{reviewError}</Text> : null}
            <TouchableOpacity
              style={[styles.orderConfirmBtn, reviewBusy && { opacity: 0.6 }]}
              onPress={async () => {
                if (!supabaseUser || !reviewTarget) return;
                if (reviewRating < 1 || reviewRating > 5) {
                  setReviewError('Please provide a rating from 1 to 5.');
                  return;
                }
                setReviewBusy(true);
                setReviewError(null);
                try {
                  const result = await addReview({
                    buyerId: supabaseUser.id,
                    listingId: reviewTarget.listingId,
                    orderItemId: reviewTarget.orderItemId,
                    rating: reviewRating,
                    comment: reviewComment,
                    media: reviewMedia,
                  });
                  if (result.error) {
                    setReviewError(result.error);
                    return;
                  }
                  const orderItemId = reviewTarget.orderItemId;
                  if (orderItemId) {
                    setReviewedOrderItems((prev) => new Set([...prev, orderItemId]));
                  } else {
                    setLegacyReviewedListings((prev) => new Set([...prev, reviewTarget.listingId]));
                  }
                  setReviewMedia([]);
                  setReviewTarget(null);
                } catch (e) {
                  console.warn('Add review failed', e);
                  setReviewError('Unable to submit your review right now.');
                } finally {
                  setReviewBusy(false);
                }
              }}
              disabled={reviewBusy}
              activeOpacity={0.85}
            >
              {reviewBusy ? (
                <ActivityIndicator size="small" color="#111111" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={16} color="#111111" />
                  <Text style={styles.orderConfirmText}>Submit review</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </PanelModal>

      <PanelModal visible={activePanel === 'inbox'} title="Inbox" onClose={closePanel}>
        <View style={styles.modalBody}>
          <Text style={styles.modalBodyText}>
            {inboxCount === 0
              ? 'You do not have any conversations in your inbox yet.'
              : `You currently have ${inboxCount} conversation${inboxCount === 1 ? '' : 's'} waiting in your inbox.`}
          </Text>
          <TouchableOpacity style={styles.modalActionLink} activeOpacity={0.75} onPress={handleOpenMessagesTab}>
            <Text style={styles.modalActionLinkText}>Open Messages tab</Text>
          </TouchableOpacity>
        </View>
      </PanelModal>

      <PanelModal visible={activePanel === 'followers'} title="Followers" onClose={closePanel}>
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalBody}
          showsVerticalScrollIndicator={false}
        >
          {followListsLoading ? (
            <View style={styles.followLoading}>
              <ActivityIndicator color="#3D5C35" />
              <Text style={styles.modalBodyText}>Loading followers…</Text>
            </View>
          ) : followListsError ? (
            <Text style={styles.modalError}>{followListsError}</Text>
          ) : followers.length === 0 ? (
            <View style={styles.followEmptyState}>
              <Ionicons name="people-outline" size={32} color="#3D5C35" />
              <Text style={styles.followEmptyTitle}>No followers yet</Text>
              <Text style={styles.followEmptyCopy}>
                Followers will appear here once people follow you.
              </Text>
            </View>
          ) : (
            <View style={styles.followList}>
              {followers.map((profile) => {
                const name = resolveFollowDisplayName(profile);
                const accent = getAccentForFollowId(profile.id);
                return (
                  <View key={profile.id} style={styles.followRow}>
                    {profile.photo_url ? (
                      <Image source={{ uri: profile.photo_url }} style={styles.followAvatar} contentFit="cover" />
                    ) : (
                      <View style={[styles.followAvatar, { backgroundColor: accent }]}>
                        <Text style={styles.followAvatarInitials}>{buildInitialsFromName(name)}</Text>
                      </View>
                    )}
                    <View style={styles.followCopy}>
                      <Text style={styles.followName}>{name}</Text>
                      {profile.email ? (
                        <Text style={styles.followEmail} numberOfLines={1}>
                          {profile.email}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </PanelModal>

      <PanelModal visible={activePanel === 'following'} title="Following" onClose={closePanel}>
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalBody}
          showsVerticalScrollIndicator={false}
        >
          {followListsLoading ? (
            <View style={styles.followLoading}>
              <ActivityIndicator color="#3D5C35" />
              <Text style={styles.modalBodyText}>Loading accounts…</Text>
            </View>
          ) : followListsError ? (
            <Text style={styles.modalError}>{followListsError}</Text>
          ) : followingProfiles.length === 0 ? (
            <View style={styles.followEmptyState}>
              <Ionicons name="person-add-outline" size={32} color="#3D5C35" />
              <Text style={styles.followEmptyTitle}>You are not following anyone</Text>
              <Text style={styles.followEmptyCopy}>Browse the marketplace and follow users to see them here.</Text>
            </View>
          ) : (
            <View style={styles.followList}>
              {followingProfiles.map((profile) => {
                const name = resolveFollowDisplayName(profile);
                const accent = getAccentForFollowId(profile.id);
                return (
                  <View key={profile.id} style={styles.followRow}>
                    {profile.photo_url ? (
                      <Image source={{ uri: profile.photo_url }} style={styles.followAvatar} contentFit="cover" />
                    ) : (
                      <View style={[styles.followAvatar, { backgroundColor: accent }]}>
                        <Text style={styles.followAvatarInitials}>{buildInitialsFromName(name)}</Text>
                      </View>
                    )}
                    <View style={styles.followCopy}>
                      <Text style={styles.followName}>{name}</Text>
                      {profile.email ? (
                        <Text style={styles.followEmail} numberOfLines={1}>
                          {profile.email}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </PanelModal>

      <PanelModal visible={activePanel === 'seller'} title="Seller Tools" onClose={closePanel}>
        {sellerStatus !== 'approved' ? (
          <View style={styles.modalBody}>
            <Text style={styles.modalBodyText}>
              Seller tools will unlock once your application is approved.
            </Text>
          </View>
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalKeyboard}
          >
            <ScrollView
              style={styles.shippingScroll}
              contentContainerStyle={styles.sellerScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalBody}>
                <Text style={styles.sellerSectionTitle}>Create a listing</Text>
                {listingFeedback ? <Text style={styles.modalSuccess}>{listingFeedback}</Text> : null}
                {listingError ? <Text style={styles.modalError}>{listingError}</Text> : null}
                <View style={styles.listingForm}>
                  <TextInput
                    value={listingForm.title}
                    onChangeText={(text) => setListingForm((prev) => ({ ...prev, title: text }))}
                    placeholder="Listing title"
                    placeholderTextColor="#9E9E9E"
                    style={styles.passwordInput}
                  />
                  <TextInput
                    value={listingForm.price}
                    onChangeText={(text) => setListingForm((prev) => ({ ...prev, price: text }))}
                    placeholder="Price in PHP (e.g. 499)"
                    placeholderTextColor="#9E9E9E"
                    keyboardType="decimal-pad"
                    style={styles.passwordInput}
                  />
                  <TextInput
                    value={listingForm.quantity}
                    onChangeText={(text) => setListingForm((prev) => ({ ...prev, quantity: text }))}
                    placeholder="Quantity available"
                    placeholderTextColor="#9E9E9E"
                    keyboardType="number-pad"
                    style={styles.passwordInput}
                  />
                  <TextInput
                    value={listingForm.imageUrl}
                    onChangeText={(text) => setListingForm((prev) => ({ ...prev, imageUrl: text }))}
                    placeholder="Image URL (optional)"
                    placeholderTextColor="#9E9E9E"
                    autoCapitalize="none"
                    style={styles.passwordInput}
                  />
                  <View style={styles.listingImagesRow}>
                    {listingImages.map((url) => (
                      <View key={url} style={styles.listingImageThumb}>
                        <Image source={{ uri: url }} style={styles.listingImage} contentFit="cover" />
                        <TouchableOpacity
                          style={styles.listingImageRemove}
                          onPress={() => handleRemoveListingImage(url)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="close" size={14} color="#FFFFFF" />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      style={[styles.listingPickButton, listingImagesUploading ? styles.listingPickButtonDisabled : null]}
                      onPress={handlePickListingImages}
                      activeOpacity={0.85}
                      disabled={listingImagesUploading}
                    >
                      {listingImagesUploading ? (
                        <ActivityIndicator size="small" color="#111111" />
                      ) : (
                        <>
                          <Ionicons name="images" size={18} color="#111111" />
                          <Text style={styles.listingPickButtonText}>Add photos</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    value={listingForm.description}
                    onChangeText={(text) => setListingForm((prev) => ({ ...prev, description: text }))}
                    placeholder="Describe your item (optional)"
                    placeholderTextColor="#9E9E9E"
                    multiline
                    style={[styles.passwordInput, styles.listingDescriptionInput]}
                  />
                  <View style={styles.listingToggleRow}>
                    <Text style={styles.listingToggleLabel}>Interested in trade offers</Text>
                    <Switch
                      value={listingForm.allowTrade}
                      onValueChange={(value) =>
                        setListingForm((prev) => ({ ...prev, allowTrade: value }))
                      }
                      trackColor={{ false: '#CFCFCF', true: '#B7E89A' }}
                      thumbColor={listingForm.allowTrade ? '#3D5C35' : '#FFFFFF'}
                    />
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.listingSubmitButton, listingSaving ? styles.listingSubmitDisabled : null]}
                  onPress={handleListingSubmit}
                  activeOpacity={0.85}
                  disabled={listingSaving}
                >
                  {listingSaving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.listingSubmitText}>Publish listing</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={[styles.modalBody, styles.listingList]}>
                <Text style={styles.sellerSectionTitle}>Your listings</Text>
                {sellerListings.length === 0 ? (
                  <Text style={styles.modalBodyText}>
                    You have not published any listings yet. Use the form above to create one.
                  </Text>
                ) : (
                  sellerListings.map((listing) => (
                    <View key={listing.id} style={styles.listingRow}>
                      <View style={styles.listingRowHeader}>
                        <Text style={styles.listingRowTitle} numberOfLines={1}>
                          {listing.title || 'Untitled listing'}
                        </Text>
                        <View
                          style={[
                            styles.listingStatusBadge,
                            listing.status === 'active'
                              ? styles.listingStatusBadgeActive
                              : styles.listingStatusBadgeInactive,
                          ]}
                        >
                          <Text style={styles.listingStatusText}>{listing.status.toUpperCase()}</Text>
                        </View>
                      </View>
                      <Text style={styles.listingRowMeta}>
                        {formatCurrency(listing.priceCents, listing.currency)} • Stock: {listing.quantity}
                      </Text>
                      {listing.allowTrade ? (
                        <Text style={styles.listingRowMeta}>Accepts trade offers</Text>
                      ) : null}
                      <View style={styles.listingRowActions}>
                        <TouchableOpacity
                          style={styles.listingActionSecondary}
                          onPress={() => handleListingStatusToggle(listing)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.listingActionSecondaryText}>
                            {listing.status === 'active' ? 'Pause' : 'Activate'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.listingActionDanger}
                          onPress={() => handleListingDelete(listing)}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.listingActionDangerText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </PanelModal>

      <PanelModal
        visible={activePanel === 'shipping'}
        title="Shipping Address"
        onClose={closePanel}
        closeDisabled={shippingSaving}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalKeyboard}
        >
          <ScrollView style={styles.shippingScroll} contentContainerStyle={styles.shippingScrollContent}>
            <View style={styles.modalBody}>
              <Text style={styles.shippingSectionTitle}>Add a new address</Text>
              <View style={styles.addressForm}>
                <TextInput
                  value={shippingForm.fullName}
                  onChangeText={text => setShippingForm(prev => ({ ...prev, fullName: text }))}
                  style={styles.passwordInput}
                  autoCapitalize="words"
                  placeholder="Full name"
                  placeholderTextColor="#9E9E9E"
                />
                <TextInput
                  value={shippingForm.phone}
                  onChangeText={text => setShippingForm(prev => ({ ...prev, phone: text }))}
                  style={styles.passwordInput}
                  keyboardType="phone-pad"
                  placeholder="Mobile number (optional)"
                  placeholderTextColor="#9E9E9E"
                />
                <TextInput
                  value={shippingForm.line1}
                  onChangeText={text => setShippingForm(prev => ({ ...prev, line1: text }))}
                  style={styles.passwordInput}
                  autoCapitalize="words"
                  placeholder="Street address"
                  placeholderTextColor="#9E9E9E"
                />
                <TextInput
                  value={shippingForm.line2}
                  onChangeText={text => setShippingForm(prev => ({ ...prev, line2: text }))}
                  style={styles.passwordInput}
                  autoCapitalize="words"
                  placeholder="Apartment, suite, etc. (optional)"
                  placeholderTextColor="#9E9E9E"
                />
                <TextInput
                  value={shippingForm.city}
                  onChangeText={text => setShippingForm(prev => ({ ...prev, city: text }))}
                  style={styles.passwordInput}
                  autoCapitalize="words"
                  placeholder="City / Municipality"
                  placeholderTextColor="#9E9E9E"
                />
                <TextInput
                  value={shippingForm.region}
                  onChangeText={text => setShippingForm(prev => ({ ...prev, region: text }))}
                  style={styles.passwordInput}
                  autoCapitalize="words"
                  placeholder="Province / Region"
                  placeholderTextColor="#9E9E9E"
                />
                <TextInput
                  value={shippingForm.postalCode}
                  onChangeText={text => setShippingForm(prev => ({ ...prev, postalCode: text }))}
                  style={styles.passwordInput}
                  keyboardType="number-pad"
                  placeholder="Postal code"
                  placeholderTextColor="#9E9E9E"
                />
                <View style={styles.shippingToggleRow}>
                  <Text style={styles.shippingToggleLabel}>Set as default delivery address</Text>
                  <Switch
                    value={addressBook.length === 0 ? true : shippingForm.isDefault}
                    onValueChange={value => setShippingForm(prev => ({ ...prev, isDefault: value }))}
                    disabled={addressBook.length === 0 || shippingSaving}
                    trackColor={{ false: '#CFCFCF', true: '#B7E89A' }}
                    thumbColor={
                      (addressBook.length === 0 ? true : shippingForm.isDefault) ? '#3D5C35' : '#FFFFFF'
                    }
                    ios_backgroundColor="#CFCFCF"
                  />
                </View>
                {shippingError ? <Text style={styles.shippingErrorText}>{shippingError}</Text> : null}
                {shippingFeedback ? <Text style={styles.shippingFeedbackText}>{shippingFeedback}</Text> : null}
                <TouchableOpacity
                  style={[styles.shippingSaveButton, shippingSaving ? styles.shippingSaveButtonDisabled : null]}
                  disabled={shippingSaving}
                  activeOpacity={0.85}
                  onPress={handleShippingSubmit}
                >
                  {shippingSaving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.shippingSaveButtonText}>Save Address</Text>
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.shippingSectionTitle}>Saved addresses</Text>
              {addressBook.length === 0 ? (
                <Text style={styles.modalBodyText}>
                  You have not saved any shipping addresses yet. Add an address to speed up checkout.
                </Text>
              ) : (
                <View style={styles.addressList}>
                  {addressBook.map(address => (
                    <View key={address.id} style={styles.addressCard}>
                      <View style={styles.addressCardHeader}>
                        <Text style={styles.addressCardTitle}>
                          {address.fullName.trim().length > 0 ? address.fullName : 'Unnamed recipient'}
                        </Text>
                        {address.isDefault ? (
                          <Text style={[styles.addressBadge, styles.addressBadgeDefault]}>Default</Text>
                        ) : null}
                      </View>
                      {address.phone ? (
                        <Text style={styles.addressCardMeta}>{address.phone}</Text>
                      ) : (
                        <Text style={[styles.addressCardMeta, styles.addressCardMetaMuted]}>No phone provided</Text>
                      )}
                      <Text style={styles.addressCardMeta}>{address.line1}</Text>
                      {address.line2 ? <Text style={styles.addressCardMeta}>{address.line2}</Text> : null}
                      <Text style={styles.addressCardMeta}>
                        {[address.city, address.region, address.postalCode].filter(Boolean).join(', ')}
                      </Text>
                      <View style={styles.addressActions}>
                        {!address.isDefault ? (
                          <TouchableOpacity
                            style={styles.addressActionSecondary}
                            activeOpacity={0.8}
                            onPress={() => handleSetDefaultAddress(address.id)}
                            disabled={shippingSaving}
                          >
                            <Text style={styles.addressActionSecondaryText}>Set as default</Text>
                          </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity
                          style={styles.addressActionDanger}
                          activeOpacity={0.8}
                          onPress={() => handleRemoveAddress(address.id)}
                          disabled={shippingSaving}
                        >
                          <Text style={styles.addressActionDangerText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </PanelModal>

      <PanelModal
        visible={activePanel === 'password'}
        title="Change Password"
        onClose={dismissPasswordPanel}
        closeDisabled={passwordUpdating}
        presentation="center"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalKeyboard}
        >
          <View style={[styles.modalBody, styles.passwordForm]}>
            <View style={styles.passwordField}>
              <Text style={styles.passwordLabel}>Current password</Text>
              <TextInput
                value={passwordForm.current}
                onChangeText={text => setPasswordForm(prev => ({ ...prev, current: text }))}
                secureTextEntry
                style={styles.passwordInput}
                autoCapitalize="none"
                placeholder="Enter current password"
                placeholderTextColor="#9E9E9E"
                textContentType="password"
              />
            </View>

            <View style={styles.passwordField}>
              <Text style={styles.passwordLabel}>New password</Text>
              <TextInput
                value={passwordForm.next}
                onChangeText={text => setPasswordForm(prev => ({ ...prev, next: text }))}
                secureTextEntry
                style={styles.passwordInput}
                autoCapitalize="none"
                placeholder="Enter new password"
                placeholderTextColor="#9E9E9E"
                textContentType="newPassword"
              />
              <Text style={styles.passwordHint}>Use at least 8 characters.</Text>
            </View>

            <View style={styles.passwordField}>
              <Text style={styles.passwordLabel}>Confirm new password</Text>
              <TextInput
                value={passwordForm.confirm}
                onChangeText={text => setPasswordForm(prev => ({ ...prev, confirm: text }))}
                secureTextEntry
                style={styles.passwordInput}
                autoCapitalize="none"
                placeholder="Re-enter new password"
                placeholderTextColor="#9E9E9E"
                textContentType="newPassword"
              />
            </View>

            {passwordError ? <Text style={styles.passwordError}>{passwordError}</Text> : null}
            {passwordFeedback ? <Text style={styles.passwordFeedback}>{passwordFeedback}</Text> : null}

            <TouchableOpacity
              style={[styles.passwordSubmit, passwordUpdating ? styles.passwordSubmitDisabled : null]}
              disabled={passwordUpdating}
              activeOpacity={0.85}
              onPress={handlePasswordSubmit}
            >
              {passwordUpdating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.passwordSubmitText}>Update Password</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </PanelModal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    gap: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECECEC',
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111111',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#5C5C5C',
    marginTop: 2,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#F6F6F6',
    gap: 18,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  avatarLoader: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E5E5',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#3D5C35',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  profileInfo: {
    flex: 1,
    gap: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  editNameButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#E4F4EA',
    alignSelf: 'flex-start',
  },
  editNameText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3A8C66',
  },
  nameEditor: {
    width: '100%',
    gap: 8,
  },
  nameInput: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D2E3D7',
    backgroundColor: '#FFFFFF',
    fontSize: 16,
    color: '#111111',
  },
  nameActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  nameCancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#EFEFEF',
  },
  nameCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5C5C5C',
  },
  nameSaveButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#3A8C66',
    minWidth: 80,
    alignItems: 'center',
  },
  nameSaveButtonDisabled: {
    opacity: 0.65,
  },
  nameSaveText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111111',
    flexShrink: 1,
  },
  nameError: {
    fontSize: 12,
    color: '#B3261E',
  },
  nameFeedback: {
    fontSize: 12,
    color: '#2E7D32',
  },
  profileUsername: {
    fontSize: 13,
    color: '#666666',
  },
  changePhotoButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3D5C35',
  },
  changePhotoText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3D5C35',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#F4F4F4',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E8F7DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#7A7A7A',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statValue: {
    marginTop: 8,
    fontSize: 24,
    color: '#111111',
    fontWeight: '700',
  },
  actionList: {
    gap: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDFDFD',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 3,
        blurRadius: 6,
        color: 'rgba(0, 0, 0, 0.04)',
      },
    ],
    elevation: 1,
  },
  actionIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E8F7DA',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  actionCopy: {
    flex: 1,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
  },
  actionDescription: {
    fontSize: 12,
    color: '#6A6A6A',
    marginTop: 4,
  },
  registerCard: {
    backgroundColor: '#E5FFD0',
    borderRadius: 22,
    padding: 20,
    gap: 14,
  },
  registerCopy: {
    gap: 6,
  },
  registerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F3E13',
  },
  registerDescription: {
    fontSize: 13,
    color: '#3D5C35',
  },
  registerButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#3D5C35',
  },
  registerButtonDisabled: {
    backgroundColor: '#9DBF8C',
  },
  registerButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  sellerCard: {
    backgroundColor: '#F3FAEF',
    borderRadius: 22,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  sellerCopy: {
    flex: 1,
    gap: 6,
  },
  sellerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F3E13',
  },
  sellerSubtitle: {
    fontSize: 13,
    color: '#3D5C35',
  },
  sellerButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#C8FF9E',
    borderWidth: 1,
    borderColor: '#9BD671',
  },
  sellerButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D2C15',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  modalOverlayBottom: {
    justifyContent: 'flex-end',
  },
  modalOverlayCenter: {
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 26,
    width: '100%',
  },
  modalContainerBottom: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    alignSelf: 'stretch',
    maxHeight: '85%',
  },
  modalContainerCentered: {
    borderRadius: 24,
    alignSelf: 'center',
    maxWidth: 420,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseButtonDisabled: {
    backgroundColor: '#E8E8E8',
  },
  modalContentContainer: {
    gap: 16,
  },
  modalBody: {
    gap: 16,
  },
  modalScroll: {
    maxHeight: 400,
  },
  modalSuccess: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D7A36',
  },
  modalError: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B3261E',
  },
  followLoading: {
    alignItems: 'center',
    gap: 8,
  },
  followList: {
    gap: 14,
  },
  followRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  followAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D9D9D9',
  },
  followAvatarInitials: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  followCopy: {
    flex: 1,
  },
  followName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  followEmail: {
    fontSize: 13,
    color: '#6F6F6F',
    marginTop: 2,
  },
  followEmptyState: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  followEmptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  followEmptyCopy: {
    fontSize: 13,
    color: '#6F6F6F',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  orderCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: '#FFFFFF',
    padding: 12,
    gap: 8,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  orderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
    flex: 1,
    marginRight: 8,
  },
  orderMeta: {
    fontSize: 12,
    color: '#6B6B6B',
    flexShrink: 0,
    textAlign: 'right',
  },
  orderItems: {
    gap: 6,
    marginTop: 4,
  },
  orderItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  orderItemTitle: {
    flex: 1,
    fontSize: 13,
    color: '#222222',
  },
  orderItemMeta: {
    fontSize: 12,
    color: '#6B6B6B',
  },
  orderFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  orderStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#F1F1F1',
  },
  orderStatusText: {
    fontSize: 12,
    color: '#6B6B6B',
  },
  orderConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#A8FF6F',
    borderWidth: 1,
    borderColor: '#8EDC59',
  },
  orderConfirmText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111111',
  },
  reviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#FFF4D1',
    borderWidth: 1,
    borderColor: '#F1DD8A',
  },
  reviewButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A6D00',
  },
  reviewMediaSection: {
    marginTop: 12,
    gap: 12,
  },
  reviewMediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  reviewMediaThumb: {
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E8E8E8',
  },
  reviewMediaImage: {
    width: '100%',
    height: '100%',
  },
  reviewMediaVideo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
  },
  reviewMediaVideoText: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  reviewMediaRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewMediaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#EAF7E5',
  },
  reviewMediaButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3D5C35',
  },
  reviewPendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#FFF4D1',
    borderWidth: 1,
    borderColor: '#F1DD8A',
  },
  reviewPendingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A6D00',
  },
  reviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#E0F7D9',
  },
  reviewBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D7A36',
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalBodyText: {
    fontSize: 14,
    color: '#3F3F3F',
    lineHeight: 20,
  },
  modalActionLink: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  modalActionLinkText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3D5C35',
  },
  modalKeyboard: {
    width: '100%',
  },
  shippingScroll: {
    maxHeight: 520,
  },
  shippingScrollContent: {
    paddingBottom: 12,
  },
  sellerScrollContent: {
    gap: 20,
    paddingBottom: 12,
  },
  shippingSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F3E13',
  },
  addressForm: {
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E1E1E1',
    backgroundColor: '#F8FDF2',
  },
  shippingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shippingToggleLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#3D5C35',
    marginRight: 12,
  },
  shippingErrorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B3261E',
  },
  shippingFeedbackText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D7A36',
  },
  sellerSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F3E13',
  },
  listingForm: {
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E1E1E1',
    backgroundColor: '#F8FDF2',
  },
  listingDescriptionInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  listingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listingToggleLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#3D5C35',
    marginRight: 12,
  },
  listingSubmitButton: {
    borderRadius: 14,
    backgroundColor: '#3D5C35',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listingSubmitDisabled: {
    opacity: 0.6,
  },
  listingSubmitText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listingList: {
    gap: 14,
  },
  listingRow: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 8,
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 2,
        blurRadius: 4,
        color: 'rgba(0, 0, 0, 0.04)',
      },
    ],
    elevation: 1,
  },
  listingRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listingRowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
    marginRight: 12,
  },
  listingStatusBadge: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  listingStatusBadgeActive: {
    backgroundColor: '#E0F7D9',
  },
  listingStatusBadgeInactive: {
    backgroundColor: '#FFE1E1',
  },
  listingStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D2C15',
  },
  listingRowMeta: {
    fontSize: 12,
    color: '#4F4F4F',
  },
  listingRowActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  listingActionSecondary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3D5C35',
    paddingVertical: 10,
  },
  listingActionSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3D5C35',
  },
  listingActionDanger: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#FF5C5C',
    paddingVertical: 10,
  },
  listingActionDangerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  shippingSaveButton: {
    borderRadius: 14,
    backgroundColor: '#3D5C35',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shippingSaveButtonDisabled: {
    opacity: 0.6,
  },
  shippingSaveButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  addressList: {
    gap: 14,
  },
  addressCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E4E4E4',
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 8,
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 2,
        blurRadius: 4,
        color: 'rgba(0, 0, 0, 0.04)',
      },
    ],
    elevation: 1,
  },
  addressCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addressCardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  addressBadge: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  addressBadgeDefault: {
    backgroundColor: '#E0F7D9',
    color: '#2D7A36',
  },
  addressCardMeta: {
    fontSize: 13,
    color: '#3F3F3F',
    lineHeight: 18,
  },
  addressCardMetaMuted: {
    color: '#8A8A8A',
  },
  addressActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  addressActionSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3D5C35',
    backgroundColor: '#FFFFFF',
  },
  addressActionSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3D5C35',
  },
  addressActionDanger: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#FF5C5C',
  },
  addressActionDangerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  passwordForm: {
    paddingBottom: Platform.select({ ios: 0, default: 0 }),
  },
  passwordField: {
    gap: 6,
  },
  passwordLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444444',
  },
  passwordInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D6D6D6',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111111',
    backgroundColor: '#FFFFFF',
  },
  passwordHint: {
    fontSize: 12,
    color: '#6F6F6F',
  },
  passwordError: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B3261E',
  },
  passwordFeedback: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2D7A36',
  },
  passwordSubmit: {
    borderRadius: 16,
    backgroundColor: '#3D5C35',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordSubmitDisabled: {
    opacity: 0.6,
  },
  passwordSubmitText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listingImagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  listingImageThumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#F0F0F0',
  },
  listingImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  listingImageRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF5C5C',
  },
  listingPickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D6D6D6',
    backgroundColor: '#FFFFFF',
  },
  listingPickButtonDisabled: {
    opacity: 0.6,
  },
  listingPickButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111111',
  },
});

