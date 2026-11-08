import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { asPlatforms } from '../tool-classify';

const prisma = new PrismaClient();

const PLATFORMS: {
  id: string;
  key: string;
  name: string;
  summary: string;
  prompt: string;
  suggestions: string[];
  toolMatchers: RegExp[];
}[] = [
  {
    id: 'amazon',
    key: 'amazon-store-assistant',
    name: '亚马逊店铺助手',
    summary: '盯库存、Listing、广告与竞品，默认围绕你已连接的亚马逊店铺作业。',
    prompt:
      '你是亚马逊店铺助手。优先调用已绑定的亚马逊相关能力，用简体中文给出可执行建议。涉及店铺数据时提醒用户在调用前选对店铺。不要提及任何上游供应商品牌名。',
    suggestions: ['帮我看下 FBA 库存风险', '优化这条 Listing 标题和五点', '对比几个竞品 ASIN', '检查广告投放是否该加预算'],
    toolMatchers: [/amazon|amz|asin|fba|aba|keepa|listing|sponsored|sp-api/i],
  },
  {
    id: 'shopify',
    key: 'shopify-store-assistant',
    name: 'Shopify 店铺助手',
    summary: '服务独立站运营：商品内容、转化文案、视觉素材与流量概览。',
    prompt: '你是 Shopify 店铺助手。优先使用通用选品、文案、视觉与店铺运营能力，回答围绕独立站转化。不要提及上游供应商品牌名。',
    suggestions: ['写一套独立站商品详情文案', '出主图与场景图生成简报', '估算这款货的利润', '总结近 7 天流量结构'],
    toolMatchers: [/shopify|独立站|listing-copy|main-image|image-caption|store-traffic|profit|translate|ad-copy|text-insight/i],
  },
  {
    id: 'temu',
    key: 'temu-store-assistant',
    name: 'Temu 店铺助手',
    summary: '覆盖 Temu 订单、库存、类目、促销与合规相关能力。',
    prompt: '你是 Temu 店铺助手。优先调用 Temu 相关能力，帮助处理订单、上架、促销与合规。不要提及上游供应商品牌名。',
    suggestions: ['查一下美国站待发订单', '搜索可上架类目', '看看有哪些促销可开', '检查商品合规风险'],
    toolMatchers: [/temu/i],
  },
  {
    id: 'ebay',
    key: 'ebay-store-assistant',
    name: 'eBay 店铺助手',
    summary: '帮你搜索 eBay 供给、优化刊登文案并处理店铺日常。',
    prompt: '你是 eBay 店铺助手。优先使用 eBay 搜索与通用刊登/运营能力。不要提及上游供应商品牌名。',
    suggestions: ['搜索 camping lantern 的 eBay 供给', '优化一则刊登标题', '翻译 Listing 到德语站', '写一条促销广告文案'],
    toolMatchers: [/ebay|listing-copy|title-optimizer|translate-listing|store-traffic|compliance|review-digest/i],
  },
  {
    id: 'shopee',
    key: 'shopee-store-assistant',
    name: 'Shopee 店铺助手',
    summary: '面向虾皮店铺：商品、分类、账户健康与日常运营。',
    prompt: '你是 Shopee 店铺助手。优先调用 Shopee 相关能力，关注账户健康与商品运营。不要提及上游供应商品牌名。',
    suggestions: ['看下店铺账户健康', '整理店铺分类', '检查商品刊登是否完整', '生成客服回复话术'],
    toolMatchers: [/shopee|faq-reply|listing-health|store-traffic|compliance/i],
  },
  {
    id: 'tiktok_shop',
    key: 'tiktok-shop-assistant',
    name: 'TikTok Shop 店铺助手',
    summary: '围绕 TikTok Shop：带货视频、商品数据、达人与店铺表现。',
    prompt: '你是 TikTok Shop 店铺助手。优先调用 TikTok / 短视频相关能力，帮助选品、内容和店铺运营。不要提及上游供应商品牌名。',
    suggestions: ['搜索相关带货视频', '看新品排行有什么机会', '生成一条口播脚本', '查店铺商品表现'],
    toolMatchers: [/tiktok|echotik|口播|短视频|videogen|aigc-videogen|带货/i],
  },
  {
    id: 'walmart',
    key: 'walmart-store-assistant',
    name: 'Walmart 店铺助手',
    summary: '帮你做 Walmart 选品搜索、刊登优化与运营动作。',
    prompt: '你是 Walmart 店铺助手。优先使用 Walmart 搜索与通用刊登/选品能力。不要提及上游供应商品牌名。',
    suggestions: ['搜索 Walmart 上的露营灯', '写一版刊登文案', '测算利润空间', '检查合规风险词'],
    toolMatchers: [/walmart|listing-copy|title-optimizer|profit|compliance|product-picker|competitor/i],
  },
  {
    id: 'alibaba1688',
    key: 'alibaba1688-store-assistant',
    name: '1688 采购助手',
    summary: '找货、以图搜同款、看商品详情与采购链路。',
    prompt: '你是 1688 采购助手。优先调用 1688 找货与商品详情类能力，帮助确认供应商与价格带。不要提及上游供应商品牌名。',
    suggestions: ['按图搜 1688 同款', '查这个商品的阶梯价', '帮我找一批露营灯货源', '对比两家供应商'],
    toolMatchers: [/1688|alibaba|sourcing|找货|以图搜/i],
  },
];

