// channels.controller.ts — Administration → Channels. Admin-only CRUD for connecting a
// channel (SendGrid today) and toggling it on/off. See channels.service.ts for the logic.

import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Controller('channels')
@UseGuards(CaslGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  // POST /channels — "Add Channel" modal, Connect button
  @Post()
  @CheckAbility({ action: 'create', subject: 'channelconnection' })
  create(@Body() dto: CreateChannelDto, @Req() req: Request) {
    return this.channelsService.create(dto, req.user!.userId);
  }

  // GET /channels — the Channels list page
  @Get()
  @CheckAbility({ action: 'read', subject: 'channelconnection' })
  findAll() {
    return this.channelsService.findAll();
  }

  // PATCH /channels/:id — rename, or rotate the API key / from-email
  @Patch(':id')
  @CheckAbility({ action: 'update', subject: 'channelconnection' })
  update(@Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return this.channelsService.update(id, dto);
  }

  // PATCH /channels/:id/status — the on/off toggle
  @Patch(':id/status')
  @CheckAbility({ action: 'update', subject: 'channelconnection' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.channelsService.updateStatus(id, dto.status);
  }

  // DELETE /channels/:id — remove the connection
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckAbility({ action: 'delete', subject: 'channelconnection' })
  async remove(@Param('id') id: string) {
    await this.channelsService.remove(id);
  }
}
