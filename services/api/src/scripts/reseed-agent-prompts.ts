import { PrismaClient } from '@prisma/client';
import { AGENT_PROMPTS, PUBLISHED_AGENT_KEYS } from '../agent-prompts';

const prisma = new PrismaClient();

async function main() {
  const updated: { key: string; rows: number; chars: number }[] = [];
  for (const key of PUBLISHED_AGENT_KEYS) {
    const prompt = AGENT_PROMPTS[key];
    const result = await prisma.agent.updateMany({
      where: { key },
      data: { systemPrompt: prompt },
    });
    updated.push({ key, rows: result.count, chars: Array.from(prompt).length });
  }
  console.log(JSON.stringify({ updated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
