import {  Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from 'passport-jwt';
import { requireEnv } from 'src/common/utils/require-env';

@Injectable()
export class jwtStrategy extends PassportStrategy(Strategy) {
    constructor(){

        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: requireEnv('JWT_SECRET'),
        })
    }
    async validate(payload: any) {
        return {
          userId: payload.sub,
          role: payload.role,
        };
      }
}
