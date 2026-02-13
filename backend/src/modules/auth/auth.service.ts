import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { PermissionService } from '../permission/permission.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwt: JwtService,
        private permissionService: PermissionService,
    ) { }

    /**
     * Login — validates credentials, returns JWT + user info + permissions.
     */
    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({
            where: { userName: dto.userName },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (!user.isActive) {
            throw new UnauthorizedException('Account is deactivated. Contact admin.');
        }

        const isPasswordValid = await bcrypt.compare(dto.password, user.password);

        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Update last login timestamp
        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        const payload = {
            sub: user.id,
            role: user.role,
        };

        // Get permissions for this role (to send to frontend)
        const permissions = this.permissionService.getPermissionsForRole(user.role);

        return {
            access_token: this.jwt.sign(payload),
            
            user: {
                id: user.id,
                userName: user.userName,
                email: user.email,
                displayName: user.displayName,
                role: user.role,
            },
            permissions,
        };
    }

    /**
     * Get current user profile + permissions.
     * Called by frontend on app load to verify token is valid.
     */
    async getProfile(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                userName: true,
                email: true,
                displayName: true,
                role: true,
                isActive: true,
                lastLoginAt: true,
                createdAt: true,
                _count: {
                    select: { assignedEnquiries: true },
                },
            },
        });

        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        const permissions = this.permissionService.getPermissionsForRole(user.role);

        return {
            ...user,
            permissions,
        };
    }
}
