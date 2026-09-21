import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActorService } from '../common/actor.service';
import { WorkflowEngineService } from '../workflow-engine/workflow-engine.service';
import { PaymentReconciliationService } from '../payments/payment-reconciliation.service';
import { PaymentOperationsService } from './payment-operations.service';

const socket = process.env.PAYMENT_OPERATIONS_INTEGRATION_TEST_SOCKET;
type OperationView = {
  state: string;
  amount_paid: string;
  amount_remaining: string;
};

(socket ? describe : describe.skip)(
  'Payment reconciliation to Payment Operations disposable PostgreSQL acceptance',
  () => {
    let db: DataSource;
    let reconciliation: PaymentReconciliationService;
    let operations: PaymentOperationsService;
    let organizationId: string;
    let foreignOrganizationId: string;
    let caseId: string;
    let invoiceId: string;
    let actorId: string;
    const identity = () => ({
      organizationId,
      actorId,
      role: 'admin',
      supabaseUserId: 'synthetic-admin',
    });

    beforeAll(async () => {
      if (!socket?.startsWith('/tmp/vineford-payment-operations-integration.'))
        throw new Error('Disposable integration socket required');
      db = new DataSource({
        type: 'postgres',
        host: socket,
        username: 'postgres',
        database: 'postgres',
        entities: [],
        synchronize: false,
      });
      await db.initialize();
      await db.query(`
        CREATE ROLE vineford_app NOLOGIN;
        CREATE ROLE vineford_workflow_worker NOLOGIN;
        CREATE TABLE organizations(id uuid PRIMARY KEY);
        CREATE TABLE clients(id uuid PRIMARY KEY);
        CREATE TABLE app_users(id uuid PRIMARY KEY);
        CREATE TABLE cases(
          id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
          client_id uuid REFERENCES clients(id), status text NOT NULL DEFAULT 'open'
        );
        CREATE TABLE invoices(
          id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
          case_id uuid NOT NULL REFERENCES cases(id), amount numeric(38,2) NOT NULL,
          currency text NOT NULL, status text NOT NULL
        );
        CREATE TABLE payments(
          id uuid PRIMARY KEY, invoice_id uuid REFERENCES invoices(id),
          organization_id uuid REFERENCES organizations(id), amount numeric(38,2) NOT NULL,
          verification_status text NOT NULL, reference_number text, proof_reference text
        );
        CREATE TABLE audit_logs(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
          user_id uuid, action text, resource_type text, resource_id uuid,
          case_id uuid, changes jsonb
        );
        CREATE TABLE workflow_domain_events(
          id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
          case_id uuid REFERENCES cases(id), event_type text NOT NULL, actor_id uuid,
          actor_type text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
          occurred_at timestamptz NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
          correlation_id uuid NOT NULL, causation_id uuid, depth integer NOT NULL DEFAULT 0,
          UNIQUE(organization_id,id)
        );
        CREATE TABLE workflow_event_outbox(
          event_id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
          attempts integer NOT NULL DEFAULT 0, run_at timestamptz NOT NULL DEFAULT now(),
          dispatched_at timestamptz, last_error text,
          FOREIGN KEY(organization_id,event_id)
            REFERENCES workflow_domain_events(organization_id,id)
        );
      `);
      for (const migration of [
        '0054-payment-reconciliation-engine.sql',
        '0062-payment-operations.sql',
        '0063-payment-operation-installments.sql',
      ])
        await db.query(
          readFileSync(
            join(__dirname, '../database/migrations', migration),
            'utf8',
          ),
        );
      organizationId = randomUUID();
      foreignOrganizationId = randomUUID();
      caseId = randomUUID();
      invoiceId = randomUUID();
      actorId = randomUUID();
      await db.query('INSERT INTO organizations VALUES($1),($2)', [
        organizationId,
        foreignOrganizationId,
      ]);
      await db.query('INSERT INTO clients VALUES($1)', [randomUUID()]);
      await db.query('INSERT INTO app_users VALUES($1)', [actorId]);
      await db.query('INSERT INTO cases(id,organization_id) VALUES($1,$2)', [
        caseId,
        organizationId,
      ]);
      await db.query(
        `INSERT INTO invoices(id,organization_id,case_id,amount,currency,status)
         VALUES($1,$2,$3,100,'USD','sent')`,
        [invoiceId, organizationId, caseId],
      );
      const workflow = { publish: jest.fn().mockResolvedValue(true) };
      const feeConfig = {} as never;
      operations = new PaymentOperationsService(db, workflow as never, feeConfig);
      reconciliation = new PaymentReconciliationService(
        db,
        new WorkflowEngineService(db, new ActorService(db)),
        operations,
      );
    });

    beforeEach(async () => {
      await db.query(
        `TRUNCATE payments,payment_operation_installment_allocations,
         payment_operation_installments,payment_operation_installment_plans,
         payment_operation_payments,payment_operations,invoices,cases,
         audit_logs,workflow_event_outbox,workflow_domain_events,
         invoice_reconciliation_snapshots`,
      );
      await db.query('INSERT INTO cases(id,organization_id) VALUES($1,$2)', [
        caseId,
        organizationId,
      ]);
      await db.query(
        `INSERT INTO invoices(id,organization_id,case_id,amount,currency,status)
         VALUES($1,$2,$3,100,'USD','sent')`,
        [invoiceId, organizationId, caseId],
      );
    });

    afterAll(() => db.destroy());

    async function createOperation() {
      const row = await operations.createRequirement(
        {
          caseId,
          invoiceId,
          amount: '100.00',
          currency: 'USD',
          description: 'Synthetic reconciliation operation',
          businessPurpose: 'CASE_SERVICE',
          originatingModule: 'CASE',
          idempotencyKey: randomUUID(),
          installments: [
            { amount: '40.00', dueAt: '2030-01-01T00:00:00Z' },
            { amount: '60.00', dueAt: '2030-02-01T00:00:00Z' },
          ],
        },
        identity(),
      );
      await operations.authorize(
        String(row.id),
        identity(),
        'synthetic approval',
      );
      await operations.issue(String(row.id), identity());
      return String(row.id);
    }

    async function addPayment(amount: string) {
      const id = randomUUID();
      await db.query(
        `INSERT INTO payments
         (id,invoice_id,organization_id,amount,verification_status,reference_number,proof_reference)
         VALUES($1,$2,$3,$4,'verified',$5,$5)`,
        [id, invoiceId, organizationId, amount, randomUUID()],
      );
      return id;
    }

    it('atomically reconciles 40 then 60 and is replay safe', async () => {
      const operationId = await createOperation();
      await addPayment('40.00');
      expect(
        (await reconciliation.reconcileInvoice(invoiceId, identity())).status,
      ).toBe('PARTIALLY_PAID');
      let operation = (await operations.getRequirement(
        operationId,
        identity(),
      )) as OperationView;
      expect(operation.state).toBe('PARTIALLY_PAID');
      expect(operation.amount_remaining).toBe('60.00');

      await addPayment('60.00');
      expect(
        (await reconciliation.reconcileInvoice(invoiceId, identity())).status,
      ).toBe('PAID');
      operation = (await operations.getRequirement(
        operationId,
        identity(),
      )) as OperationView;
      expect(operation.state).toBe('VERIFIED');
      expect(operation.amount_paid).toBe('100.00');
      expect(operation.amount_remaining).toBe('0.00');
      expect(
        await db.query(
          `SELECT sequence,status,amount_paid::text AS amount_paid
           FROM payment_operation_installments
           WHERE operation_id=$1 ORDER BY sequence`,
          [operationId],
        ),
      ).toEqual([
        { sequence: 1, status: 'SATISFIED', amount_paid: '40.00' },
        { sequence: 2, status: 'SATISFIED', amount_paid: '60.00' },
      ]);
      await reconciliation.reconcileInvoice(invoiceId, identity());
      operation = (await operations.getRequirement(
        operationId,
        identity(),
      )) as OperationView;
      expect(operation.amount_paid).toBe('100.00');
      expect(
        await db.query(
          `SELECT count(*)::int AS count FROM payment_operation_payments
           WHERE operation_id=$1`,
          [operationId],
        ),
      ).toEqual([{ count: 2 }]);
    });

    it('converges concurrent reconciliation attempts without double application', async () => {
      const operationId = await createOperation();
      await addPayment('100.00');
      const results = await Promise.all([
        reconciliation.reconcileInvoice(invoiceId, identity()),
        reconciliation.reconcileInvoice(invoiceId, identity()),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        'PAID',
        'PAID',
      ]);
      const operation = (await operations.getRequirement(
        operationId,
        identity(),
      )) as OperationView;
      expect(operation.state).toBe('VERIFIED');
      expect(operation.amount_paid).toBe('100.00');
      expect(
        await db.query(
          `SELECT count(*)::int AS count FROM payment_operation_payments
           WHERE operation_id=$1`,
          [operationId],
        ),
      ).toEqual([{ count: 1 }]);
    });

    it('fails closed for foreign-tenant reconciliation and ambiguous linkage', async () => {
      const operationId = await createOperation();
      await expect(
        reconciliation.reconcileInvoice(invoiceId, {
          ...identity(),
          organizationId: foreignOrganizationId,
        }),
      ).rejects.toThrow('invoice not found');
      const operation = (await operations.getRequirement(
        operationId,
        identity(),
      )) as OperationView;
      expect(operation.state).toBe('ISSUED');
    });
  },
);
