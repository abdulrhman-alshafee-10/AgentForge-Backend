import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Seed command invoked by `prisma db seed` and `prisma migrate reset`
  seed: 'tsx prisma/seed.ts',
});
