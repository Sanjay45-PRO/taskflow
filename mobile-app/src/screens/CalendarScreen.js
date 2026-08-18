import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, TextInput, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabaseClient';

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export default function CalendarScreen() {
  const [session, setSession] = useState(null);
  const [attendance, setAttendance] = useState({});
  const [onduty, setOnduty] = useState({});
  const [modalDate, setModalDate] = useState(null);
  const [reason, setReason] = useState('');

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const load = useCallback(async () => {
    const s = JSON.parse((await AsyncStorage.getItem('taskflow-session')) || 'null');
    if (!s) return;
    setSession(s);

    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${daysInMonth(year, month)}`;

    const { data: att } = await supabase
      .from('attendance').select('work_date, check_in_at')
      .eq('team', s.team).eq('employee_name', s.name)
      .gte('work_date', startDate).lte('work_date', endDate);
    const attMap = {};
    (att || []).forEach(a => { attMap[a.work_date] = !!a.check_in_at; });
    setAttendance(attMap);

    const { data: od } = await supabase
      .from('onduty_requests').select('request_date, status')
      .eq('team', s.team).eq('employee_name', s.name)
      .gte('request_date', startDate).lte('request_date', endDate);
    const odMap = {};
    (od || []).forEach(o => { odMap[o.request_date] = o.status; });
    setOnduty(odMap);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  function dateStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function statusFor(day) {
    const ds = dateStr(day);
    const today = new Date(); today.setHours(0,0,0,0);
    const cellDate = new Date(year, month, day);
    if (cellDate > today) return 'future';
    if (attendance[ds]) return 'present';
    if (onduty[ds] === 'approved') return 'onduty';
    if (onduty[ds] === 'pending') return 'onduty-pending';
    return 'absent';
  }

  async function submitOnDuty() {
    if (!reason.trim()) { Alert.alert('Reason needed', 'Enter a reason for the on-duty request.'); return; }
    const { error } = await supabase.from('onduty_requests').upsert({
      team: session.team, employee_name: session.name,
      request_date: modalDate, reason: reason.trim(), status: 'pending'
    }, { onConflict: 'team,employee_name,request_date' });
    if (error) { Alert.alert('Error', 'Could not submit request.'); return; }
    setModalDate(null); setReason('');
    load();
    Alert.alert('Submitted', 'On-duty request sent for manager approval.');
  }

  const colors = { present: '#16A34A', absent: '#DC2626', onduty: '#2563EB', 'onduty-pending': '#F59E0B', future: '#E2E8F0' };
  const labels = { present: 'Present', absent: 'Absent', onduty: 'On-duty', 'onduty-pending': 'On-duty (pending)', future: '' };

  const total = daysInMonth(year, month);
  const days = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 20, paddingTop: 60, paddingBottom: 40 }}>
      <Text style={styles.title}>My Calendar</Text>
      <Text style={styles.sub}>{now.toLocaleString('default', { month: 'long', year: 'numeric' })}</Text>

      <View style={styles.legend}>
        {['present','absent','onduty','onduty-pending'].map(k => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors[k] }]} />
            <Text style={styles.legendText}>{labels[k]}</Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map(day => {
          const st = statusFor(day);
          return (
            <TouchableOpacity
              key={day}
              style={[styles.cell, { backgroundColor: st === 'future' ? '#F1F5F9' : colors[st] }]}
              disabled={st === 'future' || st === 'present' || st === 'onduty' || st === 'onduty-pending'}
              onPress={() => setModalDate(dateStr(day))}
            >
              <Text style={[styles.cellText, st !== 'future' && { color: '#fff' }]}>{day}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>Tap an absent day to request on-duty.</Text>

      <Modal visible={!!modalDate} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Request on-duty for {modalDate}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Reason (e.g. client visit, workshop)"
              value={reason}
              onChangeText={setReason}
              multiline
            />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setModalDate(null); setReason(''); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSubmit} onPress={submitOnDuty}>
                <Text style={styles.modalSubmitText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 20, fontWeight: '700', color: '#0F172A' },
  sub: { fontSize: 14, color: '#64748B', marginBottom: 16 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: '#64748B' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: 42, height: 42, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  cellText: { fontSize: 13, fontWeight: '600', color: '#475569' },
  hint: { fontSize: 12, color: '#94A3B8', marginTop: 14 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 12 },
  modalInput: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 12, minHeight: 70, fontSize: 14, marginBottom: 16 },
  modalRow: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#F1F5F9' },
  modalCancelText: { color: '#64748B', fontWeight: '600' },
  modalSubmit: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', backgroundColor: '#2563EB' },
  modalSubmitText: { color: '#fff', fontWeight: '700' }
});
