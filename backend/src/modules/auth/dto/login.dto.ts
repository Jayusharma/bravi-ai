import { IsString, MinLength } from 'class-validator';

export class LoginDto {
    @IsString()
    userName: string;

    @IsString()
    @MinLength(1)
    password: string;
}