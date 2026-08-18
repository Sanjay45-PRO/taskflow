import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../supabaseClient';

const STATUS_COLORS = { approved: '#16A34A', pending: '#D97706', rejected: '#DC2626' };
const STATUS_BG = { approved: '#F0FDF4', pending: '#FFFBEB', rejected: '#FEF2F2' };

export default function MyExpensesScreen() {
  const [claims, setClaims] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const session = JSON.parse((await AsyncStorage.getItem('taskflow-session')) || 'null');
    if (!session) return;
    const { data } = await supabase
      .from('expense_claims').select('*')
      .eq('team', session.team).eq('employee_name', session.name)
      .order('submitted_at', { ascending: false });
    setClaims(data || []);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const approvedTotal = claims.filter(c => c.status === 'approved').reduce((sum, c) => sum + Number(c.amount), 0);
  const pendingTotal = claims.filter(c => c.status === 'pending').reduce((sum, c) => sum + Number(c.amount), 0);
  const rejectedCount = claims.filter(c => c.status === 'rejected').length;

  return (
    <View style={styles.wrap}>
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: '#F0FDF4' }]}>
          <Text style={[styles.summaryLabel, { color: '#166534' }]}>Approved</Text>
          <Text style={[styles.summaryValue, { color: '#166534' }]}>₹{approvedTotal.toFixed(2)}</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#FFFBEB' }]}>
          <Text style={[styles.summaryLabel, { color: '#92400E' }]}>Pending</Text>
          <Text style={[styles.summaryValue, { color: '#92400E' }]}>₹{pendingTotal.toFixed(2)}</Text>
        </View>
      </View>
      {rejectedCount > 0 && (
        <Text style={styles.rejectedNote}>{rejectedCount} claim{rejectedCount > 1 ? 's' : ''} rejected — see details below</Text>
      )}

      <FlatList
        data={claims}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingBottom: 30 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.amount}>₹{Number(item.amount).toFixed(2)}</Text>
              <View style={[styles.statusPill, { backgroundColor: STATUS_BG[item.status] }]}>
                <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>{item.status}</Text>
              </View>
            </View>
            <Text style={styles.category}>{item.category}</Text>
            {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
            <Text style={styles.date}>{new Date(item.submitted_at).toLocaleDateString()}</Text>
            {item.status === 'rejected' && item.rejection_reason ? (
              <View style={styles.reasonBox}>
                <Text style={styles.reasonText}>{item.rejection_reason}</Text>
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No expense claims yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC', padding: 20 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  summaryCard: { flex: 1, borderRadius: 12, padding: 14 },
  summaryLabel: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  summaryValue: { fontSize: 20, fontWeight: '800' },
  rejectedNote: { fontSize: 12.5, color: '#DC2626', marginBottom: 12, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, elevation: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amount: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  category: { fontSize: 13, color: '#64748B', marginTop: 4, textTransform: 'capitalize' },
  note: { fontSize: 13, color: '#334155', marginTop: 4 },
  date: { fontSize: 11.5, color: '#94A3B8', marginTop: 6 },
  reasonBox: { backgroundColor: '#FEF2F2', borderRadius: 8, padding: 10, marginTop: 8 },
  reasonText: { fontSize: 12.5, color: '#991B1B' },
  empty: { color: '#94A3B8', textAlign: 'center', marginTop: 40 }
});
