import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const users = await prisma.user.findMany({
  where: { deleted_at: null },
  select: { username: true, discord_id: true, role: true, created_at: true },
  orderBy: { created_at: 'asc' },
});
users.forEach((u) =>
  console.log(`${u.created_at.toISOString().slice(0, 10)}  ${u.role.padEnd(9)}  ${u.discord_id.padEnd(30)}  ${u.username}`),
);
console.log(`\nTotal: ${users.length}`);
await prisma.$disconnect();
