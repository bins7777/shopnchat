import OnboardingScreen from '@/screens/onboarding/onboarding.screen';
import React, { useEffect, useState } from 'react';
import { Image, SafeAreaView, StyleSheet, Text, View } from 'react-native';

const SHOP_LOGO = require('@/assets/images/shopnchat-logo.png');

export default function Index() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (showSplash) {
    return (
      <SafeAreaView style={styles.splashContainer}>
        <View style={styles.card}>
          <Image source={SHOP_LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>ShopNChat</Text>
          <Text style={styles.subtitle}>Discover, trade, and chat with your community.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return <OnboardingScreen />;
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: '#F5FBF7',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 12,
        blurRadius: 24,
        color: 'rgba(47, 122, 83, 0.15)',
      },
    ],
    elevation: 8,
    gap: 18,
  },
  logo: {
    width: 120,
    height: 120,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1F3D2B',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: '#597166',
    lineHeight: 20,
  },
});
