import { Injectable , UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService ,
        private jwt: JwtService) {}

    async login(dto: LoginDto){

        const user = await this.prisma.user.findUnique({
            where: { UserName: dto.UserName} ,
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const isPasswordValid = await bcrypt.compare(dto.password, user.password);

        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const payload = {
            sub: user.id,
            role: user.role,
        };
          
        
        console.log("the token has created ",this.jwt.sign(payload));
        return {
            access_token: this.jwt.sign(payload),
        };
    }
}
