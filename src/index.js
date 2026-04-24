// Worker entrypoint for cachecow.io
// - Serves static assets (index.html, contact.html, images, fonts) via ASSETS binding.
// - Handles POST /api/contact: transcribes via Workers AI Whisper, relays to vault@cachecow.io via Resend.
//
// One-time setup (Cloudflare dashboard → Workers & Pages → cachecow → Settings):
//   1. Bindings → AI is declared in wrangler.jsonc (env.AI).
//   2. Secrets → add RESEND_API_KEY (or: `npx wrangler secret put RESEND_API_KEY`).
//   3. Resend (resend.com) → verify cachecow.io, add the SPF/DKIM DNS records they give you.

const FROM  = 'CacheCow Contact <contact@cachecow.io>';
const TO    = 'vault@cachecow.io';
const MODEL = '@cf/openai/whisper';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      return handleContact(request, env);
    }

    if (url.pathname === '/api/transcribe') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      return handleTranscribe(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleTranscribe(request, env) {
  try {
    const form = await request.formData();
    const audio = form.get('attachment');
    if (!(audio instanceof File)) return json({ ok: false, error: 'Missing audio' }, 400);
    if (!env.AI) return json({ ok: false, error: 'Transcription not available' }, 500);

    const buf = await audio.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const result = await env.AI.run(MODEL, { audio: Array.from(bytes) });
    const transcript = (result?.text || '').trim();

    return json({ ok: true, transcript });
  } catch (err) {
    console.error('transcribe error:', err);
    return json({ ok: false, error: 'Transcription failed' }, 500);
  }
}

async function handleContact(request, env) {
  try {
    const form = await request.formData();
    const name    = (form.get('name')    || '').toString().trim();
    const email   = (form.get('email')   || '').toString().trim();
    const message = (form.get('message') || '').toString().trim();
    const kind    = (form.get('kind')    || 'email').toString();
    const audio   = form.get('attachment');

    if (!name || !email) return json({ ok: false, error: 'Missing name or email' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Invalid email' }, 400);
    if (kind === 'voicemail' && !(audio instanceof File)) return json({ ok: false, error: 'Missing audio' }, 400);
    if (kind === 'email' && !message && !(audio instanceof File)) return json({ ok: false, error: 'Empty message' }, 400);

    let transcript = '';
    let attachments = [];

    if (audio instanceof File) {
      const buf = await audio.arrayBuffer();
      const bytes = new Uint8Array(buf);

      if (env.AI) {
        try {
          const result = await env.AI.run(MODEL, { audio: Array.from(bytes) });
          transcript = (result?.text || '').trim();
        } catch (e) {
          console.warn('transcription failed:', e?.message || e);
        }
      }

      attachments.push({
        filename: audio.name || `voicemail-${Date.now()}.webm`,
        content: toBase64(bytes),
        content_type: audio.type || 'audio/webm',
      });
    }

    if (!env.RESEND_API_KEY) {
      return json({ ok: false, error: 'Mail service not configured' }, 500);
    }

    const subject = kind === 'voicemail' ? `Voicemail from ${name}` : `Message from ${name}`;
    const payload = {
      from: FROM,
      to: [TO],
      reply_to: email,
      subject,
      text: plainBody({ name, email, kind, message, transcript }),
      html: htmlBody({ name, email, kind, message, transcript, hasAudio: attachments.length > 0 }),
      attachments,
    };

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('resend error', res.status, err);
      return json({ ok: false, error: 'Email send failed' }, 502);
    }

    return json({ ok: true, transcript });
  } catch (err) {
    console.error('contact handler error:', err);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

function plainBody({ name, email, kind, message, transcript }) {
  const parts = [`From: ${name} <${email}>`, `Type: ${kind}`, ''];
  if (message)    parts.push('Message (typed):',   message, '');
  if (transcript) parts.push('Transcript (auto):', transcript, '');
  return parts.join('\n');
}

function htmlBody({ name, email, kind, message, transcript, hasAudio }) {
  return `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;color:#111">
  <p><strong>From:</strong> ${esc(name)} &lt;<a href="mailto:${esc(email)}">${esc(email)}</a>&gt;</p>
  <p><strong>Type:</strong> ${esc(kind)}</p>
  ${message    ? `<h3 style="margin-top:24px">Message</h3><p style="white-space:pre-wrap">${esc(message)}</p>` : ''}
  ${transcript ? `<h3 style="margin-top:24px">Auto-transcript</h3><p style="white-space:pre-wrap;color:#555">${esc(transcript)}</p>` : ''}
  ${hasAudio   ? `<p style="color:#999;font-size:12px;margin-top:24px">Recording attached.</p>` : ''}
</div>`;
}

function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
