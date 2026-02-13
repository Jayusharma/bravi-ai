import { Controller, Post, Get, Patch, Delete, Body, Param, Global } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto, ChangePasswordDto } from './dto/create-user.dto';
import { CheckPermission } from '../permission/permission.decorator';
import { Public } from 'src/common/decorator/public.decorator';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) { }

  /**
   * GET /users — List all users.
   */
  @Get()
  @CheckPermission({ action: 'read', subject: 'user' })
  getUsers() {
    return this.userService.getUsers();
  }

  /**
   * GET /users/:id — Get a single user.
   */
  @Get(':id')
  @CheckPermission({ action: 'read', subject: 'user' })
  getUser(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  /**
   * POST /users — Create a new user.
   */
  @Public()
  @Post()
  @CheckPermission({ action: 'create', subject: 'user' })
  createUser(@Body() dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  /**
   * PATCH /users/:id — Update user details.
   */
  @Patch(':id')
  @CheckPermission({ action: 'update', subject: 'user' })
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.updateUser(id, dto);
  }

  /**
   * PATCH /users/:id/password — Change user password.
   */
  @Patch(':id/password')
  @CheckPermission({ action: 'update', subject: 'user' })
  changePassword(@Param('id') id: string, @Body() dto: ChangePasswordDto) {
    return this.userService.changePassword(id, dto.newPassword);
  }

  /**
   * DELETE /users/:id — Soft-delete (deactivate) a user.
   */
  @Delete(':id')
  @CheckPermission({ action: 'delete', subject: 'user' })
  deactivateUser(@Param('id') id: string) {
    return this.userService.deactivateUser(id);
  }
}