async function upsertAgent(input: {
  tenantId: string;
  key: string;
  name: string;
  summary: string;
  prompt: string;
  suggestions: string[];
  primary: string;
  backup: string | null;
  tools: string[];
  platforms: string[];
}) {
  let agent = await prisma.agent.findFirst({ where: { tenantId: input.tenantId, key: input.key } });
  const data: any = {
    name: input.name,
    summary: input.summary,
    systemPrompt: input.prompt,
    status: 'published',
    primaryModelId: input.primary,
    backupModelId: input.backup,
    suggestions: input.suggestions,
    showThinkingDefault: false,
  };
  // platformsJson may not exist until schema push; set if column present via raw later
  if (!agent) {
    agent = await prisma.agent.create({ data: { id: ulid(), tenantId: input.tenantId, key: input.key, ...data } });
  } else {
    agent = await prisma.agent.update({ where: { id: agent.id }, data });
  }
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE agents SET platforms_json = CAST(? AS JSON) WHERE id = ?`,
      JSON.stringify(input.platforms),
      agent.id,
    );
  } catch {
    // column may not exist yet; ignore
  }
  await prisma.agentTool.deleteMany({ where: { agentId: agent.id } });
  const unique = [...new Set(input.tools)];
  if (unique.length) {
    await prisma.agentTool.createMany({ data: unique.map((toolId) => ({ agentId: agent.id, toolId })) });
  }
  return { key: agent.key, name: agent.name, tools: unique.length };
}

function scoreTool(tool: { key: string; name: string; summary: string; platformsJson: unknown; storeBound: boolean }, platformId: string, matchers: RegExp[]) {
  const platforms = asPlatforms(tool.platformsJson);
  const hay = `${tool.key} ${tool.name} ${tool.summary}`;
  let score = 0;
  if (platforms.includes(platformId)) score += 5;
  if (matchers.some((re) => re.test(hay))) score += 3;
  if (tool.storeBound && platforms.includes(platformId)) score += 2;
  if (platforms.length === 0 && matchers.some((re) => re.test(hay))) score += 1;
  return score;
}

async function main() {
  const tenant = (await prisma.tenant.findFirst({ where: { slug: 'default' } })) || (await prisma.tenant.findFirst());
  if (!tenant) throw new Error('no tenant');
  const chat = await prisma.aiModel.findFirst({ where: { tenantId: tenant.id, capability: 'chat', status: 'active' } });
  const reason = await prisma.aiModel.findFirst({ where: { tenantId: tenant.id, capability: 'reasoning', status: 'active' } });
  if (!chat) throw new Error('no chat model');
  const tools = await prisma.tool.findMany({ where: { tenantId: tenant.id, status: 'published' } });

  // ensure platforms_json column
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE agents ADD COLUMN platforms_json JSON NULL`,
    );
  } catch {
    // already exists
  }

  const results = [];
  for (const p of PLATFORMS) {
    const ranked = tools
      .map((t) => ({ t, score: scoreTool(t, p.id, p.toolMatchers) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    // diversify a bit by category, cap 8-40
    const picked: string[] = [];
    const seenCat = new Map<string, number>();
    for (const row of ranked) {
      if (picked.length >= 36) break;
      const cat = row.t.categoryId;
      const n = seenCat.get(cat) || 0;
      if (n >= 8 && picked.length >= 12) continue;
      picked.push(row.t.id);
      seenCat.set(cat, n + 1);
    }
    if (picked.length < 8) {
      for (const row of ranked) {
        if (picked.includes(row.t.id)) continue;
        picked.push(row.t.id);
        if (picked.length >= 8) break;
      }
    }
    const r = await upsertAgent({
      tenantId: tenant.id,
      key: p.key,
      name: p.name,
      summary: p.summary,
      prompt: p.prompt,
      suggestions: p.suggestions,
      primary: chat.id,
      backup: reason?.id || null,
      tools: picked.slice(0, 40),
      platforms: [p.id],
    });
    results.push({ ...r, platform: p.id });
  }
  console.log(JSON.stringify({ agents: results }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
