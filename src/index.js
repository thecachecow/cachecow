// Worker entrypoint for cachecow.io
// - Serves static assets (index.html, contact.html, images, fonts) via ASSETS binding.
// - Handles POST /api/contact: transcribes via Workers AI Whisper, relays to vault@cachecow.io via Resend.
// - Password-gates specific paths (see GATED below).
//
// One-time setup (Cloudflare dashboard → Workers & Pages → cachecow → Settings):
//   1. Bindings → AI is declared in wrangler.jsonc (env.AI).
//   2. Secrets → add RESEND_API_KEY (or: `npx wrangler secret put RESEND_API_KEY`).
//   3. Resend (resend.com) → verify cachecow.io, add the SPF/DKIM DNS records they give you.

const FROM  = 'CacheCow Contact <contact@cachecow.io>';
const TO    = 'vault@cachecow.io';
const MODEL = '@cf/openai/whisper';

// ── Password-gated paths (Frosted Gate pattern) ─────────────────────────────
const GATED = [
  {
    paths:    ['/shadow-pitch-v1', '/shadow-pitch-v1.html'],
    pass:     'theshadow',
    cookie:   'cc_sp1',
    cookieVal:'ok_v1',
    cookieDays: 2,
    title:    'Angel Round',
    titleEm:  'Shadow Pitch',
    subtitle: 'This deck is private. Enter your access code to continue.',
    footer:   'Confidential · ForcedField Technologies · 2026',
    blobA:    '#c0912d',
    blobB:    '#2A5C3F',
  },
];

