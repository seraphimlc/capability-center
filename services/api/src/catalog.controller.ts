import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { ApiException } from './errors';
import { AuthUser, CurrentUser } from './auth.guard';
import { pageArgs, whitelabelValue } from './domain';
import { asPlatforms, toolIdSet } from './tool-classify';

@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('api/www/categories')
  async categories(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.category.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { sort: 'asc' },
    });
    return { items: rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug })) };
  }

  @Get('api/www/tools')
  async list(
    @CurrentUser() user: AuthUser,
    @Query('q') q = '',
    @Query('category') category = '',
    @Query('favorite') favorite = '',
    @Query('sort') sort = 'newest',
    @Query('store_bound') storeBound = '',
    @Query('platform') platform = '',
    @Query('for_store_platform') forStorePlatform = '',
    @Query() query: Record<string, unknown>,
  ) {
    const { page, pageSize, skip } = pageArgs(query);
    const where: Prisma.ToolWhereInput = {
      tenantId: user.tenantId,
      status: { in: ['published', 'deprecated'] },
    };
    if (q.trim()) {
      where.OR = [
        { name: { contains: q.trim() } },
        { summary: { contains: q.trim() } },
        { key: { contains: q.trim() } },
      ];
    }
    if (category) where.categoryId = category;
    if (storeBound === '1' || storeBound === 'true') where.storeBound = true;
    if (storeBound === '0' || storeBound === 'false') where.storeBound = false;
    if (favorite === '1' || favorite === 'true') {
      const favs = await this.prisma.favorite.findMany({ where: { userId: user.id } });
      where.id = { in: favs.map((row) => row.toolId) };
    }

    const platformFilter = (forStorePlatform || platform || '').trim();
    if (platformFilter) {
      // Both `platform` and `for_store_platform` require platforms_json to contain the id.
      // Store-bound tools with an empty platform list stay out. An empty match uses a sentinel id.
      const safeId = /^[a-z0-9_]+$/i.test(platformFilter);
      const matched = safeId
        ? await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM tools
            WHERE tenant_id = ${user.tenantId}
              AND status IN ('published', 'deprecated')
              AND JSON_CONTAINS(platforms_json, ${JSON.stringify(platformFilter)})
          `
        : [];
      const ids = toolIdSet(matched.map((row) => row.id));
      if (where.id && typeof where.id === 'object' && 'in' in where.id) {
        const allowed = new Set((where.id as { in: string[] }).in);
        where.id = { in: toolIdSet(ids.filter((id) => allowed.has(id))) };
      } else {
        where.id = { in: ids };
      }
    }

    const orderBy = sort === 'price' ? { pricingCredits: 'asc' as const } : { updatedAt: 'desc' as const };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.tool.count({ where }),
      this.prisma.tool.findMany({ where, orderBy, skip, take: pageSize }),
    ]);
    const cats = await this.prisma.category.findMany({ where: { tenantId: user.tenantId } });
    const favs = await this.prisma.favorite.findMany({ where: { userId: user.id } });
    const favSet = new Set(favs.map((row) => row.toolId));
    const catMap = new Map(cats.map((row) => [row.id, row]));
    return {
      items: rows.map((row) => toTool(row, catMap.get(row.categoryId), favSet.has(row.id))),
      __page: { page, page_size: pageSize, total },
    };
  }

  @Get('api/www/tools/recent')
  async recent(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.recentTool.findMany({
      where: { userId: user.id },
      orderBy: { usedAt: 'desc' },
      take: 20,
    });
    const tools = await this.prisma.tool.findMany({
      where: { id: { in: rows.map((row) => row.toolId) }, status: { in: ['published', 'deprecated'] } },
    });
    const map = new Map(tools.map((row) => [row.id, row]));
    const cats = await this.prisma.category.findMany({ where: { tenantId: user.tenantId } });
    const catMap = new Map(cats.map((row) => [row.id, row]));
    return {
      items: rows
        .map((row) => map.get(row.toolId))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => toTool(row, catMap.get(row.categoryId), false)),
    };
  }

  @Get('api/www/tools/:toolKey')
  async detail(@CurrentUser() user: AuthUser, @Param('toolKey') toolKey: string) {
    const tool = await this.prisma.tool.findFirst({
      where: { tenantId: user.tenantId, key: toolKey, status: { in: ['published', 'deprecated'] } },
    });
    if (!tool) throw new ApiException('TOOL_NOT_PUBLISHED');
    const category = await this.prisma.category.findUnique({ where: { id: tool.categoryId } });
    const fav = await this.prisma.favorite.findUnique({ where: { userId_toolId: { userId: user.id, toolId: tool.id } } });
    const bindings = await this.prisma.agentTool.findMany({ where: { toolId: tool.id } });
    const agents = await this.prisma.agent.findMany({
      where: { id: { in: bindings.map((row) => row.agentId) }, status: 'published', tenantId: user.tenantId },
    });
    return {
      ...toTool(tool, category, Boolean(fav)),
      description_md: tool.descriptionMd,
      related_agents: agents.map((agent) => ({
        key: agent.key,
        name: agent.name,
        summary: agent.summary,
      })),
    };
  }

  @Post('api/www/tools/:toolKey/favorite')
  async favorite(@CurrentUser() user: AuthUser, @Param('toolKey') toolKey: string) {
    const tool = await publishedTool(this.prisma, user.tenantId, toolKey);
    const count = await this.prisma.favorite.count({ where: { userId: user.id } });
    const exists = await this.prisma.favorite.findUnique({ where: { userId_toolId: { userId: user.id, toolId: tool.id } } });
    if (!exists && count >= 100) throw new ApiException('FAVORITE_LIMIT');
    if (!exists) await this.prisma.favorite.create({ data: { userId: user.id, toolId: tool.id } });
    return { favored: true };
  }

  @Delete('api/www/tools/:toolKey/favorite')
  async unfavorite(@CurrentUser() user: AuthUser, @Param('toolKey') toolKey: string) {
    const tool = await this.prisma.tool.findFirst({ where: { tenantId: user.tenantId, key: toolKey } });
    if (tool) await this.prisma.favorite.deleteMany({ where: { userId: user.id, toolId: tool.id } });
    return { favored: false };
  }

  @Get('api/www/search')
  async search(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    const keyword = q.trim();
    if (!keyword) return { tools: [], agents: [] };
    const tools = await this.prisma.tool.findMany({
      where: {
        tenantId: user.tenantId,
        status: { in: ['published', 'deprecated'] },
        OR: [{ name: { contains: keyword } }, { summary: { contains: keyword } }, { key: { contains: keyword } }],
      },
      take: 8,
    });
    const agents = await this.prisma.agent.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'published',
        OR: [{ name: { contains: keyword } }, { summary: { contains: keyword } }, { key: { contains: keyword } }],
      },
      take: 8,
    });
    return {
      tools: tools.map((tool) => ({ key: tool.key, name: tool.name, summary: tool.summary })),
      agents: agents.map((agent) => ({ key: agent.key, name: agent.name, summary: agent.summary })),
    };
  }

  @Get('api/www/announcements')
  async announcements() {
    const rows = await this.prisma.announcement.findMany({
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        created_at: row.createdAt.toISOString(),
      })),
    };
  }

  @Get('api/www/notifications')
  async notifications(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.inboxMessage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unread = rows.filter((row) => !row.readAt).length;
    return {
      unread,
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        read: Boolean(row.readAt),
        created_at: row.createdAt.toISOString(),
      })),
    };
  }

  @Post('api/www/notifications/:id/read')
  async readOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.inboxMessage.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  @Post('api/www/notifications/read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    await this.prisma.inboxMessage.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: true };
  }

  @Get('api/www/invokes')
  async invokes(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    const { page, pageSize, skip } = pageArgs(query);
    const where: Prisma.InvokeRecordWhereInput = { userId: user.id, tenantId: user.tenantId };
    if (query.status) where.status = query.status;
    if (query.tool_key) where.toolKey = query.tool_key;
    if (query.source) where.source = query.source;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invokeRecord.count({ where }),
      this.prisma.invokeRecord.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return { items: rows.map(toInvoke), __page: { page, page_size: pageSize, total } };
  }

  @Get('api/www/invokes/:id')
  async invokeOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const row = await this.prisma.invokeRecord.findFirst({ where: { id, userId: user.id } });
    if (!row) throw new ApiException('NOT_FOUND');
    return toInvoke(row);
  }
}

export async function publishedTool(prisma: PrismaService, tenantId: string, toolKey: string) {
  const tool = await prisma.tool.findFirst({
    where: { tenantId, key: toolKey, status: 'published' },
  });
  if (!tool) throw new ApiException('TOOL_NOT_PUBLISHED');
  return tool;
}

export function toTool(
  tool: {
    id: string;
    key: string;
    name: string;
    summary: string;
    descriptionMd: string;
    pricingCredits: number;
    status: string;
    schemaJson: Prisma.JsonValue;
    examplesJson: Prisma.JsonValue;
    isAsync: boolean;
    capability: string;
    storeBound?: boolean;
    platformsJson?: Prisma.JsonValue;
  },
  category?: { id: string; name: string; slug: string } | null,
  favored = false,
) {
  return {
    id: tool.id,
    key: tool.key,
    name: tool.name,
    summary: tool.summary,
    description_md: tool.descriptionMd,
    category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
    pricing_credits: tool.pricingCredits,
    status: tool.status,
    deprecated: tool.status === 'deprecated',
    schema: whitelabelValue(tool.schemaJson),
    examples: whitelabelValue(tool.examplesJson),
    async: tool.isAsync,
    capability: tool.capability,
    store_bound: Boolean(tool.storeBound),
    platforms: asPlatforms(tool.platformsJson),
    favored,
  };
}

export function toInvoke(row: {
  id: string;
  toolKey: string;
  source: string;
  status: string;
  inputJson: Prisma.JsonValue;
  outputJson: Prisma.JsonValue | null;
  errorCode: string | null;
  credits: number;
  requestId: string;
  conversationId: string | null;
  taskId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}) {
  return {
    id: row.id,
    tool_key: row.toolKey,
    source: row.source,
    status: row.status,
    input: whitelabelValue(row.inputJson),
    output: whitelabelValue(row.outputJson),
    error_code: row.errorCode,
    credits: row.credits,
    request_id: row.requestId,
    conversation_id: row.conversationId,
    task_id: row.taskId,
    created_at: row.createdAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}

void Body;
void Req;
