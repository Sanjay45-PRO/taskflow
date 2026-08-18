import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Same project as the TaskFlow web dashboard — one shared database.
const SUPABASE_URL = 'https://yqdobywstnvakbcgkzqa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxZG9ieXdzdG52YWtiY2drenFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjQ1OTYsImV4cCI6MjEwMDkwMDU5Nn0.YqBlDlyeLmlujaxYiYPaQE9EVQWiRduE0EE7JRJEY1w';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});
