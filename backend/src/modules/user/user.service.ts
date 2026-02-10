import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';


@Injectable()
export class UserService {
    constructor(private prisma: PrismaService) { }

    async getUsers() {
        return this.prisma.user.findMany();
    }

    async createUser(dto: CreateUserDto) {
        const existing = await this.prisma.user.findUnique({
            where: {
                UserName: dto.UserName,
            },
        })
        if (existing) {
            throw new BadRequestException('User already exists');
        }

        const hashedPassword = await bcrypt.hash(dto.password, 10);

        const user = await this.prisma.user.create({
            data: {
                UserName: dto.UserName,
                password: await bcrypt.hash(dto.password, 10),
                role: dto.role,
                

            },
        })
        return user;
    }

}
