import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

export const NEW_CATEGORIES: { slug: string; name: string; sort: number }[] = [
  { slug: 'selection-research', name: '选品调研', sort: 1 },
  { slug: 'listing', name: '产品上架', sort: 2 },
  { slug: 'creative-visual', name: '视觉创意', sort: 3 },
  { slug: 'store-ops', name: '店铺运营', sort: 4 },
  { slug: 'ads', name: '广告投放', sort: 5 },
  { slug: 'analytics', name: '数据分析', sort: 6 },
  { slug: 'compliance', name: '合规风控', sort: 7 },
  { slug: 'general', name: '通用工具', sort: 8 },
];

export const PLATFORM_IDS = [
  'amazon',
  'shopify',
  'temu',
  'ebay',
  'shopee',
  'tiktok_shop',
  'walmart',
  'alibaba1688',
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

const OLD_SLUG_MAP: Record<string, string> = {
  selection: 'selection-research',
  'lf-selection': 'selection-research',
  content: 'listing',
  marketing: 'listing',
  creative: 'creative-visual',
  'lf-visual': 'creative-visual',
  store: 'store-ops',
  'lf-ops': 'store-ops',
  'lf-ads': 'ads',
  platform: 'analytics',
  'lf-analytics': 'analytics',
  'lf-compliance': 'compliance',
  'lf-general': 'general',
  'lf-other': 'general',
};

function haystack(tool: { key: string; name: string; summary: string; descriptionMd?: string }): string {
  return `${tool.key} ${tool.name} ${tool.summary} ${tool.descriptionMd || ''}`.toLowerCase();
}

export function detectPlatforms(text: string): PlatformId[] {
  const found = new Set<PlatformId>();
  const t = text.toLowerCase();
  if (/amazon|\bamz\b|asin|keepa|\baba\b|fba|sp-api|sponsored products/.test(t) || /亚马逊/.test(text)) found.add('amazon');
  if (/shopify/.test(t)) found.add('shopify');
  if (/temu/.test(t)) found.add('temu');
  if (/shopee/.test(t)) found.add('shopee');
  if (/tiktok|echotik|出海匠/.test(t) || /tiktok shop/.test(t)) found.add('tiktok_shop');
  if (/ebay/.test(t)) found.add('ebay');
  if (/walmart/.test(t)) found.add('walmart');
  if (/1688|alibaba1688|阿里巴巴/.test(t)) found.add('alibaba1688');
  return Array.from(found);
}

function looksOps(text: string, categorySlug: string): boolean {
  if (['store-ops', 'ads', 'listing'].includes(categorySlug)) return true;
  return /订单|库存|定价|履约|fbs|sbs|店铺|listing上架|广告投放|\bams\b|广告管理|广告授权|促销|优惠券|折扣|闪购|限时特卖|bundle|voucher|discount|flash.?sale|inventory|order|fulfill|pricing|广告报表|ads-manager|ads_auth|store-ads|store_ads|店铺广告|店铺报表|customer.?feedback|店铺买家/.test(
    text,
  );
}

function looksResearchOnly(text: string): boolean {
  return /选品|竞品|关键词|洞察|搜索|调研|keepa|aba|排行|情报|监控|分析师|简报|利润测算|季节|日历|voc|未满足|patent|专利|商标|tro|合规检测|以图搜|copyright|版权/.test(
    text,
  );
}

function looksCreative(text: string): boolean {
  return /主图|生图|分镜|短视频|口播|视频|图片理解|白底|场景图|aigc|videogen|套图|修图|视觉/.test(text);
}

function looksListing(text: string): boolean {
  return /listing|文案|标题|五点|翻译|刊登|上架|属性|description|bullet|铺货|上新/.test(text);
}

function looksAds(text: string): boolean {
  return /广告|投放|ams|sponsored|promotion|促销|优惠券|voucher|discount|flash.?sale|bundle.?deal|带货口播|ads-/.test(text);
}

function looksCompliance(text: string): boolean {
  return /合规|专利|商标|tro|侵权|违禁|copyright|版权|政策资讯|risk/.test(text);
}

function looksAnalytics(text: string): boolean {
  return /报表|分析|监控|排行|keepa|echo|geekbi|sorftime|流量|排名|评价摘要|review|analytics|insight|数据/.test(text);
}

function looksStoreOps(text: string): boolean {
  return /店铺运营|库存|订单|履约|定价|fba.?inventory|store-report|店铺报表|客服话术|faq/.test(text);
}

function refineCategorySlug(
  tool: { key: string; name: string; summary: string },
  currentSlug: string,
): string {
  const text = haystack(tool);
  const mapped = OLD_SLUG_MAP[currentSlug] || (NEW_CATEGORIES.some((c) => c.slug === currentSlug) ? currentSlug : '');

  // Strong overrides — order matters
  if (/专利|商标|tro|侵权|违禁|copyright|版权|合规检测|policy-feed|zhihuiya|ruiguan|maidalv|sif-compliance|外观专利|实用新型|版权检测/.test(text)) {
    return 'compliance';
  }
  if (/主图|生图|分镜|短视频|口播|图片理解|白底|场景图|videogen|aigc|套图|修图|视觉|image-caption|video-brief|main-image|imagegen|videogen|真人感|人台|模特图|裂变|口播脚本/.test(text)
    && !/店铺广告|广告管理|广告授权|广告优化/.test(text)) {
    return 'creative-visual';
  }
  if (/广告管理|广告授权|广告报表|广告优化|ads-manager|ads-auth|ads-report|ads-optimizer|store-ads|店铺广告|temu-ads|temu-promotion|promotion-us|promotion-eu|promotion-global|优惠券|voucher|flash.?sale|bundle.?deal|discount|ams\b|sponsored/.test(text)
    && !/关键词概览|关键词流量|asin关键词/.test(text)) {
    return 'ads';
  }
  if (/listing-specialist|listing-scout|listing-copy|title-optimizer|translate-listing|刊登翻译|标题优化|商品文案|listing健康|listing-health|product-title-analyze|标题分词|铺货|上新运营|撰写.*listing|刊登|五点|bullet.?point/.test(text)
    && !/合规|专利|广告管理/.test(text)) {
    return 'listing';
  }
  if (/店铺报表|订单|库存|履约|定价|退货|退款|fba.?inventory|store-report|store-traffic|客服话术|faq-reply|amazon-store|领星|erp|店铺健康|店铺商品管理|发货/.test(text)
    && !/广告/.test(text)) {
    return 'store-ops';
  }
  if (/keepa|echotik|geekbi|sorftime|aba|竞品动态监控|voc洞察|评价摘要|review-digest|keyword-rank|流量概览|数据分析|排行|sif-|蓝海扫描|细分市场|流量缺口|serp|市场格局|历史曲线|销量飙升|tiktok.*(排行|搜索|详情|达人|类目)/.test(text)
    && !/广告管理|店铺广告|广告优化/.test(text)) {
    return 'analytics';
  }
  if (/选品|竞品|找货|1688|季节选品|product-picker|amazon-search|amazon-product|ebay-search|walmart-search|lf-selection|选品简报|蓝海|潜力市场|投机选品|长尾|不压库存|跨文化|新品榜|wallysmarter|商品详情(?!生成)/.test(text)
    && !/广告管理|店铺广告|listing-specialist|铺货/.test(text)) {
    return 'selection-research';
  }
  if (/text-insight|文本洞察|smart-table|多维表格|通用\/热点|lf-general|tsearch|网页实时搜索|谷歌搜索|google-search|e-commerce-find/.test(text) || mapped === 'general') {
    return 'general';
  }

  if (mapped) return mapped;
  return 'general';
}

export function classifyTool(input: {
  key: string;
  name: string;
  summary: string;
  descriptionMd?: string;
  currentCategorySlug?: string;
}): { categorySlug: string; storeBound: boolean; platforms: PlatformId[] } {
  const text = haystack(input);
  const categorySlug = refineCategorySlug(input, input.currentCategorySlug || 'general');
  const platforms = detectPlatforms(text);

  let storeBound = false;
  const opsKeywords = /订单|库存|定价|履约|fbs|sbs|广告管理|广告授权|广告投放|店铺广告|促销|优惠券|折扣|listing上架|上架到|发布商品|改价|补货|ads-manager|ads-auth|store-ads|temu-ads|temu-promotion|shopee-store|amazon-ads|amazon-store|tiktok-shop-analytics|店铺报表|店铺买家|ams\b/;
  if (['store-ops', 'ads'].includes(categorySlug)) storeBound = true;
  if (categorySlug === 'listing' && opsKeywords.test(text)) storeBound = true;
  if (opsKeywords.test(text)) storeBound = true;
  if (platforms.length && ['store-ops', 'ads'].includes(categorySlug)) storeBound = true;
  // Pure creative / patent / research / general / selection stay unbound
  if (categorySlug === 'creative-visual' && !/店铺视频|store-video|livestream/.test(text)) storeBound = false;
  if (categorySlug === 'compliance' && !/temu-compliance|店铺合规/.test(text)) storeBound = false;
  if (categorySlug === 'selection-research') storeBound = false;
  if (categorySlug === 'general') storeBound = false;
  if (categorySlug === 'analytics' && !opsKeywords.test(text)) storeBound = false;
  if (categorySlug === 'listing' && !opsKeywords.test(text)) storeBound = false;

  return { categorySlug, storeBound, platforms };
}

export async function ensureNewCategories(prisma: PrismaClient, tenantId: string) {
  const map = new Map<string, { id: string; slug: string; name: string }>();
  for (const cat of NEW_CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { tenantId, slug: cat.slug } });
    if (existing) {
      const updated = await prisma.category.update({
        where: { id: existing.id },
        data: { name: cat.name, sort: cat.sort },
      });
      map.set(cat.slug, updated);
    } else {
      const created = await prisma.category.create({
        data: { id: ulid(), tenantId, slug: cat.slug, name: cat.name, sort: cat.sort },
      });
      map.set(cat.slug, created);
    }
  }
  return map;
}

