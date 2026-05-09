import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password, fullname, orgname, sector, wsname } = req.body;

  if(!email || !password || !fullname || !orgname || !wsname) {
    return res.status(400).json({ error: 'Tüm alanlar gerekli.' });
  }

  // Kullanıcı oluştur — service role ile
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email,
    password,
    user_metadata: { full_name: fullname },
    email_confirm: true  // confirm email'i bypass et
  });

  if (authErr) {
    return res.status(400).json({ error: authErr.message });
  }

  const uid = authData.user.id;

  // Organization oluştur
  const { data: org, error: orgErr } = await sb
    .from('organizations')
    .insert({ name: orgname, owner_id: uid, plan: 'starter' })
    .select()
    .single();

  if (orgErr) {
    // Kullanıcıyı geri sil
    await sb.auth.admin.deleteUser(uid);
    return res.status(400).json({ error: 'Organizasyon hatası: ' + orgErr.message });
  }

  // Workspace oluştur
  const { data: ws, error: wsErr } = await sb
    .from('workspaces')
    .insert({ org_id: org.id, name: wsname, sector: sector || null })
    .select()
    .single();

  if (wsErr) {
    await sb.auth.admin.deleteUser(uid);
    return res.status(400).json({ error: 'Şube hatası: ' + wsErr.message });
  }

  // Admin olarak members'a ekle
  const { error: memErr } = await sb.from('members').insert({
    user_id: uid,
    workspace_id: ws.id,
    role: 'admin',
    status: 'active',
    force_password_change: false,
    activated_at: new Date().toISOString()
  });

  if (memErr) {
    await sb.auth.admin.deleteUser(uid);
    return res.status(400).json({ error: 'Üye hatası: ' + memErr.message });
  }

  return res.status(200).json({ success: true });
}
