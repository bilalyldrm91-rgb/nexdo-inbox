import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).end();

  const { conversation_id, body, workspace_id, sent_by, contact_name, contact_id } = req.body;
  if(!conversation_id || !body) return res.status(400).json({ error: 'Eksik bilgi.' });

  const { data: conv } = await sb.from('conversations')
    .select('contact_id, contact_name, channel_type, last_subject')
    .eq('id', conversation_id)
    .single();

  if(!conv) return res.status(404).json({ error: 'Konuşma bulunamadı.' });

  const { data: channel } = await sb.from('channels')
    .select('credentials')
    .eq('workspace_id', workspace_id)
    .eq('type', 'email')
    .eq('active', true)
    .single();

  if(!channel) return res.status(404).json({ error: 'Email kanalı bulunamadı.' });

  const { email, password, host, port } = channel.credentials;

  const transporter = nodemailer.createTransport({
    host: host || 'smtp.gmail.com',
    port: parseInt(port) || 587,
    secure: false,
    auth: { user: email, pass: password }
  });

  // Konu: orijinal konuyu koru, yoksa Re: oluştur
  const subject = conv.last_subject
    ? (conv.last_subject.startsWith('Re:') ? conv.last_subject : `Re: ${conv.last_subject}`)
    : `Re: Mesajınız`;

  // Gönderen adı olarak işletme mailine gönder
  const toAddress = conv.contact_id || contact_id;

  try {
    await transporter.sendMail({
      from: email, // sadece email adresi — kişisel isim değil
      to: toAddress,
      subject,
      text: body
    });

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
