import { Controller, Body, Post, Get, Req } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './auth.service';
import { Public } from 'src/common/decorator/public.decorator';
import type { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /**
   * POST /auth/login — Authenticate and receive JWT + permissions.
   * Public endpoint (no JWT required).
   */
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * GET /auth/me — Get current user profile + permissions.
   * Requires valid JWT.
   */
  @Get('me')
  getProfile(@Req() req: Request) {
    return this.authService.getProfile(req.user!.userId);
  }
}
