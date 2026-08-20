import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';

export const LOCATION_TASK = 'taskflow-background-location';

const MAX_PLAUSIBLE_SPEED_KMH = 150; // above this between two consecutive points, flag as suspicious

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// This runs even when the app is backgrounded or the screen is locked,
// as long as the employee has checked in (we only start the task on check-in,
// and stop it on check-out).
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('Location task error', error);
    return;
  }
  if (!data) return;
  const { locations } = data;
  if (!locations || !locations.length) return;

  const session = JSON.parse((await AsyncStorage.getItem('taskflow-session')) || 'null');
  if (!session) return;

  // Pull the most recent saved point for this employee today, to sanity-check
  // the speed implied by the jump to the first new point in this batch.
  let lastPoint = null;
  try {
    const { data: prevRows } = await supabase
      .from('location_logs')
      .select('latitude, longitude, recorded_at')
      .eq('team', session.team)
      .eq('employee_name', session.name)
      .order('recorded_at', { ascending: false })
      .limit(1);
    if (prevRows && prevRows.length) lastPoint = prevRows[0];
  } catch (e) {
    console.error('Could not fetch last location point for speed check', e);
  }

  const rows = [];
  for (const loc of locations) {
    const recorded_at = new Date(loc.timestamp).toISOString();
    let is_suspicious = false;
    let speed_kmh = null;

    const prev = rows.length ? rows[rows.length - 1] : lastPoint;
    if (prev) {
      const distKm = haversineKm(prev.latitude, prev.longitude, loc.coords.latitude, loc.coords.longitude);
      const hrs = (new Date(recorded_at).getTime() - new Date(prev.recorded_at).getTime()) / 36e5;
      if (hrs > 0) {
        speed_kmh = distKm / hrs;
        if (speed_kmh > MAX_PLAUSIBLE_SPEED_KMH) is_suspicious = true;
      }
    }

    rows.push({
      team: session.team,
      employee_name: session.name,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      recorded_at,
      is_suspicious,
      speed_kmh: speed_kmh !== null ? Math.round(speed_kmh * 10) / 10 : null,
    });
  }

  const { error: insertError } = await supabase.from('location_logs').insert(rows);
  if (insertError) console.error('Failed to log location', insertError);
});

export async function startTracking() {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') throw new Error('Foreground location permission denied');

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') throw new Error('Background location permission denied');

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 10 * 1000, // every 10 seconds
    distanceInterval: 15, // or every 15m moved, whichever comes first
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'TaskFlow',
      notificationBody: 'Tracking your work location while checked in.',
    },
  });
}

export async function stopTracking() {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}
