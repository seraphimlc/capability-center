import { Prisma, PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { TRADEMARK_TOOLS } from '../trademark-tools';

const prisma = new PrismaClient();

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const tenant =
    (await prisma.tenant.findFirst({ where: { slug: 'default' } })) || (await prisma.tenant.findFirst());
  if (!tenant) throw new Error('no tenant');

  let category = await prisma.category.findFirst({ where: { tenantId: tenant.id, slug: 'compliance' } });
  if (!category) {
    category = await prisma.category.create({
      data: { id: ulid(), tenantId: tenant.id, name: '合规风控', slug: 'compliance', sort: 7 },
    });
  }

  const envConfig = {
    url: process.env.TRADEMARK_MCP_URL || '',
    accessToken: process.env.TRADEMARK_MCP_TOKEN || '',
    refreshToken: process.env.TRADEMARK_MCP_REFRESH_TOKEN || '',
    clientId: process.env.TRADEMARK_MCP_CLIENT_ID || '',
    tokenUrl: process.env.TRADEMARK_MCP_TOKEN_URL || '',
    resource: process.env.TRADEMARK_MCP_RESOURCE || '',
  };
  const provided = Object.fromEntries(Object.entries(envConfig).filter(([, value]) => Boolean(value)));
  const force = process.env.TRADEMARK_MCP_FORCE === '1';
  const tokenKeys = ['accessToken', 'refreshToken'];
  const nonSecret = Object.fromEntries(Object.entries(provided).filter(([key]) => !tokenKeys.includes(key)));
  const secrets = Object.fromEntries(Object.entries(provided).filter(([key]) => tokenKeys.includes(key)));

  let connector = await prisma.connector.findFirst({
    where: { tenantId: tenant.id, type: 'mcp', name: '商标数据服务' },
  });
  if (connector) {
    const current = parseConfig(connector.configEnc);
    const config = {
      url: 'https://ipunique.com/mcp',
      tokenUrl: 'https://ipunique.com/api/oauth/token',
      resource: 'https://ipunique.com/mcp',
      ...current,
      ...nonSecret,
      // A refreshed token lives in the database; do not overwrite it with a stale .env value.
      ...(force || !current.accessToken ? secrets : {}),
    };
    connector = await prisma.connector.update({
      where: { id: connector.id },
      data: { status: 'active', configEnc: JSON.stringify(config) },
    });
  } else {
    connector = await prisma.connector.create({
      data: {
        id: ulid(),
        tenantId: tenant.id,
        type: 'mcp',
        name: '商标数据服务',
        status: 'active',
        configEnc: JSON.stringify({
          url: 'https://ipunique.com/mcp',
          tokenUrl: 'https://ipunique.com/api/oauth/token',
          resource: 'https://ipunique.com/mcp',
          ...provided,
        }),
      },
    });
  }

  const imported: string[] = [];
  for (const def of TRADEMARK_TOOLS) {
    const payload = {
      name: def.name,
      summary: def.summary,
      descriptionMd: def.descriptionMd,
      categoryId: category.id,
      status: 'published',
      schemaJson: def.schema as Prisma.InputJsonValue,
      examplesJson: def.examples as Prisma.InputJsonValue,
      pricingCredits: def.pricingCredits,
      connectorId: connector.id,
      upstreamOp: def.upstream,
      isAsync: false,
      capability: 'sync',
      storeBound: false,
      platformsJson: [] as Prisma.InputJsonValue,
    };
    await prisma.tool.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: def.key } },
      update: payload,
      create: { id: ulid(), tenantId: tenant.id, key: def.key, ...payload },
    });
    imported.push(def.key);
  }

  console.log(
    JSON.stringify(
      {
        connector: connector.id,
        category: category.slug,
        tools: imported,
        authorized: Boolean(provided.accessToken || parseConfig(connector.configEnc).accessToken),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('import trademark tools failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
