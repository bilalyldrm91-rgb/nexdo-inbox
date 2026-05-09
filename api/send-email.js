import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).end();

  const { conversation_id, body, workspace_id, sent_by } = req.body;
  if(!conversation_id || !body) return res.status(400).json({ error: 'Eksik bilgi.' });

  // Konuşmayı çek
  const { data: conv } = await sb.from('conversations')
    .select('contact_id, contact_name, channel_type')
    .eq('id', conversation_id)
    .single();

  if(!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

  // Kanal credentials çek
  const { data: channel } = await sb.from('channels')
    .select('credentials')
    .eq('workspace_id', workspace_id)
    .eq('type', 'email')
    .eq('active', true)
    .single();

  if(!channel) return res.status(404).json({ error: 'Email kanalı bulunamadı.' });

  const { email, password, host, port } = channel.credentials;

  // SMTP ile gönder
  const transporter = nodemailer.createTransport({
    host: host || 'smtp.gmail.com',
    port: parseInt(port) || 587,
    secure: false,
    auth: { user: email, pass: password }
  });

  try {
    await transporter.sendMail({
      from: email,
      to: conv.contact_id,
      subject: 'Re: Nexdo Inbox',
      text: body
    });

    // Mesajı Supabase'e kaydet
    await sb.from('messages').insert({
      conversation_id,
      sent_by,
      body,
      direction: 'outbound',
      channel_type: 'email',
      created_at: new Date().toISOString()
    });

    await sb.from('conversations').update({
      last_message_at: new Date().toISOString()
    }).eq('id', conversation_id);

    return res.status(200).json({ success: true });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
