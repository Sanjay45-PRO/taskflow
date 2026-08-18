import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabaseClient';

const CATEGORIES = ['travel', 'food', 'accommodation', 'other'];

export default function ExpenseScreen({ navigation }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('travel');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access is required.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled) setPhoto(result.assets[0]);
  }

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Photo library access is required.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled) setPhoto(result.assets[0]);
  }

  async function submit() {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      Alert.alert('Missing amount', 'Enter a valid claim amount.');
      return;
    }
    setBusy(true);
    const session = JSON.parse((await AsyncStorage.getItem('taskflow-session')) || 'null');
    if (!session) { navigation.replace('Login'); return; }

    let receiptUrl = null;
    if (photo) {
      try {
        const fileExt = photo.uri.split('.').pop();
        const path = `${session.team}/${session.name}-${Date.now()}.${fileExt}`;
        const base64 = await FileSystem.readAsStringAsync(photo.uri, { encoding: FileSystem.EncodingType.Base64 });
        const arrayBuffer = decode(base64);
        const { error: uploadError } = await supabase.storage.from('receipts').upload(path, arrayBuffer, {
          contentType: photo.mimeType || 'image/jpeg'
        });
        if (uploadError) {
          setBusy(false);
          Alert.alert(
            'Photo upload failed',
            `The claim was not submitted so the photo isn't lost. Try again, or submit without a photo.\n\n(${uploadError.message || 'unknown error'})`
          );
          return;
        }
        const { data } = supabase.storage.from('receipts').getPublicUrl(path);
        receiptUrl = data.publicUrl;
      } catch (e) {
        setBusy(false);
        Alert.alert('Photo upload failed', 'Could not read or upload the photo. Try again, or submit without a photo.');
        return;
      }
    }

    const { error } = await supabase.from('expense_claims').insert({
      team: session.team,
      employee_name: session.name,
      amount: Number(amount),
      category,
      note: note.trim() || null,
      receipt_url: receiptUrl,
      status: 'pending'
    });

    setBusy(false);
    if (error) { Alert.alert('Error', 'Could not submit claim.'); return; }

    Alert.alert('Submitted', 'Your claim is pending manager approval.', [
      { text: 'OK', onPress: () => navigation.goBack() }
    ]);
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 20, paddingTop: 60 }}>
      <Text style={styles.title}>Submit Expense</Text>

      <Text style={styles.label}>Amount (₹)</Text>
      <TextInput style={styles.input} keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="0.00" />

      <Text style={styles.label}>Category</Text>
      <View style={styles.catRow}>
        {CATEGORIES.map(c => (
          <TouchableOpacity key={c} style={[styles.catChip, category === c && styles.catChipActive]} onPress={() => setCategory(c)}>
            <Text style={[styles.catChipText, category === c && styles.catChipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Note</Text>
      <TextInput style={[styles.input, { height: 80 }]} value={note} onChangeText={setNote} multiline placeholder="What was this for?" />

      <Text style={styles.label}>Receipt photo</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <TouchableOpacity style={[styles.photoBtn, { flex: 1 }]} onPress={takePhoto}>
          <Text style={styles.photoBtnText}>Take photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.photoBtn, { flex: 1 }]} onPress={pickFromGallery}>
          <Text style={styles.photoBtnText}>Choose from gallery</Text>
        </TouchableOpacity>
      </View>
      {photo && <Image source={{ uri: photo.uri }} style={styles.preview} />}

      <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit for approval</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 20, fontWeight: '700', color: '#0F172A', marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#64748B', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0' },
  catChipActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  catChipText: { fontSize: 12, color: '#64748B', textTransform: 'capitalize' },
  catChipTextActive: { color: '#fff', fontWeight: '600' },
  photoBtn: { backgroundColor: '#EEF2FF', borderRadius: 10, padding: 14, alignItems: 'center' },
  photoBtnText: { color: '#2563EB', fontWeight: '600', fontSize: 13 },
  preview: { width: '100%', height: 180, borderRadius: 10, marginTop: 10 },
  submitBtn: { backgroundColor: '#2563EB', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 }
});
