# agenticlabs-website

Static marketing site for Agentic Labs, plus a small Express contact API that sends mail through [Resend](https://resend.com).

## Contact form (Resend + reCAPTCHA)

Clicking **Send message** on `/contact` verifies Google reCAPTCHA, then posts to `/api/contact`, which sends email via Resend.

1. Put keys in `.env` (copy from `.env.example`). Create **reCAPTCHA v2** (“I’m not a robot”) keys at [google.com/recaptcha/admin](https://www.google.com/recaptcha/admin) for `localhost` and your live domain, then set `RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY`. Do not use Google’s public test keys — those always show a “testing purposes only” banner.

```bash
cp .env.example .env
```

2. Start the site + API together:

```bash
npm install
npm start
```

3. Open [http://localhost:3000/contact](http://localhost:3000/contact), fill the form, complete the captcha, and submit.

Form submissions go to `CONTACT_TO_EMAIL`. In production, proxy `/api/` to this process (see `docs/DIGITALOCEAN_DEPLOYMENT.md`) and use a verified `CONTACT_FROM_EMAIL`.
