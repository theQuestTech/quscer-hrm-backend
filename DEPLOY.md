# Deploying to Railway

This backend deploys the same way `quscer-backend` already does — a Railway
service connected to a GitHub repo, plus a Railway PostgreSQL plugin. This
guide assumes a **staging/test environment**, not production — see the
"Before this is production" list at the bottom.

## 1. Push to GitHub

Create a new repo (e.g. `quscer-hrm-backend` under your `theQuestTech` org,
matching the naming of `quscer-backend`/`quscer-frontend`) and push this
folder to it. Keep it a separate repo from `quscer-backend` — this app is
standalone until task 6.1 connects it to Quscer OS.

## 2. Create the Railway service

1. Railway dashboard → **New Project** → **Deploy from GitHub repo** →
   select the new repo.
2. In the same project, click **+ New** → **Database** → **PostgreSQL**.
   Railway provisions it and exposes a `DATABASE_URL` reference variable
   automatically — you don't need to copy/paste a connection string by hand.

## 3. Environment variables

On the backend service (not the Postgres plugin), set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Reference the Postgres plugin's variable (Railway's variable picker does this for you — don't hardcode it) |
| `JWT_SECRET` | A real random secret — do not reuse `quscer-backend`'s secret, these are separate auth systems until task 6.1 |
| `JWT_EXPIRES_IN` | `1d` (or your preference) |
| `NODE_ENV` | `production` |

Railway sets `PORT` itself — `main.ts` already reads `process.env.PORT`, so
don't set it manually.

## 4. Build and start commands

Railway auto-detects Node via Nixpacks and runs `npm install` then
`npm run build` by default, which is enough **now that `postinstall: prisma
generate` is in package.json** — without that, the build would produce a
Prisma Client that doesn't match the schema, and every DB call would fail
at runtime with a confusing type error, not a clear one.

Set the **Start Command** (Railway service Settings → Deploy) to:

```
npx prisma migrate deploy && npm run start:prod
```

`migrate deploy` (not `migrate dev`) is the one safe to run on every deploy
— it applies pending migrations without prompting or trying to reset
anything. Do this via the start command, not a separate manual step, so a
schema change never silently goes un-migrated on the next deploy.

## 5. Seed the permission catalog — once, manually

The seed script is not part of the automated deploy (running it on every
deploy would re-run the Pakistan statutory-rule inserts repeatedly). After
the first successful deploy, run it once via Railway's shell/CLI:

```bash
railway run npm run prisma:seed
```

Without this, `POST /auth/signup` will fail on purpose (see
`auth.service.ts` — it checks the permission catalog isn't empty before
allowing signups, rather than silently creating a locked-out user).

## 6. Get a public URL

Railway → service → **Settings** → **Networking** → **Generate Domain**
gives you a `*.up.railway.app` URL immediately. A custom domain
(`hrm-api.quscer.com`) can be added the same way once you're ready — see
the earlier discussion on Vercel path-routing for how the frontend side of
that works.

## Before this is production

- **Bank account numbers are still plain text** (`EmployeeBankDetail.accountNumber`)
  — do not put real employee bank data on this deployment until task 6.12
  (field-level encryption) is done.
- **Auth has no password reset** — fine for internal testing, not fine for
  real users who will eventually forget a password.
- **No bank transfer file export yet** — payroll calculates and produces
  payslips, but the "pay people" step isn't built.
- Treat this Railway environment as staging: real enough to click through
  and test end-to-end, not real enough for actual payroll runs on real
  employees.
