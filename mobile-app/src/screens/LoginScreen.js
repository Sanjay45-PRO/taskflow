import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabaseClient';
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

export default function LoginScreen({ navigation }) {
  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSaved, setCheckingSaved] = useState(true);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem('taskflow-session');
      if (!saved) { setCheckingSaved(false); return; }

      // A cached session only ever gets written after this device was approved —
      // but the backend is still the source of truth, so re-check every open in
      // case a manager has revoked this device since the last launch.
      try {
        const session = JSON.parse(saved);
        const device_id = await getDeviceId();
        const resp = await callDeviceAuth({
          action: 'check_device', team: session.team, employee_name: session.name, device_id,
          device_name: getDeviceName(), platform: getPlatform(), app_version: getAppVersion(),
        });
        if (resp.approved) {
          navigation.replace('Home');
        } else {
          await AsyncStorage.removeItem('taskflow-session');
          setName(session.name || '');
          setTeam(session.team || '');
          setCheckingSaved(false);
        }
      } catch (e) {
        // network issue — fall back to asking them to sign in again rather than
        // silently trusting a possibly-revoked local session
        setCheckingSaved(false);
      }
    })();
  }, []);

  async function handleLogin() {
    if (!name.trim() || !team.trim()) {
      Alert.alert('Missing info', 'Enter your name and workspace code.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('team', team.trim())
      .eq('name', name.trim())
      .eq('role', 'employee')
      .maybeSingle();

    if (error || !data) {
      setLoading(false);
      Alert.alert('Not found', "No employee with that name was found in this workspace. Ask your manager to add you first.");
      return;
    }

    // Credentials check out — now find out whether this specific phone is approved.
    try {
      const device_id = await getDeviceId();
      const resp = await callDeviceAuth({
        action: 'check_device', team: data.team, employee_name: data.name, device_id,
        device_name: getDeviceName(), platform: getPlatform(), app_version: getAppVersion(),
      });
      setLoading(false);

      if (resp.approved) {
        const session = { name: data.name, team: data.team, email: data.email || '' };
        await AsyncStorage.setItem('taskflow-session', JSON.stringify(session));
        navigation.replace('Home');
      } else {
        navigation.navigate('DeviceVerify', { name: data.name, team: data.team });
      }
    } catch (e) {
      setLoading(false);
      Alert.alert('Network error', 'Could not reach the server. Check your connection and try again.');
    }
  }

  if (checkingSaved) {
    return (
      <View style={[styles.wrap, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.logo}>TaskFlow</Text>
      <Text style={styles.sub}>Sign in to check in and track your day</Text>

      <TextInput
        style={styles.input}
        placeholder="Your name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      <TextInput
        style={styles.input}
        placeholder="Team / workspace code"
        value={team}
        onChangeText={setTeam}
        autoCapitalize="none"
      />

      <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Continue</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', padding: 28 },
  logo: { fontSize: 30, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 6 },
  sub: { color: '#94A3B8', textAlign: 'center', marginBottom: 32, fontSize: 14 },
  input: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 15, marginBottom: 14
  },
  btn: {
    backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 }
});
