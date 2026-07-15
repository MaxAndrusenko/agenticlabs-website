# agenticlabs-website

Static marketing site for Agentic Labs, plus a small Express contact API that sends mail through [Resend](https://resend.com).

## Contact form (Resend)

Clicking **Send message** on `/contact` posts to `/api/contact`, which sends email via Resend.

1. Put your real API key in `.env` (replace `re_xxxxxxxxx`):

```bash
cp .env.example .env
```

2. Start the site + API together:

```bash
npm install
npm start
```

3. Open [http://localhost:3000/contact](http://localhost:3000/contact), fill the form, and submit.

Form submissions go to `CONTACT_TO_EMAIL` (default: `hello@agenticlabs.cloud`). In production, proxy `/api/` to this process (see `docs/DIGITALOCEAN_DEPLOYMENT.md`) and use a verified `CONTACT_FROM_EMAIL`.
