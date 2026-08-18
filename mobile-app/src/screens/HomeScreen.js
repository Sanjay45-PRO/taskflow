import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Alert, ActivityIndicator, RefreshControl, Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import { supabase } from '../supabaseClient';
import { startTracking, stopTracking } from '../locationTask';

const VERSION_CHECK_URL = 'https://sanjay45-pro.github.io/taskflow/version.json';

export default function HomeScreen({ navigation }) {
  const [session, setSession] = useState(null);
  const [today, setToday] = useState(null); // today's attendance row
  const [tasks, setTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null); // { latest, apk_url, notes } if a newer version exists

  const load = useCallback(async () => {
    const s = JSON.parse((await AsyncStorage.getItem('taskflow-session')) || 'null');
    if (!s) { navigation.replace('Login'); return; }
    setSession(s);

    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: att } = await supabase
      .from('attendance').select('*')
      .eq('team', s.team).eq('employee_name', s.name).eq('work_date', todayStr).maybeSingle();
    setToday(att || null);

    const { data: t } = await supabase
      .from('tasks').select('*')
      .eq('team', s.team).eq('assignee', s.name).eq('status', 'pending')
      .order('due', { ascending: true });
    setTasks(t || []);
  }, [navigation]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { checkForUpdate(); }, []);

  function isNewerVersion(latest, current){
    const a = latest.split('.').map(Number);
    const b = current.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++){
      const x = a[i] || 0, y = b[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  async function checkForUpdate(){
    try {
      const res = await fetch(VERSION_CHECK_URL, { cache: 'no-store' });
      const data = await res.json();
      const currentVersion = Constants.expoConfig?.version || '1.0.0';
      if (data.latest && isNewerVersion(data.latest, currentVersion)){
        setUpdateInfo(data);
      }
    } catch (e) {
      // Silently ignore — no internet, or the version file isn't reachable yet.
      // The app keeps working normally either way.
    }
  }

  function openUpdateLink(){
    if (updateInfo?.apk_url) Linking.openURL(updateInfo.apk_url);
  }

  async function openLocationSettings(){
    if (Platform.OS !== 'android') return;
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.LOCATION_SOURCE_SETTINGS);
    } catch (e) {
      Alert.alert('Could not open settings', 'Please turn on Location in your phone\'s quick settings or Settings → Location.');
    }
  }

  // Confirms GPS/Location is actually turned on before trying to fetch a position.
  // If it's off, offers a direct button to the phone's Location settings screen
  // instead of a confusing "location unavailable" error.
  async function ensureLocationServicesOn(){
    const enabled = await Location.hasServicesEnabledAsync();
    if (enabled) return true;

    await new Promise(resolve => {
      Alert.alert(
        'Location is turned off',
        'Your phone\'s Location service is off. Turn it on to check in.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
          { text: 'Open Location Settings', onPress: async () => { await openLocationSettings(); resolve(); } },
        ]
      );
    });
    return false;
  }

  // Wraps a promise with a timeout so a stuck GPS fix doesn't hang forever.
  function withTimeout(promise, ms){
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
  }

  // Tries a fresh, accurate GPS fix first (10s timeout). If that's too slow —
  // common indoors or on a fresh install with no location history yet — falls
  // back to a faster, network-assisted lower-accuracy fix (8s timeout), then
  // finally to any last-known position. Only fails if all three don't work.
  async function getPositionSafely(){
    try {
      return await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        10000
      );
    } catch (e1) {
      try {
        return await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
          8000
        );
      } catch (e2) {
        const last = await Location.getLastKnownPositionAsync({});
        if (last) return last;
        throw e2;
      }
    }
  }

  async function requestBatteryExemption() {
    if (Platform.OS !== 'android') return;
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS
      );
    } catch (e) {
      try {
        await IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
          { data: 'package:com.greentechrenewable.taskflow' }
        );
      } catch (e2) {
        Alert.alert('Could not open settings', 'Please open Settings → Apps → TaskFlow → Battery manually.');
      }
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleCheckIn() {
    const consentAlreadyShown = await AsyncStorage.getItem('checkin-consent-shown');
    if (!consentAlreadyShown) {
      const confirmed = await new Promise(resolve => {
        Alert.alert(
          'Before you check in',
          "Your manager can see your location and work progress while you're checked in for the day. This turns off automatically when you check out.",
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'I understand, Check In', onPress: () => resolve(true) },
          ]
        );
      });
      if (!confirmed) return;
      await AsyncStorage.setItem('checkin-consent-shown', '1');
    }

    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Location access is required to check in.');
        setBusy(false);
        return;
      }

      const servicesOn = await ensureLocationServicesOn();
      if (!servicesOn) { setBusy(false); return; }

      const loc = await getPositionSafely();
      const todayStr = new Date().toISOString().slice(0, 10);

      const { error } = await supabase.from('attendance').upsert({
        team: session.team,
        employee_name: session.name,
        work_date: todayStr,
        check_in_at: new Date().toISOString(),
        check_in_lat: loc.coords.latitude,
        check_in_lng: loc.coords.longitude,
      }, { onConflict: 'team,employee_name,work_date' });

      if (error) { Alert.alert('Error', 'Could not check in. Try again.'); setBusy(false); return; }

      await startTracking();
      await load();

      // ===== EDIT THE TEXT BELOW — this is the one-time battery popup =====
      const alreadyPrompted = await AsyncStorage.getItem('battery-exemption-prompted');
      if (!alreadyPrompted) {
        await AsyncStorage.setItem('battery-exemption-prompted', '1');
        setTimeout(() => {
          Alert.alert(
            'Turn off battery restrictions',                                     // <-- TITLE goes here
            "We track your location while you're checked in, so your manager can see your work progress. Turning off battery restrictions for TaskFlow keeps this tracking running smoothly all day.", // <-- BODY goes here
            [
              { text: 'Not now', style: 'cancel' },                              // <-- DECLINE button text
              { text: 'Turn On', onPress: requestBatteryExemption },             // <-- ACCEPT button text
            ]
          );
        }, 800);
      }
      // ===== END editable section =====

      Alert.alert('Checked in', "You're checked in — location tracking is now on for the day.");
    } catch (e) {
      Alert.alert('Location unavailable', "Could not get a location fix. Try moving near a window or outdoors, or check that Location mode is set to \"High accuracy\" in your phone's Location settings, then try again.");
    }
    setBusy(false);
  }

  async function handleCheckOut() {
    setBusy(true);
    try {
      const servicesOn = await ensureLocationServicesOn();
      if (!servicesOn) { setBusy(false); return; }

      const loc = await getPositionSafely();
      const { error } = await supabase.from('attendance')
        .update({
          check_out_at: new Date().toISOString(),
          check_out_lat: loc.coords.latitude,
          check_out_lng: loc.coords.longitude,
        })
        .eq('id', today.id);

      if (error) { Alert.alert('Error', 'Could not check out.'); setBusy(false); return; }

      await stopTracking();
      await load();
      Alert.alert('Checked out', 'Have a good rest of your day!');
    } catch (e) {
      Alert.alert('Location unavailable', "Could not get a location fix. Try moving near a window or outdoors, or check that Location mode is set to \"High accuracy\" in your phone's Location settings, then try again.");
    }
    setBusy(false);
  }

  async function handleSignOut() {
    await stopTracking();
    await AsyncStorage.removeItem('taskflow-session');
    navigation.replace('Login');
  }

  if (!session) return <View style={styles.center}><ActivityIndicator /></View>;

  const isCheckedIn = today && today.check_in_at && !today.check_out_at;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.hello}>Hi, {session.name}</Text>
        <TouchableOpacity onPress={handleSignOut}><Text style={styles.signOut}>Sign out</Text></TouchableOpacity>
      </View>

      {updateInfo && (
        <TouchableOpacity style={styles.updateBanner} onPress={openUpdateLink}>
          <View style={{ flex: 1 }}>
            <Text style={styles.updateTitle}>Update available (v{updateInfo.latest})</Text>
            {updateInfo.notes ? <Text style={styles.updateNotes}>{updateInfo.notes}</Text> : null}
          </View>
          <Text style={styles.updateAction}>Download</Text>
        </TouchableOpacity>
      )}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>
          {isCheckedIn ? 'You are checked in' : today?.check_out_at ? 'Checked out for today' : 'Not checked in yet'}
        </Text>
        <TouchableOpacity
          style={[styles.bigBtn, isCheckedIn ? styles.bigBtnRed : styles.bigBtnGreen]}
          onPress={isCheckedIn ? handleCheckOut : handleCheckIn}
          disabled={busy || !!today?.check_out_at}
        >
          {busy ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.bigBtnText}>{isCheckedIn ? 'Check Out' : 'Check In'}</Text>
          )}
        </TouchableOpacity>
        {isCheckedIn && (
          <View style={styles.trackingBadge}>
            <View style={styles.trackingDot} />
            <Text style={styles.trackingText}>Checked in — your manager can see your location and work progress</Text>
          </View>
        )}
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.tile} onPress={() => navigation.navigate('Expense')}>
          <Text style={styles.tileText}>Submit Expense</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tile} onPress={() => navigation.navigate('Calendar')}>
          <Text style={styles.tileText}>My Calendar</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.tile, { backgroundColor: '#F0FDF4' }]} onPress={() => navigation.navigate('MyExpenses')}>
          <Text style={[styles.tileText, { color: '#16A34A' }]}>My Expenses</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>My Tasks</Text>
      <FlatList
        data={tasks}
        keyExtractor={i => i.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.taskRow} onPress={() => navigation.navigate('TaskDetail', { task: item })}>
            <View style={{ flex: 1 }}>
              <Text style={styles.taskTitle}>{item.title}</Text>
              {item.due ? <Text style={styles.taskDue}>Due {item.due}</Text> : null}
            </View>
            <Text style={styles.taskArrow}>›</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No pending tasks.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: 60, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  hello: { fontSize: 20, fontWeight: '700', color: '#0F172A' },
  signOut: { color: '#64748B', fontSize: 13 },
  updateBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE', borderRadius: 12, padding: 12, marginBottom: 16 },
  updateTitle: { fontSize: 13, fontWeight: '700', color: '#1D4ED8' },
  updateNotes: { fontSize: 11.5, color: '#3B82F6', marginTop: 2 },
  updateAction: { fontSize: 12.5, fontWeight: '700', color: '#fff', backgroundColor: '#2563EB', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, overflow: 'hidden' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center', elevation: 2 },
  cardLabel: { fontSize: 14, color: '#64748B', marginBottom: 14 },
  bigBtn: { width: '100%', paddingVertical: 18, borderRadius: 14, alignItems: 'center' },
  bigBtnGreen: { backgroundColor: '#16A34A' },
  bigBtnRed: { backgroundColor: '#DC2626' },
  bigBtnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  trackingBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, backgroundColor: '#FEF2F2', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  trackingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#DC2626' },
  trackingText: { fontSize: 11.5, color: '#991B1B', fontWeight: '600' },
  row: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  tile: { flex: 1, backgroundColor: '#EEF2FF', borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  tileText: { color: '#2563EB', fontWeight: '700', fontSize: 13 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 10 },
  taskRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, elevation: 1 },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  taskDue: { fontSize: 12, color: '#64748B', marginTop: 2 },
  taskArrow: { fontSize: 22, color: '#CBD5E1', marginLeft: 8 },
  empty: { color: '#94A3B8', textAlign: 'center', marginTop: 20 }
});
