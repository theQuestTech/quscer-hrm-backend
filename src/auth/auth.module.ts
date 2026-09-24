import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [
    RbacModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '1d') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [JwtAuthGuard, AuthService],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
