import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto, LoginTwoStepDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AddCompanyDto, SwitchCompanyDto } from './dto/company.dto';
import { ForgotPasswordDto, ResetPasswordWithTokenDto } from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset';
import { RateLimiter } from '../recruitment/recruitment-rules';
import { visitorAddress } from '../common/visitor-address';

// "Forgot password?" limits: per visitor, and per email so nobody can flood
// someone's inbox.
const resetPerVisitor = new RateLimiter(10, 60 * 60 * 1000);
const resetPerEmail = new RateLimiter(3, 60 * 60 * 1000);

// Sign-in limits, so nobody can keep guessing passwords: 30 tries per visitor
// and 10 wrong passwords per email in 15 minutes. A right password doesn't
// use up the email's tries.
const signInPerVisitor = new RateLimiter(30, 15 * 60 * 1000);
const wrongPasswordPerEmail = new RateLimiter(10, 15 * 60 * 1000);
// New companies: 5 an hour per visitor, against bulk fake sign-ups.
const signupPerVisitor = new RateLimiter(5, 60 * 60 * 1000);
// Changing password checks the current one: 10 tries an hour per login.
const changePasswordPerUser = new RateLimiter(10, 60 * 60 * 1000);

const tooMany = () => new HttpException('Too many tries — please wait a while and try again', HttpStatus.TOO_MANY_REQUESTS);

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private passwordReset: PasswordResetService,
  ) {}

  // Emails a reset link. Always answers the same, whether or not the email
  // has an account.
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Req() req: Request, @Body() dto: ForgotPasswordDto) {
    if (!resetPerVisitor.allow(visitorAddress(req))) {
      throw tooMany();
    }
    if (!resetPerEmail.allow(dto.email.trim().toLowerCase())) {
      return this.passwordReset.answer();
    }
    return this.passwordReset.request(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Req() req: Request, @Body() dto: ResetPasswordWithTokenDto) {
    if (!resetPerVisitor.allow(visitorAddress(req))) {
      throw tooMany();
    }
    return this.passwordReset.reset(dto.token, dto.newPassword);
  }

  // Creates a new Organization + its first User (HR Admin role) in one call.
  // An email that already has a login is refused — that person adds a
  // company with POST /auth/companies instead.
  @Post('signup')
  async signup(@Req() req: Request, @Body() dto: SignupDto) {
    if (!signupPerVisitor.allow(visitorAddress(req))) throw tooMany();
    return this.authService.signup(dto);
  }

  /** Second step of sign-in when two-step is on: the 6-digit code or a backup code. */
  @Post('login/two-step')
  @HttpCode(200)
  async loginTwoStep(@Req() req: Request, @Body() dto: LoginTwoStepDto) {
    if (!signInPerVisitor.allow(visitorAddress(req))) throw tooMany();
    const ua = req.headers['user-agent'];
    return this.authService.loginTwoStep(dto, typeof ua === 'string' ? ua : undefined);
  }

  @Post('login')
  async login(@Req() req: Request, @Body() dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    if (!signInPerVisitor.allow(visitorAddress(req)) || wrongPasswordPerEmail.full(email)) throw tooMany();
    try {
      return await this.authService.login(dto);
    } catch (e) {
      if (e instanceof UnauthorizedException) wrongPasswordPerEmail.allow(email);
      throw e;
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    return this.authService.me(req.user);
  }

  // Ends a Quscer support view early (the only change a view can make).
  @Post('end-support-view')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  endSupportView(@Req() req: any) {
    return this.authService.endSupportView(req.user);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    if (!changePasswordPerUser.allow(req.user.id)) throw tooMany();
    return this.authService.changePassword(req.user.id, req.user.organizationId, dto);
  }

  // Companies this login can open (company switcher).
  @Get('companies')
  @UseGuards(JwtAuthGuard)
  companies(@Req() req: any) {
    return this.authService.companies(req.user.id);
  }

  // Create another company and become its HR Admin. Returns a token for it.
  @Post('companies')
  @UseGuards(JwtAuthGuard)
  addCompany(@Req() req: any, @Body() dto: AddCompanyDto) {
    return this.authService.addCompany(req.user.id, req.user.organizationId, dto.organizationName);
  }

  // Returns a new token for another company the caller has access to.
  @Post('switch-company')
  @UseGuards(JwtAuthGuard)
  switchCompany(@Req() req: any, @Body() dto: SwitchCompanyDto) {
    return this.authService.switchCompany(req.user.id, dto.organizationId);
  }
}
