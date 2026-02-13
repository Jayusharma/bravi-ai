import { Controller, Post, Body, Put, Param, Patch, UseGuards, Req, Get, Query } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import { CreateEnquiryDto, SendMessageDto, ChangeStatusDto, AssignEnquiryDto } from './dto/create-enquiry.dto';
import { CheckPermission } from '../permission/permission.decorator';
import type { Request } from 'express';

@Controller('enquiry')
export class EnquiryController {
  constructor(private enquiryService: EnquiryService) { }

  /**
   * GET /enquiry — List all enquiries with optional filters.
   */
  @Get()
  @CheckPermission({ action: 'read', subject: 'enquiry' })
  findAll(
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.enquiryService.findAll({
      status,
      source,
      assignedToId,
      search,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  /**
   * GET /enquiry/stats — Dashboard KPI stats.
   */
  @Get('stats')
  @CheckPermission({ action: 'read', subject: 'dashboard' })
  getStats() {
    return this.enquiryService.getStats();
  }

  /**
   * GET /enquiry/:id — Get single enquiry with timeline & messages.
   */
  @Get(':id')
  @CheckPermission({ action: 'read', subject: 'enquiry' })
  findOne(@Param('id') id: string) {
    return this.enquiryService.findOne(id);
  }

  /**
   * POST /enquiry — Create a new manual enquiry.
   */
  @Post()
  @CheckPermission({ action: 'create', subject: 'enquiry' })
  create(@Body() dto: CreateEnquiryDto, @Req() req: Request) {
    return this.enquiryService.create(dto, req.user?.userId);
  }

  /**
   * PATCH /enquiry/:id/status — Change enquiry status (FSM validated).
   */
  @Patch(':id/status')
  @CheckPermission({ action: 'update', subject: 'enquiry' })
  statusChange(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @Req() req: Request,
  ) {
    return this.enquiryService.statusChange(id, dto, req.user?.userId);
  }

  /**
   * PATCH /enquiry/:id/assign — Assign enquiry to a user.
   */
  @Patch(':id/assign')
  @CheckPermission({ action: 'assign', subject: 'enquiry' })
  assign(
    @Param('id') id: string,
    @Body() dto: AssignEnquiryDto,
    @Req() req: Request,
  ) {
    return this.enquiryService.assign(id, dto.userId, dto.version);
  }

  /**
   * PATCH /enquiry/:id/tags — Update tags on an enquiry.
   */
  @Patch(':id/tags')
  @CheckPermission({ action: 'update', subject: 'enquiry' })
  updateTags(
    @Param('id') id: string,
    @Body() body: { tags: string[] },
    @Req() req: Request,
  ) {
    return this.enquiryService.updateTags(id, body.tags, req.user?.userId);
  }

  /**
   * POST /enquiry/:id/messages — Send a message for an enquiry.
   */
  @Post(':id/messages')
  @CheckPermission({ action: 'create', subject: 'message' })
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

  /**
   * GET /enquiry/:id/messages — List messages for an enquiry.
   */
  @Get(':id/messages')
  @CheckPermission({ action: 'read', subject: 'message' })
  getMessages(@Param('id') id: string) {
    return this.enquiryService.getMessages(id);
  }
}
