// draft.service.ts — Draft CRUD: upsert active draft, save-for-later, attachment management, orphan cleanup.
// NOTE: This service emits NO EventEmitter2 events. Drafts are private per-user state, not broadcast.

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MessageChannel, DraftStatus, AttachmentKind } from '@prisma/client';

const THIRTY_MINUTES = 30 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/** MIME type → AttachmentKind mapping for validation */
const MIME_TO_KIND: Record<string, AttachmentKind> = {
  'image/jpeg': AttachmentKind.IMAGE,
  'image/png': AttachmentKind.IMAGE,
  'image/gif': AttachmentKind.IMAGE,
  'image/webp': AttachmentKind.IMAGE,
  'image/svg+xml': AttachmentKind.IMAGE,
  'image/bmp': AttachmentKind.IMAGE,
  'video/mp4': AttachmentKind.VIDEO,
  'video/webm': AttachmentKind.VIDEO,
  'video/quicktime': AttachmentKind.VIDEO,
  'video/3gpp': AttachmentKind.VIDEO,
  'audio/webm': AttachmentKind.AUDIO,
  'audio/ogg': AttachmentKind.AUDIO,
  'audio/mpeg': AttachmentKind.AUDIO,
  'audio/aac': AttachmentKind.AUDIO,
  'audio/flac': AttachmentKind.AUDIO,
  'audio/opus': AttachmentKind.AUDIO,
  'audio/wav': AttachmentKind.AUDIO,
  'audio/mp4': AttachmentKind.VOICE_NOTE,
  'application/pdf': AttachmentKind.DOCUMENT,
  'application/msword': AttachmentKind.DOCUMENT,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': AttachmentKind.DOCUMENT,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': AttachmentKind.DOCUMENT,
  'application/vnd.ms-excel': AttachmentKind.DOCUMENT,
  'application/vnd.ms-powerpoint': AttachmentKind.DOCUMENT,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': AttachmentKind.DOCUMENT,
  'application/zip': AttachmentKind.DOCUMENT,
  'application/x-zip-compressed': AttachmentKind.DOCUMENT,
  'application/x-rar-compressed': AttachmentKind.DOCUMENT,
  'text/plain': AttachmentKind.DOCUMENT,
  'text/csv': AttachmentKind.DOCUMENT,
};

export const ALLOWED_MIMES = new Set(Object.keys(MIME_TO_KIND));

export { MIME_TO_KIND };

