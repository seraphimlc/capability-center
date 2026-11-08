import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';
import { parseApiKey, sha256 } from './domain';
import { NEW_CATEGORIES, reclassifyAllTools, classifyTool } from './tool-classify';
import { redesignAllTools } from './tool-redesign';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenant = await upsertTenant();
  const admin = await upsertUser({
    email: process.env.SEED_ADMIN_EMAIL || 'admin@visitworlds.me',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin123456',
    displayName: '平台超管',
    role: 'super_admin',
    tenantId: tenant.id,
    balance: 0,
  });
  const ops = await upsertUser({
    email: process.env.SEED_OPS_EMAIL || 'ops@visitworlds.me',
    password: process.env.SEED_OPS_PASSWORD || 'Ops123456',
    displayName: '平台运营',
    role: 'ops',
    tenantId: tenant.id,
    balance: 0,
  });
  const demo = await upsertUser({
    email: process.env.SEED_DEMO_EMAIL || 'demo@visitworlds.me',
    password: process.env.SEED_DEMO_PASSWORD || 'Demo123456',
    displayName: '演示用户',
    role: 'end_user',
    tenantId: tenant.id,
    balance: 0,
  });

  const catRows: Record<string, Awaited<ReturnType<typeof upsertCategory>>> = {};
  for (const cat of NEW_CATEGORIES) {
    catRows[cat.slug] = await upsertCategory(tenant.id, cat.slug, cat.name, cat.sort);
  }
  const selection = catRows['selection-research'];
  const listing = catRows['listing'];
  const creative = catRows['creative-visual'];
  const store = catRows['store-ops'];
  const ads = catRows['ads'];
  const analytics = catRows['analytics'];
  const complianceCat = catRows['compliance'];
  const general = catRows['general'];
  const marketing = listing;
  const platform = analytics;
  const builtin = await upsertConnector(tenant.id, 'builtin-demo', 'builtin', '内置演示连接器', 'active', {});
  const linkfox = await upsertConnector(tenant.id, 'upstream-linkfox', 'linkfox', '上游商业连接器', 'active', {
    gateway: process.env.LINKFOX_TOOL_GATEWAY || 'https://tool-gateway.linkfox.com',
    note: '密钥仅从环境变量读取，不入库',
  });

  const insight = await upsertTool({
    tenantId: tenant.id,
    key: 'text-insight',
    name: '文本洞察',
    summary: '把一段需求整理成受众、卖点和风险。',
    descriptionMd: '适合写方案前先把口头需求收成三点。内置逻辑会按文本长度与关键词给出可执行建议。',
    categoryId: general.id,
    price: 10,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['洞察', '分析', '总结', '文案'],
      required: ['text'],
      properties: { text: { type: 'string', title: '文本', description: '想分析的原文' } },
    },
    examples: [{ text: '想做一款面向独立站卖家的选品周报' }],
  });
  const picker = await upsertTool({
    tenantId: tenant.id,
    key: 'product-picker',
    name: '选品简报',
    summary: '按关键词和市场给出选品样本与切入建议。',
    descriptionMd: '用于点选调用、扣费和调用记录。演示环境返回结构化样本；字段可直接用于后续文案与利润测算。',
    categoryId: selection.id,
    price: 20,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['选品', '商品', '推荐', '市场', '店铺'],
      required: ['keyword', 'market'],
      properties: {
        keyword: { type: 'string', title: '关键词' },
        market: { type: 'string', title: '市场', enum: ['US', 'EU', 'JP', 'SEA'] },
        limit: { type: 'integer', title: '条数', default: 3 },
      },
    },
    examples: [{ keyword: '露营灯', market: 'US', limit: 3 }],
  });
  const competitor = await upsertTool({
    tenantId: tenant.id,
    key: 'competitor-insight',
    name: '竞品关键词洞察',
    summary: '拆解竞品标题里的高频词、卖点与缺口。',
    descriptionMd: '输入竞品标题或 ASIN 描述，输出词频、卖点簇与可差异化切入点。',
    categoryId: selection.id,
    price: 18,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['竞品', '关键词', 'ASIN', '洞察'],
      required: ['titles'],
      properties: {
        titles: { type: 'string', title: '竞品标题（每行一条）' },
        market: { type: 'string', title: '市场', enum: ['US', 'EU', 'JP', 'SEA'], default: 'US' },
      },
    },
    examples: [{ titles: 'Portable Camping Lantern Rechargeable LED\\nSolar Camp Light Waterproof', market: 'US' }],
  });
  const season = await upsertTool({
    tenantId: tenant.id,
    key: 'season-calendar',
    name: '季节选品日历',
    summary: '按类目给出备货、上架与促销时间窗。',
    descriptionMd: '输入类目与目标市场，返回未来 12 个月的备货/上架/促销建议月。',
    categoryId: selection.id,
    price: 12,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['季节', '日历', '备货', '选品'],
      required: ['category'],
      properties: {
        category: { type: 'string', title: '类目', description: '如露营、健身、宠物' },
        market: { type: 'string', title: '市场', enum: ['US', 'EU', 'JP', 'SEA'], default: 'US' },
      },
    },
    examples: [{ category: '露营', market: 'US' }],
  });
  const profit = await upsertTool({
    tenantId: tenant.id,
    key: 'profit-estimator',
    name: '利润测算',
    summary: '按售价、成本、费率与运费估算毛利与 ROI。',
    descriptionMd: '纯本地计算，结果可对账。适合上架前快速判断能不能做。',
    categoryId: selection.id,
    price: 5,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['利润', '测算', 'ROI', '成本'],
      required: ['price', 'cost'],
      properties: {
        price: { type: 'number', title: '售价（元）' },
        cost: { type: 'number', title: '货本（元）' },
        fee_rate: { type: 'number', title: '平台费率%', default: 15 },
        shipping: { type: 'number', title: '头程/配送（元）', default: 0 },
        ads: { type: 'number', title: '广告占比%', default: 10 },
        currency: { type: 'string', title: '币种', default: 'CNY', enum: ['CNY'] },
      },
    },
    examples: [{ price: 129, cost: 42, fee_rate: 15, shipping: 18, ads: 12 }],
  });
  const traffic = await upsertTool({
    tenantId: tenant.id,
    key: 'store-traffic',
    name: '店铺流量概览',
    summary: '汇总近 N 天访客、转化与来源结构。',
    descriptionMd: '演示环境按店铺名与天数生成可解释的流量结构，便于验收抽屉与图表文案。',
    categoryId: store.id,
    price: 15,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['店铺', '流量', '转化', '访客'],
      required: ['store_name'],
      properties: {
        store_name: { type: 'string', title: '店铺名' },
        days: { type: 'integer', title: '天数', enum: [7, 14, 30], default: 7 },
        market: { type: 'string', title: '市场', enum: ['US', 'EU', 'JP', 'SEA'], default: 'US' },
      },
    },
    examples: [{ store_name: '北野户外旗舰店', days: 7, market: 'US' }],
  });
  const listingHealth = await upsertTool({
    tenantId: tenant.id,
    key: 'listing-health',
    name: 'Listing 健康度',
    summary: '检查标题、五点、主图与 A+ 完整度并打分。',
    descriptionMd: '输入 Listing 文本，输出分项得分、缺口清单与优先改法。',
    categoryId: listing.id,
    price: 12,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['Listing', '健康度', '五点', '标题'],
      required: ['title'],
      properties: {
        title: { type: 'string', title: '标题' },
        bullets: { type: 'string', title: '五点描述（每行一条）' },
        has_main_image: { type: 'boolean', title: '已有主图', default: true },
        has_a_plus: { type: 'boolean', title: '已有 A+', default: false },
      },
    },
    examples: [{ title: 'Portable Camping Lantern 1000LM Rechargeable', bullets: 'IP65 waterproof\\nUSB-C fast charge\\n3 light modes', has_main_image: true, has_a_plus: false }],
  });
  const listingCopy = await upsertTool({
    tenantId: tenant.id,
    key: 'listing-copy',
    name: '商品文案生成',
    summary: '按卖点生成标题、五点与短描述。',
    descriptionMd: '输入商品与卖点，输出可直接粘贴的中文/英文 Listing 文案骨架。',
    categoryId: marketing.id,
    price: 16,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['文案', 'Listing', '五点', '标题'],
      required: ['product', 'selling_points'],
      properties: {
        product: { type: 'string', title: '商品名' },
        selling_points: { type: 'string', title: '卖点（逗号或换行）' },
        audience: { type: 'string', title: '人群', default: '户外露营用户' },
        language: { type: 'string', title: '语言', enum: ['zh', 'en'], default: 'zh' },
      },
    },
    examples: [{ product: '露营灯', selling_points: '续航长,防水,多档亮度', audience: '周末露营家庭', language: 'zh' }],
  });
  const titleOpt = await upsertTool({
    tenantId: tenant.id,
    key: 'title-optimizer',
    name: '标题优化',
    summary: '压缩冗长标题并补上高转化词。',
    descriptionMd: '保留核心属性，去掉堆砌词，给出 3 版可选标题。',
    categoryId: marketing.id,
    price: 8,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['标题', '优化', 'SEO'],
      required: ['title'],
      properties: {
        title: { type: 'string', title: '原标题' },
        keyword: { type: 'string', title: '主关键词' },
        market: { type: 'string', title: '市场', enum: ['US', 'EU', 'JP', 'SEA'], default: 'US' },
      },
    },
    examples: [{ title: 'New Hot Portable Camping Lantern Light LED Rechargeable Best Seller', keyword: 'camping lantern', market: 'US' }],
  });
  const adCopy = await upsertTool({
    tenantId: tenant.id,
    key: 'ad-copy',
    name: '广告文案',
    summary: '生成搜索广告标题与描述组合。',
    descriptionMd: '按投放目标输出多组标题/描述，并标注建议匹配方式。',
    categoryId: ads.id,
    price: 10,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['广告', '投放', '文案', 'Sponsored'],
      required: ['product', 'offer'],
      properties: {
        product: { type: 'string', title: '商品' },
        offer: { type: 'string', title: '卖点/优惠' },
        goal: { type: 'string', title: '目标', enum: ['转化', '引流', '清仓'], default: '转化' },
      },
    },
    examples: [{ product: '露营灯', offer: '首单立减 20%', goal: '转化' }],
  });
  const faq = await upsertTool({
    tenantId: tenant.id,
    key: 'faq-reply',
    name: '客服话术',
    summary: '针对买家问题生成礼貌可发的回复。',
    descriptionMd: '覆盖物流、尺码、退换等常见场景，输出主回复 + 备选短句。',
    categoryId: general.id,
    price: 6,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['客服', '话术', '回复', 'FAQ'],
      required: ['question'],
      properties: {
        question: { type: 'string', title: '买家问题' },
        tone: { type: 'string', title: '语气', enum: ['礼貌', '简洁', '补偿'], default: '礼貌' },
        policy: { type: 'string', title: '店铺政策补充', default: '' },
      },
    },
    examples: [{ question: '包装里少了一个支架，怎么处理？', tone: '补偿', policy: '7 天内可补发配件' }],
  });
  const translate = await upsertTool({
    tenantId: tenant.id,
    key: 'translate-listing',
    name: '刊登翻译',
    summary: '把 Listing 翻译成目标市场用语并保留卖点。',
    descriptionMd: '支持 zh↔en；输出标题、五点与注意事项，避免直译堆砌。',
    categoryId: marketing.id,
    price: 12,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['翻译', '刊登', '多语言'],
      required: ['text', 'target'],
      properties: {
        text: { type: 'string', title: '原文' },
        target: { type: 'string', title: '目标语言', enum: ['en', 'zh', 'ja'], default: 'en' },
        keep_terms: { type: 'string', title: '保留专有名词（逗号分隔）', default: '' },
      },
    },
    examples: [{ text: '便携露营灯，IP65 防水，USB-C 快充，三档亮度', target: 'en', keep_terms: 'IP65,USB-C' }],
  });
  const image = await upsertTool({
    tenantId: tenant.id,
    key: 'image-caption',
    name: '图片理解',
    summary: '上传图片后生成主图说明与构图建议。',
    descriptionMd: '文件先上传到对象存储，再把文件编号交给能力。',
    categoryId: creative.id,
    price: 15,
    connectorId: builtin.id,
    capability: 'multimodal_understand',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['识图', '图片', '主图', '看图'],
      required: ['file_id'],
      properties: { file_id: { type: 'string', title: '图片', format: 'file', 'x-file': true } },
    },
    examples: [],
  });
  const mainImage = await upsertTool({
    tenantId: tenant.id,
    key: 'main-image-brief',
    name: '主图生成简报',
    summary: '按卖点输出主图/场景图拍摄与生成指令。',
    descriptionMd: '不直接出图文件，先给出可执行的画面清单与提示词，便于对接生图能力。',
    categoryId: creative.id,
    price: 14,
    connectorId: builtin.id,
    capability: 'image_gen',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['主图', '生图', '场景图', '白底图'],
      required: ['product'],
      properties: {
        product: { type: 'string', title: '商品' },
        selling_points: { type: 'string', title: '卖点' },
        style: { type: 'string', title: '风格', enum: ['白底', '场景', '对比图'], default: '白底' },
        count: { type: 'integer', title: '张数', default: 5, enum: [3, 5, 7] },
      },
    },
    examples: [{ product: '露营灯', selling_points: '防水,续航,便携', style: '场景', count: 5 }],
  });
  const video = await upsertTool({
    tenantId: tenant.id,
    key: 'video-brief',
    name: '短视频分镜',
    summary: '提交说明后生成异步分镜与成片任务。',
    descriptionMd: '长任务进入任务中心。成功后才扣积分，取消或失败不扣。',
    categoryId: creative.id,
    price: 50,
    connectorId: builtin.id,
    capability: 'video_gen',
    isAsync: true,
    schema: {
      type: 'object',
      'x-hints': ['视频', '分镜', '短视频', '成片'],
      required: ['brief'],
      properties: {
        brief: { type: 'string', title: '分镜说明' },
        seconds: { type: 'integer', title: '时长（秒）', default: 6 },
      },
    },
    examples: [{ brief: '15 秒露营灯开箱', seconds: 6 }],
  });
  const keywordRank = await upsertTool({
    tenantId: tenant.id,
    key: 'keyword-rank',
    name: '关键词排名概览',
    summary: '估算关键词自然位与广告位区间。',
    descriptionMd: '演示按关键词哈希给出稳定区间，便于对比优化前后。',
    categoryId: platform.id,
    price: 15,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['关键词', '排名', 'SEO', '自然位'],
      required: ['keyword'],
      properties: {
        keyword: { type: 'string', title: '关键词' },
        market: { type: 'string', title: '市场', enum: ['US', 'EU', 'JP', 'SEA'], default: 'US' },
        asin: { type: 'string', title: 'ASIN（可选）', default: '' },
      },
    },
    examples: [{ keyword: 'camping lantern', market: 'US', asin: 'B0DEMO1234' }],
  });
  const compliance = await upsertTool({
    tenantId: tenant.id,
    key: 'compliance-check',
    name: 'Listing 合规检查',
    summary: '扫描违禁词、绝对化用语与敏感承诺。',
    descriptionMd: '内置中英文规则表，命中即标严重级别与改写建议。',
    categoryId: complianceCat.id,
    price: 10,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['合规', '违禁词', 'Listing', '审核'],
      required: ['text'],
      properties: {
        text: { type: 'string', title: '待检查文本' },
        market: { type: 'string', title: '市场', enum: ['US', 'EU', 'JP', 'SEA'], default: 'US' },
      },
    },
    examples: [{ text: 'Best seller 100% cure guaranteed free shipping forever', market: 'US' }],
  });
  const reviewDigest = await upsertTool({
    tenantId: tenant.id,
    key: 'review-digest',
    name: '评价摘要',
    summary: '把买家评价归纳成好评点、差评点与改品建议。',
    descriptionMd: '粘贴多条评价文本即可，输出主题簇与可执行改品/客服动作。',
    categoryId: platform.id,
    price: 12,
    connectorId: builtin.id,
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['评价', '评论', 'VOC', '差评'],
      required: ['reviews'],
      properties: {
        reviews: { type: 'string', title: '评价原文（每行或分段）' },
        product: { type: 'string', title: '商品名', default: '' },
      },
    },
    examples: [{ product: '露营灯', reviews: '很亮，续航不错\\n支架有点松\\n充电口进灰' }],
  });


  const amzSearch = await upsertTool({
    tenantId: tenant.id,
    key: 'amazon-search',
    name: '亚马逊前台搜索',
    summary: '按关键词拉取亚马逊实时搜索结果（含广告位）。',
    descriptionMd: '走上游网关 `amazon/search`。默认关闭竞品补全以控制费用；需要月销等字段时再打开。',
    categoryId: selection.id,
    price: 25,
    connectorId: linkfox.id,
    upstreamOp: 'amazon/search',
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['亚马逊', '搜索', 'ASIN', '竞品'],
      required: ['keyword'],
      properties: {
        keyword: { type: 'string', title: '关键词' },
        amazonDomain: { type: 'string', title: '站点', default: 'amazon.com', enum: ['amazon.com','amazon.co.uk','amazon.de','amazon.co.jp','amazon.ca','amazon.com.au'] },
        page: { type: 'integer', title: '页码', default: 1 },
        sort: { type: 'string', title: '排序', default: 'relevanceblender', enum: ['relevanceblender','price-asc-rank','price-desc-rank','review-rank','date-desc-rank','exact-aware-popularity-rank'] },
        includeSellerSpriteData: { type: 'boolean', title: '补全竞品销量（更贵）', default: false },
      },
    },
    examples: [{ keyword: 'camping lantern', amazonDomain: 'amazon.com', page: 1, includeSellerSpriteData: false }],
  });
  const amzDetail = await upsertTool({
    tenantId: tenant.id,
    key: 'amazon-product-detail',
    name: '亚马逊商品详情',
    summary: '按 ASIN 批量查询价格、五点、变体等详情。',
    descriptionMd: '上游 `amazon/product/detail`，单次最多 5 个 ASIN。',
    categoryId: selection.id,
    price: 20,
    connectorId: linkfox.id,
    upstreamOp: 'amazon/product/detail',
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['ASIN', '详情', '五点'],
      required: ['asins'],
      properties: {
        asins: { type: 'string', title: 'ASIN（逗号分隔，最多5个）' },
        amazonDomain: { type: 'string', title: '站点', default: 'amazon.com' },
        returnBoughtTogether: { type: 'boolean', title: '一起购买', default: false },
        returnRelatedProducts: { type: 'boolean', title: '相关商品', default: false },
      },
    },
    examples: [{ asins: 'B072MQ5BRX', amazonDomain: 'amazon.com' }],
  });
  const ebaySearch = await upsertTool({
    tenantId: tenant.id,
    key: 'ebay-search',
    name: 'eBay 商品搜索',
    summary: '按关键词搜索 eBay 刊登与价格。',
    descriptionMd: '上游 `ebay/search`。',
    categoryId: platform.id,
    price: 18,
    connectorId: linkfox.id,
    upstreamOp: 'ebay/search',
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['eBay', '搜索'],
      required: ['keyword'],
      properties: {
        keyword: { type: 'string', title: '关键词' },
        ebayDomain: { type: 'string', title: '站点', default: 'ebay.com' },
        page: { type: 'integer', title: '页码', default: 1 },
        pageSize: { type: 'integer', title: '每页条数', default: 50, enum: [25, 50, 100] },
      },
    },
    examples: [{ keyword: 'camping lantern', ebayDomain: 'ebay.com', pageSize: 25 }],
  });
  const walmartSearch = await upsertTool({
    tenantId: tenant.id,
    key: 'walmart-search',
    name: 'Walmart 商品搜索',
    summary: '按关键词搜索 Walmart 商品与价格。',
    descriptionMd: '上游 `walmart/search`。',
    categoryId: platform.id,
    price: 18,
    connectorId: linkfox.id,
    upstreamOp: 'walmart/search',
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['Walmart', '搜索'],
      required: ['keyword'],
      properties: {
        keyword: { type: 'string', title: '关键词' },
        sort: { type: 'string', title: '排序', default: 'best_match', enum: ['best_match','best_seller','price_low','price_high'] },
        page: { type: 'integer', title: '页码', default: 1 },
      },
    },
    examples: [{ keyword: 'camping lantern', sort: 'best_seller', page: 1 }],
  });
  const titleAnalyze = await upsertTool({
    tenantId: tenant.id,
    key: 'product-title-analyze',
    name: '标题分词分析',
    summary: '从商品标题中抽取指定维度的属性词并计数。',
    descriptionMd: '上游 `product/titleAnalyze`。适合竞品标题场景词/材质词统计。',
    categoryId: marketing.id,
    price: 15,
    connectorId: linkfox.id,
    upstreamOp: 'product/titleAnalyze',
    capability: 'sync',
    isAsync: false,
    schema: {
      type: 'object',
      'x-hints': ['标题', '分词', '属性'],
      required: ['tokenizationAndCountingRequest'],
      properties: {
        tokenizationAndCountingRequest: { type: 'string', title: '分析指令', description: '如：统计商品标题中出现的场景词' },
        outputMode: { type: 'string', title: '输出模式', default: 'MULTIPLE_RECORDS', enum: ['MULTIPLE_RECORDS', 'COMMA_SEPARATED'] },
      },
    },
    examples: [{ tokenizationAndCountingRequest: '统计商品标题中出现的场景词', outputMode: 'MULTIPLE_RECORDS' }],
  });

  const chat = await upsertModel(tenant.id, '标准对话', 'chat', process.env.LLM_MODEL || 'deepseek-v4.1-flash');
  const reason = await upsertModel(tenant.id, '深度推理', 'reasoning', process.env.LLM_MODEL || 'deepseek-v4.1-flash');
  await upsertModel(tenant.id, '图像理解', 'multimodal_understand', process.env.LLM_MODEL || 'deepseek-v4.1-flash');
  await upsertModel(tenant.id, '视频生成', 'video_gen', 'mock-video');

  await upsertAgent({
    tenantId: tenant.id,
    key: 'buyer-assistant',
    name: '选品顾问',
    summary: '帮你做选品简报、竞品洞察、季节日历与利润测算。',
    prompt: '你是选品顾问。优先调用已启用技能拿到结构化结果，再用简体中文解释可执行建议。',
    status: 'published',
    primary: chat.id,
    backup: reason.id,
    suggestions: ['帮我做一份露营灯的选品简报', '测算售价 129、货本 42 的利润', '看看竞品标题里高频词'],
    tools: [picker.id, amzSearch.id, amzDetail.id, competitor.id, season.id, profit.id, insight.id],
  });
  await upsertAgent({
    tenantId: tenant.id,
    key: 'studio-assistant',
    name: '内容工作室',
    summary: '处理文案、主图简报、图片理解与短视频分镜。',
    prompt: '你是内容工作室助手。文案、图片和视频请求请调用对应技能，再汇总成可直接用的素材清单。',
    status: 'published',
    primary: chat.id,
    backup: reason.id,
    suggestions: ['写一套露营灯 Listing 文案', '出 5 张主图生成简报', '做一条露营灯短视频分镜'],
    tools: [listingCopy.id, titleOpt.id, titleAnalyze.id, adCopy.id, translate.id, image.id, mainImage.id, video.id],
  });
  await upsertAgent({
    tenantId: tenant.id,
    key: 'ops-assistant',
    name: '运营助手',
    summary: '看店铺流量、Listing 健康度、关键词排名、合规与评价。',
    prompt: '你是运营助手。优先调用店铺与平台数据技能，给出本周可执行动作。',
    status: 'published',
    primary: chat.id,
    backup: reason.id,
    suggestions: ['看下店铺近 7 天流量', '检查这段 Listing 是否合规', '摘要这批差评'],
    tools: [traffic.id, listingHealth.id, keywordRank.id, compliance.id, reviewDigest.id, faq.id, ebaySearch.id, walmartSearch.id],
  });
  await upsertAgent({
    tenantId: tenant.id,
    key: 'desk-assistant',
    name: '值班助手',
    summary: '纯对话助手，没有绑定技能。',
    prompt: '你是值班助手，只做对话，不调用工具。',
    status: 'published',
    primary: chat.id,
    backup: null,
    suggestions: ['能力中心能做什么？', '积分是怎么扣的？'],
    tools: [],
  });

  await seedOss(tenant.id);
  await seedFlags();
  await seedRates();
  await seedTemplates();
  await seedAnnouncement();
  await seedDemoKey(demo.id, tenant.id);
  const hello = await prisma.inboxMessage.findFirst({ where: { userId: demo.id, title: '余额为 0' } });
  if (!hello) {
    await prisma.inboxMessage.create({
      data: {
        id: ulid(),
        userId: demo.id,
        title: '余额为 0',
        body: '演示账号当前没有积分。请让运营在管理端充值后再调用付费能力。对话本身默认不扣积分。',
      },
    });
  }
  const seeded = await prisma.auditEvent.findFirst({ where: { action: 'seed.ready' } });
  if (!seeded) {
    await prisma.auditEvent.create({
      data: {
        id: ulid(),
        tenantId: tenant.id,
        actorId: admin.id,
        action: 'seed.ready',
        targetType: 'tenant',
        targetId: tenant.id,
        detail: { ops: ops.email, demo: demo.email },
      },
    });
  }
  await seedMockShops(demo.id, tenant.id);
  const reclass = await reclassifyAllTools(prisma, tenant.id);
  console.log('reclassified tools', reclass);
  const redesigned = await redesignAllTools(prisma, tenant.id);
  console.log('redesigned tools', redesigned);
  const platformAgents = await seedPlatformAgents(tenant.id, chat.id, reason.id);
  console.log('platform agents', platformAgents);
  console.log('seed ready', { admin: admin.email, ops: ops.email, demo: demo.email });
}

