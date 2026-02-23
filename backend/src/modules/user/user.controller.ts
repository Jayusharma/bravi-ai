import { Controller, Post, Get, Patch, Delete, Body, Param, Global } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto, ChangePasswordDto } from './dto/create-user.dto';
import { Public } from 'src/common/decorator/public.decorator';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) { }

  /**
   * GET /users — List all users.
   */
  @Get()
  getUsers() {
    return this.userService.getUsers();
  }

  /**
   * GET /users/:id — Get a single user.
   */
  @Get(':id')
  getUser(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  /**
   * POST /users — Create a new user.
   */
  @Public()
  @Post()
  createUser(@Body() dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  /**
   * PATCH /users/:id — Update user details.
   */
  @Patch(':id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.updateUser(id, dto);
  }

  /**
   * PATCH /users/:id/password — Change user password.
   */
  @Patch(':id/password')
  changePassword(@Param('id') id: string, @Body() dto: ChangePasswordDto) {
    return this.userService.changePassword(id, dto.newPassword);
  }

  /**
   * DELETE /users/:id — Soft-delete (deactivate) a user.
   */
  @Delete(':id')
  deactivateUser(@Param('id') id: string) {
    return this.userService.deactivateUser(id);
  }
}
