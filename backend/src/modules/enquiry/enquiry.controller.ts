import { Controller, Post, Body, Put, Param, Patch, UseGuards, Req } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import { CreateEnquiryDto, SendMessageDto, ChangeStatusDto } from './dto/create-enquiry.dto';
import { RolesGuard } from 'src/common/roles/role.guard';
import { Roles } from 'src/common/roles/role.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IdempotencyGuard } from 'src/common/Idempotency/idempotency.guard';
import { AssignEnquiryDto } from './dto/create-enquiry.dto';
import type { Request } from 'express';
import * as express from 'express';

@Controller('enquiry')
export class EnquiryController {
  constructor(private enquiryService: EnquiryService) {

  }


  @Post()
  @UseGuards(IdempotencyGuard)
  create(@Body() dto: CreateEnquiryDto) {
    return this.enquiryService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  statusChange(@Param('id') id: string, @Body() dto: ChangeStatusDto, @Req() req) {
    return this.enquiryService.statusChange(id, dto, req.user.userId);
  }

  @Patch(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignEnquiryDto,
    @Req() req: Request,
  ) {
    return this.enquiryService.assign(
      id,
      dto.userId,
      dto.version,

    );
  }


  @Post(':id/messages')
  @UseGuards(JwtAuthGuard)
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    return this.enquiryService.sendMessage(
      id,
      dto,
      {
        userId: req.user!.userId,
        role: req.user!.role,
      },
    );
  }
}
