import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {

 // Webhook doğrulama
  if(req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if(mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }
  // Gelen mesajları işle
  if(req.method === 'POST') {
    const body = req.body;

    if(body.object !== 'whatsapp_business_account') {
      return res.status(400).end();
    }

    for(const entry of body.entry || []) {
      const wabaId = entry.id;

      // Bu WABA ID'ye ait workspace'i bul
      const { data: channels } = await sb.from('channels')
        .select('workspace_id, credentials')
        .eq('type', 'whatsapp')
        .eq('active', true);

      const channel = channels?.find(ch => ch.credentials?.account_id === wabaId);
      if(!channel) continue;

      for(const change of entry.changes || []) {
        const value = change.value;
        if(!value?.messages) continue;

        for(const msg of value.messages) {
          if(msg.type !== 'text') continue;

          const fromNumber = msg.from;
          const body = msg.text?.body || '';
          const messageId = msg.id;
          const contactName = value.contacts?.[0]?.profile?.name || fromNumber;

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
            .eq('contact_id', fromNumber)
            .eq('channel_type', 'whatsapp')
            .single();

          if(!conv) {
            const { data: newConv } = await sb.from('conversations').insert({
              workspace_id: channel.workspace_id,
              channel_type: 'whatsapp',
              status: 'open',
              contact_name: contactName,
              contact_id: fromNumber,
              last_message_at: new Date().toISOString()
            }).select().single();
            conv = newConv;
          } else {
            await sb.from('conversations')
              .update({ last_message_at: new Date().toISOString() })
              .eq('id', conv.id);
          }

          if(!conv) continue;

          // Mesajı kaydet
          await sb.from('messages').insert({
            conversation_id: conv.id,
            body,
            direction: 'inbound',
            channel_type: 'whatsapp',
            external_id: messageId,
            created_at: new Date().toISOString()
          });
        }
      }
    }

    return res.status(200).json({ status: 'ok' });
  }

  res.status(405).end();
}
