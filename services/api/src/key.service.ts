import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ApiException } from './errors';
import { parseApiKey, safeEqual, sha256 } from './domain';
import type { AuthUser } from './auth.guard';

@Injectable()
export class KeyService {
  constructor(private readonly prisma: PrismaService) {}

  pepper(): string {
    return process.env.API_KEY_PEPPER || 'dev-pepper';
  }

  hashSecret(secret: string): string {
    return sha256(`${secret}${this.pepper()}`);
  }

  async authenticate(token: string, req: { ip?: string; headers?: Record<string, string | undefined> }): Promise<AuthUser> {
    const parsed = parseApiKey(token);
    if (!parsed) throw new ApiException('API_KEY_INVALID');
    const row = await this.prisma.apiKey.findFirst({
      where: { keyPrefix: parsed.publicId, env: parsed.env },
    });
    const expected = row ? row.keyHash : sha256(`missing${this.pepper()}`);
    if (!row || !safeEqual(expected, this.hashSecret(parsed.secret))) {
      throw new ApiException('API_KEY_INVALID');
    }
    if (row.status === 'revoked') throw new ApiException('API_KEY_REVOKED');
    if (row.status !== 'active') throw new ApiException('API_KEY_INVALID');
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw new ApiException('API_KEY_EXPIRED');
    const allow = Array.isArray(row.ipAllowlist) ? (row.ipAllowlist as string[]) : [];
    const ip = clientIp(req);
    if (allow.length && !allow.includes('*') && !allow.includes(ip)) {
      throw new ApiException('API_KEY_IP_DENIED');
    }
    const headerEnv = req.headers?.['x-cc-env'];
    if (headerEnv && headerEnv !== row.env) throw new ApiException('API_KEY_ENV_MISMATCH');
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || user.status !== 'active') throw new ApiException('AUTH_USER_DISABLED');
    await this.prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      role: 'integration',
      status: user.status,
      sid: row.id,
      portal: 'api',
      imp: null,
    };
  }

  assertScope(user: AuthUser, scope: string, scopes: unknown): void {
    if (user.role !== 'integration') return;
    const list = Array.isArray(scopes) ? (scopes as string[]) : [];
    if (!list.includes(scope) && !list.includes('*')) throw new ApiException('API_KEY_SCOPE_DENIED');
  }
}

export function clientIp(req: { ip?: string; headers?: Record<string, string | undefined> }): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || '0.0.0.0';
}
