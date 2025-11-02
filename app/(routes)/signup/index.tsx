import { supabase } from '@/config/supabase';
import { DEFAULT_AVATAR_URI } from '@/constants/avatar';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function SignupScreen() {
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!supabase) {
      Alert.alert('Configuration missing', 'Supabase is not configured yet.');
      return;
    }

    if (!email || !password) {
      Alert.alert('Missing fields', 'Email and password are required.');
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      Alert.alert('Invalid email', 'Please enter a valid email address (e.g. name@example.com).');
      return;
    }

    if (password.trim().length < 6) {
      Alert.alert('Weak password', 'Passwords must contain at least 6 characters.');
      return;
    }

    try {
      setLoading(true);
      const displayNameInput = name.trim();
      const userMetadata: Record<string, string> = { photo_url: DEFAULT_AVATAR_URI };
      if (displayNameInput) {
        userMetadata.display_name = displayNameInput;
      }
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: userMetadata,
        },
      });

      if (error) {
        throw error;
      }

      const userId = data.user?.id;
      if (userId) {
        const { error: profileError } = await supabase
          .from('users')
          .upsert(
            {
              id: userId,
              email: normalizedEmail,
              display_name: displayNameInput || data.user?.user_metadata?.display_name || null,
              photo_url: DEFAULT_AVATAR_URI,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'id' },
          );

        if (profileError) {
          console.warn('Failed to sync profile record', profileError);
        }
      }

      Alert.alert('Account created!', 'You can now sign in with your credentials.', [
        { text: 'OK', onPress: () => router.replace('/login') },
      ]);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unable to create account. Please try again.';
      Alert.alert('Signup failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>SIGN UP</Text>
          <Text style={styles.subtitle}>Create an account to continue.</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your name"
            placeholderTextColor="#A2A2A2"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="next"
          />

          <Text style={[styles.label, styles.sectionSpacing]}>EMAIL</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor="#A2A2A2"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            returnKeyType="next"
          />

          <Text style={[styles.label, styles.sectionSpacing]}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            placeholder="Create a password"
            placeholderTextColor="#A2A2A2"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.disabledButton]}
            activeOpacity={0.85}
            onPress={handleSignup}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Create Account</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/login')} style={styles.linkWrapper}>
            <Text style={styles.primaryLink}>Already have an account? Log in</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 36,
    letterSpacing: 6,
    fontWeight: '700',
    color: '#111111',
  },
  subtitle: {
    fontSize: 14,
    color: '#707070',
    marginTop: 6,
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 12,
    color: '#9D9D9D',
    letterSpacing: 2,
    marginBottom: 8,
  },
  sectionSpacing: {
    marginTop: 20,
  },
  input: {
    backgroundColor: '#E6E6E6',
    height: 52,
    borderRadius: 12,
    paddingHorizontal: 18,
    fontSize: 16,
    color: '#202020',
  },
  button: {
    marginTop: 30,
    backgroundColor: '#1F1F1F',
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.65,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  linkWrapper: {
    marginTop: 18,
    alignItems: 'center',
  },
  primaryLink: {
    fontSize: 12,
    color: '#111111',
    letterSpacing: 1,
  },
});
