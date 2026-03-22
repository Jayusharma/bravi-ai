import {
  Controller,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Req,
  Get,
  Query,
} from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import {
  CreateEnquiryDto,
  SendMessageDto,
  ChangeStatusDto,
  AssignEnquiryDto,
  AddNoteDto,
  QualifiedDto,
} from './dto/create-enquiry.dto';
import { InboxQueryDto } from './dto/inbox-query.dto';
import type { Request } from 'express';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { Ability } from '../casl/decorators/ability.decorator';
import { Public } from 'src/common/decorator/public.decorator';
import { AppAbility } from '../casl/casl.types';

@Controller('enquiry')
@UseGuards(CaslGuard)
export class EnquiryController {
  constructor(private enquiryService: EnquiryService) { }

  // ── Test endpoint (existing) ──
  @Patch('qualfiy')
  @Public()
  qualified(@Body() dto: QualifiedDto) {
    return this.enquiryService.handleQualified(dto);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /enquiry — Paginated inbox with filters
  // ═══════════════════════════════════════════════════════════════════
  @Get()
  @CheckAbility({ action: 'read', subject: 'enquiry' })
  findAll(@Query() query: InboxQueryDto, @Req() req: Request) {
    return this.enquiryService.findAll(query, req.ability);
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /enquiry/stats — Dashboard KPIs
  // ═══════════════════════════════════════════════════════════════════
  @Get('stats')
  @CheckAbility({ action: 'read', subject: 'enquiry' })
  getStats() {
    return this.enquiryService.getStats();
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /enquiry/:id — Single enquiry with messages, timeline, notes
  // ═══════════════════════════════════════════════════════════════════
  @Get(':id')
  @CheckAbility({ action: 'read', subject: 'enquiry' })
  findOne(@Param('id') id: string) {
    return this.enquiryService.findOne(id);
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /enquiry — Manual enquiry creation
  // ═══════════════════════════════════════════════════════════════════
  @Post()
  @CheckAbility({ action: 'create', subject: 'enquiry' })
  create(@Body() dto: CreateEnquiryDto, @Req() req: Request) {
    return this.enquiryService.create(dto, req.user?.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /enquiry/:id/status — FSM-validated status change
  // ═══════════════════════════════════════════════════════════════════
  @Patch(':id/status')
  @CheckAbility({ action: 'update', subject: 'enquiry' })
  statusChange(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @Req() req: Request,
  ) {
    return this.enquiryService.statusChange(id, dto, req.ability, req.user?.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /enquiry/:id/assign — Assign to team member
  // ═══════════════════════════════════════════════════════════════════
  @Patch(':id/assign')
  @CheckAbility({ action: 'assign', subject: 'enquiry' })
  assign(@Param('id') id: string, @Body() dto: AssignEnquiryDto) {
    return this.enquiryService.assign(id, dto.userId, dto.version);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /enquiry/:id/tags — Update tags
  // ═══════════════════════════════════════════════════════════════════
  @Patch(':id/tags')
  @CheckAbility({ action: 'update', subject: 'enquiry' })
  updateTags(
    @Param('id') id: string,
    @Body() body: { tags: string[] },
    @Req() req: Request,
  ) {
    return this.enquiryService.updateTags(id, body.tags, req.user?.userId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /enquiry/:id/messages — Send reply to customer
  // ═══════════════════════════════════════════════════════════════════
  @Post(':id/messages')
  @CheckAbility({ action: 'create', subject: 'message' })
  sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    return this.enquiryService.sendMessage(id, dto, {
      userId: req.user!.userId,
      role: req.user!.role,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /enquiry/:id/messages — List conversation messages
  // ═══════════════════════════════════════════════════════════════════
  @Get(':id/messages')
  @CheckAbility({ action: 'read', subject: 'message' })
  getMessages(@Param('id') id: string) {
    return this.enquiryService.getMessages(id);
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /enquiry/:id/notes — Add internal note
  // ═══════════════════════════════════════════════════════════════════
  @Post(':id/notes')
  @CheckAbility({ action: 'create', subject: 'internalnote' })
  addNote(
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
    @Req() req: Request,
  ) {
    return this.enquiryService.addNote(id, dto, req.user!.userId);
  }
}
