import { Controller, Post, Body, Put, Param, Patch, UseGuards, Req, Get, Query } from '@nestjs/common';
import { EnquiryService } from './enquiry.service';
import { CreateEnquiryDto, SendMessageDto, ChangeStatusDto, AssignEnquiryDto, QualifiedDto } from './dto/create-enquiry.dto';
import type { Request } from 'express';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { Ability } from '../casl/decorators/ability.decorator';
import { Public } from 'src/common/decorator/public.decorator';

@Controller('enquiry')
@UseGuards(CaslGuard)
export class EnquiryController {
  constructor(private enquiryService: EnquiryService) { }



  @Patch('qualfiy')
  @Public()
  qualified(@Body() dto: QualifiedDto) {
    return this.enquiryService.handleQualified(dto);
  }
  /**
   * GET /enquiry — List all enquiries with optional filters.
   */
//   @Get()
//   @CheckAbility({ action: 'read', subject: 'Enquiry' })

//   findAll(
//     @Req() req: Request,
//     @Query('status') status?: string,
//     @Query('source') source?: string,
//     @Query('assignedToId') assignedToId?: string,
//     @Query('search') search?: string,
//     @Query('page') page?: string,
//     @Query('limit') limit?: string,
    
//   ) {
//     return this.enquiryService.findAll({
//       status,
//       source,
//       assignedToId,
//       search,
//       page: page ? parseInt(page, 10) : 1,
//       limit: limit ? parseInt(limit, 10) : 20,
//     } ,
//     req.ability,
//   );
//   }

//   /**
//    * GET /enquiry/stats — Dashboard KPI stats.
//    */
//   @Get('stats')
//   getStats() {
//     return this.enquiryService.getStats();
//   }

//   /**
//    * GET /enquiry/:id — Get single enquiry with timeline & messages.
//    */
//   @Get(':id')
  
//   findOne(@Param('id') id: string) {
//     return this.enquiryService.findOne(id);
//   }

//   /**
//    * POST /enquiry — Create a new manual enquiry.
//    */
//   @Post()
//   create(@Body() dto: CreateEnquiryDto, @Req() req: Request) {
//     return this.enquiryService.create(dto, req.user?.userId);
//   }

//   /**
//    * PATCH /enquiry/:id/status — Change enquiry status (FSM validated).
//    */
//   @Patch(':id/status')
//   @CheckAbility({ action: 'update', subject: 'Enquiry' })

//   statusChange(
//     @Param('id') id: string,
//     @Body() dto: ChangeStatusDto,
//     @Req() req: Request,
//   ) {
//     return this.enquiryService.statusChange(id, dto,  req.ability ,req.user?.userId );
//   }

//   /**
//    * PATCH /enquiry/:id/assign — Assign enquiry to a user.
//    */
//   @Patch(':id/assign')
//   assign(
//     @Param('id') id: string,
//     @Body() dto: AssignEnquiryDto,
//     @Req() req: Request,
//   ) {
//     return this.enquiryService.assign(id, dto.userId, dto.version);
//   }

//   /**
//    * PATCH /enquiry/:id/tags — Update tags on an enquiry.
//    */
//   @Patch(':id/tags')
//   updateTags(
//     @Param('id') id: string,
//     @Body() body: { tags: string[] },
//     @Req() req: Request,
//   ) {
//     return this.enquiryService.updateTags(id, body.tags, req.user?.userId);
//   }

//   /**
//    * POST /enquiry/:id/messages — Send a message for an enquiry.
//    */
//   @Post(':id/messages')
//   sendMessage(
//     @Param('id') id: string,
//     @Body() dto: SendMessageDto,
//     @Req() req: Request,
//   ) {
//     return this.enquiryService.sendMessage(id, dto, {
//       userId: req.user!.userId,
//       role: req.user!.role,
//     });
//   }

//   /**
//    * GET /enquiry/:id/messages — List messages for an enquiry.
//    */
//   @Get(':id/messages')
//   getMessages(@Param('id') id: string) {
//     return this.enquiryService.getMessages(id);
//   }
 }
