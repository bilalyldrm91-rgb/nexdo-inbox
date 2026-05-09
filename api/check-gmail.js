import { createClient } from '@supabase/supabase-js';
import Imap from 'imap';
import { simpleParser } from 'mailparser';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if(req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  // Tüm aktif email kanallarını çek
  const { data: channels, error } = await sb.from('channels')
    .select('id, workspace_id, credentials')
    .eq('type', 'email')
    .eq('active', true);

  if(error || !channels || channels.length === 0) {
    return res.status(200).json({ message: 'Aktif email kanalı bulunamadı.', count: 0 });
  }

  const days = req.query.days || 30;
  const since = new Date();
  since.setDate(since.getDate() - parseInt(days));
  const sinceStr = since.toDateString();

  let totalSaved = 0;
  const results = [];

  for(const channel of channels) {
    const { email, password } = channel.credentials || {};
    if(!email || !password) continue;

    try {
      const emails = await fetchEmails(email, password, sinceStr);
      let saved = 0;

      for(const mail of emails) {
        const fromEmail = mail.from?.value?.[0]?.address || 'unknown';
        const fromName = mail.from?.value?.[0]?.name || fromEmail;
        const subject = mail.subject || '(Konu yok)';
        const body = mail.text || '';
        const messageId = mail.messageId || `${Date.now()}-${Math.random()}`;

        // Daha önce kaydedilmiş mi?
        const { data: existing } = await sb.from('messages')
          .select('id')
          .eq('external_id', messageId)
          .single();
        if(existing) continue;

        // Conversation bul veya oluştur
        let { data: conv } = await sb.from('conversations')
          .select('id')
          .eq('workspace_id', channel.workspace_id)
          .eq('contact_id', fromEmail)
          .eq('channel_type', 'email')
          .single();

        if(!conv) {
          const { data: newConv } = await sb.from('conversations').insert({
            workspace_id: channel.workspace_id,
            channel_type: 'email',
            status: 'open',
            contact_name: fromName,
            contact_id: fromEmail,
            last_message_at: mail.date || new Date().toISOString()
          }).select().single();
          conv = newConv;
        } else {
          await sb.from('conversations')
            .update({ last_message_at: mail.date || new Date().toISOString() })
            .eq('id', conv.id);
        }

        if(!conv) continue;

        // Mesajı kaydet
        await sb.from('messages').insert({
          conversation_id: conv.id,
          body: `📧 Konu: ${subject}\n\n${body.slice(0, 2000)}`,
          direction: 'inbound',
          channel_type: 'email',
          external_id: messageId,
          created_at: mail.date || new Date().toISOString()
        });

        saved++;
      }

      totalSaved += saved;
      results.push({ workspace_id: channel.workspace_id, email, saved, total: emails.length });

    } catch(e) {
      results.push({ workspace_id: channel.workspace_id, email, error: e.message });
    }
  }

  return res.status(200).json({ success: true, totalSaved, results });
}

function fetchEmails(user, password, since) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user,
      password,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 5000
    });

    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if(err) { imap.end(); return reject(err); }

        imap.search(['ALL', ['SINCE', since]], (err, results) => {
          if(err || !results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          const toFetch = results.slice(-100);
          const fetch = imap.fetch(toFetch, { bodies: '' });
          const pending = [];

          fetch.on('message', (msg) => {
            let buffer = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => buffer += chunk.toString('utf8'));
              stream.once('end', () => {
                pending.push(simpleParser(buffer).catch(() => null));
              });
            });
          });

          fetch.once('error', reject);
          fetch.once('end', async () => {
            const parsed = await Promise.all(pending);
            parsed.forEach(m => { if(m) emails.push(m); });
            imap.end();
          });
        });
      });
    });

    imap.once('end', () => resolve(emails));
    imap.once('error', reject);
    imap.connect();
  });
}
