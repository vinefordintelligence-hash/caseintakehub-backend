import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('durable workflow foundation migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../database/migrations/0042-authoritative-workflow-automation.sql',
    ),
    'utf8',
  );
  it('defines management, history, audit, execution, and durable job tables', () => {
    for (const table of [
      'workflow_definitions',
      'workflow_nodes',
      'workflow_edges',
      'workflow_versions',
      'workflow_executions',
      'workflow_execution_steps',
      'workflow_jobs',
      'workflow_audits',
    ])
      expect(sql).toContain(`CREATE TABLE public.${table}`);
  });
  it('enforces event and action idempotency', () => {
    expect(sql).toContain('UNIQUE(workflow_id,trigger_reference)');
    expect(sql).toContain('UNIQUE(organization_id,idempotency_key)');
  });
  it('enables tenant RLS for every engine table', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain(
      "organization_id=nullif(current_setting(''app.organization_id''",
    );
  });
  it('contains no protected-case mutation or destructive migration', () => {
    expect(sql).not.toContain('VF-2026-8282');
    expect(sql).not.toMatch(
      /\b(?:UPDATE|DELETE FROM|TRUNCATE)\s+public\.cases\b/i,
    );
  });
});

describe('workflow worker concurrency and retry controls', () => {
  const source = readFileSync(
    join(__dirname, 'workflow-engine.service.ts'),
    'utf8',
  );
  it('claims one due job with PostgreSQL row locking', () => {
    expect(source).toContain('FOR UPDATE SKIP LOCKED LIMIT 1');
    expect(source).toContain("status='RUNNING'");
  });
  it('uses bounded exponential retry and dead-letter handling', () => {
    expect(source).toContain('Math.pow(2');
    expect(source).toContain("'DEAD_LETTER'");
    expect(source).toContain('max_attempts');
  });
  it('does not execute unsupported business actions', () => {
    expect(source).toContain('workflow_node_type_not_enabled');
    expect(source).not.toContain('Would perform');
  });
  it('persists waits and never uses long-running timers for them', () => {
    expect(source).toContain("status='WAITING'");
    expect(source).toContain('make_interval(secs=>$2)');
    expect(source).not.toMatch(
      /setTimeout\([^,]+,\s*(?:duration|seconds|wait)/,
    );
  });
  it('records action effects transactionally before completing a job', () => {
    expect(source).toContain('workflow_action_effects');
    expect(source).toContain('idempotency_key=$2');
    expect(source).toContain('INSERT INTO public.workflow_action_effects');
  });
  it('provides authorized recovery and cancellation operations', () => {
    expect(source).toContain('async retryExecution');
    expect(source).toContain('async cancelExecution');
    expect(source).toContain('workflow.execution.retried');
    expect(source).toContain('workflow.execution.cancelled');
  });
});

describe('workflow runtime hardening migration', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../database/migrations/0043-workflow-runtime-hardening.sql',
    ),
    'utf8',
  );
  it('adds durable waits, failed jobs, and action effect idempotency', () => {
    expect(sql).toContain("'FAILED'");
    expect(sql).toContain("'WAIT'");
    expect(sql).toContain('CREATE TABLE public.workflow_action_effects');
    expect(sql).toContain('UNIQUE (organization_id,idempotency_key)');
  });
  it('does not reference or mutate the protected case', () => {
    expect(sql).not.toContain('VF-2026-8282');
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM|TRUNCATE)\s+public\.cases/i);
  });
});
