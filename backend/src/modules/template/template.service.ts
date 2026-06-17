import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotImplementedException,
} from '@nestjs/common';
import {
    Prisma,
    MessageChannel,
    MessageTemplate,
    TemplateType,
    WaApprovalStatus,
    WaContentType,
} from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { parseBody, classifyVariable, sourceForLabel, compileBody } from './template.engine';
import { resolveBySource, type VariableContext } from './template-system-fields';

export interface ListTemplatesFilter {
    type?: TemplateType;
    channel?: MessageChannel;
    search?: string;
    page?: number;
    limit?: number;
}

const includeVariables = {
    variables: { orderBy: { position: 'asc' as const } },
};

@Injectable()
export class TemplateService {
    private readonly logger = new Logger(TemplateService.name);

    constructor(private readonly prisma: PrismaService) {}

    /** Builds TemplateVariable rows from a body by parsing + classifying each [Label]. */
    private buildVariables(body: string) {
        return parseBody(body).map((v) => ({
            position: v.position,
            label: v.label,
            source: sourceForLabel(v.label),
            type: classifyVariable(v.label),
        }));
    }

    private assertChannelSupported(channel: MessageChannel) {
        if (channel !== MessageChannel.WHATSAPP && channel !== MessageChannel.EMAIL) {
            throw new BadRequestException('Templates support WhatsApp or Email channels only.');
        }
    }

