import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateUserDto, UpdateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
    constructor(private prisma: PrismaService) { }

    /**
     * List all users. Excludes password from response.
     */
    async getUsers() {
        return this.prisma.user.findMany({
            select: {
                id: true,
                userName: true,
                email: true,
                displayName: true,
                role: true,
                isActive: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: { assignedEnquiries: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Get a single user by ID.
     */
    async getUserById(id: string) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                userName: true,
                email: true,
                displayName: true,
                role: true,
                isActive: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: { assignedEnquiries: true },
                },
            },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        return user;
    }

    /**
     * Create a new user.
     */
    async createUser(dto: CreateUserDto) {
        const existing = await this.prisma.user.findUnique({
            where: { userName: dto.userName },
        });

        if (existing) {
            throw new BadRequestException('Username already exists');
        }

        if (dto.email) {
            const emailExists = await this.prisma.user.findUnique({
                where: { email: dto.email },
            });
            if (emailExists) {
                throw new BadRequestException('Email already in use');
            }
        }

        const hashedPassword = await bcrypt.hash(dto.password, 10);

        const user = await this.prisma.user.create({
            data: {
                userName: dto.userName,
                email: dto.email,
                displayName: dto.displayName || dto.userName,
                password: hashedPassword,
                role: dto.role,
            },
            select: {
                id: true,
                userName: true,
                email: true,
                displayName: true,
                role: true,
                isActive: true,
                createdAt: true,
            },
        });

        return user;
    }

    /**
     * Update a user (role, displayName, email, isActive).
     */
    async updateUser(id: string, dto: UpdateUserDto) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        return this.prisma.user.update({
            where: { id },
            data: {
                ...dto,
            },
            select: {
                id: true,
                userName: true,
                email: true,
                displayName: true,
                role: true,
                isActive: true,
                updatedAt: true,
            },    
        });
    }

    /**
     * Change a user's password.
     */
    async changePassword(id: string, newPassword: string) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await this.prisma.user.update({
            where: { id },
            data: { password: hashedPassword },
        });

        return { message: 'Password updated successfully' };
    }

    /**
     * Soft-delete a user (set isActive = false).
     * Never hard-deletes — historical data stays intact.
     */
    async deactivateUser(id: string) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        return this.prisma.user.update({
            where: { id },
            data: { isActive: false },
            select: {
                id: true,
                userName: true,
                isActive: true,
            },
        });
    }

    /**
     * Update lastLoginAt timestamp (called from AuthService on login).
     */
    async updateLastLogin(id: string) {
        await this.prisma.user.update({
            where: { id },
            data: { lastLoginAt: new Date() },
        });
    }
}
