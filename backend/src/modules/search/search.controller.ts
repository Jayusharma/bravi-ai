// search.controller.ts — Unified search endpoint for contacts and messages.

import { Controller, Get, Query } from '@nestjs/common';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * GET /search?q=query&contactId=optional&limit=20
   * Returns { contacts[], messages[] }.
   * When contactId is provided, contacts[] is empty and messages are scoped to that contact.
   */
  @Get()
  @CheckAbility({ action: 'read', subject: 'contact' })
  search(
    @Query('q') q = '',
    @Query('contactId') contactId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.searchService.searchUnified(q, contactId, parseInt(limit ?? '20', 10) || 20);
  }
}