async function upsertTenant() {
  const existing = await prisma.tenant.findUnique({ where: { slug: 'default' } });
  if (existing) return existing;
  return prisma.tenant.create({ data: { id: ulid(), name: '默认租户', slug: 'default', status: 'active' } });
}

async function upsertUser(input: { email: string; password: string; displayName: string; role: string; tenantId: string; balance: number }) {
  let user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: ulid(),
        tenantId: input.tenantId,
        email: input.email,
        passwordHash: await bcrypt.hash(input.password, 10),
        displayName: input.displayName,
        role: input.role,
        status: 'active',
      },
    });
  }
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) {
    await prisma.wallet.create({ data: { id: ulid(), userId: user.id, tenantId: input.tenantId, balance: input.balance } });
  }
  const quota = await prisma.storageQuota.findUnique({ where: { userId: user.id } });
  if (!quota) {
    await prisma.storageQuota.create({ data: { id: ulid(), userId: user.id, limitBytes: 1024 * 1024 * 1024, usedBytes: 0 } });
  }
  return user;
}

async function upsertCategory(tenantId: string, slug: string, name: string, sort: number) {
  const existing = await prisma.category.findFirst({ where: { tenantId, slug } });
  if (existing) return prisma.category.update({ where: { id: existing.id }, data: { name, sort } });
  return prisma.category.create({ data: { id: ulid(), tenantId, slug, name, sort } });
}

