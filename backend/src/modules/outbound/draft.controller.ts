// draft.controller.ts — Draft CRUD + attachment upload endpoints.
// Delegates all logic to DraftService. Emits NO events (drafts are private per-user).

import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import multer = require('multer');
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { DraftService, ALLOWED_MIMES } from './draft.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { MessageChannel } from '@prisma/client';

@Controller('outbound')
@UseGuards(CaslGuard)
export class DraftController {
  constructor(private readonly draftService: DraftService) {}

  // ── POST /outbound/enquiries/:enquiryId/drafts ──

  @Post('enquiries/:enquiryId/drafts')
  @CheckAbility({ action: 'create', subject: 'outbounddraft' })
  async createDraft(
    @Param('enquiryId') enquiryId: string,
    @Body() dto: CreateDraftDto,
    @Req() req: Request,
  ) {
    return this.draftService.saveDraft(enquiryId, dto, req.user!.userId);
  }

  // ── GET /outbound/enquiries/:enquiryId/draft ──

  @Get('enquiries/:enquiryId/draft')
  @CheckAbility({ action: 'read', subject: 'outbounddraft' })
  async getActiveDraft(
    @Param('enquiryId') enquiryId: string,
    @Query('channel') channel: MessageChannel | undefined,
    @Req() req: Request,
  ) {
    return this.draftService.getActiveDraft(enquiryId, channel, req.user!.userId) ?? null;
  }

  // ── PATCH /outbound/drafts/:draftId ──

  @Patch('drafts/:draftId')
  @CheckAbility({ action: 'update', subject: 'outbounddraft' })
  async updateDraft(
    @Param('draftId') draftId: string,
    @Body() dto: UpdateDraftDto,
    @Req() req: Request,
  ) {
    return this.draftService.updateDraft(draftId, dto, req.user!.userId);
  }

  // ── DELETE /outbound/drafts/:draftId ──

  @Delete('drafts/:draftId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckAbility({ action: 'delete', subject: 'outbounddraft' })
  async deleteDraft(@Param('draftId') draftId: string, @Req() req: Request) {
    await this.draftService.discardDraft(draftId, req.user!.userId);
  }

  // ── POST /outbound/drafts/:draftId/attachments ──

  @Post('drafts/:draftId/attachments')
  @CheckAbility({ action: 'update', subject: 'outbounddraft' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => { cb(null, ALLOWED_MIMES.has(file.mimetype)); },
    }),
  )
  async uploadAttachment(
    @Param('draftId') draftId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('No file provided or unsupported file type');
    const attachment = await this.draftService.addAttachment(draftId, file, req.user!.userId);
    return {
      attachmentId: attachment.id,
      cdnUrl: attachment.cdnUrl,
      kind: attachment.kind,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
    };
  }

  // ── DELETE /outbound/drafts/:draftId/attachments/:attachmentId ──

  @Delete('drafts/:draftId/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckAbility({ action: 'update', subject: 'outbounddraft' })
  async deleteAttachment(
    @Param('draftId') draftId: string,
    @Param('attachmentId') attachmentId: string,
    @Req() req: Request,
  ) {
    await this.draftService.removeAttachment(draftId, attachmentId, req.user!.userId);
  }
}