export async function reclassifyAllTools(prisma: PrismaClient, tenantId: string) {
  const catMap = await ensureNewCategories(prisma, tenantId);
  const oldCats = await prisma.category.findMany({ where: { tenantId } });
  const oldById = new Map(oldCats.map((c) => [c.id, c]));

  const tools = await prisma.tool.findMany({ where: { tenantId } });
  const counts: Record<string, number> = {};
  let bound = 0;
  let unbound = 0;

  for (const tool of tools) {
    const current = oldById.get(tool.categoryId);
    const result = classifyTool({
      key: tool.key,
      name: tool.name,
      summary: tool.summary,
      descriptionMd: tool.descriptionMd,
      currentCategorySlug: current?.slug,
    });
    const category = catMap.get(result.categorySlug) || catMap.get('general')!;
    await prisma.tool.update({
      where: { id: tool.id },
      data: {
        categoryId: category.id,
        storeBound: result.storeBound,
        platformsJson: result.platforms,
      },
    });
    counts[result.categorySlug] = (counts[result.categorySlug] || 0) + 1;
    if (result.storeBound) bound += 1;
    else unbound += 1;
  }

  // Retire old empty categories
  const keep = new Set(NEW_CATEGORIES.map((c) => c.slug));
  for (const cat of oldCats) {
    if (keep.has(cat.slug)) continue;
    const left = await prisma.tool.count({ where: { categoryId: cat.id } });
    if (left === 0) {
      await prisma.category.delete({ where: { id: cat.id } }).catch(() => undefined);
    }
  }

  return { counts, bound, unbound, total: tools.length };
}

/** No real tool id. Used so an empty platform match does not become SQL `IN ()` or an unfiltered list. */
export const EMPTY_TOOL_ID_SET = ['__none__'] as const;

/**
 * Store workspace filter: a tool is in a platform only when `platforms_json`
 * contains that platform id. Store-bound tools with an empty platform list do not match.
 */
export function matchesStorePlatform(platforms: unknown, platformId: string): boolean {
  const id = platformId.trim();
  if (!id) return false;
  return asPlatforms(platforms).includes(id);
}

export function toolIdSet(ids: string[]): string[] {
  return ids.length ? ids : [...EMPTY_TOOL_ID_SET];
}

/** Parse platforms_json safely */
export function asPlatforms(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
