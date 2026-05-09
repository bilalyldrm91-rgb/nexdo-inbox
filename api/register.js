import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password, fullname, orgname, sector, wsname } = req.body;

  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email,
    password,
    user_metadata: { full_name: fullname },
    email_confirm: true
  });
  if (authErr) return res.status(400).json({ error: authErr.message });

  const uid = authData.user.id;

  const { data: org, error: orgErr } = await sb.from('organizations')
    .insert({ name: orgname, owner_id: uid, plan: 'starter' })
    .select().single();
  if (orgErr) return res.status(400).json({ error: 'Organizasyon hatası: ' + orgErr.message });

  const { data: ws, error: wsErr } = await sb.from('workspaces')
    .insert({ org_id: org.id, name: wsname, sector })
    .select().single();
  if (wsErr) return res.status(400).json({ error: 'Şube hatası: ' + wsErr.message });

  await sb.from('members').insert({
    user_id: uid,
    workspace_id: ws.id,
    role: 'admin',
    status: 'active',
    force_password_change: false,
    activated_at: new Date().toISOString()
  });

  return res.status(200).json({ success: true });
}
