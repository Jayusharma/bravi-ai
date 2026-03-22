import {
    Controller,
    Get,
    Patch,
    Param,
    Body,
    Query,
    UseGuards,
} from '@nestjs/common';
import { CaslGuard } from '../casl/casl.guard';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { ContactService } from './contact.service';
import { EnquiryService } from '../enquiry/enquiry.service';
import { UpdateContactDto } from './dto/update-contact.dto';
import { Ability } from '../casl/decorators/ability.decorator';
import type { Request } from 'express';

@Controller('contact')
@UseGuards(CaslGuard)
export class ContactController {
    constructor(
        private contactService: ContactService,
        private enquiryService: EnquiryService,
    ) { }

    // ═══════════════════════════════════════════════════════════════════════════
    // GET /contact — List all contacts (search + pagination)
    // Query: ?search=rahul&page=1&limit=20
    // ═══════════════════════════════════════════════════════════════════════════
    @Get()
    @CheckAbility({ action: 'read', subject: 'contact' })
    findAll(
        @Query('search') search?: string,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        return this.contactService.findAll({ search, page, limit });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GET /contact/:id — Get single contact with channels & counts
    // ═══════════════════════════════════════════════════════════════════════════
    @Get(':id')
    @CheckAbility({ action: 'read', subject: 'contact' })
    findById(@Param('id') id: string) {
        return this.contactService.findById(id);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PATCH /contact/:id — Update contact profile (name, org, notes)
    // ═══════════════════════════════════════════════════════════════════════════
    @Patch(':id')
    @CheckAbility({ action: 'update', subject: 'contact' })
    updateContact(@Param('id') id: string, @Body() dto: UpdateContactDto) {
        return this.contactService.updateContact(id, dto);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GET /contact/:contactId/enquiries — Get all enquiries for a contact
    // Logic lives in EnquiryService, but route is under /contact
    // ═══════════════════════════════════════════════════════════════════════════
    @Get(':contactId/enquiries')
    @CheckAbility({ action: 'read', subject: 'enquiry' })
    getEnquiriesByContact(@Param('contactId') contactId: string) {
        return this.enquiryService.getEnquiriesByContact(contactId);
    }
}