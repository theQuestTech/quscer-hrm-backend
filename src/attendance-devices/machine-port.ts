// A second, plain-HTTP door for older attendance machines that can't do
// HTTPS. It only answers the machine address (/iclock/…); everything else —
// sign-in, employee data — gets a 404 here and stays HTTPS-only on the main
// address. On Railway, point a TCP Proxy at MACHINE_PORT and show its
// address to HR with MACHINE_PUBLIC_ADDRESS.

import type { IncomingMessage, RequestListener, ServerResponse } from 'http';

export function isMachinePath(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  return path === '/iclock' || path.startsWith('/iclock/');
}

export function machineOnly(app: RequestListener): RequestListener {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (!isMachinePath(req.url)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Not found');
      return;
    }
    app(req, res);
  };
}
