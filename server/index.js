'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Resend } = require('resend');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO = process.env.CONTACT_TO_EMAIL;
const CONTACT_FROM = process.env.CONTACT_FROM_EMAIL || 'onboarding@resend.dev';

const apiKeyReady = Boolean(RESEND_API_KEY) && RESEND_API_KEY !== 're_xxxxxxxxx';

if (!apiKeyReady) {
  console.warn(
    '[contact API] Set RESEND_API_KEY in .env to your real Resend key (replace re_xxxxxxxxx).'
  );
}

const resend = apiKeyReady ? new Resend(RESEND_API_KEY) : null;
const app = express();

app.use(express.json({ limit: '32kb' }));

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

app.get('/api/health', function (_req, res) {
  res.json({ ok: true, emailConfigured: Boolean(resend) });
});

app.post('/api/contact', async function (req, res) {
  if (!resend) {
    return res.status(503).json({
      error: 'Email service is not configured. Set RESEND_API_KEY in .env.'
    });
  }

  const body = req.body || {};
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const company = String(body.company || '').trim();
  const details = String(body.details || '').trim();

  if (!name || !email || !company || !details) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!isEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
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
});
