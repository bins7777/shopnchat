import { supabase } from '@/config/supabase';
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

export default function LoginScreen() {
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!supabase) {
      Alert.alert('Configuration missing', 'Supabase is not configured yet.');
      return;
    }

    if (!email || !password) {
      Alert.alert('Missing fields', 'Please enter both email and password.');
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      Alert.alert('Invalid email', 'Please enter a valid email address (e.g. name@example.com).');
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        throw error;
      }

      router.replace('/(tabs)');
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unable to sign in. Please try again.';
      Alert.alert('Login failed', message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!supabase) {
      Alert.alert('Configuration missing', 'Supabase is not configured yet.');
      return;
    }

    if (!email) {
      Alert.alert('Enter email', 'Add your email above so we know where to send the reset link.');
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      Alert.alert('Invalid email', 'Please enter a valid email address before resetting.');
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail);

      if (error) {
        throw error;
      }

      Alert.alert('Reset link sent', 'Check your inbox to reset the password.');
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Something went wrong while sending the password reset email.';
      Alert.alert('Reset failed', message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>LOGIN</Text>
          <Text style={styles.subtitle}>Sign in to continue.</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor="#A2A2A2"
            value={email}
            onChangeText={setEmail}
            returnKeyType="next"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={[styles.label, styles.passwordLabel]}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            placeholderTextColor="#A2A2A2"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.disabledButton]}
            activeOpacity={0.85}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Log in</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleForgotPassword} style={styles.linkWrapper}>
            <Text style={styles.secondaryLink}>Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/signup')} style={styles.linkWrapper}>
            <Text style={styles.primaryLink}>Signup!</Text>
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
  passwordLabel: {
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
    marginTop: 10,
    alignItems: 'center',
  },
  secondaryLink: {
    fontSize: 12,
    color: '#8C8C8C',
    letterSpacing: 1,
  },
  primaryLink: {
    fontSize: 12,
    color: '#111111',
    letterSpacing: 1,
  },
});
