import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { WorkflowEngineService } from './workflow-engine/workflow-engine.service';

const workerId = `${process.env.HOSTNAME ?? 'worker'}:${process.pid}:${randomUUID()}`;
let stopping = false;
const logger = new Logger('WorkflowWorker');
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const engine = app.get(WorkflowEngineService);
  await engine.recoverStale();
  process.on('SIGTERM', () => {
    stopping = true;
  });
  process.on('SIGINT', () => {
    stopping = true;
  });
  while (!stopping) {
    const job = await engine.claim(workerId);
    if (!job || typeof job.id !== 'string') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    try {
      logger.log(
        JSON.stringify({
          event: 'workflow.node.started',
          executionId: job.workflow_execution_id,
          jobId: job.id,
          nodeId: job.node_id,
          attempt: job.attempts,
        }),
      );
      const outcome = await engine.execute(job);
      if (!outcome.deferred) await engine.complete(job, outcome);
      logger.log(
        JSON.stringify({
          event: outcome.deferred ? 'workflow.wait' : 'workflow.node.completed',
          executionId: job.workflow_execution_id,
          jobId: job.id,
          nodeId: job.node_id,
        }),
      );
    } catch (error) {
      await engine.fail(job, error);
    }
  }
  await app.close();
}
void main();