async function upsertConnector(tenantId: string, name: string, type: string, label: string, status: string, config: unknown) {
  const existing = await prisma.connector.findFirst({ where: { tenantId, name: label } });
  if (existing) {
    return prisma.connector.update({
      where: { id: existing.id },
      data: { type, status, configEnc: JSON.stringify(config) },
    });
  }
  return prisma.connector.create({
    data: { id: ulid(), tenantId, type, name: label, status, configEnc: JSON.stringify(config) },
  });
}

async function upsertTool(input: {
  tenantId: string;
  key: string;
  name: string;
  summary: string;
  descriptionMd: string;
  categoryId: string;
  price: number;
  connectorId: string;
  capability: string;
  isAsync: boolean;
  schema: unknown;
  examples: unknown;
  upstreamOp?: string;
  storeBound?: boolean;
  platforms?: string[];
}) {
  const classified = classifyTool({
    key: input.key,
    name: input.name,
    summary: input.summary,
    descriptionMd: input.descriptionMd,
  });
  const existing = await prisma.tool.findFirst({ where: { tenantId: input.tenantId, key: input.key } });
  const data = {
    name: input.name,
    summary: input.summary,
    descriptionMd: input.descriptionMd,
    categoryId: input.categoryId,
    status: 'published',
    schemaJson: input.schema as object,
    examplesJson: input.examples as object,
    pricingCredits: input.price,
    connectorId: input.connectorId,
    upstreamOp: input.upstreamOp || 'run',
    isAsync: input.isAsync,
    capability: input.capability,
    storeBound: input.storeBound ?? classified.storeBound,
    platformsJson: input.platforms ?? classified.platforms,
  };
  if (existing) return prisma.tool.update({ where: { id: existing.id }, data });
  return prisma.tool.create({ data: { id: ulid(), tenantId: input.tenantId, key: input.key, ...data } });
}

