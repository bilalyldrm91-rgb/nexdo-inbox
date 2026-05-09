import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).end();
  const { name, sector, org_id, user_id } = req.body;
  if(!name || !org_id) return res.status(400).json({ error: 'Ad ve organizasyon gerekli.' });

  const { data: ws, error } = await sb.from('workspaces')
    .insert({ name, sector: sector||null, org_id })
    .select().single();
  if(error) return res.status(400).json({ error: error.message });

  await sb.from('members').insert({
    user_id, workspace_id: ws.id, role: 'admin',
    status: 'active', force_password_change: false,
    activated_at: new Date().toISOString()
  });

  return res.status(200).json({ success: true, workspace: ws });
}
