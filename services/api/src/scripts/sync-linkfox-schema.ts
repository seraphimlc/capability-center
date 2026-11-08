import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'node:fs';

const prisma = new PrismaClient();

function toolKey(slug: string): string {
  return slug.replace(/^linkfox-/, 'lf-');
}

async function main() {
  const candidates = [
    process.env.LINKFOX_ENRICHED_JSON || '',
    '/data/linkfox-skills-enriched.json',
    '/app/data/linkfox-skills-enriched.json',
  ].filter(Boolean);
  // also try host-mounted path when running outside docker
  for (const p of ['./data/linkfox-skills-enriched.json', '../data/linkfox-skills-enriched.json']) {
    candidates.push(p);
  }
  const path = candidates.find((p) => p && existsSync(p));
  if (!path) throw new Error('enriched json not found');
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    skills: Array<{
      slug: string;
      upstream_path?: string;
      schema: Record<string, unknown>;
      fill_status?: string;
      summary?: string;
    }>;
  };
  const tenant = (await prisma.tenant.findFirst({ where: { slug: 'default' } })) || (await prisma.tenant.findFirst());
  if (!tenant) throw new Error('no tenant');

  let updated = 0;
  let missing = 0;
  let stubbed = 0;
  for (const skill of raw.skills) {
    const key = toolKey(skill.slug);
    const tool = await prisma.tool.findFirst({ where: { tenantId: tenant.id, key } });
    if (!tool) {
      missing += 1;
      continue;
    }
    const upstreamOp = (skill.upstream_path || '').trim() || tool.upstreamOp || 'mcp/any-tool';
    const schema = {
      ...(skill.schema || (tool.schemaJson as object) || {}),
      'x-fill-status': skill.fill_status || (tool.schemaJson as any)?.['x-fill-status'] || 'unknown',
    };
    await prisma.tool.update({
      where: { id: tool.id },
      data: {
        schemaJson: schema,
        upstreamOp,
      },
    });
    updated += 1;
    if (skill.fill_status === 'stub' || skill.fill_status === 'error' || skill.fill_status === 'schema_only') stubbed += 1;
  }
  console.log(JSON.stringify({ path, updated, missing, stubbed, totalSkills: raw.skills.length }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
