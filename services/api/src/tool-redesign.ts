import { PrismaClient } from '@prisma/client';
import { classifyTool, ensureNewCategories, type PlatformId } from './tool-classify';
import { whitelabelText } from './domain';

/** Explicit product names: verb + object, white-label, no vendor packaging. */
const NAME_MAP: Record<string, string> = {
  'lf-tsearch-search': '搜索全网实时网页',
  'lf-wallysmarter-product-detail': '查询跨境商品详情',
  'lf-lingxing-erp': '对接领星 ERP',
  'lf-os': '打开运营工作台',
  'e-commerce-find-skills': '搜索电商能力',
  'lf-expert-1688-sourcing-expert': '查找 1688 货源',
  'lf-expert-aba-keyword-lookup-mining': '速查 ABA 关键词',
  'lf-expert-aba-keyword-heat-analyst': '分析 ABA 关键词热度',
  'lf-expert-aba-new-keyword-miner': '挖掘 ABA 新词',
  'lf-expert-ai-talking-video-script-generator': '生成口播视频脚本',
  'lf-expert-aigc-imagegen-bestseller-replicate': '复刻爆款商品图',
  'lf-expert-aigc-imagegen-brand-gene-extract': '提取品牌视觉基因',
  'lf-expert-aigc-imagegen-cloth': '生成服饰电商套图',
  'lf-expert-aigc-imagegen-image-fission': '裂变电商图片',
  'lf-expert-aigc-imagegen-mannequin-to-model': '人台图换模特',
  'lf-expert-aigc-imagegen-product': '生成商品电商图',
  'lf-expert-aigc-textgen': '理解图文并生成文案',
  'lf-expert-aigc-videogen-image-to-video': '图生短视频',
  'lf-expert-aigc-videogen-sale': '生成带货口播视频',
  'lf-expert-aigc-videogen-viral-replicate': '复刻爆款短视频',
  'lf-expert-alexa-prompt-product-selection': '用提示词辅助选品',
  'lf-expert-all-category-listing-scout': '扫描全品类铺货机会',
  'lf-expert-amazon-ads-optimizer': '优化亚马逊广告',
  'lf-expert-amazon-competitor-monitor': '监控亚马逊竞品动态',
  'lf-expert-amazon-fba-inventory-planner': '规划亚马逊 FBA 库存',
  'lf-expert-amazon-listing-specialist': '撰写亚马逊 Listing',
  'lf-expert-amazon-multi-competitor-analysis': '分析多竞品对比',
  'lf-expert-amazon-single-competitor-analysis': '分析单个竞品',
  'lf-expert-apparel-keyword-mining': '挖掘服装关键词',
  'lf-expert-asin-keepa-curve-analyst': '解读 ASIN 历史曲线',
  'lf-expert-beginner-sellersprite-scout': '推荐新手向选品',
  'lf-expert-blue-ocean-market-scanner': '扫描蓝海品类',
  'lf-expert-cross-cultural-product-scout': '跨文化选品洞察',
  'lf-expert-google-search-researcher': '检索谷歌市场情报',
  'lf-expert-ip-patent-copyright-search': '查询专利与版权',
  'lf-expert-keyword-mining-expert': '挖掘选品关键词',
  'lf-expert-keyword-product-selection': '按关键词选品',
  'lf-expert-low-inventory-product-selection': '筛选轻库存选品',
  'lf-expert-low-price-long-tail-selector': '筛选低价长尾词',
  'lf-expert-low-price-product-expert': '筛选低价潜力品',
  'lf-expert-new-product-launch': '策划新品上新',
  'lf-expert-new-release-product-scout': '扫描新品榜机会',
  'lf-expert-niche-market-recommendation': '推荐细分市场',
  'lf-expert-offsite-check': '检查站外推广痕迹',
  'lf-expert-opportunistic-product-scout': '捕捉短期投机机会',
  'lf-expert-potential-market-scout': '发掘潜力市场',
  'lf-expert-profit-calculation-expert': '核算选品利润',
  'lf-expert-quality-listing-scout': '扫描精品铺货机会',
  'lf-expert-realistic-photo-generation': '生成真人感商品图',
  'lf-expert-sales-surge-product-scout': '扫描销量飙升榜',
  'lf-expert-serp-market-structure-analyst': '分析前三页市场格局',
  'lf-expert-single-variation-potential-scout': '挖掘潜力单变体',
  'lf-expert-structured-decision-making': '结构化决策分析',
  'lf-expert-traffic-gap-analyst': '分析流量缺口',
  'lf-expert-tro-risk-advisor': '评估 TRO 风险',
  'lf-expert-unmet-demand-miner': '挖掘未满足需求',
  'lf-expert-voc-insight-analyst': '洞察买家 VOC',
  'lf-keepa-product-request': '查询商品历史详情',
  'lf-keepa-product-search': '搜索商品历史库',
  'lf-keepa-product-series': '拉取商品历史序列',
  'lf-echotik-batch-product-detail': '批量查 TikTok 商品详情',
  'lf-echotik-batch-video-detail': '批量查 TikTok 视频详情',
  'lf-echotik-category': '查询 TikTok 类目数据',
  'lf-echotik-get-video-download-url': '获取 TikTok 视频下载地址',
  'lf-echotik-influencer': '查询 TikTok 达人档案',
  'lf-echotik-list-new-product-rank': '查看 TikTok 新品排行',
  'lf-echotik-list-product': '搜索 TikTok 商品',
  'lf-echotik-list-seller': '搜索 TikTok 店铺',
  'lf-echotik-list-seller-product': '列出 TikTok 店铺商品',
  'lf-echotik-list-video': '搜索 TikTok 视频',
  'lf-echotik-list-video-rank': '查看 TikTok 视频排行',
  'lf-echotik-product-video': '查询商品关联视频',
  'lf-echotik-seller-detail': '查询 TikTok 店铺详情',
  'lf-sif-asin-keywords': '反查 ASIN 流量词',
  'lf-sif-asin-summary': '概览 ASIN 流量结构',
  'lf-sif-compliance-detection': '检测外观专利风险',
  'lf-sif-keyword-overview': '概览关键词竞争',
  'lf-sif-keyword-summary': '分析关键词流量来源',
  'lf-seerfar-ozon-category-search': '搜索 Ozon 类目',
  'lf-seerfar-ozon-keyword-back-search': '反查 Ozon 关键词',
  'lf-seerfar-ozon-keyword-mining': '挖掘 Ozon 关键词',
  'lf-seerfar-ozon-market-keyword-search': '搜索 Ozon 市场词',
  'lf-seerfar-ozon-product-detail-search': '查询 Ozon 商品详情',
  'lf-seerfar-ozon-product-report-search': '查询 Ozon 商品报表',
  'lf-seerfar-ozon-shop-search': '搜索 Ozon 店铺',
  'lf-ruiguan-copyright-detection': '检测版权侵权风险',
  'lf-ruiguan-detection-patent-design': '检测外观专利风险',
  'lf-ruiguan-gun-parts-search': '监测图片政策合规',
  'lf-ruiguan-text-trademark-detection': '检测文字商标风险',
  'lf-ruiguan-trademark-graphic-detection': '检测图形商标风险',
  'lf-ruiguan-utility-patent-detection': '检测实用新型专利',
  'lf-zhihuiya-abstract-data-translated': '翻译专利标题与摘要',
  'lf-zhihuiya-abstract-image': '查询专利摘要附图',
  'lf-zhihuiya-bibliography': '查询专利著录信息',
  'lf-zhihuiya-claim-data': '获取专利权利要求',
  'lf-zhihuiya-claim-data-translated': '翻译专利权利要求',
  'lf-zhihuiya-description-data': '获取专利说明书',
  'lf-zhihuiya-description-data-translated': '翻译专利说明书',
  'lf-zhihuiya-fulltext-image': '获取专利全文附图',
  'lf-zhihuiya-legal-status': '查询专利法律状态',
  'lf-zhihuiya-patent-cited': '查询专利被引用',
  'lf-zhihuiya-patent-family': '查询专利家族',
  'lf-zhihuiya-patent-forward-citation': '查询专利引用',
  'lf-zhihuiya-patent-image-search': '以图搜外观专利',
  'lf-zhihuiya-pdf-data': '下载专利 PDF',
  'lf-zhihuiya-retrieval-patent-search': '按检索式查专利',
  'lf-zhihuiya-simple-bibliography': '查询专利简要著录',
  'lf-zhihuiya-utility-patent-image-search': '以图搜实用新型专利',
};

