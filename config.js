/*
  Replace with your own Supabase project values.
  Get them from: Supabase dashboard -> Project Settings -> API
  (Project URL, and the "anon public" key — never use the service_role key here)
*/
const SUPABASE_URL = "https://yqdobywstnvakbcgkzqa.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxZG9ieXdzdG52YWtiY2drenFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjQ1OTYsImV4cCI6MjEwMDkwMDU5Nn0.YqBlDlyeLmlujaxYiYPaQE9EVQWiRduE0EE7JRJEY1w";

/*
  Same VAPID public key you generated for the task-reminder function
  (run `npx web-push generate-vapid-keys`, use the "Public Key" here).
*/
const VAPID_PUBLIC_KEY = "BBgVatPJ8rgchxO9osmb7kBYH7WuiPOAPi3h97I-CdkoX1-uS7PUnxXWqZtzwYHwDi9l60UqNmEsC1gOIdRQ-6k";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
