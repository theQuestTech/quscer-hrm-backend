import { isMadeUpAddress, isStaging, quscerEnv, stagingEmailAllowed } from './environment';

describe('environment', () => {
  it('works out which copy this is', () => {
    expect(quscerEnv({ QUSCER_ENV: 'staging' } as never)).toBe('staging');
    expect(quscerEnv({ NODE_ENV: 'production' } as never)).toBe('production');
    expect(quscerEnv({} as never)).toBe('development');
    expect(isStaging({ QUSCER_ENV: ' Staging ' } as never)).toBe(true);
  });

  it('staging only emails addresses and domains on the allow list', () => {
    const env = { STAGING_EMAIL_ALLOW: 'owner@gmail.com, @quscer.com' } as never;
    expect(stagingEmailAllowed('owner@gmail.com', env)).toBe(true);
    expect(stagingEmailAllowed('Team <hr@quscer.com>', env)).toBe(true);
    expect(stagingEmailAllowed('someone@gmail.com', env)).toBe(false);
    expect(stagingEmailAllowed('x@notquscer.com', env)).toBe(false);
    expect(stagingEmailAllowed('owner@gmail.com', {} as never)).toBe(false);
  });

  it('never emails made-up addresses', () => {
    for (const a of ['demo.hr@quscer.test', 'sana@alnoor-demo.test', 'a@example', 'b@site.invalid']) expect(isMadeUpAddress(a)).toBe(true);
    for (const a of ['someone@gmail.com', 'hr@quscer.com', 'test@company.pk']) expect(isMadeUpAddress(a)).toBe(false);
  });
});