async function upsertModel(tenantId: string, displayName: string, capability: string, upstreamModel: string) {
  const existing = await prisma.aiModel.findFirst({ where: { tenantId, displayName } });
  if (existing) {
    return prisma.aiModel.update({ where: { id: existing.id }, data: { capability, upstreamModel, status: 'active' } });
  }
  return prisma.aiModel.create({
    data: {
      id: ulid(),
      tenantId,
      displayName,
      capability,
      upstreamModel,
      status: 'active',
      timeoutMs: 60000,
      maxTokens: 2048,
      priceCredits: 0,
    },
  });
}

async function upsertAgent(input: {
  tenantId: string;
  key: string;
  name: string;
  summary: string;
  prompt: string;
  status: string;
  primary: string;
  backup: string | null;
  suggestions: string[];
  tools: string[];
}) {
  let agent = await prisma.agent.findFirst({ where: { tenantId: input.tenantId, key: input.key } });
  const data = {
    name: input.name,
    summary: input.summary,
    systemPrompt: input.prompt,
    status: input.status,
    primaryModelId: input.primary,
    backupModelId: input.backup,
    suggestions: input.suggestions,
    showThinkingDefault: false,
  };
  if (!agent) {
    agent = await prisma.agent.create({ data: { id: ulid(), tenantId: input.tenantId, key: input.key, ...data } });
  } else {
    agent = await prisma.agent.update({ where: { id: agent.id }, data });
  }
  await prisma.agentTool.deleteMany({ where: { agentId: agent.id } });
  if (input.tools.length) {
    await prisma.agentTool.createMany({ data: input.tools.map((toolId) => ({ agentId: agent.id, toolId })) });
  }
  return agent;
}

