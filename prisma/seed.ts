/**
 * Prisma seed script — Phase 02
 *
 * Creates a deterministic demo dataset:
 *   - 1 demo tenant
 *   - 1 demo user (owner)
 *   - 1 demo agent
 *
 * Run with:
 *   npx prisma db seed
 *
 * or directly:
 *   npx tsx prisma/seed.ts
 *
 * Safe to re-run: uses upsert so IDs stay stable across runs.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Stable seed IDs ──────────────────────────────────────────────────────────
// Hard-coded UUIDs so the seed is deterministic across environments.

const TENANT_ID  = '00000000-0000-0000-0000-000000000001';
const USER_ID    = '00000000-0000-0000-0000-000000000002';
const AGENT_ID   = '00000000-0000-0000-0000-000000000003';

async function main(): Promise<void> {
  console.log('🌱  Seeding database …');

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    create: {
      id:       TENANT_ID,
      name:     'Demo Tenant',
      slug:     'demo',
      plan:     'pro',
      settings: {},
    },
    update: {
      name: 'Demo Tenant',
      slug: 'demo',
    },
  });

  console.log(`  ✓ Tenant  ${tenant.id}  (${tenant.slug})`);

  // ── User ──────────────────────────────────────────────────────────────────
  // Password: "demo-password-change-me"
  // Hash generated with bcrypt rounds=12 — do NOT use in production as-is.
  const DEMO_PASSWORD_HASH =
    '$2b$12$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

  const user = await prisma.user.upsert({
    where: { id: USER_ID },
    create: {
      id:           USER_ID,
      tenantId:     TENANT_ID,
      email:        'demo@agentforge.dev',
      passwordHash: DEMO_PASSWORD_HASH,
      displayName:  'Demo User',
      role:         'owner',
    },
    update: {
      displayName: 'Demo User',
      role:        'owner',
    },
  });

  console.log(`  ✓ User    ${user.id}  (${user.email})`);

  // ── Agent ─────────────────────────────────────────────────────────────────
  const agent = await prisma.agent.upsert({
    where: { id: AGENT_ID },
    create: {
      id:              AGENT_ID,
      tenantId:        TENANT_ID,
      name:            'Default Assistant',
      description:     'General-purpose assistant for the demo tenant.',
      systemPrompt:    'You are a helpful assistant.',
      model:           'gpt-4o',
      temperature:     0.7,
      tools:           [],
      workflowVersion: 'v1',
    },
    update: {
      name:        'Default Assistant',
      description: 'General-purpose assistant for the demo tenant.',
    },
  });

  console.log(`  ✓ Agent   ${agent.id}  (${agent.name})`);

  console.log('\n✅  Seed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
