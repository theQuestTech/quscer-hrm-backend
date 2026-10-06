/**
 * Which copy of Quscer People this is. Set QUSCER_ENV=staging on the staging server; the
 * live server needs nothing (it counts as production when NODE_ENV=production).
 *
 * Staging is where demos and tests run, so it must never reach real people: email only
 * goes to addresses on STAGING_EMAIL_ALLOW (a comma-separated list of full addresses
 * and/or whole domains written as "@quscer.com"); everything else is held.
 */
export type QuscerEnv = 'production' | 'staging' | 'development';

export function quscerEnv(env: NodeJS.ProcessEnv = process.env): QuscerEnv {
  const set = (env.QUSCER_ENV ?? '').trim().toLowerCase();
  if (set === 'staging') return 'staging';
  if (set === 'production') return 'production';
  if (set === 'development') return 'development';
  return env.NODE_ENV === 'production' ? 'production' : 'development';
}

export const isStaging = (env: NodeJS.ProcessEnv = process.env) => quscerEnv(env) === 'staging';

export function stagingEmailAllowed(to: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const list = (env.STAGING_EMAIL_ALLOW ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  const address = (/<([^>]+)>/.exec(to)?.[1] ?? to).trim().toLowerCase();
  if (!address.includes('@')) return false;
  return list.some((a) => (a.startsWith('@') ? address.endsWith(a) : address === a));
}

/** Made-up addresses (demo staff, tests) — never emailed, on any server. */
export const isMadeUpAddress = (to: string) => /@([a-z0-9-]+\.)*(test|example|invalid|localhost)$/i.test(to.trim().replace(/>$/, ''));
