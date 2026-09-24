/**
 * Seeds the bootstrap ADMIN user (idempotent). System ledger accounts and KYC tier limits are
 * created by migrations, so every environment has them without running the seed.
 *
 *   npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import { hashSecret } from '../src/modules/auth/credentials.policy';

async function main(): Promise<void> {
  const phone = process.env.ADMIN_PHONE;
  const password = process.env.ADMIN_PASSWORD;
  if (!phone || !password) throw new Error('ADMIN_PHONE and ADMIN_PASSWORD must be set');

  const prisma = new PrismaClient();
  try {
    const admin = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        fullName: 'PayCore Administrator',
        passwordHash: await hashSecret(password),
        role: 'ADMIN',
        status: 'ACTIVE',
        phoneVerifiedAt: new Date(),
        kycTier: 'TIER_3',
      },
    });
    const systemAccounts = await prisma.ledgerAccount.count({ where: { ownerType: 'SYSTEM' } });
    console.log(`Admin ready: ${admin.phone} (${admin.id}); system accounts: ${systemAccounts}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
