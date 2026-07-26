// channels.service.ts — owns ChannelConnection CRUD, the on/off toggle, and credential
// encrypt/decrypt. This is the ONLY place ChannelConnection rows are read or written.
//
// Providers wired today:
//   SENDGRID_EMAIL — credentials { apiKey },              externalAccountId = from-email
//   META_WHATSAPP  — credentials { accessToken, verifyToken }, externalAccountId = phoneNumberId
// Credentials are stored as ONE encrypted JSON blob so every provider shares the same column.
//
// Methods that matter outside this module:
//   findConnectionForChannel()  — the toggle check for outbound + the email webhook
//   findConnectionForProvider() — the toggle check for the Meta webhook, looked up by
//                                 provider rather than channel
//   resolveCredentials()        — decrypted SendGrid creds for the outbound email adapter
//   resolveMetaCredentials()    — decrypted Meta creds for the Meta webhook (and outbound later)

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

// Decrypted credential shapes, per provider.
interface StoredCredentials {
  apiKey?: string; // SENDGRID_EMAIL
  verificationKey?: string; // SENDGRID_EMAIL — Signed Event Webhook Public Verification Key
  accessToken?: string; // META_WHATSAPP
  verifyToken?: string; // META_WHATSAPP — answers Meta's GET webhook-verify handshake
  appSecret?: string; // META_WHATSAPP — used for HMAC webhook payload signature verification
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── PROVIDER → MESSAGE CHANNEL MAP ──
  // Every provider maps to exactly one MessageChannel.
  private channelForProvider(provider: ChannelProvider): MessageChannel {
    switch (provider) {
      case ChannelProvider.SENDGRID_EMAIL:
        return MessageChannel.EMAIL;
      case ChannelProvider.META_WHATSAPP:
        return MessageChannel.WHATSAPP;
      default:
        return MessageChannel.WHATSAPP;
    }
  }

