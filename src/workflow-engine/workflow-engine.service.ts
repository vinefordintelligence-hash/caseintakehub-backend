/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unnecessary-type-assertion */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { ActorService, AdminActor } from '../common/actor.service';

type Row = Record<string, unknown>;
type Node = {
  id: string;
  node_type: string;
  subtype: string;
  label: string;
  configuration: Row;
  position_x: number;
  position_y: number;
};
type Edge = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle?: string | null;
  target_handle?: string | null;
  configuration: Row;
};
type Graph = { nodes: Node[]; edges: Edge[] };
export type DomainEvent = {
  eventType: string;
  eventId: string;
  organizationId: string;
  caseId?: string;
  actorId?: string;
  actorType: 'admin' | 'investigator' | 'client' | 'system';
  entityType: string;
  entityId: string;
  occurredAt: Date;
  metadata?: Row;
  correlationId?: string;
  causationId?: string;
  depth?: number;
};
type Job = {
  id: string;
  workflow_execution_id: string;
  workflow_id: string;
  node_id: string;
  case_id: string | null;
  organization_id: string;
  trigger_event_id: string | null;
  attempts: number;
  max_attempts: number;
  payload: Row;
};
const TRIGGERS = new Set([
  'PAYMENT_RECEIVED',
  'PAYMENT_VERIFIED',
  'CASE_CREATED',
  'CLIENT_REGISTERED',
  'EVIDENCE_UPLOADED',
  'DOCUMENT_PUBLISHED',
  'INVESTIGATOR_ASSIGNED',
  'TIMELINE_UPDATED',
  'INVOICE_PAID',
  'REPORT_GENERATED',
  'CASE_CLOSED',
  'MANUAL_TRIGGER',
  'SCHEDULED_TRIGGER',
]);
const CONDITIONS = new Set([
  'IF_ELSE',
  'STATUS_EQUALS',
  'PAYMENT_METHOD',
  'AMOUNT',
  'CASE_TYPE',
  'ORGANIZATION',
  'CLIENT_TYPE',
  'INVESTIGATION_PHASE',
  'EVIDENCE_EXISTS',
  'DOCUMENT_EXISTS',
  'CUSTOM_RULE',
]);
const ACTIONS = new Set(['GENERATE_TIMELINE_EVENT']);
const WAITS = new Set(['DELAY']);
const MAX_NODES = 100;
const MAX_EDGES = 200;
const SECRET_KEY =
  /(secret|password|token|api[_-]?key|private[_-]?key|credential|pin)/i;