async function seedOss(tenantId: string) {
  const provider = process.env.OSS_PROVIDER || 'minio';
  const endpoint = process.env.OSS_ENDPOINT || 'http://minio:9000';
  const data = {
    provider,
    endpoint,
    publicEndpoint: process.env.OSS_PUBLIC_ENDPOINT || endpoint,
    region: process.env.OSS_REGION || 'us-east-1',
    bucket: process.env.OSS_BUCKET || 'capability-center',
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || 'minioadmin',
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || 'minioadmin',
    prefix: process.env.OSS_PREFIX || 'capability-center',
    publicRead: process.env.OSS_PUBLIC_READ === 'true',
    signedUrlExpires: Number(process.env.OSS_SIGNED_URL_EXPIRES || 3600),
    mediaPublicBase: process.env.MEDIA_PUBLIC_BASE || null,
    forcePathStyle: process.env.OSS_FORCE_PATH_STYLE ? process.env.OSS_FORCE_PATH_STYLE !== 'false' : provider !== 'aliyun',
    status: 'active',
  };
  await prisma.ossConfig.upsert({
    where: { tenantId },
    update: data,
    create: { id: ulid(), tenantId, ...data },
  });
}

async function seedFlags() {
  const flags: Record<string, string> = {
    billing_strategy: 'A',
    maintenance_mode: 'false',
    online_pay_enabled: 'false',
    watermark: 'true',
    sms_enabled: 'false',
  };
  for (const [key, value] of Object.entries(flags)) {
    await prisma.featureFlag.upsert({ where: { key }, update: {}, create: { key, value } });
  }
}

