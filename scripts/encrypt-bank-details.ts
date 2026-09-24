// One-off: encrypts any EmployeeBankDetail.accountNumber still stored as
// plaintext (rows written before WBS 6.12 landed). Safe to re-run — rows that
// are already encrypted are skipped.
//
//   FIELD_ENCRYPTION_KEY=... DATABASE_URL=... npm run encrypt:bank-details

import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { FieldEncryptionService } from '../src/crypto/field-encryption.service';

async function main() {
  // Pick up .env when run locally; on Railway the variables are already set.
  try {
    process.loadEnvFile();
  } catch {}
  const prisma = new PrismaClient();
  const encryption = new FieldEncryptionService(new ConfigService());
  encryption.onModuleInit(); // validates FIELD_ENCRYPTION_KEY

  const rows = await prisma.employeeBankDetail.findMany();
  let updated = 0;
  for (const row of rows) {
    if (encryption.isEncrypted(row.accountNumber)) continue;
    const digits = row.accountNumber.replace(/\s+/g, '');
    await prisma.employeeBankDetail.update({
      where: { id: row.id },
      data: {
        accountNumber: encryption.encrypt(digits),
        accountNumberLast4: digits.slice(-4),
      },
    });
    updated++;
  }
  console.log(`Encrypted ${updated} of ${rows.length} bank detail rows.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
