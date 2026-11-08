import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ApiException } from './errors';
import { AuditService, NotifyService } from './support.service';
import { AuthUser, CurrentUser, Public, Roles, signAccess } from './auth.guard';
import { emailOk, passwordOk, randomToken, sha256 } from './domain';

const REFRESH_MS = 30 * 24 * 3600 * 1000;

@Controller()
export class IdentityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  @Public()
  @Post('api/www/auth/register')
  async register(@Body() body: { email?: string; password?: string; display_name?: string }, @Req() req: Request) {
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const displayName = (body.display_name || email.split('@')[0] || '用户').trim().slice(0, 40);
    if (!emailOk(email)) throw new ApiException('VALIDATION_ERROR', '请填写有效邮箱', { field: 'email' });
    if (!passwordOk(password)) throw new ApiException('AUTH_PASSWORD_WEAK');
    const tenant = await this.prisma.tenant.findFirst({ where: { slug: 'default' } });
    if (!tenant) throw new ApiException('INTERNAL_ERROR');
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ApiException('AUTH_EMAIL_TAKEN');
    const user = await this.prisma.user.create({
      data: {
        id: ulid(),
        tenantId: tenant.id,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        displayName,
        role: 'end_user',
        status: 'active',
      },
    });
    await this.prisma.wallet.create({ data: { id: ulid(), userId: user.id, tenantId: tenant.id, balance: 0 } });
    await this.prisma.storageQuota.create({
      data: { id: ulid(), userId: user.id, limitBytes: 1024 * 1024 * 1024, usedBytes: 0 },
    });
    await this.audit.write({
      tenantId: tenant.id,
      actorId: user.id,
      action: 'user.register',
      targetType: 'user',
      targetId: user.id,
      requestId: req.requestId,
    });
    await this.notify.push(user.id, '欢迎来到能力中心', '账号已创建。当前积分余额为 0，请联系管理员充值后再调用付费能力。');
    return this.issue(user.id, 'www', req);
  }

  @Public()
  @Post('api/www/auth/login')
  loginWww(@Body() body: { email?: string; password?: string }, @Req() req: Request) {
    return this.login(body, 'www', req);
  }

  @Public()
  @Post('api/admin/auth/login')
  loginAdmin(@Body() body: { email?: string; password?: string }, @Req() req: Request) {
    return this.login(body, 'admin', req);
  }

  @Public()
  @Post('api/www/auth/refresh')
  refreshWww(@Req() req: Request) {
    return this.refresh(req, 'www');
  }

  @Public()
  @Post('api/admin/auth/refresh')
  refreshAdmin(@Req() req: Request) {
    return this.refresh(req, 'admin');
  }

  @Post('api/www/auth/logout')
  logoutWww(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.logout(user, req, 'www');
  }

  @Post('api/admin/auth/logout')
  logoutAdmin(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.logout(user, req, 'admin');
  }

  @Public()
  @Post('api/www/auth/forgot')
  async forgot(@Body() body: { email?: string }) {
    const email = (body.email || '').trim().toLowerCase();
    const user = emailOk(email) ? await this.prisma.user.findUnique({ where: { email } }) : null;
    let devToken: string | undefined;
    if (user) {
      const token = randomToken(24);
      devToken = token;
      await this.prisma.passwordReset.create({
        data: {
          id: ulid(),
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        },
      });
      await this.notify.push(user.id, '重置密码', '我们收到了重置密码请求。若不是你本人操作，可忽略这条消息。');
    }
    const data: { sent: boolean; dev_reset_token?: string } = { sent: true };
    if (user && process.env.APP_ENV !== 'production' && devToken) data.dev_reset_token = devToken;
    return data;
  }

  @Public()
  @Post('api/www/auth/reset')
  async reset(@Body() body: { token?: string; password?: string }) {
    const token = body.token || '';
    const password = body.password || '';
    if (!passwordOk(password)) throw new ApiException('AUTH_PASSWORD_WEAK');
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw new ApiException('AUTH_RESET_TOKEN_INVALID');
    await this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    await this.prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await this.prisma.authSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { reset: true };
  }

  @Post('api/www/auth/password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: { old_password?: string; new_password?: string },
  ) {
    if (!passwordOk(body.new_password || '')) throw new ApiException('AUTH_PASSWORD_WEAK');
    const row = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!row || !(await bcrypt.compare(body.old_password || '', row.passwordHash))) {
      throw new ApiException('AUTH_INVALID_CREDENTIALS');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.new_password || '', 10) } });
    await this.prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: user.sid } },
      data: { revokedAt: new Date() },
    });
    return { changed: true };
  }

  @Get('api/www/me')
  me(@CurrentUser() user: AuthUser) {
    return publicUser(user);
  }

  @Patch('api/www/me')
  async patchMe(@CurrentUser() user: AuthUser, @Body() body: { display_name?: string }) {
    const displayName = (body.display_name || '').trim().slice(0, 40);
    if (!displayName) throw new ApiException('VALIDATION_ERROR', '请填写显示名', { field: 'display_name' });
    await this.prisma.user.update({ where: { id: user.id }, data: { displayName } });
    return { ...publicUser(user), display_name: displayName };
  }

  @Get('api/www/auth/sessions')
  async sessions(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.authSession.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        portal: row.portal,
        ip: row.ip,
        user_agent: row.userAgent,
        created_at: row.createdAt.toISOString(),
        current: row.id === user.sid,
      })),
    };
  }

  @Delete('api/www/auth/sessions/:id')
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.authSession.updateMany({
      where: { id, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  @Get('api/admin/me')
  @Roles('ops', 'super_admin', 'tenant_admin')
  adminMe(@CurrentUser() user: AuthUser) {
    return publicUser(user);
  }

  private async login(body: { email?: string; password?: string }, portal: 'www' | 'admin', req: Request) {
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const failKey = `login:fail:${email}`;
    const fails = Number((await this.redis.client.get(failKey)) || 0);
    if (fails >= 8) throw new ApiException('RATE_LIMITED');
    const user = email ? await this.prisma.user.findUnique({ where: { email } }) : null;
    const matched = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !matched) {
      const count = await this.redis.client.incr(failKey);
      if (count === 1) await this.redis.client.expire(failKey, 600);
      throw new ApiException('AUTH_INVALID_CREDENTIALS');
    }
    if (user.status !== 'active') throw new ApiException('AUTH_USER_DISABLED');
    if (portal === 'admin' && !['ops', 'super_admin', 'tenant_admin'].includes(user.role)) {
      throw new ApiException('FORBIDDEN', '请使用管理账号登录');
    }
    await this.redis.client.del(failKey);
    await this.audit.write({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'user.login',
      targetType: 'user',
      targetId: user.id,
      detail: { portal },
      requestId: req.requestId,
    });
    return this.issue(user.id, portal, req);
  }

  private async issue(userId: string, portal: 'www' | 'admin', req: Request) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiException('UNAUTHORIZED');
    const active = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    });
    const overflow = active.length - 9;
    if (overflow > 0) {
      const stale = active.slice(0, overflow).map((row) => row.id);
      await this.prisma.authSession.updateMany({ where: { id: { in: stale } }, data: { revokedAt: new Date() } });
    }
    const refresh = randomToken();
    const session = await this.prisma.authSession.create({
      data: {
        id: ulid(),
        userId,
        portal,
        refreshHash: sha256(refresh),
        userAgent: (req.headers['user-agent'] || '').slice(0, 255),
        ip: req.ip,
        expiresAt: new Date(Date.now() + REFRESH_MS),
      },
    });
    const access = signAccess({
      sub: user.id,
      tid: user.tenantId,
      roles: [user.role],
      sid: session.id,
      typ: 'access',
      portal,
    });
    return {
      access_token: access,
      expires_in: 900,
      refresh_token: refresh,
      portal,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        role: user.role,
        tenant_id: user.tenantId,
      },
    };
  }

  private async refresh(req: Request, portal: 'www' | 'admin') {
    const raw = readCookie(req, portal === 'www' ? 'cc_www_rt' : 'cc_admin_rt');
    if (!raw) throw new ApiException('AUTH_TOKEN_EXPIRED');
    const session = await this.prisma.authSession.findUnique({ where: { refreshHash: sha256(raw) } });
    if (!session) throw new ApiException('AUTH_TOKEN_EXPIRED');
    if (session.revokedAt) {
      await this.prisma.authSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new ApiException('AUTH_REFRESH_REUSED');
    }
    if (session.expiresAt.getTime() < Date.now() || session.portal !== portal) {
      throw new ApiException('AUTH_TOKEN_EXPIRED');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== 'active') throw new ApiException('AUTH_USER_DISABLED');
    const refresh = randomToken();
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: { refreshHash: sha256(refresh), expiresAt: new Date(Date.now() + REFRESH_MS) },
    });
    const access = signAccess({
      sub: user.id,
      tid: user.tenantId,
      roles: [user.role],
      sid: session.id,
      typ: 'access',
      portal,
    });
    return {
      access_token: access,
      expires_in: 900,
      refresh_token: refresh,
      portal,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        role: user.role,
        tenant_id: user.tenantId,
      },
    };
  }

  private async logout(user: AuthUser, req: Request, portal: 'www' | 'admin') {
    await this.prisma.authSession.updateMany({
      where: { id: user.sid, userId: user.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.write({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'user.logout',
      targetType: 'session',
      targetId: user.sid,
      requestId: req.requestId,
    });
    return { logged_out: true, portal };
  }
}

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    role: user.role,
    tenant_id: user.tenantId,
    impersonating: Boolean(user.imp),
  };
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function applyAuthCookie(req: Request, res: Response, body: unknown): void {
  if (!body || typeof body !== 'object' || !('refresh_token' in body)) return;
  const record = body as { refresh_token?: string; portal?: string };
  if (!record.refresh_token || !record.portal) return;
  const name = record.portal === 'admin' ? 'cc_admin_rt' : 'cc_www_rt';
  res.cookie(name, record.refresh_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: REFRESH_MS,
  });
  delete record.refresh_token;
}

export function clearAuthCookie(res: Response, portal: 'www' | 'admin'): void {
  const name = portal === 'admin' ? 'cc_admin_rt' : 'cc_www_rt';
  res.clearCookie(name, { path: '/' });
}
