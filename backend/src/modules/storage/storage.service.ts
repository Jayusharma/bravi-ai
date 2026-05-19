import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    this.bucket = process.env.R2_BUCKET_NAME ?? 'messaging-attachments';
    this.publicUrl = process.env.R2_PUBLIC_URL ?? '';

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : process.env.S3_ENDPOINT,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
  }

  generateKey(prefix: string, originalFilename: string): string {
    const ext = path.extname(originalFilename).toLowerCase();
    return `${prefix}/${randomUUID()}${ext}`;
  }

  async uploadBuffer(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
    this.logger.log(`✅ Uploaded ${key} (${buffer.length} bytes)`);
    return this.publicUrl ? `${this.publicUrl}/${key}` : key;
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, cmd, { expiresIn });
  }

  async deleteFile(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`🗑️  Deleted ${key}`);
  }

  getCdnUrl(key: string): string {
    return this.publicUrl ? `${this.publicUrl}/${key}` : key;
  }
}