@Injectable()
export class DraftService {
  private readonly logger = new Logger(DraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ─── DRAFT MANAGEMENT ────────────────────────────────────────────────────

  /** Saves draft (upsert): finds ACTIVE for enquiry+channel+user, updates if found, creates if not */
  async saveDraft(
    enquiryId: string,
    dto: { channel: MessageChannel; subject?: string; body?: string; saveForLater?: boolean },
    userId: string,
  ) {
    const expiresAt = new Date(Date.now() + (dto.saveForLater ? SEVEN_DAYS : THIRTY_MINUTES));

    const existing = await this.prisma.outboundDraft.findFirst({
      where: {
        enquiryId,
        channel: dto.channel,
        createdBy: userId,
        status: DraftStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
    });

    if (existing) {
      return this.prisma.outboundDraft.update({
        where: { id: existing.id },
        data: {
          subject: dto.subject,
          body: dto.body,
          expiresAt,
        },
      });
    }

    return this.prisma.outboundDraft.create({
      data: {
        enquiryId,
        channel: dto.channel,
        subject: dto.subject,
        body: dto.body,
        createdBy: userId,
        expiresAt,
      },
    });
  }

  /** Loads active, unexpired draft for enquiry+channel+user — null if none */
  async getActiveDraft(enquiryId: string, channel: MessageChannel | undefined, userId: string) {
    return this.prisma.outboundDraft.findFirst({
      where: {
        enquiryId,
        createdBy: userId,
        status: DraftStatus.ACTIVE,
        expiresAt: { gt: new Date() },
        ...(channel ? { channel } : {}),
      },
      include: { attachments: true },
    });
  }

  /** Marks draft CLEARED, cleans attachments from storage */
  async discardDraft(draftId: string, userId: string): Promise<void> {
    const draft = await this.requireOwnDraft(draftId, userId);
    await this.prisma.outboundDraft.update({
      where: { id: draft.id },
      data: { status: DraftStatus.CLEARED },
    });
  }

  /** Extends expiry to 7 days; status stays ACTIVE */
  async saveForLater(draftId: string, userId: string) {
    const draft = await this.requireOwnDraft(draftId, userId);
    if (draft.status !== DraftStatus.ACTIVE) {
      throw new BadRequestException('Draft is no longer active');
    }
    return this.prisma.outboundDraft.update({
      where: { id: draft.id },
      data: { expiresAt: new Date(Date.now() + SEVEN_DAYS) },
    });
  }

  /** Updates draft body/subject and refreshes 30-min expiry */
  async updateDraft(
    draftId: string,
    dto: { channel?: MessageChannel; subject?: string; body?: string },
    userId: string,
  ) {
    const draft = await this.requireOwnDraft(draftId, userId);
    if (draft.status !== DraftStatus.ACTIVE) {
      throw new BadRequestException('Draft is no longer active');
    }

    return this.prisma.outboundDraft.update({
      where: { id: draft.id },
      data: {
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        expiresAt: new Date(Date.now() + THIRTY_MINUTES),
      },
    });
  }

  // ─── ATTACHMENTS ──────────────────────────────────────────────────────────

  /** Adds attachment + opportunistically cleans expired draft attachments (batch: 50) */
  async addAttachment(draftId: string, file: Express.Multer.File, userId: string) {
    const draft = await this.requireOwnDraft(draftId, userId);
    if (draft.status !== DraftStatus.ACTIVE) {
      throw new BadRequestException('Draft is not active');
    }

    const kind = MIME_TO_KIND[file.mimetype] ?? AttachmentKind.DOCUMENT;
    const key = this.storage.generateKey(`drafts/${draftId}`, file.originalname);
    const cdnUrl = await this.storage.uploadBuffer(key, file.buffer, file.mimetype);

    const attachment = await this.prisma.draftAttachment.create({
      data: {
        draftId,
        kind,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        storageKey: key,
        cdnUrl,
      },
    });

    // Fire-and-forget cleanup — non-blocking, 24-hour grace period
    this.cleanOrphanedFiles().catch((err) =>
      this.logger.warn(`Orphan file cleanup failed: ${err.message}`),
    );

    return attachment;
  }

  /** Removes attachment row from DB only — storage file is NOT deleted immediately.
   *  cleanOrphanedFiles() handles storage cleanup after the 24-hour grace period. */
  async removeAttachment(draftId: string, attachmentId: string, userId: string): Promise<void> {
    await this.requireOwnDraft(draftId, userId);
    const attachment = await this.prisma.draftAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.draftId !== draftId) {
      throw new NotFoundException('Attachment not found');
    }
    // DB row only — storage file kept for 24-hour grace period
    await this.prisma.draftAttachment.delete({ where: { id: attachmentId } });
  }

  /** Lazy cleanup: deletes storage files for abandoned draft attachments after a 24-hour grace period.
   *  Only deletes storage if the file is not referenced by any sent MessageAttachment. */
  private async cleanOrphanedFiles(): Promise<void> {
    const grace = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Attachments belonging to expired/cleared drafts that are older than 24 hours
    const candidates = await this.prisma.draftAttachment.findMany({
      where: {
        createdAt: { lt: grace },
        draft: {
          OR: [
            { status: DraftStatus.CLEARED },
            { status: DraftStatus.EXPIRED },
            { status: DraftStatus.ACTIVE, expiresAt: { lt: new Date() } },
          ],
        },
      },
      take: 50,
      select: { id: true, storageKey: true },
    });

    if (candidates.length === 0) return;

    // Check which storage keys are still referenced by sent MessageAttachments
    const storageKeys = candidates.map((a) => a.storageKey);
    const referenced = await this.prisma.messageAttachment.findMany({
      where: { storageKey: { in: storageKeys } },
      select: { storageKey: true },
    });
    const referencedKeys = new Set(referenced.map((r) => r.storageKey));

    // Delete storage file only when no MessageAttachment references it
    for (const a of candidates) {
      if (!referencedKeys.has(a.storageKey)) {
        this.storage.deleteFile(a.storageKey).catch(() => {});
      }
    }

    // Always delete the DraftAttachment row
    await this.prisma.draftAttachment.deleteMany({
      where: { id: { in: candidates.map((a) => a.id) } },
    });

    this.logger.log(`🧹 Cleaned ${candidates.length} orphaned draft attachment row(s) (${referencedKeys.size} file(s) kept — referenced by sent messages)`);
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  /** Fetches draft and throws if not found or not owned by userId */
  async requireOwnDraft(draftId: string, userId: string) {
    const draft = await this.prisma.outboundDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
    if (draft.createdBy !== userId) throw new ForbiddenException('Cannot modify another user\'s draft');
    return draft;
  }
}
