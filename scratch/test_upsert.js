const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

async function run() {
  const env = fs.readFileSync(".env.local", "utf8");
  const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
  const keyMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);

  if (!urlMatch || !keyMatch) {
    console.error("Missing credentials in .env.local");
    return;
  }

  const supabaseUrl = urlMatch[1].trim();
  const serviceRoleKey = keyMatch[1].trim();

  const adminDb = createClient(supabaseUrl, serviceRoleKey);

  console.log("Testing upsert...");
  const { data, error } = await adminDb
    .from("app_settings")
    .upsert({ key: "admin_proxy_url", value: "https://gcli.ggchan.dev/" }, { onConflict: "key" })
    .select();

  if (error) {
    console.error("Upsert failed:", error);
  } else {
    console.log("Upsert succeeded:", data);
  }
}

run();
