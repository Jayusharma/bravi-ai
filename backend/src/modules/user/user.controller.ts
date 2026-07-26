import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto, ChangePasswordDto } from './dto/create-user.dto';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';

@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly caslAbilityFactory: CaslAbilityFactory,
  ) { }

  /**
   * GET /users — List all users.
   */
  @Get()
  @CheckAbility({ action: 'read', subject: 'user' })
  getUsers() {
    return this.userService.getUsers();
  }

  /**
   * GET /users/:id — Get a single user.
   */
  @Get(':id')
  @CheckAbility({ action: 'read', subject: 'user' })
  getUser(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  /**
   * POST /users — Create a new user.
   */
  @Post()
  @CheckAbility({ action: 'create', subject: 'user' })
  createUser(@Body() dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  /**
   * PATCH /users/:id — Update user details.
   */
  @Patch(':id')
  @CheckAbility({ action: 'update', subject: 'user' })
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.updateUser(id, dto);
  }

  /**
   * PATCH /users/:id/password — Change a password.
   * Self-service (caller === target) requires the current password.
   * Admin reset (caller !== target) requires update:user and skips the current-password check.
   */
  @Patch(':id/password')
  async changePassword(
    @Param('id') id: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const actor = req.user!;

    if (actor.userId === id) {
      return this.userService.changeOwnPassword(id, dto.currentPassword, dto.newPassword);
    }

    const ability = await this.caslAbilityFactory.createForUser(actor);
    if (!ability.can('update', 'user')) {
      throw new ForbiddenException("You don't have permission to update user");
    }
    return this.userService.changePassword(id, dto.newPassword);
  }

  /**
   * DELETE /users/:id — Soft-delete (deactivate) a user.
   */
  @Delete(':id')
  @CheckAbility({ action: 'delete', subject: 'user' })
  deactivateUser(@Param('id') id: string) {
    return this.userService.deactivateUser(id);
  }
}
