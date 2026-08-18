import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabaseClient';

export default function TaskDetailScreen({ route, navigation }) {
  const { task } = route.params;
  const [report, setReport] = useState('');
  const [attachment, setAttachment] = useState(null); // { uri, name, mimeType, kind: 'image' | 'file' }
  const [busy, setBusy] = useState(false);

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access is required.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled) {
      const a = result.assets[0];
      setAttachment({ uri: a.uri, name: `photo-${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg', kind: 'image' });
    }
  }

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Photo library access is required.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled) {
      const a = result.assets[0];
      setAttachment({ uri: a.uri, name: `photo-${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg', kind: 'image' });
    }
  }

  async function pickExcelFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const a = result.assets[0];
    setAttachment({ uri: a.uri, name: a.name, mimeType: a.mimeType || 'application/vnd.ms-excel', kind: 'file' });
  }

  async function markDone() {
    setBusy(true);
    try {
      let attachmentUrl = null;
      let attachmentName = null;

      if (attachment) {
        try {
          const path = `${task.team}/${task.id}-${Date.now()}-${attachment.name}`;
          const base64 = await FileSystem.readAsStringAsync(attachment.uri, { encoding: FileSystem.EncodingType.Base64 });
          const arrayBuffer = decode(base64);
          const { error: uploadError } = await supabase.storage
            .from('task-attachments')
            .upload(path, arrayBuffer, { contentType: attachment.mimeType });
          if (uploadError) {
            setBusy(false);
            Alert.alert(
              'Attachment upload failed',
              `The task was not marked done so nothing is lost. Try again, or remove the attachment and submit without it.\n\n(${uploadError.message || 'unknown error'})`
            );
            return;
          }
          const { data } = supabase.storage.from('task-attachments').getPublicUrl(path);
          attachmentUrl = data.publicUrl;
          attachmentName = attachment.name;
        } catch (e) {
          setBusy(false);
          Alert.alert('Attachment upload failed', 'Could not read or upload the file. Try again, or remove the attachment and submit without it.');
          return;
        }
      }

      const { error } = await supabase.from('tasks').update({
        status: 'done',
        completed_at: new Date().toISOString(),
        report: report.trim() || null,
        report_attachment_url: attachmentUrl,
        report_attachment_name: attachmentName,
      }).eq('id', task.id);

      if (error) { Alert.alert('Error', 'Could not mark this task done.'); setBusy(false); return; }

      Alert.alert('Task completed', 'Marked as done — your manager can see this update right away.', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (e) {
      Alert.alert('Error', e.message || 'Something went wrong.');
    }
    setBusy(false);
  }

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={styles.title}>{task.title}</Text>
      {task.due ? <Text style={styles.due}>Due {task.due}</Text> : null}
      {task.description ? <Text style={styles.desc}>{task.description}</Text> : null}

      <Text style={styles.label}>Completion report</Text>
      <TextInput
        style={styles.textarea}
        value={report}
        onChangeText={setReport}
        placeholder="Describe what you completed…"
        multiline
      />

      <Text style={styles.label}>Attach a file (optional)</Text>
      <Text style={styles.hint}>Photo of finished work, or an Excel report — whichever fits.</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <TouchableOpacity style={[styles.attachBtn, { flex: 1 }]} onPress={takePhoto}>
          <Text style={styles.attachBtnText}>Take photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.attachBtn, { flex: 1 }]} onPress={pickFromGallery}>
          <Text style={styles.attachBtnText}>Gallery</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.attachBtnFull} onPress={pickExcelFile}>
        <Text style={styles.attachBtnText}>Attach Excel file</Text>
      </TouchableOpacity>

      {attachment && attachment.kind === 'image' && (
        <Image source={{ uri: attachment.uri }} style={styles.preview} />
      )}
      {attachment && attachment.kind === 'file' && (
        <View style={styles.filePill}>
          <Text style={styles.filePillText}>{attachment.name}</Text>
          <TouchableOpacity onPress={() => setAttachment(null)}><Text style={styles.filePillRemove}>Remove</Text></TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.doneBtn} onPress={markDone} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.doneBtnText}>Mark task done</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 20, fontWeight: '700', color: '#0F172A', marginTop: 10 },
  due: { fontSize: 13, color: '#64748B', marginTop: 4 },
  desc: { fontSize: 14, color: '#334155', marginTop: 10, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#64748B', marginBottom: 4, marginTop: 20 },
  hint: { fontSize: 12, color: '#94A3B8', marginBottom: 4 },
  textarea: { backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0', minHeight: 90, textAlignVertical: 'top' },
  attachBtn: { backgroundColor: '#EEF2FF', borderRadius: 10, padding: 14, alignItems: 'center' },
  attachBtnFull: { backgroundColor: '#EEF2FF', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 10 },
  attachBtnText: { color: '#2563EB', fontWeight: '600', fontSize: 13 },
  preview: { width: '100%', height: 180, borderRadius: 10, marginTop: 12 },
  filePill: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 12, marginTop: 12 },
  filePillText: { fontSize: 13, color: '#0F172A', flex: 1 },
  filePillRemove: { fontSize: 12, color: '#DC2626', fontWeight: '600' },
  doneBtn: { backgroundColor: '#16A34A', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 28 },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 }
});
