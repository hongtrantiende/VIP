const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function run() {
  const env = fs.readFileSync('.env.local', 'utf8');
  const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/);
  const keyMatch = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/);
  
  if (urlMatch && keyMatch) {
    const supabase = createClient(urlMatch[1].trim(), keyMatch[1].trim());
    const { data, error } = await supabase.from('model_leases').insert({
          id: "test",
          user_id: "00000000-0000-0000-0000-000000000000",
          email: "test@test.com",
          last_active_at: new Date().toISOString()
    });
    console.log("Insert Error:", error);
  }
}
run();
