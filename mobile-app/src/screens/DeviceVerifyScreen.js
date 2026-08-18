import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDeviceId, getDeviceName, getPlatform, getAppVersion } from '../deviceId';

const EDGE_FN_URL = 'https://yqdobywstnvakbcgkzqa.supabase.co/functions/v1/swift-service';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxZG9ieXdzdG52YWtiY2drenFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjQ1OTYsImV4cCI6MjEwMDkwMDU5Nn0.YqBlDlyeLmlujaxYiYPaQE9EVQWiRduE0EE7JRJEY1w';

async function callDeviceAuth(payload) {
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export default function DeviceVerifyScreen({ route, navigation }) {
  const { name, team } = route.params;
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    requestCode();
    return () => timerRef.current && clearInterval(timerRef.current);
  }, []);

  function startCooldown(seconds) {
    setCooldown(seconds);
    timerRef.current && clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) { clearInterval(timerRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  async function requestCode() {
    setRequesting(true);
    try {
      const device_id = await getDeviceId();
      const resp = await callDeviceAuth({
        action: 'request_otp', team, employee_name: name, device_id,
      });
      if (resp.ok) {
        startCooldown(60);
      } else if (resp.reason === 'cooldown') {
        startCooldown(resp.wait_seconds || 60);
      } else if (resp.reason === 'rate_limited') {
        Alert.alert('Too many attempts', 'Please wait a while before requesting another code.');
      } else {
        Alert.alert('Could not send code', 'Please try again in a moment.');
      }
    } catch (e) {
      Alert.alert('Network error', 'Could not reach the server. Check your connection and try again.');
    }
    setRequesting(false);
  }

  async function verifyCode() {
    if (code.trim().length !== 6) {
      Alert.alert('Enter the code', 'The verification code is 6 digits.');
      return;
    }
    setLoading(true);
    try {
      const device_id = await getDeviceId();
      const resp = await callDeviceAuth({
        action: 'verify_otp', team, employee_name: name, device_id, code: code.trim(),
        device_name: getDeviceName(), platform: getPlatform(), app_version: getAppVersion(),
      });
      setLoading(false);

      if (resp.ok) {
        const session = { name, team };
        await AsyncStorage.setItem('taskflow-session', JSON.stringify(session));
        navigation.replace('Home');
        return;
      }

      if (resp.reason === 'incorrect') {
        Alert.alert('Incorrect code', `That code is wrong. ${resp.attempts_remaining} attempt(s) left.`);
      } else if (resp.reason === 'expired') {
        Alert.alert('Code expired', 'Request a new code and try again.');
      } else if (resp.reason === 'too_many_attempts') {
        Alert.alert('Too many attempts', 'Request a new code and try again.');
      } else {
        Alert.alert('Verification failed', 'Request a new code and try again.');
      }
    } catch (e) {
      setLoading(false);
      Alert.alert('Network error', 'Could not reach the server. Check your connection and try again.');
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>New device detected</Text>
      <Text style={styles.sub}>
        This phone isn't registered for your TaskFlow account yet. A verification code has been sent
        to your workspace administrator — ask them for it.
      </Text>

      <Text style={styles.label}>Enter verification code</Text>
      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
        keyboardType="number-pad"
        placeholder="••••••"
        maxLength={6}
        textAlign="center"
      />

      <TouchableOpacity style={styles.btn} onPress={verifyCode} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Verify</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.resendBtn}
        onPress={requestCode}
        disabled={requesting || cooldown > 0}
      >
        <Text style={styles.resendText}>
          {requesting ? 'Sending…' : cooldown > 0 ? `Resend code (${cooldown}s)` : 'Resend code'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', padding: 28 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 10 },
  sub: { color: '#94A3B8', textAlign: 'center', marginBottom: 32, fontSize: 14, lineHeight: 20 },
  label: { color: '#CBD5E1', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  codeInput: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16,
    fontSize: 26, letterSpacing: 10, marginBottom: 20,
  },
  btn: { backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 14 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resendBtn: { alignItems: 'center', paddingVertical: 8 },
  resendText: { color: '#93C5FD', fontSize: 14 },
});
