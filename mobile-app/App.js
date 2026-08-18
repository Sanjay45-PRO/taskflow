import 'react-native-gesture-handler';
import React from 'react';
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

const Stack = createNativeStackNavigator();

export default function App() {
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
