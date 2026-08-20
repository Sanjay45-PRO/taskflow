import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import Constants from 'expo-constants';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import './src/locationTask'; // registers the background task at app startup

import LoginScreen from './src/screens/LoginScreen';
import DeviceVerifyScreen from './src/screens/DeviceVerifyScreen';
import HomeScreen from './src/screens/HomeScreen';
import ExpenseScreen from './src/screens/ExpenseScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import TaskDetailScreen from './src/screens/TaskDetailScreen';
import MyExpensesScreen from './src/screens/MyExpensesScreen';
import UpdateRequiredScreen from './src/screens/UpdateRequiredScreen';

const Stack = createNativeStackNavigator();
const VERSION_CHECK_URL = 'https://taskflow.greentechrenewable.com/version.json';

// Compares "1.0.4" style strings. Returns true if `a` is older than `b`.
function isOlder(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

export default function App() {
  const [checking, setChecking] = useState(true);
  const [updateInfo, setUpdateInfo] = useState(null); // { apkUrl, notes } when update required

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(VERSION_CHECK_URL, { cache: 'no-store' });
        const data = await res.json();
        const currentVersion = Constants.expoConfig?.version || '0.0.0';
        if (data.latest && isOlder(currentVersion, data.latest)) {
          setUpdateInfo({ apkUrl: data.apk_url, notes: data.notes });
        }
      } catch (e) {
        // If the version check itself fails (offline, etc.), don't block the app —
        // fail open so a network hiccup never locks someone out of TaskFlow.
        console.error('Version check failed', e.message);
      }
      setChecking(false);
    })();
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#2563EB" size="large" />
      </View>
    );
  }

  if (updateInfo) {
    return <UpdateRequiredScreen apkUrl={updateInfo.apkUrl} notes={updateInfo.notes} />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="DeviceVerify" component={DeviceVerifyScreen} options={{ headerShown: true, title: 'Verify Device' }} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Expense" component={ExpenseScreen} options={{ headerShown: true, title: 'Submit Expense' }} />
        <Stack.Screen name="Calendar" component={CalendarScreen} options={{ headerShown: true, title: 'My Calendar' }} />
        <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ headerShown: true, title: 'Task' }} />
        <Stack.Screen name="MyExpenses" component={MyExpensesScreen} options={{ headerShown: true, title: 'My Expenses' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
