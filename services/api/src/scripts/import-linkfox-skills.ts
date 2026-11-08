import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { ulid } from 'ulid';
import { classifyTool } from '../tool-classify';

const prisma = new PrismaClient();

const CAT_SLUG: Record<string, { slug: string; name: string; sort: number }> = {
  '选品与开发': { slug: 'selection-research', name: '选品调研', sort: 1 },
  '产品运营': { slug: 'store-ops', name: '店铺运营', sort: 4 },
  '营销广告': { slug: 'ads', name: '广告投放', sort: 5 },
  '数据分析': { slug: 'analytics', name: '数据分析', sort: 6 },
  '产品视觉': { slug: 'creative-visual', name: '视觉创意', sort: 3 },
  '合规检测': { slug: 'compliance', name: '合规风控', sort: 7 },
  '通用/热点': { slug: 'general', name: '通用工具', sort: 8 },
};

const PRICE: Record<string, number> = {
  '选品与开发': 20,
  '产品运营': 15,
  '营销广告': 18,
  '数据分析': 15,
  '产品视觉': 25,
  '合规检测': 22,
  '通用/热点': 10,
};

function toolKey(slug: string): string {
  return slug.replace(/^linkfox-/, 'lf-');
}

function NEW_NAME(slug: string) {
  const map: Record<string, string> = {
    'selection-research': '选品调研',
    listing: '产品上架',
    'creative-visual': '视觉创意',
    'store-ops': '店铺运营',
    ads: '广告投放',
    analytics: '数据分析',
    compliance: '合规风控',
    general: '通用工具',
  };
  return map[slug] || '通用工具';
}
function NEW_SORT(slug: string) {
  const map: Record<string, number> = {
    'selection-research': 1,
    listing: 2,
    'creative-visual': 3,
    'store-ops': 4,
    ads: 5,
    analytics: 6,
    compliance: 7,
    general: 8,
  };
  return map[slug] || 8;
}

async function upsertCategory(tenantId: string, slug: string, name: string, sort: number) {
  const existing = await prisma.category.findFirst({ where: { tenantId, slug } });
  if (existing) {
    return prisma.category.update({ where: { id: existing.id }, data: { name, sort } });
  }
  return prisma.category.create({
    data: { id: ulid(), tenantId, slug, name, sort },
  });
}

async function main() {
  const path = process.env.LINKFOX_ENRICHED_JSON || '/data/linkfox-skills-enriched.json';
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    skills: Array<{
      slug: string;
      name: string;
      summary: string;
      description?: string;
      category?: string;
      upstream_path?: string;
      schema: Record<string, unknown>;
      fill_status?: string;
      version?: string;
    }>;
  };

  const tenant = await prisma.tenant.findFirst({ where: { slug: 'default' } })
    || await prisma.tenant.findFirst();
  if (!tenant) throw new Error('no tenant');

  let linkfox = await prisma.connector.findFirst({ where: { tenantId: tenant.id, type: 'linkfox' } });
  if (!linkfox) {
    linkfox = await prisma.connector.create({
      data: {
        id: ulid(),
        tenantId: tenant.id,
        type: 'linkfox',
        name: '上游商业连接器',
        status: 'active',
        configEnc: JSON.stringify({ gateway: process.env.LINKFOX_TOOL_GATEWAY || 'https://tool-gateway.linkfox.com' }),
      },
    });
  }

  const catIds = new Map<string, string>();
  for (const [label, meta] of Object.entries(CAT_SLUG)) {
    const row = await upsertCategory(tenant.id, meta.slug, meta.name, meta.sort);
    catIds.set(label, row.id);
  }
  const fallbackCat = await upsertCategory(tenant.id, 'general', '通用工具', 8);
  catIds.set('__fallback__', fallbackCat.id);

  let upserted = 0;
  let skipped = 0;
  for (const skill of raw.skills) {
    const key = toolKey(skill.slug);
    const categoryId = catIds.get(skill.category || '') || catIds.get('__fallback__')!;
    const price = PRICE[skill.category || ''] ?? 15;
    const upstreamOp = (skill.upstream_path || '').trim() || 'mcp/any-tool';
    const summary = (skill.summary || skill.name || key).slice(0, 480);
    const descriptionMd = [
      skill.description || skill.summary || '',
      '',
      '在能力目录点「使用」填写参数即可运行；需绑店的能力请先完成店铺授权。',
    ].join('\n');

    const existing = await prisma.tool.findFirst({ where: { tenantId: tenant.id, key } });
    const classified = classifyTool({ key, name: skill.name || key, summary, descriptionMd, currentCategorySlug: skill.category ? CAT_SLUG[skill.category || '']?.slug : undefined });
    const classifiedCat = await upsertCategory(tenant.id, classified.categorySlug, NEW_NAME(classified.categorySlug), NEW_SORT(classified.categorySlug));
    const data = {
      name: skill.name || key,
      summary,
      descriptionMd,
      categoryId: classifiedCat.id,
      status: 'published',
      schemaJson: { ...skill.schema, 'x-fill-status': skill.fill_status || 'unknown' },
      examplesJson: [],
      pricingCredits: price,
      connectorId: linkfox.id,
      upstreamOp,
      isAsync: false,
      capability: 'sync',
      storeBound: classified.storeBound,
      platformsJson: classified.platforms,
    };
    if (existing) {
      await prisma.tool.update({ where: { id: existing.id }, data });
    } else {
      await prisma.tool.create({ data: { id: ulid(), tenantId: tenant.id, key, ...data } });
    }
    upserted += 1;
    if (upserted % 50 === 0) console.log(`upserted ${upserted}`);
  }

  const total = await prisma.tool.count({ where: { tenantId: tenant.id, status: 'published' } });
  console.log(JSON.stringify({ upserted, skipped, published_total: total }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
