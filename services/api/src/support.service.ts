import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ApiException } from './errors';
import { whitelabelText } from './domain';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(input: {
    tenantId: string;
    actorId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    detail?: unknown;
    requestId?: string | null;
  }): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        id: ulid(),
        tenantId: input.tenantId,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        requestId: input.requestId ?? null,
      },
    });
  }
}

@Injectable()
export class NotifyService {
  constructor(private readonly prisma: PrismaService) {}

  async push(userId: string, title: string, body: string): Promise<void> {
    await this.prisma.inboxMessage.create({
      data: {
        id: ulid(),
        userId,
        title: whitelabelText(title).slice(0, 120),
        body: whitelabelText(body),
      },
    });
  }
}

@Injectable()
export class RateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async hit(scope: string, actor: string): Promise<void> {
    const rule = await this.prisma.rateLimitRule.findUnique({ where: { scope } });
    if (!rule?.enabled) return;
    const key = `rl:${scope}:${actor}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, rule.windowSec);
    if (count > rule.limit) throw new ApiException('RATE_LIMITED');
  }
}

export async function flag(prisma: PrismaService, key: string, fallback = ''): Promise<string> {
  const row = await prisma.featureFlag.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
