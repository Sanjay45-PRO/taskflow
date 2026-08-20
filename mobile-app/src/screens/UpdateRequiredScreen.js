import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';

export default function UpdateRequiredScreen({ apkUrl, notes }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Update Required</Text>
      <Text style={styles.sub}>
        A newer version of TaskFlow is available and this version can no longer be used.
        Please download and install the latest version to continue.
      </Text>
      {notes ? <Text style={styles.notes}>{notes}</Text> : null}
      <TouchableOpacity style={styles.btn} onPress={() => Linking.openURL(apkUrl)}>
        <Text style={styles.btnText}>Download Latest Version</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>
        After downloading, open the file to install. You may need to allow installs from this
        source in your phone's settings.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', padding: 28 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 14, textAlign: 'center' },
  sub: { color: '#CBD5E1', textAlign: 'center', fontSize: 15, lineHeight: 22, marginBottom: 14 },
  notes: { color: '#94A3B8', textAlign: 'center', fontSize: 13, marginBottom: 24, fontStyle: 'italic' },
  btn: { backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 15, paddingHorizontal: 28, marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { color: '#64748B', textAlign: 'center', fontSize: 12, marginTop: 20, lineHeight: 18 },
});
