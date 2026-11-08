import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from './prisma.service';
import { ApiException } from './errors';
import { AuthUser } from './auth.guard';
import { asJson } from './support.service';

export const SHOP_PLATFORMS: Record<
  string,
  {
    name: string;
    authType: 'oauth' | 'api_key';
    fields: { key: string; title: string; secret?: boolean; required?: boolean; placeholder?: string }[];
    capabilities: string[];
  }
> = {
  amazon: {
    name: 'Amazon',
    authType: 'api_key',
    fields: [
      { key: 'seller_id', title: 'Seller ID', required: true },
      { key: 'marketplace', title: '站点', required: true, placeholder: 'US / UK / DE / JP' },
      { key: 'refresh_token', title: 'Refresh Token', secret: true, required: true },
      { key: 'client_id', title: 'LWA Client ID', secret: true },
      { key: 'client_secret', title: 'LWA Client Secret', secret: true },
    ],
    capabilities: ['订单', '库存', 'Listing', '广告报表'],
  },
  shopify: {
    name: 'Shopify',
    authType: 'api_key',
    fields: [
      { key: 'shop_domain', title: '店铺域名', required: true, placeholder: 'xxx.myshopify.com' },
      { key: 'access_token', title: 'Admin API Token', secret: true, required: true },
    ],
    capabilities: ['商品', '订单', '库存'],
  },
  temu: {
    name: 'Temu',
    authType: 'api_key',
    fields: [
      { key: 'shop_id', title: '店铺 ID', required: true },
      { key: 'access_token', title: 'Access Token', secret: true, required: true },
      { key: 'region', title: '站点', placeholder: 'US / EU / Global' },
    ],
    capabilities: ['商品', '订单', '价格', '库存'],
  },
  ebay: {
    name: 'eBay',
    authType: 'api_key',
    fields: [
      { key: 'user_id', title: 'User ID', required: true },
      { key: 'refresh_token', title: 'Refresh Token', secret: true, required: true },
      { key: 'marketplace', title: '站点', placeholder: 'EBAY_US' },
    ],
    capabilities: ['商品', '订单', '库存'],
  },
  shopee: {
    name: 'Shopee',
    authType: 'api_key',
    fields: [
      { key: 'shop_id', title: 'Shop ID', required: true },
      { key: 'access_token', title: 'Access Token', secret: true, required: true },
      { key: 'region', title: '站点', placeholder: 'SG / MY / TH / VN / PH / TW' },
    ],
    capabilities: ['商品', '订单', '促销'],
  },
  tiktok_shop: {
    name: 'TikTok Shop',
    authType: 'api_key',
    fields: [
      { key: 'shop_id', title: 'Shop ID', required: true },
      { key: 'access_token', title: 'Access Token', secret: true, required: true },
      { key: 'region', title: '站点', placeholder: 'US / UK / SEA' },
    ],
    capabilities: ['商品', '订单', '带货视频'],
  },
  walmart: {
    name: 'Walmart',
    authType: 'api_key',
    fields: [
      { key: 'client_id', title: 'Client ID', required: true },
      { key: 'client_secret', title: 'Client Secret', secret: true, required: true },
      { key: 'channel_type', title: '渠道', placeholder: 'marketplace' },
    ],
    capabilities: ['商品', '订单', '库存'],
  },
  alibaba1688: {
    name: '1688',
    authType: 'api_key',
    fields: [
      { key: 'account_name', title: '采购账号', required: true },
      { key: 'access_token', title: 'Access Token', secret: true, required: true },
    ],
    capabilities: ['找货', '下单', '物流'],
  },
};

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 6) return '******';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  platforms() {
    return Object.entries(SHOP_PLATFORMS).map(([id, meta]) => ({
      id,
      name: meta.name,
      auth_type: meta.authType,
      fields: meta.fields.map((f) => ({
        key: f.key,
        title: f.title,
        secret: Boolean(f.secret),
        required: Boolean(f.required),
        placeholder: f.placeholder || '',
      })),
      capabilities: meta.capabilities,
    }));
  }

  async list(user: AuthUser) {
    const rows = await this.prisma.shopAccount.findMany({
      where: { tenantId: user.tenantId, userId: user.id, status: { not: 'deleted' } },
      orderBy: { updatedAt: 'desc' },
    });
    return { items: rows.map((row) => this.toPublic(row)) };
  }

  async get(user: AuthUser, id: string) {
    const row = await this.requireOwned(user, id);
    return this.toPublic(row, true);
  }

  async create(
    user: AuthUser,
    input: { platform: string; name: string; credentials?: Record<string, string>; marketplace?: string; external_store_id?: string },
  ) {
    const platform = String(input.platform || '').trim();
    const meta = SHOP_PLATFORMS[platform];
    if (!meta) throw new ApiException('VALIDATION_ERROR', '不支持的平台');
    const name = String(input.name || '').trim();
    if (!name) throw new ApiException('VALIDATION_ERROR', '请填写店铺名称');
    const credentials = input.credentials || {};
    for (const field of meta.fields.filter((f) => f.required)) {
      if (!String(credentials[field.key] || '').trim()) {
        throw new ApiException('VALIDATION_ERROR', `请填写${field.title}`);
      }
    }
    const status = Object.keys(credentials).length ? 'connected' : 'draft';
    const row = await this.prisma.shopAccount.create({
      data: {
        id: ulid(),
        tenantId: user.tenantId,
        userId: user.id,
        platform,
        name,
        externalStoreId: input.external_store_id || credentials.shop_id || credentials.seller_id || null,
        marketplace: input.marketplace || credentials.marketplace || credentials.region || null,
        authType: meta.authType,
        status,
        credentialsEnc: JSON.stringify(credentials),
        metaJson: asJson({ capabilities: meta.capabilities }),
        lastCheckedAt: status === 'connected' ? new Date() : null,
      },
    });
    return this.toPublic(row);
  }

  async update(
    user: AuthUser,
    id: string,
    input: { name?: string; credentials?: Record<string, string>; marketplace?: string; status?: string },
  ) {
    const row = await this.requireOwned(user, id);
    const meta = SHOP_PLATFORMS[row.platform];
    const current = this.readCredentials(row.credentialsEnc);
    const nextCreds = { ...current, ...(input.credentials || {}) };
    // keep old secrets if blank submitted
    if (meta) {
      for (const field of meta.fields.filter((f) => f.secret)) {
        if (input.credentials && Object.prototype.hasOwnProperty.call(input.credentials, field.key)) {
          const v = String(input.credentials[field.key] || '');
          if (!v.trim()) nextCreds[field.key] = current[field.key];
        }
      }
    }
    const updated = await this.prisma.shopAccount.update({
      where: { id: row.id },
      data: {
        name: input.name?.trim() || row.name,
        marketplace: input.marketplace ?? row.marketplace,
        credentialsEnc: JSON.stringify(nextCreds),
        status: input.status || (Object.values(nextCreds).some(Boolean) ? 'connected' : row.status),
        updatedAt: new Date(),
      },
    });
    return this.toPublic(updated);
  }

  async disconnect(user: AuthUser, id: string) {
    const row = await this.requireOwned(user, id);
    const updated = await this.prisma.shopAccount.update({
      where: { id: row.id },
      data: { status: 'revoked', credentialsEnc: '{}', errorMessage: null },
    });
    return this.toPublic(updated);
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.requireOwned(user, id);
    await this.prisma.shopAccount.update({ where: { id: row.id }, data: { status: 'deleted', credentialsEnc: '{}' } });
    return { ok: true };
  }

  async probe(user: AuthUser, id: string) {
    const row = await this.requireOwned(user, id);
    const creds = this.readCredentials(row.credentialsEnc);
    const meta = SHOP_PLATFORMS[row.platform];
    const missing = (meta?.fields || []).filter((f) => f.required && !String(creds[f.key] || '').trim());
    if (missing.length) {
      const updated = await this.prisma.shopAccount.update({
        where: { id: row.id },
        data: { status: 'error', errorMessage: `缺少：${missing.map((f) => f.title).join('、')}`, lastCheckedAt: new Date() },
      });
      return { ok: false, shop: this.toPublic(updated), message: updated.errorMessage };
    }
    // Local validation only in this phase; live OAuth/token probe comes next.
    const updated = await this.prisma.shopAccount.update({
      where: { id: row.id },
      data: { status: 'connected', errorMessage: null, lastCheckedAt: new Date() },
    });
    return { ok: true, shop: this.toPublic(updated), message: '凭证已校验，可在调用能力时选择该店铺' };
  }

  async resolveForInvoke(user: AuthUser, storeId: string | undefined) {
    if (!storeId) return null;
    const row = await this.prisma.shopAccount.findFirst({
      where: { id: storeId, tenantId: user.tenantId, userId: user.id, status: 'connected' },
    });
    if (!row) throw new ApiException('VALIDATION_ERROR', '请选择已连接的店铺');
    return {
      store_id: row.id,
      platform: row.platform,
      name: row.name,
      marketplace: row.marketplace,
      external_store_id: row.externalStoreId,
      credentials: this.readCredentials(row.credentialsEnc),
    };
  }

  private async requireOwned(user: AuthUser, id: string) {
    const row = await this.prisma.shopAccount.findFirst({
      where: { id, tenantId: user.tenantId, userId: user.id, status: { not: 'deleted' } },
    });
    if (!row) throw new ApiException('NOT_FOUND', '店铺不存在');
    return row;
  }

  private readCredentials(raw: string): Record<string, string> {
    try {
      const parsed = JSON.parse(raw || '{}') as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private toPublic(row: {
    id: string;
    platform: string;
    name: string;
    externalStoreId: string | null;
    marketplace: string | null;
    authType: string;
    status: string;
    credentialsEnc: string;
    metaJson: unknown;
    lastCheckedAt: Date | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }, withMasked = false) {
    const meta = SHOP_PLATFORMS[row.platform];
    const creds = this.readCredentials(row.credentialsEnc);
    const masked: Record<string, string> = {};
    if (withMasked && meta) {
      for (const field of meta.fields) {
        const v = creds[field.key];
        if (!v) continue;
        masked[field.key] = field.secret ? maskSecret(v) : v;
      }
    }
    return {
      id: row.id,
      platform: row.platform,
      platform_name: meta?.name || row.platform,
      name: row.name,
      external_store_id: row.externalStoreId,
      marketplace: row.marketplace,
      auth_type: row.authType,
      status: row.status,
      capabilities: meta?.capabilities || [],
      credentials_masked: withMasked ? masked : undefined,
      last_checked_at: row.lastCheckedAt?.toISOString() || null,
      error_message: row.errorMessage,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}
