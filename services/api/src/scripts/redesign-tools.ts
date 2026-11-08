import { PrismaClient } from '@prisma/client';
import { redesignAllTools } from '../tool-redesign';

const prisma = new PrismaClient();

async function main() {
  const tenant = (await prisma.tenant.findFirst({ where: { slug: 'default' } })) || (await prisma.tenant.findFirst());
  if (!tenant) throw new Error('no tenant');
  const result = await redesignAllTools(prisma, tenant.id);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
