import { Controller, Post, Get, UseGuards } from '@nestjs/common';
import { Body } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/roles/role.guard';
import { Roles } from 'src/common/roles/role.decorator';




@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}


  @Get()
  getUsers() {
    
    return this.userService.getUsers();
  }

 
  @Post()
  createUser(@Body() user: CreateUserDto) {
    return this.userService.createUser(user);
  }
}
