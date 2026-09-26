import { renderEmail } from './email-layout';

describe('renderEmail', () => {
  it('escapes names and keeps the button link', () => {
    const e = renderEmail(
      { subject: 'S', title: 'Hi <b>', lines: ['A & B'], button: { label: 'Go', url: 'https://hrm.quscer.com/leave?tab=approvals' } },
      'Acme "Traders"',
    );
    expect(e.html).toContain('Hi &lt;b&gt;');
    expect(e.html).toContain('A &amp; B');
    expect(e.html).toContain('Acme &quot;Traders&quot;');
    expect(e.html).toContain('https://hrm.quscer.com/leave?tab=approvals');
    expect(e.text).toContain('Go: https://hrm.quscer.com/leave?tab=approvals');
  });
});