async function seedRates() {
  const rules = [
    { scope: 'user_invoke', limit: 120, windowSec: 60 },
    { scope: 'open_invoke', limit: 60, windowSec: 60 },
  ];
  for (const rule of rules) {
    await prisma.rateLimitRule.upsert({
      where: { scope: rule.scope },
      update: {},
      create: { id: ulid(), ...rule, enabled: true },
    });
  }
}

async function seedTemplates() {
  const templates = [
    { code: 'wallet.grant', title: '积分已到账', body: '你收到了新的积分。' },
    { code: 'task.done', title: '任务已完成', body: '异步任务已完成。' },
  ];
  for (const template of templates) {
    await prisma.messageTemplate.upsert({
      where: { code: template.code },
      update: {},
      create: { id: ulid(), ...template, channel: 'inbox' },
    });
  }
}

async function seedAnnouncement() {
  const title = '能力中心已就绪';
  const existing = await prisma.announcement.findFirst({ where: { title } });
  if (existing) return;
  await prisma.announcement.create({
    data: {
      id: ulid(),
      title,
      body: '目录、对话、钱包和任务中心可以开始演示。未配置模型密钥时，对话使用本地模拟流。',
      published: true,
    },
  });
}

async function seedDemoKey(userId: string, tenantId: string) {
  const token = process.env.SEED_API_KEY || 'ck_sandbox_demo01_capabilitycenterdevsecret';
  const parsed = parseApiKey(token);
  if (!parsed) return;
  const existing = await prisma.apiKey.findFirst({ where: { keyPrefix: parsed.publicId, env: parsed.env } });
  if (existing) return;
  const pepper = process.env.API_KEY_PEPPER || 'dev-pepper';
  await prisma.apiKey.create({
    data: {
      id: ulid(),
      userId,
      tenantId,
      name: '演示 WorkBuddy 密钥',
      env: parsed.env,
      keyPrefix: parsed.publicId,
      keyHash: sha256(`${parsed.secret}${pepper}`),
      scopes: ['tools:read', 'tools:invoke', 'wallet:read'],
      ipAllowlist: [],
      status: 'active',
    },
  });
}


