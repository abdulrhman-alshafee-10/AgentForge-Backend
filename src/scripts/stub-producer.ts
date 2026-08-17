import { eventsService } from '../modules/executions/events.service.js';
import { prisma } from '../db/prisma.js';
import { redis } from '../redis/redis.js';

const executionId = process.argv[2];

if (!executionId) {
  console.error('Usage: tsx src/scripts/stub-producer.ts <executionId>');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const execution = await prisma.execution.findUnique({
    where: { id: executionId as string },
  });

  if (!execution) {
    console.error(`Execution ${executionId} not found`);
    process.exit(1);
  }

  const { tenantId, chatId } = execution;

  console.log(`Starting fake events for execution ${executionId}...`);

  await eventsService.appendEvent(tenantId, chatId, executionId as string, 'PLANNING', { note: 'Starting fake plan...' });
  await sleep(1000);

  await eventsService.appendEvent(tenantId, chatId, executionId as string, 'THINKING', { node: 'agent' });
  await sleep(1000);

  await eventsService.appendEvent(tenantId, chatId, executionId as string, 'CALLING_TOOL', { toolCallId: 'call_123', toolName: 'search', input: { query: 'hello' } });
  await sleep(1500);

  await eventsService.appendEvent(tenantId, chatId, executionId as string, 'TOOL_RESULT', { toolCallId: 'call_123', status: 'success', output: 'Found some results.' });
  await sleep(1000);

  await eventsService.appendEvent(tenantId, chatId, executionId as string, 'GENERATING_RESPONSE', { node: 'generate' });
  await sleep(500);

  const textChunks = ['Hello', ' there', '!', ' This', ' is', ' a', ' stubbed', ' response.'];
  for (const chunk of textChunks) {
    await eventsService.appendEvent(tenantId, chatId, executionId as string, 'RESPONSE_DELTA', { text: chunk });
    await sleep(200);
  }

  await eventsService.appendEvent(tenantId, chatId, executionId as string, 'RESPONSE_COMPLETED', { messageId: 'msg_fake_123' });
  await sleep(500);

  await eventsService.appendEvent(tenantId, chatId, executionId as string, 'COMPLETED', { messageId: 'msg_fake_123', durationMs: 5000 });

  console.log('Finished stub producer.');
  await prisma.$disconnect();
  await redis.quit();
}

run().catch(console.error);
