// PrismaClient singleton.
// Real implementation lands in M1.2 once schema.prisma + Prisma 7 driver-adapter setup is wired.
// M1.1 stub keeps the package importable so workspace resolution doesn't break.

export const dbPlaceholder = 'M1.2 will export PrismaClient instance from here';
