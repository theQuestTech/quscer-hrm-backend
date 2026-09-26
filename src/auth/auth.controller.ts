import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
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
      throw new HttpException('Too many tries — please wait a while and try again', HttpStatus.TOO_MANY_REQUESTS);
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
      throw new HttpException('Too many tries — please wait a while and try again', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.passwordReset.reset(dto.token, dto.newPassword);
  }

  // Creates a new Organization + its first User (HR Admin role) in one call.
  // An email that already has a login is refused — that person adds a
  // company with POST /auth/companies instead.
  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    return this.authService.me(req.user.id, req.user.organizationId);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
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