const VENDOR_PREFIX = /^(EchoTik|Keepa|SIF|Seerfar|WallySmarter|Tsearch|睿观|智慧芽|领星官方MCP|LinkFox)[-—:\s]*/i;

function scrubBrands(text: string): string {
  let out = whitelabelText(text || '');
  out = out
    .replace(/Wally\s*Smarter/gi, '商品数据服务')
    .replace(/\bTsearch\b/gi, '网页搜索')
    .replace(/skill\.linkfox[^\s`]*/gi, '上游能力')
    .replace(/来源技能[：:].*/g, '')
    .replace(/补齐状态[：:].*/g, '')
    .replace(/上游路径[：:].*/g, '')
    .replace(/\bEchoTik\b/gi, 'TikTok 数据')
    .replace(/\bKeepa\b/gi, '历史价格数据')
    .replace(/\bSeerfar\b/gi, 'Ozon 数据')
    .replace(/\bSIF\b/g, '流量数据')
    .replace(/卖家精灵/g, '选品数据')
    .replace(/智慧芽[-—]?/g, '')
    .replace(/睿观[-—]?/g, '')
    .replace(/官方\s*MCP\s*安装/g, '对接')
    .replace(/\bMCP\b/g, '接口')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out;
}

function tidyDashedName(name: string): string {
  let n = name.trim();
  n = n.replace(VENDOR_PREFIX, '');
  n = n.replace(/专家(-\S+)?$/g, '').trim();
  n = n.replace(/(分析师|研究员|顾问)$/g, '').trim();
  n = n.replace(/\s{2,}/g, ' ');
  // Platform-Action → 更顺的中文
  n = n.replace(/^亚马逊[-—]/, '亚马逊');
  n = n.replace(/^Temu(美国站|欧洲站|全球站)?[-—]/, (_, site) => `Temu${site || ''}`);
  n = n.replace(/^Shopee[-—]/, 'Shopee');
  n = n.replace(/^TikTok\s*Shop?[-—]/i, 'TikTok Shop');
  // Ensure not empty
  return n || name;
}

function productizeName(key: string, current: string): string {
  if (NAME_MAP[key]) return NAME_MAP[key];
  let name = scrubBrands(current);
  name = tidyDashedName(name);
  // Verbify common noun-only leftovers
  if (/专家/.test(name)) name = name.replace(/专家/g, '').trim();
  if (/^(查询|搜索|生成|分析|挖掘|检测|监控|优化|撰写|规划|扫描|拉取|列出|获取|翻译|下载|反查|概览|解读|复刻|裂变|核算|评估|策划|捕捉|发掘|推荐|筛选|打开|对接|用|按|批量)/.test(name)) {
    return name.slice(0, 40);
  }
  // If still looks like "X-Y" ops label, soften
  if (/[-—]/.test(name) && name.length <= 28) {
    const parts = name.split(/[-—]/);
    if (parts.length === 2) {
      const [a, b] = parts;
      if (/订单|库存|退货|广告|报表|商品|类目|关键词|详情|健康|促销/.test(b)) {
        return `管理${a}${b}`.slice(0, 40);
      }
    }
  }
  return name.slice(0, 40);
}

function improveSummary(key: string, name: string, summary: string, descriptionMd: string): string {
  let s = scrubBrands(summary || '');
  s = s.replace(/专业电商技能搜索工具[，,].*/g, '按关键词检索可用的电商能力，覆盖选品、运营、广告、视觉与合规。');
  s = s.replace(/技能包|MCP|来源技能|WallySmarter|Tsearch|LinkFox/gi, '');
  s = s.replace(/\s{2,}/g, ' ').trim();
  if (!s || s.length < 8) {
    s = `${name}：面向跨境电商日常作业，输入必要参数即可得到结构化结果。`;
  }
  // Prefer one concise sentence
  const first = s.split(/[。.!？?\n]/).map((x) => x.trim()).filter(Boolean)[0] || s;
  let out = first.endsWith('。') ? first : `${first}。`;
  if (out.length > 120) out = `${out.slice(0, 118)}…`;
  return out;
}

function improveDescription(name: string, summary: string, descriptionMd: string): string {
  let body = scrubBrands(descriptionMd || '');
  // Drop meta lines that leak packaging
  body = body
    .split('\n')
    .filter((line) => !/来源技能|补齐状态|上游路径|skill\.linkfox|WallySmarter|Tsearch/i.test(line))
    .join('\n')
    .trim();
  const lead = `${name}。${summary}`.replace(/。。/g, '。');
  if (!body) {
    return `${lead}\n\n在能力目录点「使用」填写参数即可运行；需绑店的能力请先在店铺管理完成授权。`;
  }
  // Keep first meaningful paragraph, rewrite if it starts with HTML/prompt junk
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  let first = paras[0] || '';
  if (/生成 HTML|references\/|Write 到文件|Seedance|Prompt（CAMERA/i.test(first) || first.length > 600) {
    first = summary;
  }
  first = scrubBrands(first);
  const rest = paras.slice(1, 3).join('\n\n');
  const parts = [lead, first];
  if (rest && rest !== first && rest.length < 800) parts.push(rest);
  parts.push('在能力目录点「使用」填写参数即可运行；需绑店的能力请先在店铺管理完成授权。');
  return [...new Set(parts.filter(Boolean))].join('\n\n').slice(0, 8000);
}

export function redesignToolCopy(input: {
  key: string;
  name: string;
  summary: string;
  descriptionMd: string;
  currentCategorySlug?: string;
}): {
  name: string;
  summary: string;
  descriptionMd: string;
  categorySlug: string;
  storeBound: boolean;
  platforms: PlatformId[];
} {
  const name = productizeName(input.key, input.name);
  const summary = improveSummary(input.key, name, input.summary, input.descriptionMd);
  const descriptionMd = improveDescription(name, summary, input.descriptionMd);
  const classified = classifyTool({
    key: input.key,
    name,
    summary,
    descriptionMd,
    currentCategorySlug: input.currentCategorySlug,
  });
  return {
    name,
    summary: summary.slice(0, 480),
    descriptionMd,
    categorySlug: classified.categorySlug,
    storeBound: classified.storeBound,
    platforms: classified.platforms,
  };
}

const BRAND_LEAK = /LinkFox|WallySmarter|Tsearch|skill\.linkfox|来源技能|Wally\s*Smarter/i;

export async function redesignAllTools(prisma: PrismaClient, tenantId: string) {
  const catMap = await ensureNewCategories(prisma, tenantId);
  const cats = await prisma.category.findMany({ where: { tenantId } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  const tools = await prisma.tool.findMany({ where: { tenantId } });
  const counts: Record<string, number> = {};
  let bound = 0;
  let unbound = 0;
  let renamed = 0;
  let leaks = 0;

  for (const tool of tools) {
    const current = byId.get(tool.categoryId);
    const next = redesignToolCopy({
      key: tool.key,
      name: tool.name,
      summary: tool.summary,
      descriptionMd: tool.descriptionMd,
      currentCategorySlug: current?.slug,
    });
    const category = catMap.get(next.categorySlug) || catMap.get('general')!;
    if (next.name !== tool.name) renamed += 1;
    const blob = `${next.name}\n${next.summary}\n${next.descriptionMd}`;
    if (BRAND_LEAK.test(blob)) leaks += 1;
    await prisma.tool.update({
      where: { id: tool.id },
      data: {
        name: next.name,
        summary: next.summary,
        descriptionMd: next.descriptionMd,
        categoryId: category.id,
        storeBound: next.storeBound,
        platformsJson: next.platforms,
      },
    });
    counts[next.categorySlug] = (counts[next.categorySlug] || 0) + 1;
    if (next.storeBound) bound += 1;
    else unbound += 1;
  }

  const keep = new Set([...catMap.keys()]);
  for (const cat of cats) {
    if (keep.has(cat.slug)) continue;
    const left = await prisma.tool.count({ where: { categoryId: cat.id } });
    if (left === 0) await prisma.category.delete({ where: { id: cat.id } }).catch(() => undefined);
  }

  return { total: tools.length, renamed, bound, unbound, leaks, counts };
}
