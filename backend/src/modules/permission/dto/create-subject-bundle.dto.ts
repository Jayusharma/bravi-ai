import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSubjectBundleDto {
    @IsString()
    @MinLength(2)
    subject: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    actions?: string[];
}