    async create(dto: CreateTemplateDto, userId: string): Promise<MessageTemplate> {
        this.assertChannelSupported(dto.channel);
        const isWhatsApp = dto.type === TemplateType.WHATSAPP;

        try {
            return await this.prisma.messageTemplate.create({
                data: {
                    type: dto.type,
                    name: dto.name,
                    friendlyName: dto.friendlyName,
                    channel: dto.channel,
                    language: dto.language ?? 'en',
                    body: dto.body,
                    bodyCompiled: isWhatsApp ? compileBody(dto.body) : null,
                    subject: dto.channel === MessageChannel.EMAIL ? (dto.subject ?? null) : null,
                    contentType: dto.contentType ?? WaContentType.TEXT,
                    buttons: (dto.buttons as Prisma.InputJsonValue) ?? undefined,
                    headerMediaUrl: dto.headerMediaUrl ?? null,
                    category: isWhatsApp ? (dto.category ?? null) : null,
                    approvalStatus: isWhatsApp ? WaApprovalStatus.DRAFT : null,
                    sampleValues: (dto.sampleValues as Prisma.InputJsonValue) ?? undefined,
                    isActive: dto.isActive ?? true,
                    createdBy: userId,
                    variables: { create: this.buildVariables(dto.body) },
                },
                include: includeVariables,
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                throw new ConflictException(`A template named "${dto.name}" already exists.`);
            }
            throw e;
        }
    }

    async findAll(filter: ListTemplatesFilter = {}): Promise<{
        data: MessageTemplate[];
        meta: { total: number; page: number; limit: number; totalPages: number };
    }> {
        const page = filter.page ?? 1;
        const limit = filter.limit ?? 50;
        const skip = (page - 1) * limit;

        const where: Prisma.MessageTemplateWhereInput = {
            ...(filter.type ? { type: filter.type } : {}),
            ...(filter.channel ? { channel: filter.channel } : {}),
            ...(filter.search
                ? {
                      OR: [
                          { friendlyName: { contains: filter.search, mode: 'insensitive' } },
                          { name: { contains: filter.search, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        };

        const [data, total] = await Promise.all([
            this.prisma.messageTemplate.findMany({
                where,
                include: includeVariables,
                orderBy: { updatedAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.messageTemplate.count({ where }),
        ]);

        return {
            data,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async findOne(id: string): Promise<MessageTemplate> {
        const template = await this.prisma.messageTemplate.findUnique({
            where: { id },
            include: includeVariables,
        });
        if (!template) throw new NotFoundException(`Template ${id} not found`);
        return template;
    }

    /** True once a WhatsApp template has been submitted (PENDING or beyond) — then it's frozen. */
    private isFrozen(t: MessageTemplate): boolean {
        return (
            t.type === TemplateType.WHATSAPP &&
            t.approvalStatus != null &&
            t.approvalStatus !== WaApprovalStatus.DRAFT
        );
    }

    async update(id: string, dto: UpdateTemplateDto): Promise<MessageTemplate> {
        const existing = await this.findOne(id);
        if (this.isFrozen(existing)) {
            throw new ForbiddenException(
                'This template was submitted for approval and is frozen. Duplicate it to make changes.',
            );
        }
        if (dto.channel) this.assertChannelSupported(dto.channel);

        const isWhatsApp = (dto.type ?? existing.type) === TemplateType.WHATSAPP;
        const bodyChanged = dto.body !== undefined && dto.body !== existing.body;

        try {
            return await this.prisma.$transaction(async (tx) => {
                if (bodyChanged) {
                    // Re-parse: replace the variable set to match the new body.
                    await tx.templateVariable.deleteMany({ where: { templateId: id } });
                }
                return tx.messageTemplate.update({
                    where: { id },
                    data: {
                        ...(dto.type !== undefined ? { type: dto.type } : {}),
                        ...(dto.name !== undefined ? { name: dto.name } : {}),
                        ...(dto.friendlyName !== undefined ? { friendlyName: dto.friendlyName } : {}),
                        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
                        ...(dto.language !== undefined ? { language: dto.language } : {}),
                        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
                        ...(dto.contentType !== undefined ? { contentType: dto.contentType } : {}),
                        ...(dto.category !== undefined ? { category: dto.category } : {}),
                        ...(dto.headerMediaUrl !== undefined ? { headerMediaUrl: dto.headerMediaUrl } : {}),
                        ...(dto.buttons !== undefined ? { buttons: dto.buttons as Prisma.InputJsonValue } : {}),
                        ...(dto.sampleValues !== undefined ? { sampleValues: dto.sampleValues as Prisma.InputJsonValue } : {}),
                        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
                        ...(dto.body !== undefined
                            ? { body: dto.body, bodyCompiled: isWhatsApp ? compileBody(dto.body) : null }
                            : {}),
                        ...(bodyChanged ? { variables: { create: this.buildVariables(dto.body!) } } : {}),
                    },
                    include: includeVariables,
                });
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                throw new ConflictException(`A template named "${dto.name}" already exists.`);
            }
            throw e;
        }
    }

    async remove(id: string): Promise<void> {
        await this.findOne(id); // 404 if missing
        // No send-history references templates yet → hard delete (variables cascade).
        await this.prisma.messageTemplate.delete({ where: { id } });
    }

    /** Copies a template as a fresh DRAFT with a unique name. */
    async duplicate(id: string): Promise<MessageTemplate> {
        const src = await this.findOne(id);
        const isWhatsApp = src.type === TemplateType.WHATSAPP;
        const copyName = `${src.name}_copy_${Date.now().toString(36)}`;

        return this.prisma.messageTemplate.create({
            data: {
                type: src.type,
                name: copyName,
                friendlyName: `${src.friendlyName} (copy)`,
                channel: src.channel,
                language: src.language,
                body: src.body,
                bodyCompiled: isWhatsApp ? compileBody(src.body) : null,
                subject: src.subject,
                contentType: src.contentType,
                buttons: (src.buttons as Prisma.InputJsonValue) ?? undefined,
                headerMediaUrl: src.headerMediaUrl,
                category: src.category,
                approvalStatus: isWhatsApp ? WaApprovalStatus.DRAFT : null,
                sampleValues: (src.sampleValues as Prisma.InputJsonValue) ?? undefined,
                isActive: src.isActive,
                createdBy: src.createdBy,
                variables: { create: this.buildVariables(src.body) },
            },
            include: includeVariables,
        });
    }

    /** Custom-variable autocomplete — distinct CUSTOM labels matching q, across all templates. */
    async suggestVariables(q: string) {
        const query = (q ?? '').trim();
        const rows = await this.prisma.templateVariable.findMany({
            where: {
                type: 'CUSTOM',
                ...(query ? { label: { contains: query, mode: 'insensitive' } } : {}),
            },
            distinct: ['label'],
            take: 10,
            orderBy: { label: 'asc' },
            select: { label: true, source: true, type: true },
        });
        return rows;
    }

    /**
     * Templates usable in a given conversation, with SYSTEM variables pre-resolved against the
     * live contact/enquiry/agent. INTERNAL + active + channel-matching only (WhatsApp send is a
     * later step). CUSTOM variables come back with value=null for the agent to fill.
     */
    async findUsable(enquiryId: string, channel: MessageChannel, userId: string) {
        const enquiry = await this.prisma.enquiry.findUnique({
            where: { id: enquiryId },
            include: { contact: { include: { channels: true } } },
        });
        if (!enquiry) throw new NotFoundException(`Enquiry ${enquiryId} not found`);

        const user = await this.prisma.user.findUnique({ where: { id: userId } });

        const ctx: VariableContext = {
            contact: enquiry.contact,
            enquiry,
            user,
            config: () => undefined, // no SystemConfig model yet → business name/phone unresolved
        };

        const templates = await this.prisma.messageTemplate.findMany({
            where: { type: TemplateType.INTERNAL, isActive: true, channel },
            include: includeVariables,
            orderBy: { updatedAt: 'desc' },
        });

        return templates.map((t) => ({
            ...t,
            resolvedVariables: t.variables.map((v) => ({
                label: v.label,
                source: v.source,
                type: v.type,
                value: v.type === 'SYSTEM' ? (resolveBySource(v.source, ctx) ?? null) : null,
            })),
        }));
    }

    /** Resolve a template body with supplied values — Step 4 (registry-backed). */
    async render(
        _templateId: string,
        _variables: Record<string, string>,
    ): Promise<{ subject?: string; body: string }> {
        throw new NotImplementedException('TemplateService.render — Step 4');
    }
}