async function seedMockShops(userId: string, tenantId: string) {
  const mocks: { platform: string; name: string; marketplace?: string; credentials: Record<string, string> }[] = [
    {
      platform: 'amazon',
      name: '美亚·Nordic Home',
      marketplace: 'US',
      credentials: { seller_id: 'A1MOCKUS001', marketplace: 'US', refresh_token: 'mock-amz-us-refresh', client_id: 'mock-lwa', client_secret: 'mock-secret' },
    },
    {
      platform: 'amazon',
      name: '日亚·Nordic JP',
      marketplace: 'JP',
      credentials: { seller_id: 'A1MOCKJP001', marketplace: 'JP', refresh_token: 'mock-amz-jp-refresh', client_id: 'mock-lwa', client_secret: 'mock-secret' },
    },
    {
      platform: 'shopify',
      name: '独立站·VisitWorlds',
      credentials: { shop_domain: 'visitworlds-demo.myshopify.com', access_token: 'shpat_mock_token' },
    },
    {
      platform: 'temu',
      name: 'Temu·美区主店',
      marketplace: 'US',
      credentials: { shop_id: 'temu-mock-us', access_token: 'temu-mock-token', region: 'US' },
    },
    {
      platform: 'shopee',
      name: 'Shopee·新加坡店',
      marketplace: 'SG',
      credentials: { shop_id: 'shopee-mock-sg', access_token: 'shopee-mock-token', region: 'SG' },
    },
    {
      platform: 'tiktok_shop',
      name: 'TikTok Shop·美区',
      marketplace: 'US',
      credentials: { shop_id: 'tts-mock-us', access_token: 'tts-mock-token', region: 'US' },
    },
    {
      platform: 'ebay',
      name: 'eBay·US 主店',
      marketplace: 'EBAY_US',
      credentials: { user_id: 'ebay-mock-us', refresh_token: 'ebay-mock-refresh', marketplace: 'EBAY_US' },
    },
    {
      platform: 'alibaba1688',
      name: '1688·采购号',
      credentials: { account_name: 'vw-sourcing', access_token: '1688-mock-token' },
    },
  ];
  for (const item of mocks) {
    const existing = await prisma.shopAccount.findFirst({
      where: { tenantId, userId, platform: item.platform, name: item.name, status: { not: 'deleted' } },
    });
    if (existing) {
      await prisma.shopAccount.update({
        where: { id: existing.id },
        data: {
          status: 'connected',
          credentialsEnc: JSON.stringify(item.credentials),
          marketplace: item.marketplace || item.credentials.marketplace || item.credentials.region || null,
          lastCheckedAt: new Date(),
          errorMessage: null,
        },
      });
      continue;
    }
    await prisma.shopAccount.create({
      data: {
        id: ulid(),
        tenantId,
        userId,
        platform: item.platform,
        name: item.name,
        externalStoreId: item.credentials.shop_id || item.credentials.seller_id || item.credentials.user_id || null,
        marketplace: item.marketplace || item.credentials.marketplace || item.credentials.region || null,
        authType: 'api_key',
        status: 'connected',
        credentialsEnc: JSON.stringify(item.credentials),
        metaJson: { mock: true },
        lastCheckedAt: new Date(),
      },
    });
  }
}


