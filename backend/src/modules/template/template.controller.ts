import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Query,
    Body,
    Req,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { MessageChannel, TemplateType, WaApprovalStatus } from '@prisma/client';
import { TemplateService } from './template.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Controller('templates')
export class TemplateController {
    constructor(private readonly templateService: TemplateService) {}

    @Post()
    @CheckAbility({ action: 'create', subject: 'messagetemplate' })
    create(@Body() dto: CreateTemplateDto, @Req() req: Request) {
        return this.templateService.create(dto, req.user!.userId);
    }

    @Get()
    @CheckAbility({ action: 'read', subject: 'messagetemplate' })
    findAll(
        @Query('filter_by_template') filterByTemplate?: TemplateType,
        @Query('filter_by_channel') filterByChannel?: MessageChannel,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const pageNum = page ? parseInt(page, 10) : 1;
        const limitNum = limit ? parseInt(limit, 10) : 50;
        return this.templateService.findAll({
            type: filterByTemplate,
            channel: filterByChannel,
            search,
            page: isNaN(pageNum) ? 1 : pageNum,
            limit: isNaN(limitNum) ? 50 : limitNum,
        });
    }

    // NOTE: static paths must be declared before ':id' so they win over the param route.
    @Get('variables/suggest')
    @CheckAbility({ action: 'read', subject: 'messagetemplate' })
    suggest(@Query('q') q?: string) {
        return this.templateService.suggestVariables(q ?? '');
    }

    // Templates usable in a conversation, with SYSTEM variables pre-resolved for the contact.
    @Get('usable')
    @CheckAbility({ action: 'read', subject: 'messagetemplate' })
    usable(
        @Query('enquiryId') enquiryId: string,
        @Query('channel') channel: MessageChannel,
        @Req() req: Request,
    ) {
        return this.templateService.findUsable(enquiryId, channel, req.user!.userId);
    }

    @Get(':id')
    @CheckAbility({ action: 'read', subject: 'messagetemplate' })
    findOne(@Param('id') id: string) {
        return this.templateService.findOne(id);
    }

    @Patch(':id')
    @CheckAbility({ action: 'update', subject: 'messagetemplate' })
    update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
        return this.templateService.update(id, dto);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @CheckAbility({ action: 'delete', subject: 'messagetemplate' })
    async remove(@Param('id') id: string) {
        await this.templateService.remove(id);
    }

    @Post(':id/duplicate')
    @CheckAbility({ action: 'create', subject: 'messagetemplate' })
    duplicate(@Param('id') id: string) {
        return this.templateService.duplicate(id);
    }
}
