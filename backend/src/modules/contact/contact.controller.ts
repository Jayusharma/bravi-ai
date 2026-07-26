import {
    Controller,
    Get,
    Patch,
    Param,
    Body,
    Query,
    Post,
    Delete,
} from '@nestjs/common';
import { CheckAbility } from '../casl/decorators/check-ability.decorator';
import { ContactService } from './contact.service';
import { EnquiryService } from '../enquiry/enquiry.service';
import { UpdateContactDto } from './dto/update-contact.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { AddChannelDto } from './dto/add-channel.dto';

@Controller('contact')
export class ContactController {
    constructor(
        private contactService: ContactService,
        private enquiryService: EnquiryService,
    ) { }

    // List all contacts with search and pagination support
    @Get()
    @CheckAbility({ action: 'read', subject: 'contact' })
    findAll(
        @Query('search') search?: string,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('channel') channel?: string,
        @Query('status') status?: string,
    ) {
        return this.contactService.findAll({ search, page, limit, channel, status });
    }

    // Create a new contact manually along with their first channel
    @Post()
    @CheckAbility({ action: 'create', subject: 'contact' })
    createContact(@Body() dto: CreateContactDto) {
        return this.contactService.createContact(dto);
    }

    // Get a single contact with channel and active enquiry details
    @Get(':id')
    @CheckAbility({ action: 'read', subject: 'contact' })
    findById(@Param('id') id: string) {
        return this.contactService.findById(id);
    }

    // Update basic contact profile details
    @Patch(':id')
    @CheckAbility({ action: 'update', subject: 'contact' })
    updateContact(@Param('id') id: string, @Body() dto: UpdateContactDto) {
        return this.contactService.updateContact(id, dto);
    }

    // Delete a contact if they have no active enquiries
    @Delete(':id')
    @CheckAbility({ action: 'delete', subject: 'contact' })
    deleteContact(@Param('id') id: string) {
        return this.contactService.deleteContact(id);
    }

    // Delete multiple contacts in bulk
    @Delete()
    @CheckAbility({ action: 'delete', subject: 'contact' })
    deleteContacts(@Body('ids') ids: string[]) {
        return this.contactService.deleteContacts(ids);
    }

    // Add a new channel to an existing contact
    @Post(':id/channels')
    @CheckAbility({ action: 'update', subject: 'contact' })
    addChannel(@Param('id') id: string, @Body() dto: AddChannelDto) {
        return this.contactService.addChannel(id, dto);
    }

    // Remove a channel from a contact
    @Delete(':id/channels/:channelId')
    @CheckAbility({ action: 'update', subject: 'contact' })
    removeChannel(@Param('id') id: string, @Param('channelId') channelId: string) {
        return this.contactService.removeChannel(id, channelId);
    }

    // Set a contact channel as primary
    @Patch(':id/channels/:channelId/primary')
    @CheckAbility({ action: 'update', subject: 'contact' })
    setPrimaryChannel(@Param('id') id: string, @Param('channelId') channelId: string) {
        return this.contactService.setPrimaryChannel(id, channelId);
    }

    // Get all enquiries associated with a contact
    @Get(':contactId/enquiries')
    @CheckAbility({ action: 'read', subject: 'enquiry' })
    getEnquiriesByContact(@Param('contactId') contactId: string) {
        return this.enquiryService.getEnquiriesByContact(contactId);
    }
}