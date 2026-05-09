
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).end();
  const { email, role, workspace_id, invited_by } = req.body;
  if(!email || !workspace_id) return res.status(400).json({ error: 'E-posta ve workspace gerekli.' });

  const { data: authData, error: authErr } = await sb.auth.admin.inviteUserByEmail(email);
  if(authErr) return res.status(400).json({ error: authErr.message });

  const { error: memErr } = await sb.from('members').insert({
    user_id: authData.user.id,
    workspace_id,
    role: role || 'agent',
    status: 'pending',
    force_password_change: true,
    invited_by,
    invited_at: new Date().toISOString()
  });

  if(memErr) return res.status(400).json({ error: memErr.message });
  return res.status(200).json({ success: true });
}
