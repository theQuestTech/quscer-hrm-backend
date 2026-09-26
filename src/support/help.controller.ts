import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimiter } from '../recruitment/recruitment-rules';
import { TicketsService } from './tickets.service';
import { CustomerReplyDto, NewTicketDto } from './dto';

const newPerPerson = new RateLimiter(10, 60 * 60 * 1000);
const repliesPerPerson = new RateLimiter(60, 60 * 60 * 1000);
const tooMany = () => new HttpException("You've sent a lot of messages — please wait a while", HttpStatus.TOO_MANY_REQUESTS);

// "Get help" in HRM: anyone signed in can ask Quscer support, and sees only
// their own questions.
@Controller('help')
@UseGuards(JwtAuthGuard)
export class HelpController {
  constructor(private tickets: TicketsService) {}

  @Get('tickets')
  list(@Req() req: any) {
    return this.tickets.mine(req.user);
  }

  @Post('tickets')
  create(@Req() req: any, @Body() dto: NewTicketDto) {
    if (!newPerPerson.allow(req.user.id)) throw tooMany();
    return this.tickets.create(req.user, dto.subject, dto.body, dto.page);
  }

  @Get('tickets/:id')
  one(@Req() req: any, @Param('id') id: string) {
    return this.tickets.mineOne(req.user, id);
  }

  @Post('tickets/:id/messages')
  reply(@Req() req: any, @Param('id') id: string, @Body() dto: CustomerReplyDto) {
    if (!repliesPerPerson.allow(req.user.id)) throw tooMany();
    return this.tickets.customerReply(req.user, id, dto.body);
  }

  @Post('tickets/:id/close')
  @HttpCode(200)
  close(@Req() req: any, @Param('id') id: string) {
    return this.tickets.customerClose(req.user, id);
  }
}
