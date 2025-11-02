import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import {
  Image,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const SHOP_LOGO = require('@/assets/images/shopnchat-logo.png');

export default function OnboardingScreen() {
  const handleProceed = () => {
    router.replace('/login');
  };

  return (
    <LinearGradient colors={['#EAF9F2', '#FFFFFF']} style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerStack}>
          <View style={styles.logoWrapper}>
            <Image source={SHOP_LOGO} style={styles.logo} resizeMode="contain" />
          </View>

          <Text style={styles.heading}>Welcome  ShopNChat</Text>
          <Text style={styles.subtitle}>
            Join a friendly neighborhood marketplace to share, swap, and support local.
          </Text>

          <TouchableOpacity activeOpacity={0.9} onPress={handleProceed} style={styles.primaryButton}>
            <LinearGradient
              colors={['#36B37E', '#62D6A5']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryButtonGradient}
            >
              <Text style={styles.primaryButtonText}>Get Started</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.8} onPress={handleProceed}>
            <Text style={styles.secondaryActionText}>Browse as guest</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 24,
  },
  centerStack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  logoWrapper: {
    width: 120,
    height: 120,
    borderRadius: 32,
    backgroundColor: '#F3FBF6',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 8,
        blurRadius: 18,
        color: 'rgba(58, 140, 102, 0.12)',
      },
    ],
    elevation: 3,
  },
  logo: {
    width: '78%',
    height: '78%',
  },
  heading: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1F3D2B',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: '#4E6E5C',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  primaryButton: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  primaryButtonGradient: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  secondaryActionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3A8C66',
  },
});
