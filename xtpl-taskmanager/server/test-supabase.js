import './loadEnv.js';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

(async () => {
  if (!url || !key) {
    console.log("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    return;
  }

  const headers = { apikey: key };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // legacy keys only

  const res = await fetch(`${url}/rest/v1/chat_messages?select=*&limit=1`, { headers });
  console.log("Status:", res.status);
  console.log("Response:", await res.text());
})();