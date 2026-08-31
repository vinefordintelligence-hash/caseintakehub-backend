import { WorkflowEngineService } from './workflow-engine.service';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const node = (
  n: number,
  node_type: string,
  subtype: string,
  configuration: Record<string, unknown> = {},
) => ({
  id: id(n),
  node_type,
  subtype,
  label: `Node ${n}`,
  configuration,
  position_x: 0,
  position_y: n * 100,
});

describe('authoritative workflow graph validation', () => {
  const service = new WorkflowEngineService({} as never, {} as never);
  it('accepts a complete true/false graph and a bounded durable wait', () => {
    const nodes = [
      node(1, 'TRIGGER', 'MANUAL_TRIGGER'),
      node(2, 'CONDITION', 'IF_ELSE', {
        field: 'approved',
        operator: 'equals',
        value: true,
      }),
      node(3, 'WAIT', 'DELAY', { duration: 24, unit: 'hours' }),
      node(4, 'END', 'END'),
      node(5, 'END', 'END'),
    ];
    const edges = [
      {
        id: id(11),
        source_node_id: id(1),
        target_node_id: id(2),
        configuration: {},
      },
      {
        id: id(12),
        source_node_id: id(2),
        target_node_id: id(3),
        source_handle: 'true',
        configuration: {},
      },
      {
        id: id(13),
        source_node_id: id(2),
        target_node_id: id(5),
        source_handle: 'false',
        configuration: {},
      },
      {
        id: id(14),
        source_node_id: id(3),
        target_node_id: id(4),
        configuration: {},
      },
    ];
    expect(service.validateGraph({ nodes, edges }).valid).toBe(true);
  });
  it('rejects incomplete condition branches', () => {
    const nodes = [
      node(1, 'TRIGGER', 'MANUAL_TRIGGER'),
      node(2, 'CONDITION', 'IF_ELSE', {
        field: 'approved',
        operator: 'equals',
        value: true,
      }),
      node(3, 'END', 'END'),
    ];
    const result = service.validateGraph({
      nodes,
      edges: [
        {
          id: id(11),
          source_node_id: id(1),
          target_node_id: id(2),
          configuration: {},
        },
        {
          id: id(12),
          source_node_id: id(2),
          target_node_id: id(3),
          source_handle: 'true',
          configuration: {},
        },
      ],
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CONDITION_BRANCHES' }),
      ]),
    );
  });
  it('rejects secret-bearing configuration and unbounded waits', () => {
    expect(() =>
      service.validateGraph({
        nodes: [node(1, 'TRIGGER', 'MANUAL_TRIGGER', { apiToken: 'nope' })],
        edges: [],
      }),
    ).toThrow(/may not contain secrets/);
    const result = service.validateGraph({
      nodes: [
        node(1, 'TRIGGER', 'MANUAL_TRIGGER'),
        node(2, 'WAIT', 'DELAY', { duration: 999, unit: 'days' }),
        node(3, 'END', 'END'),
      ],
      edges: [
        {
          id: id(11),
          source_node_id: id(1),
          target_node_id: id(2),
          configuration: {},
        },
        {
          id: id(12),
          source_node_id: id(2),
          target_node_id: id(3),
          configuration: {},
        },
      ],
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'duration' })]),
    );
  });
});

describe('PostgreSQL mutation result normalization', () => {
  it('returns the claimed row from TypeORM update-returning tuples', async () => {
    const job = {
      id: id(90),
      workflow_execution_id: id(91),
      workflow_id: id(92),
      node_id: id(93),
      case_id: null,
      organization_id: id(94),
      trigger_event_id: null,
      attempts: 1,
      max_attempts: 5,
      payload: {},
    };
    const db = {
      transaction: (
        fn: (manager: { query: () => Promise<unknown> }) => unknown,
      ) => fn({ query: () => Promise.resolve([[job], 1]) }),
    };
    const service = new WorkflowEngineService(db as never, {} as never);
    await expect(service.claim('worker')).resolves.toEqual(job);
  });
});
