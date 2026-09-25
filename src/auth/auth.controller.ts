import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AddCompanyDto, SwitchCompanyDto } from './dto/company.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
