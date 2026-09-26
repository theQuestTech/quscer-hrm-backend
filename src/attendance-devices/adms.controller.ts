// ZKTeco "ADMS" / "Cloud Server" push — the protocol most attendance
// machines in Pakistan speak (ZKTeco and the many machines built on it).
// On the machine: Communication → Cloud Server Setting → server address =
// this API's address, port 443 (HTTPS on) or 80. The machine then:
//   GET  /iclock/cdata?SN=…            → asks for its settings
//   POST /iclock/cdata?SN=…&table=ATTLOG → uploads punches (tab-separated)
//   GET  /iclock/getrequest?SN=…       → asks for commands (we have none)
// Only machines HR registered (by serial number) are accepted. Replies are
// plain text in the format the machines expect.

import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DevicesService } from './devices.service';
import { parseAttlog } from './punch-rules';

function text(res: Response, body: string, status = 200) {
  res.status(status).type('text/plain').send(body);
}

@Controller('iclock')
export class AdmsController {
  constructor(private devices: DevicesService) {}

  @Get(['cdata', 'cdata.aspx'])
  async handshake(@Query('SN') sn: string | undefined, @Res() res: Response) {
    const device = await this.devices.admsDevice(sn);
    if (!device) return text(res, 'Unknown device — register its serial number in Quscer HRM first', 403);
    text(
      res,
      [
        `GET OPTION FROM: ${device.serialNumber}`,
        'ATTLOGStamp=None',
        'OPERLOGStamp=9999',
        'ATTPHOTOStamp=None',
        'ErrorDelay=30',
        'Delay=10',
        'TransTimes=00:00;14:05',
        'TransInterval=1',
        'TransFlag=TransData AttLog',
        'Realtime=1',
        'Encrypt=None',
      ].join('\n'),
    );
  }

  @Post(['cdata', 'cdata.aspx'])
  async upload(@Query('SN') sn: string | undefined, @Query('table') table: string | undefined, @Req() req: Request, @Res() res: Response) {
    const device = await this.devices.admsDevice(sn);
    if (!device) return text(res, 'Unknown device', 403);
    if ((table ?? '').toUpperCase() !== 'ATTLOG') return text(res, 'OK'); // user lists, photos, logs: not needed
    const body = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const punches = parseAttlog(body);
    await this.devices.ingestAdms(device, punches);
    text(res, `OK: ${punches.length}`);
  }

  @Get(['getrequest', 'getrequest.aspx'])
  async commands(@Query('SN') sn: string | undefined, @Res() res: Response) {
    await this.devices.admsDevice(sn);
    text(res, 'OK');
  }

  @Post(['devicecmd', 'devicecmd.aspx'])
  commandResult(@Res() res: Response) {
    text(res, 'OK');
  }
}
