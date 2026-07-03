// channels.service.ts — owns ChannelConnection CRUD, the on/off toggle, and credential
// encrypt/decrypt. This is the ONLY place ChannelConnection rows are read or written.
//
// Two methods matter outside this module:
//   getActiveConnection() — called by outbound (before every send) and the email webhook
//                            (before every inbound accept) to check the toggle.
//   resolveCredentials()  — called by outbound right after, to get the real API key.

import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { ChannelConnection, ChannelProvider, ConnectionStatus, MessageChannel, Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { encryptCredential, decryptCredential } from 'src/common/crypto/credential-cipher';

// What the frontend gets back — the encrypted `credentials` blob never leaves this service.
export type MaskedChannelConnection = Omit<ChannelConnection, 'credentials'> & {
  apiKeyMasked: string;
};

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── PROVIDER → MESSAGE CHANNEL MAP ──
  // Every provider maps to exactly one MessageChannel. SendGrid is an EMAIL provider.
  private channelForProvider(provider: ChannelProvider): MessageChannel {
    switch (provider) {
      case ChannelProvider.SENDGRID_EMAIL:
        return MessageChannel.EMAIL;
    }
  }

  /** Pings SendGrid with the given key. Throws if the key is invalid — called before every save. */
  private async validateSendGridKey(apiKey: string): Promise<void> {
    const res = await fetch('https://api.sendgrid.com/v3/scopes', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new BadRequestException('SendGrid rejected this API key — check it and try again.');
    }
  }

  /** Hides the encrypted blob and shows only the last 4 chars of the real key, e.g. "••••9f2a". */
  private mask(conn: ChannelConnection, apiKey?: string): MaskedChannelConnection {
    const { credentials: _credentials, ...rest } = conn;
    const last4 = apiKey ? apiKey.slice(-4) : decryptCredential(conn.credentials).slice(-4);
    return { ...rest, apiKeyMasked: `••••${last4}` };
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /channels — user clicks "Connect" in the Add Channel modal
  // ═══════════════════════════════════════════════════════════════════
  async create(dto: CreateChannelDto, userId: string): Promise<MaskedChannelConnection> {
    await this.validateSendGridKey(dto.apiKey);

    try {
      const conn = await this.prisma.channelConnection.create({
        data: {
          provider: dto.provider,
          channel: this.channelForProvider(dto.provider),
          displayName: dto.displayName,
          externalAccountId: dto.fromEmail,
          credentials: encryptCredential(dto.apiKey),
          status: ConnectionStatus.ACTIVE,
          createdBy: userId,
        },
      });
      return this.mask(conn, dto.apiKey);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A channel connection for "${dto.fromEmail}" already exists.`);
      }
      throw e;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET /channels — the Channels list page
  // ═══════════════════════════════════════════════════════════════════
  async findAll(): Promise<MaskedChannelConnection[]> {
    const rows = await this.prisma.channelConnection.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.mask(r));
  }

  private async findOneOrThrow(id: string): Promise<ChannelConnection> {
    const conn = await this.prisma.channelConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundException(`Channel connection ${id} not found`);
    return conn;
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /channels/:id — rename, or rotate the API key / from-email
  // ═══════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateChannelDto): Promise<MaskedChannelConnection> {
    await this.findOneOrThrow(id); // 404 if missing
    if (dto.apiKey) await this.validateSendGridKey(dto.apiKey);

    const conn = await this.prisma.channelConnection.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.fromEmail !== undefined ? { externalAccountId: dto.fromEmail } : {}),
        ...(dto.apiKey !== undefined ? { credentials: encryptCredential(dto.apiKey) } : {}),
        lastError: null, // a successful edit clears any previous error state
      },
    });
    return this.mask(conn, dto.apiKey);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /channels/:id/status — THE TOGGLE. Flips ACTIVE ⇄ DISABLED.
  // ═══════════════════════════════════════════════════════════════════
  async updateStatus(id: string, status: ConnectionStatus): Promise<MaskedChannelConnection> {
    await this.findOneOrThrow(id); // 404 if missing
    const conn = await this.prisma.channelConnection.update({ where: { id }, data: { status } });
    this.logger.log(`Channel ${conn.displayName} (${conn.id}) → ${status}`);
    return this.mask(conn);
  }

  // ═══════════════════════════════════════════════════════════════════
  // DELETE /channels/:id — remove the connection entirely
  // ═══════════════════════════════════════════════════════════════════
  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id); // 404 if missing
    await this.prisma.channelConnection.delete({ where: { id } });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Used by OTHER modules (outbound, webhooks) — not exposed as a route.
  // ═══════════════════════════════════════════════════════════════════

  /**
   * The connection for a channel, in whatever status it's in — or null if that channel was
   * never connected. This is THE lookup outbound and inbound both go through; neither of
   * them looks at env vars or config directly, only at this table.
   */
  async findConnectionForChannel(channel: MessageChannel): Promise<ChannelConnection | null> {
    return this.prisma.channelConnection.findFirst({
      where: { channel },
      orderBy: { createdAt: 'desc' }, // most recently connected wins if more than one exists
    });
  }

  /** Decrypts the stored key. Only outbound (right before calling the provider) needs the real value. */
  resolveCredentials(conn: ChannelConnection): { apiKey: string; fromEmail: string } {
    return { apiKey: decryptCredential(conn.credentials), fromEmail: conn.externalAccountId };
  }

  /** Stamps lastInboundAt — called by the email webhook right after it accepts a message. */
  async markInboundReceived(connectionId: string): Promise<void> {
    await this.prisma.channelConnection.update({
      where: { id: connectionId },
      data: { lastInboundAt: new Date() },
    });
  }
}
