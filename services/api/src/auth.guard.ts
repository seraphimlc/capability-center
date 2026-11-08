import { CanActivate, ExecutionContext, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { PrismaService } from './prisma.service';
import { ApiException } from './errors';
import { KeyService } from './key.service';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  sid: string;
  portal: string;
  imp: string | null;
};

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user as AuthUser;
});

export type AccessClaims = {
  sub: string;
  tid: string;
  roles: string[];
  sid: string;
  typ: string;
  portal: string;
  imp?: string;
};

export function jwtSecret(): string {
  return process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
}

export function signAccess(claims: AccessClaims): string {
  return jwt.sign(claims, jwtSecret(), { expiresIn: 15 * 60 });
}

export function verifyAccess(token: string): AccessClaims {
  return jwt.verify(token, jwtSecret()) as AccessClaims;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly keys: KeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const path: string = (req.path || req.url || '').split('?')[0];
    if (path === '/healthz' || path === '/health') return true;
    if (path === '/mcp' || path.startsWith('/v1/') || path === '/v1') {
      const token = bearer(req);
      if (!token) throw new ApiException('API_KEY_INVALID');
      req.user = await this.keys.authenticate(token, req);
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const token = bearer(req);
    if (!token) {
      if (isPublic) return true;
      throw new ApiException('UNAUTHORIZED');
    }
    if (token.startsWith('ck_')) throw new ApiException('UNAUTHORIZED');
    let claims: AccessClaims;
    try {
      claims = verifyAccess(token);
    } catch {
      if (isPublic) return true;
      throw new ApiException('AUTH_TOKEN_EXPIRED');
    }
    if (claims.typ !== 'access') throw new ApiException('UNAUTHORIZED');
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.status !== 'active') throw new ApiException('AUTH_USER_DISABLED');
    const portal = path.startsWith('/api/admin') ? 'admin' : 'www';
    if (claims.portal !== portal && !isPublic) throw new ApiException('FORBIDDEN');
    req.user = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      sid: claims.sid,
      portal: claims.portal,
      imp: claims.imp ?? null,
    } satisfies AuthUser;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ApiException('UNAUTHORIZED');
    if (user.role === 'super_admin' || roles.includes(user.role)) return true;
    throw new ApiException('FORBIDDEN');
  }
}

@Injectable()
export class ImpersonateGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (user?.imp && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      throw new ApiException('IMPERSONATE_READ_ONLY');
    }
    return true;
  }
}

function bearer(req: { headers?: Record<string, string | undefined> }): string | null {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}