  /** Decrypts + parses the stored credentials JSON. */
  private parseCredentials(conn: ChannelConnection): StoredCredentials {
    const plain = decryptCredential(conn.credentials);
    try {
      return JSON.parse(plain) as StoredCredentials;
    } catch {
      // Legacy rows (first email build) stored the raw API key, not JSON.
      return { apiKey: plain };
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

  /** Asks Meta's Graph API about the phone number. Throws if the token/number pair is invalid. */
  private async validateMetaCredentials(phoneNumberId: string, accessToken: string): Promise<void> {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=verified_name,display_phone_number`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new BadRequestException(
        'Meta rejected these credentials — check the Phone Number ID and Access Token.',
      );
    }
  }

  /** Hides the encrypted blob; shows only the last 4 chars of the provider's secret, e.g. "••••9f2a". */
  private mask(conn: ChannelConnection, secret?: string): MaskedChannelConnection {
    const { credentials: _credentials, ...rest } = conn;
    const creds = secret ? undefined : this.parseCredentials(conn);
    const real = secret ?? creds?.apiKey ?? creds?.accessToken ?? '';
    return { ...rest, apiKeyMasked: `••••${real.slice(-4)}` };
  }

  // ═══════════════════════════════════════════════════════════════════
  // POST /channels — user clicks "Connect" in the Add Channel modal
  // ═══════════════════════════════════════════════════════════════════
  async create(dto: CreateChannelDto, userId: string): Promise<MaskedChannelConnection> {
    let externalAccountId: string;
    let credentialsJson: string;
    let secret: string;

    switch (dto.provider) {
      // Email: validate the API key against SendGrid, store { apiKey, verificationKey }
      case ChannelProvider.SENDGRID_EMAIL: {
        if (!dto.apiKey || !dto.fromEmail) {
          throw new BadRequestException('SendGrid needs an API key and a from-email.');
        }
        await this.validateSendGridKey(dto.apiKey);
        externalAccountId = dto.fromEmail;
        credentialsJson = JSON.stringify({
          apiKey: dto.apiKey,
          verificationKey: dto.verificationKey,
        });
        secret = dto.apiKey;
        break;
      }

      // Meta WhatsApp: validate token + phone number against the Graph API,
      // store { accessToken, verifyToken } — verifyToken answers Meta's webhook handshake
      case ChannelProvider.META_WHATSAPP: {
        if (!dto.phoneNumberId || !dto.accessToken || !dto.verifyToken) {
          throw new BadRequestException(
            'Meta WhatsApp needs a Phone Number ID, an Access Token, and a Verify Token.',
          );
        }
        await this.validateMetaCredentials(dto.phoneNumberId, dto.accessToken);
        externalAccountId = dto.phoneNumberId;
        credentialsJson = JSON.stringify({
          accessToken: dto.accessToken,
          verifyToken: dto.verifyToken,
          appSecret: dto.appSecret,
        });
        secret = dto.accessToken;
        break;
      }

      default:
        throw new BadRequestException(`Provider ${dto.provider} is not supported yet.`);
    }

    try {
      const conn = await this.prisma.channelConnection.create({
        data: {
          provider: dto.provider,
          channel: this.channelForProvider(dto.provider),
          displayName: dto.displayName,
          externalAccountId,
          credentials: encryptCredential(credentialsJson),
          status: ConnectionStatus.ACTIVE,
          createdBy: userId,
        },
      });
      return this.mask(conn, secret);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A channel connection for "${externalAccountId}" already exists.`);
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
  // PATCH /channels/:id — rename, or rotate the SendGrid key / from-email
  // (credential rotation for Meta lands with Meta outbound — rename works for all)
  // ═══════════════════════════════════════════════════════════════════
  async update(id: string, dto: UpdateChannelDto): Promise<MaskedChannelConnection> {
    const existing = await this.findOneOrThrow(id); // 404 if missing

    if ((dto.apiKey || dto.fromEmail) && existing.provider !== ChannelProvider.SENDGRID_EMAIL) {
      throw new BadRequestException('apiKey/fromEmail only apply to SendGrid email connections.');
    }
    if (dto.apiKey) await this.validateSendGridKey(dto.apiKey);

    const conn = await this.prisma.channelConnection.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.fromEmail !== undefined ? { externalAccountId: dto.fromEmail } : {}),
        ...(dto.apiKey !== undefined
          ? { credentials: encryptCredential(JSON.stringify({ apiKey: dto.apiKey })) }
          : {}),
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
   * never connected. This is THE lookup outbound and the email webhook go through; neither
   * of them looks at env vars or config directly, only at this table.
   */
  async findConnectionForChannel(channel: MessageChannel): Promise<ChannelConnection | null> {
    return this.prisma.channelConnection.findFirst({
      where: { channel },
      orderBy: { createdAt: 'desc' }, // most recently connected wins if more than one exists
    });
  }

  /** Same lookup, but by provider. The Meta webhook uses this. */
  async findConnectionForProvider(provider: ChannelProvider): Promise<ChannelConnection | null> {
    return this.prisma.channelConnection.findFirst({
      where: { provider },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Decrypted SendGrid creds for the outbound email adapter and inbound signature verification.
   * Returns undefined for non-email rows.
   */
  resolveCredentials(conn: ChannelConnection): { apiKey: string; fromEmail: string; verificationKey?: string } | undefined {
    if (conn.provider !== ChannelProvider.SENDGRID_EMAIL) return undefined;
    const creds = this.parseCredentials(conn);
    if (!creds.apiKey) return undefined;
    return {
      apiKey: creds.apiKey,
      fromEmail: conn.externalAccountId,
      verificationKey: creds.verificationKey,
    };
  }

  resolveSendGridCredentials(conn: ChannelConnection): { apiKey: string; fromEmail: string; verificationKey?: string } | undefined {
    return this.resolveCredentials(conn);
  }

  /** Decrypted Meta creds — the Meta webhook needs verifyToken & appSecret; outbound needs accessToken. */
  resolveMetaCredentials(conn: ChannelConnection): {
    accessToken: string;
    verifyToken: string;
    phoneNumberId: string;
    appSecret?: string;
  } {
    const creds = this.parseCredentials(conn);
    return {
      accessToken: creds.accessToken ?? '',
      verifyToken: creds.verifyToken ?? '',
      phoneNumberId: conn.externalAccountId,
      appSecret: creds.appSecret,
    };
  }

  /** Stamps lastInboundAt — called by the inbound webhooks right after they accept a message. */
  async markInboundReceived(connectionId: string): Promise<void> {
    await this.prisma.channelConnection.update({
      where: { id: connectionId },
      data: { lastInboundAt: new Date() },
    });
  }
}
