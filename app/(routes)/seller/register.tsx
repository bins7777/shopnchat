import { supabase } from '@/config/supabase';
import { extractMissingColumnName } from '@/lib/supabase-errors';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function SellerRegisterScreen() {
  const [shopName, setShopName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [socialLink, setSocialLink] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!shopName.trim() || !businessType.trim() || !contactNumber.trim()) {
      Alert.alert('Missing information', 'Fill in your shop name, business type, and contact number.');
      return;
    }

    if (!agree) {
      Alert.alert(
        'Agreement required',
        'Please accept the community guidelines to start selling or trading.',
      );
      return;
    }

    const supabaseClient = supabase;

    if (!supabaseClient) {
      Alert.alert(
        'Configuration missing',
        'Database configuration is not available yet. Please check your Supabase settings.',
      );
      return;
    }

    try {
      const { data: userData, error: userError } = await supabaseClient.auth.getUser();
      if (userError) {
        throw userError;
      }

      const user = userData.user;
      if (!user) {
        Alert.alert('Sign in required', 'Please log in before registering to sell or trade.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go to Login', onPress: () => router.push('/login') },
        ]);
        return;
      }

      setSubmitting(true);

      const approvalTimestamp = new Date().toISOString();

      const payload = {
        user_id: user.id,
        shop_name: shopName.trim(),
        business_type: businessType.trim(),
        contact_number: contactNumber.trim(),
        social_link: socialLink.trim() || null,
        status: 'approved',
        submitted_at: approvalTimestamp,
        reviewed_at: approvalTimestamp,
        email: user.email ?? null,
      };

      const { data: existingApplication, error: fetchError } = await supabaseClient
        .from('seller_applications')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      const applySellerMutation = async (
        action: 'insert' | 'update',
        initialPayload: Record<string, unknown>,
        applicationId?: string,
      ) => {
        if (action === 'update' && !applicationId) {
          throw new Error('Seller application id is required to update the record.');
        }

        const requiredColumns = new Set(['user_id', 'shop_name', 'status', 'submitted_at']);
        let workingPayload: Record<string, unknown> = { ...initialPayload };

        // Remove any optional columns that are not present in the Supabase schema yet.
        // This keeps the mutation resilient to partially migrated databases.
        for (;;) {
          const builder = supabaseClient.from('seller_applications');
          const result =
            action === 'insert'
              ? await builder.insert(workingPayload)
              : await builder.update(workingPayload).eq('id', applicationId as string);

          const { error: mutationError } = result;
          if (!mutationError) {
            return;
          }

          const missingColumn = extractMissingColumnName(mutationError);
          if (!missingColumn || !Object.prototype.hasOwnProperty.call(workingPayload, missingColumn)) {
            throw mutationError;
          }

          if (requiredColumns.has(missingColumn)) {
            throw mutationError;
          }

          const nextPayload: Record<string, unknown> = { ...workingPayload };
          delete nextPayload[missingColumn];
          workingPayload = nextPayload;
        }
      };

      if (existingApplication?.id) {
        await applySellerMutation('update', payload, existingApplication.id);
      } else {
        await applySellerMutation('insert', payload);
      }

      Alert.alert(
        'Seller access granted',
        'Thanks! Your seller tools are now unlocked and ready to use.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: string }).message ?? '').trim()
          : '';
      Alert.alert('Submission failed', message || 'Unable to submit application right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.75}
          >
            <Ionicons name="arrow-back" size={22} color="#111111" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Seller / Trader Registration</Text>
            <Text style={styles.subtitle}>
              Tell us more about your store so we can enable selling tools on your account.
            </Text>
          </View>
        </View>

        <View style={styles.form}>
          <View style={styles.formGroup}>
            <Text style={styles.label}>SHOP NAME</Text>
            <TextInput
              style={styles.input}
              value={shopName}
              onChangeText={setShopName}
              placeholder="e.g. Quiambao's Corporation"
              placeholderTextColor="#A2A2A2"
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>BUSINESS TYPE</Text>
            <TextInput
              style={styles.input}
              value={businessType}
              onChangeText={setBusinessType}
              placeholder="Online retail, trade-in, etc."
              placeholderTextColor="#A2A2A2"
              autoCapitalize="sentences"
              returnKeyType="next"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>CONTACT NUMBER</Text>
            <TextInput
              style={styles.input}
              value={contactNumber}
              onChangeText={setContactNumber}
              placeholder="+63 900 000 0000"
              placeholderTextColor="#A2A2A2"
              keyboardType="phone-pad"
              returnKeyType="next"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>SOCIAL / SHOP LINK (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              value={socialLink}
              onChangeText={setSocialLink}
              placeholder="https://"
              placeholderTextColor="#A2A2A2"
              autoCapitalize="none"
              keyboardType="url"
              returnKeyType="done"
            />
          </View>

          <View style={styles.guidelines}>
            <Ionicons name="shield-checkmark" size={22} color="#3D5C35" />
            <View style={styles.guidelineCopy}>
              <Text style={styles.guidelineTitle}>Community guidelines</Text>
              <Text style={styles.guidelineText}>
                Keep listings accurate, respond within 24 hours, and ship confirmed orders on time.
              </Text>
            </View>
          </View>

          <View style={styles.agreementRow}>
            <Switch
              value={agree}
              onValueChange={setAgree}
              thumbColor={agree ? '#3D5C35' : '#FFFFFF'}
              trackColor={{ true: '#BEE4A3', false: '#DADADA' }}
            />
            <Text style={styles.agreementText}>
              I agree to the marketplace terms and commit to safe trading practices.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.disabledButton]}
            onPress={handleSubmit}
            activeOpacity={0.85}
            disabled={submitting}
          >
            <Text style={styles.submitButtonText}>
              {submitting ? 'Submitting...' : 'Submit Application'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ECECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111111',
  },
  subtitle: {
    fontSize: 13,
    color: '#5C5C5C',
    lineHeight: 20,
  },
  form: {
    gap: 18,
  },
  formGroup: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    color: '#7C7C7C',
    letterSpacing: 1.2,
  },
  input: {
    height: 50,
    borderRadius: 14,
    backgroundColor: '#F1F1F1',
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#222222',
  },
  guidelines: {
    flexDirection: 'row',
    gap: 16,
    backgroundColor: '#F3FFE3',
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
  },
  guidelineCopy: {
    flex: 1,
    gap: 4,
  },
  guidelineTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1F3E13',
  },
  guidelineText: {
    fontSize: 12,
    color: '#4E6A41',
    lineHeight: 18,
  },
  agreementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  agreementText: {
    flex: 1,
    fontSize: 12,
    color: '#4E4E4E',
    lineHeight: 18,
  },
  submitButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: '#3D5C35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  disabledButton: {
    opacity: 0.6,
  },
});