@Injectable()
export class WorkflowEngineService {
  private readonly log = new Logger(WorkflowEngineService.name);
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly actors: ActorService,
  ) {}
  private admin(id?: string) {
    return this.actors.requireAdmin(id);
  }
  private text(v: unknown, n: string, max = 4000) {
    if (typeof v !== 'string' || !v.trim() || v.length > max)
      throw new BadRequestException(`${n} is invalid`);
    return v.trim();
  }
  private integer(v: unknown, n: string) {
    const x = Number(v);
    if (!Number.isInteger(x) || x < 1)
      throw new BadRequestException(`${n} is invalid`);
    return x;
  }
  private mutationRows<T extends Row>(value: unknown): T[] {
    if (!Array.isArray(value)) return [];
    return (Array.isArray(value[0]) ? value[0] : value) as T[];
  }
  private noSecrets(v: unknown, path = 'configuration'): void {
    if (Array.isArray(v)) {
      v.forEach((x, i) => this.noSecrets(x, `${path}.${i}`));
      return;
    }
    if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (SECRET_KEY.test(k))
          throw new BadRequestException(`${path}.${k} may not contain secrets`);
        this.noSecrets(x, `${path}.${k}`);
      }
  }
  private async scoped(
    m: EntityManager,
    id: string,
    a: AdminActor,
    lock = false,
  ) {
    const r = await m.query(
      `SELECT * FROM public.workflow_definitions WHERE id=$1 AND organization_id=$2 ${lock ? 'FOR UPDATE' : ''}`,
      [id, a.organization_id],
    );
    if (!r[0]) throw new NotFoundException('workflow not found');
    return r[0] as Row;
  }
  private async graph(m: EntityManager, id: string): Promise<Graph> {
    const [nodes, edges] = await Promise.all([
      m.query(
        `SELECT id,node_type,subtype,label,configuration,position_x,position_y,created_at,updated_at FROM public.workflow_nodes WHERE workflow_id=$1 ORDER BY created_at,id`,
        [id],
      ),
      m.query(
        `SELECT id,source_node_id,target_node_id,source_handle,target_handle,configuration,created_at FROM public.workflow_edges WHERE workflow_id=$1 ORDER BY created_at,id`,
        [id],
      ),
    ]);
    return { nodes, edges };
  }
  private snapshot(w: Row, g: Graph) {
    return {
      id: w.id,
      name: w.name,
      description: w.description,
      version: w.version,
      trigger_type: w.trigger_type,
      nodes: g.nodes,
      edges: g.edges,
    };
  }
  private async audit(
    m: EntityManager,
    a: AdminActor,
    w: string,
    action: string,
    type = 'workflow',
    entity?: string,
    changes: Row = {},
  ) {
    await m.query(
      `INSERT INTO public.workflow_audits(workflow_id,organization_id,actor_id,action,entity_type,entity_id,changes) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        w,
        a.organization_id,
        a.id,
        action,
        type,
        entity ?? w,
        JSON.stringify(changes),
      ],
    );
  }
  private revision(b: Row) {
    return this.integer(b.expectedRevision, 'expectedRevision');
  }
  private async draft(
    m: EntityManager,
    id: string,
    a: AdminActor,
    expected: number,
  ) {
    const w = await this.scoped(m, id, a, true);
    if (w.status === 'ARCHIVED')
      throw new ConflictException('archived workflow is immutable');
    if (Number(w.revision) !== expected)
      throw new ConflictException('workflow revision conflict');
    return w;
  }
  async list(actor?: string) {
    const a = await this.admin(actor);
    return this.db.query(
      `SELECT id,name,description,status,version,revision,trigger_type,created_at,updated_at,published_at FROM public.workflow_definitions WHERE organization_id=$1 ORDER BY updated_at DESC`,
      [a.organization_id],
    );
  }
  async get(id: string, actor?: string) {
    const a = await this.admin(actor),
      w = await this.scoped(this.db.manager, id, a);
    return { ...w, ...(await this.graph(this.db.manager, id)) };
  }
  async create(b: Row, actor?: string) {
    const a = await this.admin(actor),
      name = this.text(b.name, 'name', 160),
      description =
        typeof b.description === 'string' ? b.description.slice(0, 4000) : '';
    return this.db.transaction(async (m) => {
      const r = await m.query(
        `INSERT INTO public.workflow_definitions(organization_id,name,description,created_by,updated_by) VALUES($1,$2,$3,$4,$4) RETURNING *`,
        [a.organization_id, name, description, a.id],
      );
      await this.audit(m, a, String(r[0].id), 'workflow.created');
      return { ...r[0], nodes: [], edges: [] };
    });
  }
  async update(id: string, b: Row, actor?: string) {
    const a = await this.admin(actor);
    this.noSecrets(b);
    return this.db.transaction(async (m) => {
      const w = await this.draft(m, id, a, this.revision(b));
      if (w.status === 'PUBLISHED')
        await m.query(
          `UPDATE public.workflow_definitions SET status='DRAFT',version=version+1 WHERE id=$1`,
          [id],
        );
      const name =
          b.name === undefined ? w.name : this.text(b.name, 'name', 160),
        description =
          b.description === undefined
            ? w.description
            : String(b.description).slice(0, 4000);
      if (b.nodes !== undefined || b.edges !== undefined) {
        if (!Array.isArray(b.nodes) || !Array.isArray(b.edges))
          throw new BadRequestException('nodes and edges must be arrays');
        const g = { nodes: b.nodes as Node[], edges: b.edges as Edge[] };
        this.validateGraph(g);
        await m.query(
          `DELETE FROM public.workflow_edges WHERE workflow_id=$1`,
          [id],
        );
        await m.query(
          `DELETE FROM public.workflow_nodes WHERE workflow_id=$1`,
          [id],
        );
        for (const n of g.nodes) await this.insertNode(m, id, a, n);
        for (const e of g.edges) await this.insertEdge(m, id, a, e);
        await this.audit(m, a, id, 'draft.saved', 'workflow', id, {
          nodeCount: g.nodes.length,
          edgeCount: g.edges.length,
        });
      }
      const r = await m.query(
        `UPDATE public.workflow_definitions SET name=$2,description=$3,updated_by=$4,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
        [id, name, description, a.id],
      );
      await this.audit(m, a, id, 'workflow.updated');
      return { ...this.mutationRows(r)[0], ...(await this.graph(m, id)) };
    });
  }
  async archive(id: string, b: Row, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      await this.draft(m, id, a, this.revision(b));
      const r = await m.query(
        `UPDATE public.workflow_definitions SET status='ARCHIVED',archived_at=now(),updated_by=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
        [id, a.id],
      );
      await this.audit(m, a, id, 'workflow.archived');
      return this.mutationRows(r)[0];
    });
  }
  async duplicate(id: string, b: Row, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      const source = await this.scoped(m, id, a),
        g = await this.graph(m, id);
      const r = await m.query(
        `INSERT INTO public.workflow_definitions(organization_id,name,description,created_by,updated_by) VALUES($1,$2,$3,$4,$4) RETURNING *`,
        [
          a.organization_id,
          typeof b.name === 'string'
            ? this.text(b.name, 'name', 160)
            : `${source.name} Copy`,
          source.description,
          a.id,
        ],
      );
      const ids = new Map<string, string>();
      for (const n of g.nodes) {
        const fresh = randomUUID();
        ids.set(String(n.id), fresh);
        await this.insertNode(m, String(r[0].id), a, { ...n, id: fresh });
      }
      for (const e of g.edges)
        await this.insertEdge(m, String(r[0].id), a, {
          ...e,
          id: randomUUID(),
          source_node_id: ids.get(String(e.source_node_id))!,
          target_node_id: ids.get(String(e.target_node_id))!,
        });
      await this.audit(
        m,
        a,
        String(r[0].id),
        'workflow.duplicated',
        'workflow',
        String(r[0].id),
        { sourceWorkflowId: id },
      );
      return { ...r[0], ...(await this.graph(m, String(r[0].id))) };
    });
  }
  async versions(id: string, actor?: string) {
    const a = await this.admin(actor);
    await this.scoped(this.db.manager, id, a);
    return this.db.query(
      `SELECT version,published_by,published_at FROM public.workflow_versions WHERE workflow_id=$1 AND organization_id=$2 ORDER BY version DESC`,
      [id, a.organization_id],
    );
  }
  async version(id: string, v: string, actor?: string) {
    const a = await this.admin(actor);
    await this.scoped(this.db.manager, id, a);
    const r = await this.db.query(
      `SELECT version,snapshot,published_by,published_at FROM public.workflow_versions WHERE workflow_id=$1 AND organization_id=$2 AND version=$3`,
      [id, a.organization_id, this.integer(v, 'version')],
    );
    if (!r[0]) throw new NotFoundException('workflow version not found');
    return r[0];
  }
  private node(b: Row): Node {
    const type = this.text(b.node_type, 'node_type', 20).toUpperCase(),
      subtype = this.text(b.subtype, 'subtype', 80).toUpperCase(),
      configuration = (b.configuration ?? {}) as Row;
    this.noSecrets(configuration);
    return {
      id: typeof b.id === 'string' ? b.id : randomUUID(),
      node_type: type,
      subtype,
      label: this.text(b.label, 'label', 200),
      configuration,
      position_x: Number(b.position_x ?? 0),
      position_y: Number(b.position_y ?? 0),
    };
  }
  private async insertNode(
    m: EntityManager,
    w: string,
    a: AdminActor,
    input: Row | Node,
  ) {
    const n = this.node(input as Row);
    await m.query(
      `INSERT INTO public.workflow_nodes(id,workflow_id,organization_id,node_type,subtype,label,configuration,position_x,position_y) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
      [
        n.id,
        w,
        a.organization_id,
        n.node_type,
        n.subtype,
        n.label,
        JSON.stringify(n.configuration),
        n.position_x,
        n.position_y,
      ],
    );
    return n;
  }
  async addNode(id: string, b: Row, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      await this.draft(m, id, a, this.revision(b));
      const n = await this.insertNode(m, id, a, b);
      await m.query(
        `UPDATE public.workflow_definitions SET revision=revision+1,updated_by=$2,updated_at=now() WHERE id=$1`,
        [id, a.id],
      );
      await this.audit(m, a, id, 'node.added', 'node', n.id);
      return n;
    });
  }
  async updateNode(id: string, nid: string, b: Row, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      await this.draft(m, id, a, this.revision(b));
      const old = (
        await m.query(
          `SELECT * FROM public.workflow_nodes WHERE id=$1 AND workflow_id=$2 AND organization_id=$3`,
          [nid, id, a.organization_id],
        )
      )[0];
      if (!old) throw new NotFoundException('node not found');
      const n = this.node({ ...old, ...b, id: nid });
      const r = await m.query(
        `UPDATE public.workflow_nodes SET node_type=$4,subtype=$5,label=$6,configuration=$7::jsonb,position_x=$8,position_y=$9,updated_at=now() WHERE id=$1 AND workflow_id=$2 AND organization_id=$3 RETURNING *`,
        [
          nid,
          id,
          a.organization_id,
          n.node_type,
          n.subtype,
          n.label,
          JSON.stringify(n.configuration),
          n.position_x,
          n.position_y,
        ],
      );
      await m.query(
        `UPDATE public.workflow_definitions SET revision=revision+1,updated_by=$2,updated_at=now() WHERE id=$1`,
        [id, a.id],
      );
      await this.audit(m, a, id, 'node.changed', 'node', nid);
      return this.mutationRows(r)[0];
    });
  }
  async deleteNode(id: string, nid: string, b: Row, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      await this.draft(m, id, a, this.revision(b));
      const r = await m.query(
        `DELETE FROM public.workflow_nodes WHERE id=$1 AND workflow_id=$2 AND organization_id=$3 RETURNING id`,
        [nid, id, a.organization_id],
      );
      if (!this.mutationRows(r)[0])
        throw new NotFoundException('node not found');
      await m.query(
        `UPDATE public.workflow_definitions SET revision=revision+1,updated_by=$2,updated_at=now() WHERE id=$1`,
        [id, a.id],
      );
      await this.audit(m, a, id, 'node.deleted', 'node', nid);
      return { deleted: true };
    });
  }
  private async insertEdge(
    m: EntityManager,
    w: string,
    a: AdminActor,
    input: Row | Edge,
  ) {
    const e = input as Row,
      id = typeof e.id === 'string' ? e.id : randomUUID(),
      source = this.text(e.source_node_id, 'source_node_id', 80),
      target = this.text(e.target_node_id, 'target_node_id', 80),
      configuration = (e.configuration ?? {}) as Row;
    this.noSecrets(configuration);
    await m.query(
      `INSERT INTO public.workflow_edges(id,workflow_id,organization_id,source_node_id,target_node_id,source_handle,target_handle,configuration) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        id,
        w,
        a.organization_id,
        source,
        target,
        e.source_handle ?? null,
        e.target_handle ?? null,
        JSON.stringify(configuration),
      ],
    );
    return {
      id,
      source_node_id: source,
      target_node_id: target,
      configuration,
    };
  }
  async addEdge(id: string, b: Row, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      await this.draft(m, id, a, this.revision(b));
      const e = await this.insertEdge(m, id, a, b);
      await m.query(
        `UPDATE public.workflow_definitions SET revision=revision+1,updated_by=$2,updated_at=now() WHERE id=$1`,
        [id, a.id],
      );
      await this.audit(m, a, id, 'connection.added', 'edge', String(e.id));
      return e;
    });
  }
  async deleteEdge(id: string, eid: string, b: Row, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      await this.draft(m, id, a, this.revision(b));
      const r = await m.query(
        `DELETE FROM public.workflow_edges WHERE id=$1 AND workflow_id=$2 AND organization_id=$3 RETURNING id`,
        [eid, id, a.organization_id],
      );
      if (!this.mutationRows(r)[0])
        throw new NotFoundException('edge not found');
      await m.query(
        `UPDATE public.workflow_definitions SET revision=revision+1,updated_by=$2,updated_at=now() WHERE id=$1`,
        [id, a.id],
      );
      await this.audit(m, a, id, 'connection.deleted', 'edge', eid);
      return { deleted: true };
    });
  }
  validateGraph(g: Graph) {
    const errors: Row[] = [],
      ids = new Set(g.nodes.map((n) => String(n.id))),
      triggers = g.nodes.filter((n) => n.node_type === 'TRIGGER');
    if (g.nodes.length > MAX_NODES)
      errors.push({
        code: 'NODE_LIMIT',
        message: `A workflow may contain at most ${MAX_NODES} nodes`,
      });
    if (g.edges.length > MAX_EDGES)
      errors.push({
        code: 'EDGE_LIMIT',
        message: `A workflow may contain at most ${MAX_EDGES} connections`,
      });
    if (triggers.length !== 1)
      errors.push({
        code: 'TRIGGER_COUNT',
        message: 'Exactly one trigger is required',
      });
    for (const n of g.nodes) {
      const allowed =
        n.node_type === 'TRIGGER'
          ? TRIGGERS
          : n.node_type === 'CONDITION'
            ? CONDITIONS
            : n.node_type === 'ACTION'
              ? ACTIONS
              : n.node_type === 'WAIT'
                ? WAITS
                : n.node_type === 'END'
                  ? new Set(['END'])
                  : new Set<string>();
      if (!allowed.has(n.subtype))
        errors.push({
          code: 'UNSUPPORTED_NODE',
          nodeId: n.id,
          message: `${n.node_type}/${n.subtype} is not available`,
        });
      if (
        n.node_type === 'ACTION' &&
        n.subtype === 'GENERATE_TIMELINE_EVENT' &&
        typeof n.configuration?.title !== 'string'
      )
        errors.push({
          code: 'REQUIRED_CONFIGURATION',
          nodeId: n.id,
          field: 'title',
          message: 'Timeline title is required',
        });
      if (n.node_type === 'CONDITION') {
        const field = String(n.configuration?.field ?? '');
        const operator = String(n.configuration?.operator ?? 'equals');
        if (!field || !['equals', 'not_equals', 'exists'].includes(operator))
          errors.push({
            code: 'REQUIRED_CONFIGURATION',
            nodeId: n.id,
            field: 'field',
            message: 'Condition field and supported operator are required',
          });
      }
      if (n.node_type === 'WAIT') {
        const duration = Number(n.configuration?.duration),
          unit = String(n.configuration?.unit ?? 'minutes');
        if (
          !Number.isInteger(duration) ||
          duration < 1 ||
          duration > 365 ||
          !['minutes', 'hours', 'days'].includes(unit)
        )
          errors.push({
            code: 'REQUIRED_CONFIGURATION',
            nodeId: n.id,
            field: 'duration',
            message: 'Wait duration must be 1–365 minutes, hours, or days',
          });
      }
      this.noSecrets(n.configuration);
    }
    for (const e of g.edges)
      if (
        !ids.has(String(e.source_node_id)) ||
        !ids.has(String(e.target_node_id))
      )
        errors.push({
          code: 'INVALID_EDGE',
          edgeId: e.id,
          message: 'Edge references an unknown node',
        });
    for (const n of g.nodes.filter((item) => item.node_type === 'CONDITION')) {
      const branches = g.edges
        .filter((e) => String(e.source_node_id) === String(n.id))
        .map((e) => e.source_handle);
      if (
        branches.filter((x) => x === 'true').length !== 1 ||
        branches.filter((x) => x === 'false').length !== 1 ||
        branches.some((x) => x !== 'true' && x !== 'false')
      )
        errors.push({
          code: 'CONDITION_BRANCHES',
          nodeId: n.id,
          message:
            'Condition nodes require exactly one true and one false connection',
        });
    }
    if (triggers[0]) {
      const seen = new Set<string>(),
        stack = [String(triggers[0].id)];
      while (stack.length) {
        const x = stack.pop()!;
        if (seen.has(x)) continue;
        seen.add(x);
        for (const e of g.edges.filter((q) => String(q.source_node_id) === x))
          stack.push(String(e.target_node_id));
      }
      for (const n of g.nodes)
        if (!seen.has(String(n.id)))
          errors.push({
            code: 'UNREACHABLE_NODE',
            nodeId: n.id,
            message: 'Node is unreachable from the trigger',
          });
      const visit = (x: string, path: Set<string>) => {
        if (path.has(x)) {
          errors.push({
            code: 'CYCLE',
            nodeId: x,
            message: 'Cycles are not supported',
          });
          return;
        }
        const next = new Set(path).add(x);
        for (const e of g.edges.filter((q) => String(q.source_node_id) === x))
          visit(String(e.target_node_id), next);
      };
      visit(String(triggers[0].id), new Set());
    }
    return {
      valid: errors.length === 0,
      errors,
      supportedActions: [...ACTIONS],
    };
  }
  async validateStored(id: string, actor?: string) {
    const a = await this.admin(actor);
    await this.scoped(this.db.manager, id, a);
    return this.validateGraph(await this.graph(this.db.manager, id));
  }
  async publishWorkflow(id: string, b: Row, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      const w = await this.draft(m, id, a, this.revision(b)),
        g = await this.graph(m, id),
        validation = this.validateGraph(g);
      if (!validation.valid)
        throw new BadRequestException({
          message: 'workflow validation failed',
          ...validation,
        });
      const trigger = g.nodes.find((n) => n.node_type === 'TRIGGER')!;
      await m.query(
        `INSERT INTO public.workflow_versions(workflow_id,organization_id,version,snapshot,published_by) VALUES($1,$2,$3,$4::jsonb,$5)`,
        [
          id,
          a.organization_id,
          w.version,
          JSON.stringify(this.snapshot(w, g)),
          a.id,
        ],
      );
      const r = await m.query(
        `UPDATE public.workflow_definitions SET status='PUBLISHED',trigger_type=$2,published_at=now(),published_by=$3,updated_by=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
        [id, trigger.subtype, a.id],
      );
      await this.audit(m, a, id, 'workflow.published', 'workflow', id, {
        version: w.version,
      });
      return { ...this.mutationRows(r)[0], validation };
    });
  }
  async audits(id: string, actor?: string) {
    const a = await this.admin(actor);
    await this.scoped(this.db.manager, id, a);
    return this.db.query(
      `SELECT id,actor_id,action,entity_type,entity_id,changes,created_at FROM public.workflow_audits WHERE workflow_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      [id, a.organization_id],
    );
  }
  async executions(id: string, actor?: string) {
    const a = await this.admin(actor);
    await this.scoped(this.db.manager, id, a);
    return this.db.query(
      `SELECT id,workflow_version,trigger_type,trigger_reference,status,started_at,completed_at,failed_node_id,error_metadata,created_at FROM public.workflow_executions WHERE workflow_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      [id, a.organization_id],
    );
  }
  async execution(id: string, actor?: string) {
    const a = await this.admin(actor),
      r = await this.db.query(
        `SELECT * FROM public.workflow_executions WHERE id=$1 AND organization_id=$2`,
        [id, a.organization_id],
      );
    if (!r[0]) throw new NotFoundException('workflow execution not found');
    return {
      ...r[0],
      steps: await this.db.query(
        `SELECT * FROM public.workflow_execution_steps WHERE execution_id=$1 AND organization_id=$2 ORDER BY created_at`,
        [id, a.organization_id],
      ),
    };
  }
  async cancelExecution(id: string, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      const execution = (
        await m.query(
          `SELECT * FROM public.workflow_executions WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
          [id, a.organization_id],
        )
      )[0];
      if (!execution)
        throw new NotFoundException('workflow execution not found');
      if (
        ['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(execution.status))
      )
        throw new ConflictException('execution is already terminal');
      await m.query(
        `UPDATE public.workflow_jobs SET status='CANCELLED',locked_at=NULL,locked_by=NULL,completed_at=now(),updated_at=now() WHERE workflow_execution_id=$1 AND organization_id=$2 AND status IN ('PENDING','WAITING','RUNNING')`,
        [id, a.organization_id],
      );
      const updated = this.mutationRows(
        await m.query(
          `UPDATE public.workflow_executions SET status='CANCELLED',completed_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,
          [id, a.organization_id],
        ),
      )[0];
      await this.audit(
        m,
        a,
        String(execution.workflow_id),
        'workflow.execution.cancelled',
        'execution',
        id,
      );
      return updated;
    });
  }
  async retryExecution(id: string, actor?: string) {
    const a = await this.admin(actor);
    return this.db.transaction(async (m) => {
      const execution = (
        await m.query(
          `SELECT * FROM public.workflow_executions WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
          [id, a.organization_id],
        )
      )[0];
      if (!execution)
        throw new NotFoundException('workflow execution not found');
      if (execution.status !== 'FAILED' || !execution.failed_node_id)
        throw new ConflictException('only failed executions can be retried');
      const job = this.mutationRows(
        await m.query(
          `UPDATE public.workflow_jobs SET status='PENDING',attempts=0,last_error=NULL,run_at=now(),locked_at=NULL,locked_by=NULL,completed_at=NULL,updated_at=now() WHERE workflow_execution_id=$1 AND organization_id=$2 AND node_id=$3 AND status IN ('DEAD_LETTER','FAILED') RETURNING *`,
          [id, a.organization_id, execution.failed_node_id],
        ),
      )[0];
      if (!job)
        throw new ConflictException('failed node has no recoverable job');
      await m.query(
        `UPDATE public.workflow_executions SET status='PENDING',failed_node_id=NULL,error_metadata=NULL,completed_at=NULL,updated_at=now() WHERE id=$1`,
        [id],
      );
      await this.audit(
        m,
        a,
        String(execution.workflow_id),
        'workflow.execution.retried',
        'execution',
        id,
        { nodeId: execution.failed_node_id },
      );
      return { retried: true, jobId: job.id };
    });
  }
  async manualExecute(id: string, b: Row, actor?: string) {
    const a = await this.admin(actor),
      reference = this.text(b.triggerReference, 'triggerReference', 200),
      caseId =
        b.caseId === undefined ? undefined : this.text(b.caseId, 'caseId', 80);
    if (
      caseId &&
      !(
        await this.db.query(
          `SELECT id FROM public.cases WHERE id=$1 AND organization_id=$2`,
          [caseId, a.organization_id],
        )
      )[0]
    )
      throw new NotFoundException('case not found');
    const accepted = await this.publish({
      eventType: 'MANUAL_TRIGGER',
      eventId: randomUUID(),
      organizationId: a.organization_id,
      caseId,
      actorId: a.id,
      actorType: 'admin',
      entityType: 'workflow',
      entityId: id,
      occurredAt: new Date(),
      metadata: { workflowId: id, triggerReference: reference },
    });
    return { accepted, triggerReference: reference };
  }
  async publish(event: DomainEvent, mgr?: EntityManager) {
    if ((event.depth ?? 0) > 16)
      throw new BadRequestException('workflow event depth exceeded');
    const m = mgr ?? this.db.manager,
      inserted = await m.query(
        `INSERT INTO public.workflow_domain_events(id,organization_id,case_id,event_type,actor_id,actor_type,entity_type,entity_id,occurred_at,metadata,correlation_id,causation_id,depth) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) ON CONFLICT(organization_id,id) DO NOTHING RETURNING id`,
        [
          event.eventId,
          event.organizationId,
          event.caseId ?? null,
          event.eventType,
          event.actorId ?? null,
          event.actorType,
          event.entityType,
          event.entityId,
          event.occurredAt,
          JSON.stringify(event.metadata ?? {}),
          event.correlationId ?? event.eventId,
          event.causationId ?? null,
          event.depth ?? 0,
        ],
      );
    if (!inserted[0]) return false;
    const workflows = await m.query(
      `SELECT d.*,v.snapshot FROM public.workflow_definitions d JOIN public.workflow_versions v ON v.workflow_id=d.id AND v.version=d.version WHERE d.organization_id=$1 AND d.status='PUBLISHED' AND d.trigger_type=$2 AND ($3::uuid IS NULL OR d.id=$3)`,
      [
        event.organizationId,
        event.eventType,
        (event.metadata?.workflowId as string) ?? null,
      ],
    );
    for (const w of workflows) {
      const g = w.snapshot as Graph,
        trigger = g.nodes.find((n) => n.node_type === 'TRIGGER');
      if (!trigger) continue;
      const reference = String(
          event.metadata?.triggerReference ?? event.eventId,
        ),
        execution = randomUUID();
      const ex = await m.query(
        `INSERT INTO public.workflow_executions(id,workflow_id,workflow_version,organization_id,case_id,trigger_type,trigger_reference,trigger_event_id,definition_snapshot,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) ON CONFLICT(workflow_id,trigger_reference) DO NOTHING RETURNING id`,
        [
          execution,
          w.id,
          w.version,
          event.organizationId,
          event.caseId ?? null,
          event.eventType,
          reference,
          event.eventId,
          JSON.stringify(w.snapshot),
          event.correlationId ?? event.eventId,
        ],
      );
      if (!ex[0]) continue;
      await m.query(
        `INSERT INTO public.workflow_jobs(workflow_execution_id,workflow_id,node_id,organization_id,case_id,trigger_event_id,idempotency_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(organization_id,idempotency_key) DO NOTHING`,
        [
          execution,
          w.id,
          trigger.id,
          event.organizationId,
          event.caseId ?? null,
          event.eventId,
          `${w.id}:${reference}:${trigger.id}`,
          JSON.stringify({ event }),
        ],
      );
      await m.query(
        `INSERT INTO public.workflow_audits(workflow_id,organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,$3,'workflow.executed','execution',$4)`,
        [w.id, event.organizationId, event.actorId ?? null, execution],
      );
    }
    return true;
  }
  async claim(worker: string): Promise<Job | null> {
    return this.db.transaction(async (m) => {
      const rows = await m.query(
        `WITH candidate AS (SELECT id FROM public.workflow_jobs WHERE status IN ('PENDING','WAITING') AND run_at<=now() ORDER BY run_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE public.workflow_jobs j SET status='RUNNING',locked_at=now(),locked_by=$1,attempts=attempts+1,updated_at=now() FROM candidate WHERE j.id=candidate.id RETURNING j.*`,
        [worker],
      );
      return this.mutationRows<Job & Row>(rows)[0] ?? null;
    });
  }
  async execute(job: Job) {
    return this.db.transaction(async (m) => {
      const ex = (
          await m.query(
            `SELECT * FROM public.workflow_executions WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
            [job.workflow_execution_id, job.organization_id],
          )
        )[0],
        g = ex?.definition_snapshot as Graph | undefined,
        n = g?.nodes.find((x) => String(x.id) === job.node_id);
      if (!n) throw new Error('workflow_node_not_found');
      await m.query(
        `INSERT INTO public.workflow_execution_steps(execution_id,organization_id,node_id,node_type,subtype,status,attempt,started_at) VALUES($1,$2,$3,$4,$5,'RUNNING',$6,now()) ON CONFLICT(execution_id,node_id) DO UPDATE SET status='RUNNING',attempt=$6,started_at=coalesce(workflow_execution_steps.started_at,now())`,
        [
          job.workflow_execution_id,
          job.organization_id,
          n.id,
          n.node_type,
          n.subtype,
          job.attempts,
        ],
      );
      let result: Row = {};
      let conditionBranch: string | null = null;
      if (n.node_type === 'WAIT' && job.payload.waitNodeId !== n.id) {
        const duration = Number(n.configuration.duration),
          unit = String(n.configuration.unit),
          seconds =
            duration * (unit === 'days' ? 86400 : unit === 'hours' ? 3600 : 60);
        await m.query(
          `UPDATE public.workflow_jobs SET status='WAITING',run_at=now()+make_interval(secs=>$2),locked_at=NULL,locked_by=NULL,payload=payload||$3::jsonb,updated_at=now() WHERE id=$1`,
          [job.id, seconds, JSON.stringify({ waitNodeId: n.id })],
        );
        await m.query(
          `UPDATE public.workflow_execution_steps SET status='PENDING',result=$3::jsonb WHERE execution_id=$1 AND node_id=$2`,
          [
            job.workflow_execution_id,
            n.id,
            JSON.stringify({ waitingUntilSeconds: seconds }),
          ],
        );
        return { deferred: true, waitSeconds: seconds };
      }
      if (n.node_type === 'CONDITION') {
        const field = String(n.configuration.field);
        const operator = String(n.configuration.operator ?? 'equals');
        const metadata = (job.payload.event as Row | undefined)?.metadata;
        const value =
          metadata && typeof metadata === 'object'
            ? (metadata as Row)[field]
            : undefined;
        const expected = n.configuration.value;
        const matched =
          operator === 'exists'
            ? value !== undefined && value !== null
            : operator === 'not_equals'
              ? value !== expected
              : value === expected;
        conditionBranch = matched ? 'true' : 'false';
        result = { matched, field };
      }
      if (n.node_type === 'ACTION') {
        if (n.subtype !== 'GENERATE_TIMELINE_EVENT')
          throw new Error(`workflow_node_type_not_enabled:${n.subtype}`);
        if (!job.case_id) throw new Error('timeline_action_requires_case');
        if (
          !(
            await m.query(
              `SELECT id FROM public.cases WHERE id=$1 AND organization_id=$2`,
              [job.case_id, job.organization_id],
            )
          )[0]
        )
          throw new Error('workflow_case_scope_invalid');
        const title = String(n.configuration.title ?? '').trim();
        if (!title) throw new Error('timeline_title_required');
        const effectKey = `${job.workflow_execution_id}:${n.id}`;
        const existingEffect = (
          await m.query(
            `SELECT result FROM public.workflow_action_effects WHERE organization_id=$1 AND idempotency_key=$2`,
            [job.organization_id, effectKey],
          )
        )[0];
        if (existingEffect) result = existingEffect.result as Row;
        else {
          const row = await m.query(
            `INSERT INTO public.timeline(case_id,organization_id,title,description,event_date,status,actor_id,is_client_visible,metadata) VALUES($1,$2,$3,$4,now(),'completed',NULL,false,$5::jsonb) RETURNING id`,
            [
              job.case_id,
              job.organization_id,
              title,
              String(n.configuration.description ?? ''),
              JSON.stringify({
                workflow_execution_id: job.workflow_execution_id,
                workflow_node_id: n.id,
              }),
            ],
          );
          result = { timelineEventId: row[0].id };
          await m.query(
            `INSERT INTO public.workflow_action_effects(organization_id,execution_id,node_id,idempotency_key,result) VALUES($1,$2,$3,$4,$5::jsonb)`,
            [
              job.organization_id,
              job.workflow_execution_id,
              n.id,
              effectKey,
              JSON.stringify(result),
            ],
          );
        }
      }
      const outgoing = (g?.edges ?? []).filter(
        (e) =>
          String(e.source_node_id) === String(n.id) &&
          (conditionBranch === null || e.source_handle === conditionBranch),
      );
      for (const e of outgoing)
        await m.query(
          `INSERT INTO public.workflow_jobs(workflow_execution_id,workflow_id,node_id,organization_id,case_id,trigger_event_id,idempotency_key,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(organization_id,idempotency_key) DO NOTHING`,
          [
            job.workflow_execution_id,
            job.workflow_id,
            e.target_node_id,
            job.organization_id,
            job.case_id,
            job.trigger_event_id,
            `${job.workflow_execution_id}:${e.target_node_id}`,
            JSON.stringify(job.payload),
          ],
        );
      await m.query(
        `UPDATE public.workflow_execution_steps SET status='COMPLETED',completed_at=now(),result=$3::jsonb WHERE execution_id=$1 AND node_id=$2`,
        [job.workflow_execution_id, n.id, JSON.stringify(result)],
      );
      const remaining = await m.query(
        `SELECT 1 FROM public.workflow_jobs WHERE workflow_execution_id=$1 AND id<>$2 AND status IN ('PENDING','WAITING','RUNNING') LIMIT 1`,
        [job.workflow_execution_id, job.id],
      );
      await m.query(
        `UPDATE public.workflow_executions SET status=$2::public.workflow_execution_status,started_at=coalesce(started_at,now()),completed_at=CASE WHEN $2='COMPLETED' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1`,
        [
          job.workflow_execution_id,
          outgoing.length === 0 && !remaining[0] ? 'COMPLETED' : 'RUNNING',
        ],
      );
      return {
        ...result,
        scheduledNodes: outgoing.map((e) => e.target_node_id),
      };
    });
  }
  async complete(job: Job, outcome: Row = {}) {
    await this.db.query(
      `UPDATE public.workflow_jobs SET status='COMPLETED',completed_at=now(),locked_at=null,locked_by=null,payload=payload||$2::jsonb,updated_at=now() WHERE id=$1`,
      [job.id, JSON.stringify({ outcome })],
    );
  }
  async fail(job: Job, error: unknown) {
    const message = (
        error instanceof Error ? error.message : 'workflow_node_failed'
      ).slice(0, 2000),
      terminal = job.attempts >= job.max_attempts,
      delay = Math.min(3600, Math.pow(2, Math.max(0, job.attempts - 1)) * 15);
    await this.db.transaction(async (m) => {
      await m.query(
        `UPDATE public.workflow_jobs SET status=$2::public.workflow_job_status,last_error=$3,run_at=CASE WHEN $2='PENDING' THEN now()+make_interval(secs=>$4) ELSE run_at END,locked_at=null,locked_by=null,updated_at=now(),completed_at=CASE WHEN $2='DEAD_LETTER' THEN now() ELSE NULL END WHERE id=$1`,
        [job.id, terminal ? 'DEAD_LETTER' : 'PENDING', message, delay],
      );
      await m.query(
        `UPDATE public.workflow_execution_steps SET status='FAILED',completed_at=now(),error_metadata=$3::jsonb WHERE execution_id=$1 AND node_id=$2`,
        [
          job.workflow_execution_id,
          job.node_id,
          JSON.stringify({ message, attempt: job.attempts }),
        ],
      );
      if (terminal) {
        await m.query(
          `UPDATE public.workflow_executions SET status='FAILED',failed_node_id=$2,error_metadata=$3::jsonb,completed_at=now(),updated_at=now() WHERE id=$1`,
          [job.workflow_execution_id, job.node_id, JSON.stringify({ message })],
        );
        await m.query(
          `INSERT INTO public.workflow_audits(workflow_id,organization_id,action,entity_type,entity_id,changes) VALUES($1,$2,'workflow.execution.failed','execution',$3,$4::jsonb)`,
          [
            job.workflow_id,
            job.organization_id,
            job.workflow_execution_id,
            JSON.stringify({ nodeId: job.node_id, message }),
          ],
        );
      }
    });
    this.log.error(
      JSON.stringify({
        event: terminal ? 'workflow.node.failed' : 'workflow.retry',
        executionId: job.workflow_execution_id,
        nodeId: job.node_id,
        error: message,
      }),
    );
  }
  async recoverStale(minutes = 10) {
    const r = await this.db.query(
      `UPDATE public.workflow_jobs SET status='PENDING',locked_at=null,locked_by=null,last_error=coalesce(last_error||E'\n','')||'Recovered stale worker lock',run_at=now(),updated_at=now() WHERE status='RUNNING' AND locked_at<now()-make_interval(mins=>$1) RETURNING id`,
      [minutes],
    );
    return r.length;
  }
}
