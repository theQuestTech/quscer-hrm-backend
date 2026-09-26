// One simple, branded layout for every notification email.

export interface EmailContent {
  subject: string;
  title: string;
  lines: string[]; // plain sentences; escaped for HTML
  button?: { label: string; url: string };
  footer?: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderEmail(c: EmailContent, companyName: string): { subject: string; html: string; text: string } {
  const footer = c.footer ?? `You're getting this because you're part of ${companyName} on Quscer People.`;
  const text = [c.title, '', ...c.lines, ...(c.button ? ['', `${c.button.label}: ${c.button.url}`] : []), '', footer].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f8fa;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:13px;font-weight:bold;color:#00857a;padding-bottom:4px">Quscer People</td></tr>
<tr><td style="font-size:12px;color:#9ca3af;padding-bottom:20px">${esc(companyName)}</td></tr>
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:12px">${esc(c.title)}</td></tr>
${c.lines.map((l) => `<tr><td style="font-size:14px;line-height:22px;color:#4b5563;padding-bottom:10px">${esc(l)}</td></tr>`).join('\n')}
${c.button ? `<tr><td style="padding:14px 0 24px"><a href="${esc(c.button.url)}" style="display:inline-block;background:#00857a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 24px;border-radius:10px">${esc(c.button.label)}</a></td></tr>` : ''}
<tr><td style="font-size:12px;line-height:18px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:16px">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: c.subject, html, text };
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtDateTime(d: Date, timeZone: string): string {
  try {
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone });
  } catch {
    return d.toISOString();
  }
}
