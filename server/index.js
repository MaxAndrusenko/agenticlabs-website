'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Resend } = require('resend');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO = process.env.CONTACT_TO_EMAIL;
const CONTACT_FROM = process.env.CONTACT_FROM_EMAIL || 'onboarding@resend.dev';
const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';

// Contact abuse controls (in-memory; fine for a single Node process behind Nginx).
const RATE_LIMIT_MAX = Number(process.env.CONTACT_RATE_LIMIT_MAX) || 5;
const RATE_LIMIT_WINDOW_MS = Number(process.env.CONTACT_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000;
const USED_TOKEN_TTL_MS = Number(process.env.CONTACT_TOKEN_TTL_MS) || 10 * 60 * 1000;

const apiKeyReady = Boolean(RESEND_API_KEY) && RESEND_API_KEY !== 're_xxxxxxxxx';
const recaptchaReady = Boolean(RECAPTCHA_SITE_KEY && RECAPTCHA_SECRET_KEY);

if (!apiKeyReady) {
  console.warn(
    '[contact API] Set RESEND_API_KEY in .env to your real Resend key (replace re_xxxxxxxxx).'
  );
}
if (!recaptchaReady) {
  console.warn(
    '[contact API] Set RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY in .env to enable reCAPTCHA.'
  );
}

const resend = apiKeyReady ? new Resend(RESEND_API_KEY) : null;
const app = express();

// So req.ip is the real client when Nginx proxies /api/.
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

/** @type {Map<string, { count: number, resetAt: number }>} */
const rateByIp = new Map();
/** @type {Map<string, number>} tokenHash -> expiresAt */
const usedTokens = new Map();

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function safeJoin(root, requestPath) {
  const resolved = path.resolve(root, '.' + requestPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function pruneMaps(now) {
  for (const [ip, entry] of rateByIp) {
    if (entry.resetAt <= now) { rateByIp.delete(ip); }
  }
  for (const [hash, expiresAt] of usedTokens) {
    if (expiresAt <= now) { usedTokens.delete(hash); }
  }
}

function checkRateLimit(ip) {
  const now = Date.now();
  pruneMaps(now);

  let entry = rateByIp.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateByIp.set(ip, entry);
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  entry.count += 1;
  return { ok: true, remaining: RATE_LIMIT_MAX - entry.count };
}

function consumeToken(token) {
  const now = Date.now();
  const hash = hashToken(token);
  const existing = usedTokens.get(hash);
  if (existing && existing > now) {
    return { ok: false, error: 'token-reuse' };
  }
  usedTokens.set(hash, now + USED_TOKEN_TTL_MS);
  return { ok: true };
}

async function verifyRecaptcha(token, remoteip) {
  if (!recaptchaReady) {
    return { ok: false, error: 'recaptcha-not-configured' };
  }
  if (!token) {
    return { ok: false, error: 'missing-token' };
  }

  const body = new URLSearchParams();
  body.set('secret', RECAPTCHA_SECRET_KEY);
  body.set('response', token);
  if (remoteip) { body.set('remoteip', remoteip); }

  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await response.json();
  return { ok: Boolean(data && data.success), data: data };
}

app.get('/api/health', function (_req, res) {
  res.json({
    ok: true,
    emailConfigured: Boolean(resend),
    recaptchaConfigured: recaptchaReady
  });
});

app.get('/api/public-config', function (_req, res) {
  res.json({
    recaptchaSiteKey: recaptchaReady ? RECAPTCHA_SITE_KEY : ''
  });
});

app.post('/api/contact', async function (req, res) {
  if (!resend) {
    return res.status(503).json({
      error: 'Email service is not configured. Set RESEND_API_KEY in .env.'
    });
  }
  if (!recaptchaReady) {
    return res.status(503).json({
      error: 'reCAPTCHA is not configured.'
    });
  }

  const ip = clientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    res.set('Retry-After', String(rate.retryAfterSec));
    return res.status(429).json({
      error: 'Too many requests. Please try again later.'
    });
  }

  const body = req.body || {};
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const company = String(body.company || '').trim();
  const details = String(body.details || '').trim();
  const recaptchaToken = String(body.recaptchaToken || '').trim();
  // Honeypot: real users leave this empty; bots often fill it.
  const honeypot = String(body.website || body.companyUrl || '').trim();

  if (honeypot) {
    // Fake success so scrapers do not learn the trap.
    return res.status(200).json({ ok: true });
  }

  if (!name || !email || !company || !details) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!isEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  if (name.length > 200 || email.length > 254 || company.length > 200 || details.length > 5000) {
    return res.status(400).json({ error: 'Field too long.' });
  }

  // Reject replay before calling Google (test keys do not invalidate tokens).
  const consumed = consumeToken(recaptchaToken);
  if (!consumed.ok) {
    return res.status(400).json({
      error: 'reCAPTCHA token already used. Please complete the captcha again.'
    });
  }

  try {
    const captcha = await verifyRecaptcha(recaptchaToken, ip);
    if (!captcha.ok) {
      // Allow a fresh attempt with a new token (drop the bad mark).
      usedTokens.delete(hashToken(recaptchaToken));
      return res.status(400).json({ error: 'reCAPTCHA verification failed.' });
    }
  } catch (err) {
    usedTokens.delete(hashToken(recaptchaToken));
    console.error('[contact API] reCAPTCHA verify error:', err);
    return res.status(502).json({ error: 'reCAPTCHA verification unavailable.' });
  }

  const subject = 'New contact from ' + name + ' — ' + company;

  const html =
    '<h2>New contact form submission</h2>' +
    '<p><strong>Name:</strong> ' + escapeHtml(name) + '</p>' +
    '<p><strong>Email:</strong> ' + escapeHtml(email) + '</p>' +
    '<p><strong>Company:</strong> ' + escapeHtml(company) + '</p>' +
    '<p><strong>Project details:</strong></p>' +
    '<p>' + escapeHtml(details).replace(/\n/g, '<br>') + '</p>';

  try {
    const { data, error } = await resend.emails.send({
      from: CONTACT_FROM,
      to: CONTACT_TO,
      replyTo: email,
      subject: subject,
      html: html
    });

    if (error) {
      console.error('[contact API] Resend error:', error);
      return res.status(502).json({ error: 'Failed to send email.' });
    }

    return res.status(200).json({ ok: true, id: data && data.id });
  } catch (err) {
    console.error('[contact API] Unexpected error:', err);
    return res.status(500).json({ error: 'Unexpected server error.' });
  }
});

// Match Nginx try_files: $uri.html $uri $uri/ — prefer sibling .html over a
// same-named directory (e.g. /case-studies → case-studies.html, not case-studies/).
app.use(function preferHtmlOverDir(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { return next(); }

  var pathname = req.path || '/';
  if (pathname !== '/' && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  if (!pathname || pathname === '/' || path.extname(pathname)) {
    return next();
  }

  var htmlFile = safeJoin(ROOT, pathname + '.html');
  if (htmlFile && fs.existsSync(htmlFile) && fs.statSync(htmlFile).isFile()) {
    return res.sendFile(htmlFile);
  }

  return next();
});

app.use(express.static(ROOT, {
  extensions: ['html'],
  index: ['index.html'],
  redirect: false
}));

app.use(function (_req, res) {
  var notFound = path.join(ROOT, '404.html');
  if (fs.existsSync(notFound)) {
    return res.status(404).sendFile(notFound);
  }
  return res.status(404).send('Not found');
});

app.listen(PORT, function () {
  console.log('Site + contact API at http://localhost:' + PORT);
  console.log('Contact form: http://localhost:' + PORT + '/contact');
  console.log(
    'Contact rate limit: ' + RATE_LIMIT_MAX + ' requests / ' +
    Math.round(RATE_LIMIT_WINDOW_MS / 60000) + ' min per IP'
  );
});
