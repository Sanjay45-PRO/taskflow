import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabaseClient';

export const LOCATION_TASK = 'taskflow-background-location';

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

  const rows = locations.map(loc => ({
    team: session.team,
    employee_name: session.name,
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    recorded_at: new Date(loc.timestamp).toISOString()
  }));

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
