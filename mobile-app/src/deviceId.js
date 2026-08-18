// Stable device identity used ONLY as a lookup key sent to the backend.
// The backend (device-auth edge function) is the source of truth for whether
// this id is approved — nothing here grants access on its own.
//
// Android: Application.androidId — survives app reinstall, tied to the OS install,
//          changes only on factory reset.
// iOS:     Application.getIosIdForVendorAsync() — stable per vendor while at least
//          one app from the same vendor stays installed.
//
// We still cache the resolved id in SecureStore (not AsyncStorage) purely to avoid
// re-deriving it every launch — clearing SecureStore just means we re-read the same
// underlying OS-level id next time, it does NOT create a "new" device server-side.

import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CACHE_KEY = 'taskflow-device-id';

export async function getDeviceId() {
  const cached = await SecureStore.getItemAsync(CACHE_KEY);
  if (cached) return cached;

  let id;
  if (Platform.OS === 'android') {
    id = Application.androidId;
  } else {
    id = await Application.getIosIdForVendorAsync();
  }
  // Fallback should essentially never trigger, but avoids a hard crash on an
  // unusual device/emulator that returns null.
  if (!id) {
    id = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  await SecureStore.setItemAsync(CACHE_KEY, id);
  return id;
}

export function getDeviceName() {
  return Application.applicationName || `${Platform.OS} device`;
}

export function getPlatform() {
  return Platform.OS;
}

export function getAppVersion() {
  return Application.nativeApplicationVersion || 'unknown';
}