async function seedPlatformAgents(tenantId: string, primary: string, backup: string | null) {
  const defs: {
    platform: string;
    key: string;
    name: string;
    summary: string;
    prompt: string;
    suggestions: string[];
    match: RegExp;
  }[] = [
    {
      platform: 'amazon',
      key: 'amazon-store-assistant',
      name: '亚马逊店铺助手',
      summary: '盯库存、Listing、广告与竞品，围绕已连接的亚马逊店铺作业。',
      prompt: '你是亚马逊店铺助手。优先调用已绑定的亚马逊相关能力，用简体中文给出可执行建议。不要提及上游供应商品牌名。',
      suggestions: ['帮我看下 FBA 库存风险', '优化这条 Listing 标题和五点', '对比几个竞品 ASIN'],
      match: /amazon|amz|asin|fba|aba|keepa|listing|sponsored/i,
    },
    {
      platform: 'shopify',
      key: 'shopify-store-assistant',
      name: 'Shopify 店铺助手',
      summary: '服务独立站：商品内容、转化文案、视觉素材与流量概览。',
      prompt: '你是 Shopify 店铺助手。优先使用通用选品、文案、视觉与店铺运营能力。不要提及上游供应商品牌名。',
      suggestions: ['写一套独立站商品详情文案', '出主图生成简报', '估算利润'],
      match: /shopify|独立站|listing-copy|main-image|image-caption|store-traffic|profit|translate|ad-copy|text-insight/i,
    },
    {
      platform: 'temu',
      key: 'temu-store-assistant',
      name: 'Temu 店铺助手',
      summary: '覆盖 Temu 订单、库存、类目、促销与合规。',
      prompt: '你是 Temu 店铺助手。优先调用 Temu 相关能力。不要提及上游供应商品牌名。',
      suggestions: ['查美国站待发订单', '搜索可上架类目', '看看可开的促销'],
      match: /temu/i,
    },
    {
      platform: 'ebay',
      key: 'ebay-store-assistant',
      name: 'eBay 店铺助手',
      summary: '搜索 eBay 供给、优化刊登并处理日常运营。',
      prompt: '你是 eBay 店铺助手。优先使用 eBay 搜索与通用刊登/运营能力。不要提及上游供应商品牌名。',
      suggestions: ['搜索 eBay 供给', '优化刊登标题', '翻译 Listing'],
      match: /ebay|listing-copy|title-optimizer|translate-listing|store-traffic|compliance|review-digest/i,
    },
    {
      platform: 'shopee',
      key: 'shopee-store-assistant',
      name: 'Shopee 店铺助手',
      summary: '面向虾皮店铺的商品、分类、账户健康与运营。',
      prompt: '你是 Shopee 店铺助手。优先调用 Shopee 相关能力。不要提及上游供应商品牌名。',
      suggestions: ['看店铺账户健康', '整理店铺分类', '生成客服话术'],
      match: /shopee|faq-reply|listing-health|store-traffic|compliance/i,
    },
    {
      platform: 'tiktok_shop',
      key: 'tiktok-shop-assistant',
      name: 'TikTok Shop 店铺助手',
      summary: '围绕 TikTok Shop 的带货视频、商品数据与店铺表现。',
      prompt: '你是 TikTok Shop 店铺助手。优先调用短视频与 TikTok 相关能力。不要提及上游供应商品牌名。',
      suggestions: ['搜索相关带货视频', '看新品排行', '生成口播脚本'],
      match: /tiktok|echotik|口播|短视频|videogen|带货/i,
    },
    {
      platform: 'walmart',
      key: 'walmart-store-assistant',
      name: 'Walmart 店铺助手',
      summary: 'Walmart 选品搜索、刊登优化与运营动作。',
      prompt: '你是 Walmart 店铺助手。优先使用 Walmart 搜索与通用刊登/选品能力。不要提及上游供应商品牌名。',
      suggestions: ['搜索 Walmart 商品', '写刊登文案', '测算利润'],
      match: /walmart|listing-copy|title-optimizer|profit|compliance|product-picker|competitor/i,
    },
    {
      platform: 'alibaba1688',
      key: 'alibaba1688-store-assistant',
      name: '1688 采购助手',
      summary: '找货、以图搜同款、看商品详情与采购链路。',
      prompt: '你是 1688 采购助手。优先调用 1688 找货与商品详情类能力。不要提及上游供应商品牌名。',
      suggestions: ['按图搜同款', '查阶梯价', '找一批货源'],
      match: /1688|alibaba|sourcing|找货|以图搜/i,
    },
  ];

  const tools = await prisma.tool.findMany({ where: { tenantId, status: 'published' } });
  const out: { key: string; name: string; tools: number; platform: string }[] = [];
  for (const def of defs) {
    const ranked = tools
      .map((t) => {
        const platforms = Array.isArray(t.platformsJson) ? (t.platformsJson as string[]) : [];
        const hay = `${t.key} ${t.name} ${t.summary}`;
        let score = 0;
        if (platforms.includes(def.platform)) score += 5;
        if (def.match.test(hay)) score += 3;
        if (t.storeBound && platforms.includes(def.platform)) score += 2;
        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const picked: string[] = [];
    const catCount = new Map<string, number>();
    for (const row of ranked) {
      if (picked.length >= 36) break;
      const n = catCount.get(row.t.categoryId) || 0;
      if (n >= 8 && picked.length >= 12) continue;
      picked.push(row.t.id);
      catCount.set(row.t.categoryId, n + 1);
    }
    while (picked.length < 8 && picked.length < ranked.length) {
      for (const row of ranked) {
        if (!picked.includes(row.t.id)) picked.push(row.t.id);
        if (picked.length >= 8) break;
      }
      break;
    }
    await upsertAgent({
      tenantId,
      key: def.key,
      name: def.name,
      summary: def.summary,
      prompt: def.prompt,
      status: 'published',
      primary,
      backup,
      suggestions: def.suggestions,
      tools: picked.slice(0, 40),
    });
    const agent = await prisma.agent.findFirst({ where: { tenantId, key: def.key } });
    if (agent) {
      try {
        await prisma.agent.update({
          where: { id: agent.id },
          data: { platformsJson: [def.platform] },
        });
      } catch {
        // ignore if client not yet aware; raw fallback
        await prisma.$executeRawUnsafe(
          `UPDATE agents SET platforms_json = CAST(? AS JSON) WHERE id = ?`,
          JSON.stringify([def.platform]),
          agent.id,
        ).catch(() => undefined);
      }
    }
    out.push({ key: def.key, name: def.name, tools: Math.min(40, picked.length), platform: def.platform });
  }
  return out;
}


main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