function getCookie(header, name) {
  if (!header) return null;
  const match = (header || '').split(';').find(c => c.trim().startsWith(name + '='));
  return match ? match.trim().slice(name.length + 1) : null;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function frostedGate(back, failed, cfg) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CacheCow — ${escHtml(cfg.title)} ${escHtml(cfg.titleEm)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#1a1a18;--ink2:#5a5a56;--ink3:#9a9a94;--bg:#f5f4f0;--border:rgba(26,26,24,0.14);--gold:#c0912d}
@media(prefers-color-scheme:dark){:root{--ink:#f0efe8;--ink2:#a8a89e;--ink3:#6a6a62;--bg:#1a1a18;--border:rgba(240,239,232,0.12)}}
html,body{height:100%;font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased}
.scene{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.sl{position:absolute;background:var(--border)}
.sl.h{left:0;right:0;height:.5px}
.sl.v{top:0;bottom:0;width:.5px}
.blob{position:absolute;border-radius:50%;filter:blur(80px);opacity:.18}
.wrap{position:relative;z-index:10;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
.card{width:100%;max-width:420px;background:rgba(245,244,240,.72);border:.5px solid var(--border);border-radius:16px;padding:2.75rem 2.5rem 2.25rem;backdrop-filter:blur(24px) saturate(1.4);-webkit-backdrop-filter:blur(24px) saturate(1.4);box-shadow:0 2px 32px rgba(26,26,24,.08),0 0 0 .5px rgba(26,26,24,.06)}
@media(prefers-color-scheme:dark){.card{background:rgba(26,26,24,.72);box-shadow:0 2px 32px rgba(0,0,0,.4),0 0 0 .5px rgba(240,239,232,.08)}}
.brand{font-family:'Playfair Display',Georgia,serif;font-size:13px;font-weight:600;letter-spacing:.08em;color:var(--ink3);text-transform:uppercase;margin-bottom:1.5rem}
h1{font-family:'Playfair Display',Georgia,serif;font-size:1.85rem;font-weight:600;line-height:1.2;margin-bottom:.5rem}
h1 em{font-style:italic;color:var(--ink2)}
.sub{font-size:14px;color:var(--ink2);line-height:1.7;margin-bottom:2rem}
.err{font-size:13px;color:#c0392b;background:rgba(192,57,43,.08);border:.5px solid rgba(192,57,43,.2);border-radius:6px;padding:8px 12px;margin-bottom:1rem}
@media(prefers-color-scheme:dark){.err{color:#e07b72;background:rgba(192,57,43,.15)}}
form{display:flex;flex-direction:column;gap:12px}
input[type=password]{width:100%;padding:12px 14px;font-family:'DM Sans',sans-serif;font-size:15px;color:var(--ink);background:var(--bg);border:.5px solid var(--border);border-radius:8px;outline:none;transition:border-color .2s,box-shadow .2s;letter-spacing:.1em}
input[type=password]::placeholder{color:var(--ink3);letter-spacing:normal}
input[type=password]:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(192,145,45,.12)}
button{width:100%;padding:12px 14px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;letter-spacing:.04em;color:var(--bg);background:var(--ink);border:none;border-radius:8px;cursor:pointer;transition:opacity .2s}
button:hover{opacity:.82}
.foot{margin-top:1.75rem;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);text-align:center}
</style>
</head>
<body>
<div class="scene" aria-hidden="true">
  <div class="sl h" style="top:18%"></div><div class="sl h" style="top:42%"></div>
  <div class="sl h" style="top:67%"></div><div class="sl h" style="top:84%"></div>
  <div class="sl v" style="left:22%"></div><div class="sl v" style="left:50%"></div><div class="sl v" style="left:78%"></div>
  <div class="blob" style="width:480px;height:480px;top:-10%;left:-8%;background:${escHtml(cfg.blobA)}"></div>
  <div class="blob" style="width:360px;height:360px;bottom:-5%;right:-5%;background:${escHtml(cfg.blobB)}"></div>
</div>
<div class="wrap">
  <div class="card">
    <p class="brand">CacheCow / ForcedField Technologies</p>
    <h1>${escHtml(cfg.title)} <em>${escHtml(cfg.titleEm)}</em></h1>
    <p class="sub">${escHtml(cfg.subtitle)}</p>
    ${failed ? '<p class="err">Incorrect code — try again.</p>' : ''}
    <form method="POST" action="/__unlock">
      <input type="hidden" name="next" value="${escHtml(back)}">
      <input type="password" name="password" placeholder="Access code" autofocus autocomplete="off" spellcheck="false">
      <button type="submit">Unlock &rarr;</button>
    </form>
    <p class="foot">${escHtml(cfg.footer)}</p>
  </div>
</div>
<script>var _sc={idle:3000};</script>
<script src="https://iamkhayyam.github.io/spherical-cow/spherical-cow.js" data-config="_sc"></script>
</body>
</html>`;
  return new Response(html, { status: failed ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
// ───────────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── Frosted Gate: /__unlock POST ──────────────────────────
    if (request.method === 'POST' && url.pathname === '/__unlock') {
      const form = await request.formData().catch(() => null);
      const pw   = form ? (form.get('password') || '').toString().trim() : '';
      const back = form ? (form.get('next')     || '/').toString()       : '/';
      const cfg  = GATED.find(g => g.paths.some(p => back.startsWith(p)));
      if (cfg && pw === cfg.pass) {
        return new Response(null, {
          status: 303,
          headers: {
            Location: back,
            'Set-Cookie': `${cfg.cookie}=${cfg.cookieVal}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${cfg.cookieDays * 86400}`,
          },
        });
      }
      if (cfg) return frostedGate(back, true, cfg);
      return new Response('Not found', { status: 404 });
    }

    // ── Frosted Gate: check gated paths ───────────────────────
    const gatedCfg = GATED.find(g => g.paths.includes(url.pathname));
    if (gatedCfg) {
      const cookies = request.headers.get('Cookie') || '';
      const authed  = cookies.split(';').some(c => c.trim() === `${gatedCfg.cookie}=${gatedCfg.cookieVal}`);
      if (!authed) return frostedGate(url.pathname, false, gatedCfg);
    }

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
