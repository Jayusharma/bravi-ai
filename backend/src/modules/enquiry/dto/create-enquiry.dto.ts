import { IsEnum, IsOptional, IsString , IsInt , isNumber , IsUUID , MinLength} from 'class-validator';
import {  EnquirySource , EnquiryStatus } from '@prisma/client';
import { Type } from 'class-transformer'; 

export class CreateEnquiryDto {
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;


  @IsEnum(EnquirySource)
  source: 'MANUAL' | 'WHATSAPP' | 'EMAIL';
}

     

export class ChangeStatusDto {
  @IsEnum(EnquiryStatus)
  status: EnquiryStatus;

  @Type(() => Number)
  @IsInt()
  version: number;
}

export class AssignEnquiryDto {
  @IsUUID()
  userId: string;

  @IsInt()
  version: number;
}



export class SendMessageDto {
  @IsString()
  @MinLength(1)
  content: string;
}
