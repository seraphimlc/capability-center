import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { PrismaService } from './prisma.service';
import { ApiException } from './errors';
import { assertSafePrefix, shanghaiParts } from './domain';

export type OssRuntime = {
  provider: 'minio' | 'aliyun' | 'mock';
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  prefix: string;
  publicRead: boolean;
  signedUrlExpires: number;
  mediaPublicBase: string;
  forcePathStyle: boolean;
  source: 'database' | 'env';
};

const MAX_BYTES = Number(process.env.OSS_MAX_BYTES || 20 * 1024 * 1024);

@Injectable()
export class FileService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const cfg = await this.resolve();
    if (cfg.provider === 'mock') return;
    try {
      const client = this.client(cfg, cfg.endpoint);
      try {
        await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
      }
      await client.send(
        new PutBucketCorsCommand({
          Bucket: cfg.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: ['*'],
                AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (error) {
      console.error('oss bootstrap skipped', error instanceof Error ? error.message : 'error');
    }
  }

  async resolve(): Promise<OssRuntime> {
    const row = await this.prisma.ossConfig.findFirst({ where: { status: 'active' } });
    if (row) {
      try {
        return this.normalize({
          provider: row.provider,
          endpoint: row.endpoint,
          publicEndpoint: row.publicEndpoint || row.endpoint,
          region: row.region,
          bucket: row.bucket,
          accessKeyId: row.accessKeyId,
          accessKeySecret: row.accessKeySecret,
          prefix: row.prefix,
          publicRead: row.publicRead,
          signedUrlExpires: row.signedUrlExpires,
          mediaPublicBase: row.mediaPublicBase || '',
          forcePathStyle: row.forcePathStyle,
          source: 'database',
        });
      } catch (error) {
        console.error('oss config rejected', error instanceof Error ? error.message : 'error');
      }
    }
    return this.normalize({
      provider: (process.env.OSS_PROVIDER as OssRuntime['provider']) || 'minio',
      endpoint: process.env.OSS_ENDPOINT || 'http://127.0.0.1:9000',
      publicEndpoint: process.env.OSS_PUBLIC_ENDPOINT || process.env.OSS_ENDPOINT || 'http://127.0.0.1:9000',
      region: process.env.OSS_REGION || 'us-east-1',
      bucket: process.env.OSS_BUCKET || 'capability-center',
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
      prefix: process.env.OSS_PREFIX || 'capability-center',
      publicRead: process.env.OSS_PUBLIC_READ === 'true',
      signedUrlExpires: Number(process.env.OSS_SIGNED_URL_EXPIRES || 3600),
      mediaPublicBase: process.env.MEDIA_PUBLIC_BASE || '',
      forcePathStyle: process.env.OSS_FORCE_PATH_STYLE ? process.env.OSS_FORCE_PATH_STYLE === 'true' : (process.env.OSS_PROVIDER || 'minio') !== 'aliyun',
      source: 'env',
    });
  }

  async presign(user: { id: string; tenantId: string }, input: { filename?: string; mime?: string; size?: number }) {
    const mime = (input.mime || '').toLowerCase();
    const size = Number(input.size || 0);
    if (!allowedMime(mime)) throw new ApiException('FILE_MIME_NOT_ALLOWED');
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) throw new ApiException('FILE_TOO_LARGE');
    await this.assertQuota(user.id, size);
    const cfg = await this.resolve();
    const ext = extOf(input.filename || '', mime);
    const parts = shanghaiParts();
    const envName = (process.env.APP_ENV || 'local').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'local';
    const objectKey = `${cfg.prefix}/${envName}/${user.tenantId}/${user.id}/${parts.y}/${parts.m}/${parts.d}/${ulid()}.${ext}`;
    const file = await this.prisma.fileObject.create({
      data: {
        id: ulid(),
        tenantId: user.tenantId,
        userId: user.id,
        objectKey,
        mime,
        size,
        status: 'pending',
      },
    });
    if (cfg.provider === 'mock') {
      return {
        file_id: file.id,
        object_key: objectKey,
        upload_url: `/api/www/files/${file.id}/raw`,
        method: 'PUT',
        headers: { 'Content-Type': mime },
        expires_in: cfg.signedUrlExpires,
        provider: 'mock',
      };
    }
    const client = this.client(cfg, cfg.publicEndpoint);
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: cfg.bucket, Key: objectKey, ContentType: mime }),
      { expiresIn: cfg.signedUrlExpires },
    );
    return {
      file_id: file.id,
      object_key: objectKey,
      upload_url: uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': mime },
      expires_in: cfg.signedUrlExpires,
      provider: cfg.provider,
    };
  }

  async writeRaw(userId: string, fileId: string, body: Buffer, mime: string): Promise<void> {
    const file = await this.prisma.fileObject.findFirst({ where: { id: fileId, userId } });
    if (!file) throw new ApiException('FILE_NOT_FOUND');
    if (body.length <= 0 || body.length > MAX_BYTES) throw new ApiException('FILE_TOO_LARGE');
    const cfg = await this.resolve();
    if (cfg.provider === 'mock') {
      const full = this.mockPath(file.objectKey);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body);
      return;
    }
    const client = this.client(cfg, cfg.endpoint);
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: file.objectKey,
        Body: body,
        ContentType: mime || file.mime,
      }),
    );
  }

  async complete(userId: string, fileId: string) {
    const file = await this.prisma.fileObject.findFirst({ where: { id: fileId, userId } });
    if (!file) throw new ApiException('FILE_NOT_FOUND');
    if (file.status === 'ready') return this.present(file);
    const cfg = await this.resolve();
    let size = file.size;
    if (cfg.provider === 'mock') {
      const info = await stat(this.mockPath(file.objectKey)).catch(() => null);
      if (!info) throw new ApiException('FILE_NOT_READY');
      size = info.size;
    } else {
      const head = await this.client(cfg, cfg.endpoint).send(
        new HeadObjectCommand({ Bucket: cfg.bucket, Key: file.objectKey }),
      );
      size = Number(head.ContentLength || 0);
    }
    if (size <= 0 || size > MAX_BYTES) throw new ApiException('FILE_TOO_LARGE');
    await this.assertQuota(userId, size);
    await this.prisma.fileObject.update({ where: { id: file.id }, data: { status: 'ready', size } });
    await this.prisma.storageQuota.update({
      where: { userId },
      data: { usedBytes: { increment: size } },
    });
    return this.present({ ...file, status: 'ready', size });
  }

  async downloadUrl(userId: string, fileId: string, allowAdmin = false) {
    const file = await this.prisma.fileObject.findFirst({
      where: allowAdmin ? { id: fileId } : { id: fileId, userId },
    });
    if (!file || file.status !== 'ready') throw new ApiException('FILE_NOT_FOUND');
    const cfg = await this.resolve();
    if (cfg.provider === 'mock') {
      return { url: `/api/www/files/${file.id}/raw`, expires_in: cfg.signedUrlExpires, mime: file.mime };
    }
    if (cfg.publicRead && cfg.mediaPublicBase) {
      return { url: `${cfg.mediaPublicBase.replace(/\/$/, '')}/${file.objectKey}`, expires_in: cfg.signedUrlExpires, mime: file.mime };
    }
    const url = await getSignedUrl(
      this.client(cfg, cfg.publicEndpoint),
      new GetObjectCommand({ Bucket: cfg.bucket, Key: file.objectKey }),
      { expiresIn: cfg.signedUrlExpires },
    );
    return { url, expires_in: cfg.signedUrlExpires, mime: file.mime };
  }

  async readRaw(userId: string, fileId: string): Promise<{ mime: string; body: Buffer }> {
    const file = await this.prisma.fileObject.findFirst({ where: { id: fileId, userId } });
    if (!file) throw new ApiException('FILE_NOT_FOUND');
    const cfg = await this.resolve();
    if (cfg.provider !== 'mock') throw new ApiException('FEATURE_DISABLED', '请使用签名地址下载');
    const body = await readFile(this.mockPath(file.objectKey));
    return { mime: file.mime, body };
  }

  async putGenerated(input: { userId: string; tenantId: string; filename: string; mime: string; body: Buffer }) {
    const cfg = await this.resolve();
    const parts = shanghaiParts();
    const envName = (process.env.APP_ENV || 'local').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'local';
    const ext = extOf(input.filename, input.mime);
    const objectKey = `${cfg.prefix}/${envName}/${input.tenantId}/${input.userId}/${parts.y}/${parts.m}/${parts.d}/${ulid()}.${ext}`;
    if (cfg.provider === 'mock') {
      const full = this.mockPath(objectKey);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, input.body);
    } else {
      await this.client(cfg, cfg.endpoint).send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: objectKey,
          Body: input.body,
          ContentType: input.mime,
        }),
      );
    }
    const file = await this.prisma.fileObject.create({
      data: {
        id: ulid(),
        tenantId: input.tenantId,
        userId: input.userId,
        objectKey,
        mime: input.mime,
        size: input.body.length,
        status: 'ready',
      },
    });
    await this.prisma.storageQuota.updateMany({
      where: { userId: input.userId },
      data: { usedBytes: { increment: input.body.length } },
    });
    return file.id;
  }

  async usage(userId: string) {
    const quota = await this.prisma.storageQuota.findUnique({ where: { userId } });
    return {
      used_bytes: quota?.usedBytes ?? 0,
      limit_bytes: quota?.limitBytes ?? 1024 * 1024 * 1024,
    };
  }

  async probe(): Promise<{ ok: boolean; provider: string; bucket: string }> {
    const cfg = await this.resolve();
    if (cfg.provider === 'mock') return { ok: true, provider: 'mock', bucket: cfg.bucket };
    await this.client(cfg, cfg.endpoint).send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    return { ok: true, provider: cfg.provider, bucket: cfg.bucket };
  }

  private async assertQuota(userId: string, extra: number) {
    const quota = await this.prisma.storageQuota.findUnique({ where: { userId } });
    const limit = quota?.limitBytes ?? 1024 * 1024 * 1024;
    const used = quota?.usedBytes ?? 0;
    if (used + extra > limit) throw new ApiException('STORAGE_QUOTA_EXCEEDED');
  }

  private present(file: { id: string; mime: string; size: number; status: string; objectKey: string }) {
    return { file_id: file.id, mime: file.mime, size: file.size, status: file.status };
  }

  private client(cfg: OssRuntime, endpoint: string): S3Client {
    return new S3Client({
      region: cfg.region,
      endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.accessKeySecret },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private mockPath(objectKey: string): string {
    const root = process.env.OSS_MOCK_DIR || path.join(process.cwd(), 'data', 'oss');
    const safe = objectKey.replace(/\.\./g, '');
    return path.join(root, safe);
  }

  private normalize(input: Omit<OssRuntime, 'provider'> & { provider: string }): OssRuntime {
    let provider: OssRuntime['provider'] = input.provider === 'aliyun' || input.provider === 'mock' ? input.provider : 'minio';
    const accessKeyId = input.accessKeyId || (provider === 'minio' ? process.env.OSS_ACCESS_KEY_ID || 'minioadmin' : '');
    const accessKeySecret = input.accessKeySecret || (provider === 'minio' ? process.env.OSS_ACCESS_KEY_SECRET || 'minioadmin' : '');
    if (provider !== 'mock' && (!accessKeyId || !accessKeySecret)) provider = 'mock';
    const prefix = assertSafePrefix(input.prefix || 'capability-center');
    const forcePathStyle = provider === 'aliyun' ? input.forcePathStyle : input.forcePathStyle !== false;
    return {
      ...input,
      provider,
      accessKeyId,
      accessKeySecret,
      prefix,
      forcePathStyle: provider === 'aliyun' ? forcePathStyle : true,
      signedUrlExpires: input.signedUrlExpires || 3600,
    };
  }
}

function allowedMime(mime: string): boolean {
  return [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'text/plain',
    'application/pdf',
    'video/mp4',
    'application/json',
  ].includes(mime);
}

function extOf(filename: string, mime: string): string {
  const fromName = filename.split('.').pop()?.toLowerCase() || '';
  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'text/plain': 'txt',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4',
    'application/json': 'json',
  };
  return map[mime] || 'bin';
}
