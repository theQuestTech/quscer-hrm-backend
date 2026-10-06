# Setting up Quscer People (HRM) staging on Railway

The same idea as the Quscer OS staging copy: same code, its own database, and the demo
company **Al-Noor Traders (Demo)** ready to show. Nothing done there emails a real
person (see [What staging blocks](#what-staging-blocks)).

You do this once. It's quicker than the Quscer OS one — about 30 minutes.

| | Live | Staging |
| --- | --- | --- |
| Railway environment | `production` | `staging` (already made for Quscer OS) |
| Database | live HRM Postgres | its own, new Postgres |
| Backend | your live HRM API | e.g. `quscer-hrm-backend-staging.up.railway.app` |
| App | hrm.quscer.com | e.g. `quscer-hrm-frontend-staging.vercel.app` |

> Before every change, glance at the Railway top bar and check it says **staging**.

---

## 1. Add the HRM services to staging

1. Open the Quscer project on Railway, switch the top bar to **staging**.
2. If staging doesn't have the HRM backend yet: **+ New** → **GitHub Repo** →
   `quscer-hrm-backend` (branch `main`).
3. **+ New** → **Database** → **PostgreSQL** — a new, empty database just for HRM staging.
   Open it and check it has no tables. If it shows live data, stop and tell me.
4. Backend service → **Variables** → `DATABASE_URL` = `${{Postgres-HRM.DATABASE_URL}}`
   (pick the new HRM staging Postgres from the list — not the Quscer OS one, not live).

## 2. Backend variables (staging only)

| Variable | Value |
| --- | --- |
| `QUSCER_ENV` | `staging` |
| `STAGING_EMAIL_ALLOW` | who staging may email, e.g. `you@gmail.com,@quscer.com` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | a **new** random value (below) |
| `SUPPORT_JWT_SECRET` | a **new** random value |
| `FIELD_ENCRYPTION_KEY` | a **new** key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SUPPORT_OWNER_EMAIL` | your email (also put it in `STAGING_EMAIL_ALLOW`) |
| `RESEND_API_KEY`, `RESEND_FROM` | same as live is fine — staging only emails the allow list |
| `REMINDERS_DISABLED` | `1` (no daily reminder emails from demo data) |

New random value for the two secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Never** copy the live `FIELD_ENCRYPTION_KEY` to staging, and never change the live one.

`CORS_ORIGINS` and `APP_URL` are set in step 4, once the app has its address.

## 3. Start command (staging only)

Backend service → **Settings** → **Deploy** → **Custom Start Command**:

```
npx prisma migrate deploy && npx ts-node prisma/seed.ts && (npm run demo:seed -- --yes || true) && npm run start:prod
```

On every staging deploy: updates the tables, makes sure the permission list and Pakistan
payroll rules are there, builds the demo company **if it isn't there yet**, then starts.
If the demo step fails, the server still starts.

(Live keeps its own start command — don't copy this one there. The demo script refuses
to run on live anyway.)

## 4. Web addresses

1. Backend → **Settings** → **Networking** → **Generate Domain**, e.g.
   `https://quscer-hrm-backend-staging.up.railway.app`.
2. The app (Vercel): add a project for `quscer-hrm-frontend` named
   `quscer-hrm-frontend-staging`, with
   `NEXT_PUBLIC_API_URL` = the backend address above. Deploy.
3. Back on Railway, backend variables:
   - `CORS_ORIGINS` = the Vercel staging address, e.g. `https://quscer-hrm-frontend-staging.vercel.app`
   - `APP_URL` = the same address
4. In the **Quscer OS staging** frontend (Vercel), set `NEXT_PUBLIC_HRM_URL` to the HRM
   staging app address, so the HRM button on staging opens staging HRM.

## 5. Deploy and check the log

Approve / deploy. In the backend's **Deploy Logs** you should see, in this order:

- `All migrations have been successfully applied` (or "No pending migrations")
- `Seeded 12 permissions.`
- `[demo] Done. HR admin: demo.hr@quscer.test …`
- `Quscer HRM backend listening on port … — STAGING (test data only)`
- `Staging: email only goes to …` (your allow list)

If the STAGING line is missing, `QUSCER_ENV` isn't set on the staging backend.

## 6. First sign-in

**Support console** (`<app address>/support/login`): **Forgot password?** → your
`SUPPORT_OWNER_EMAIL`. Set a password, then two-step. On **Companies** you'll see the
**Demo company (staging)** box with **Rebuild demo**.

**The demo company** — all passwords `Demo-Quscer-2026`:

| Who | Email | Two-step |
| --- | --- | --- |
| HR admin (Ayesha Siddiqui) | `demo.hr@quscer.test` | yes — authenticator key `QUSCERDEMOAL2NOORTRADERSKHI34567` (the same key as the Quscer OS demo, so one entry in your app covers both) |
| Sales manager (Kamran Sheikh) | `demo.manager@quscer.test` | no |
| Sales officer (Sana Iqbal) | `demo.employee@quscer.test` | no |

## 7. Quick check (5 minutes)

- [ ] Every page shows the orange **STAGING · TEST DATA ONLY** badge; the tab says "[Staging]".
- [ ] HR admin: 25 staff, three months of attendance, payroll for the last three months.
- [ ] Manager: two leave requests waiting; the team's reviews.
- [ ] Employee: three payslips; leave balance.
- [ ] Support console → **Rebuild demo** finishes in a few seconds.
- [ ] Support console → a company's emails show **Held (staging)** for demo people.
- [ ] The live HRM app shows **no** badge.

---

## Day to day

- **Before a demo:** support console → **Rebuild demo** (fresh three months up to today).
  The old demo company stays in the list, renamed "Old demo — replaced <date>" and switched off —
  its activity record can't be deleted, by design.
- **Never** paste live employee data, bank numbers or the live encryption key into staging.

## What staging blocks

With `QUSCER_ENV=staging`:

- **Email** only goes to `STAGING_EMAIL_ALLOW`; everything else is held and shown as
  "Held (staging)" in the support console. Emails that do go out have "[Staging]" in the subject.
- **Rebuild demo** works only here; the live server refuses it.

On **every** server (live too): made-up addresses ending in `.test`, `.example`,
`.invalid` or `.localhost` are never emailed.
