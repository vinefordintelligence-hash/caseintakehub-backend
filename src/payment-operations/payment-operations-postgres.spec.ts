import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PaymentOperationsService } from './payment-operations.service';

const socket = process.env.PAYMENT_OPERATIONS_TEST_SOCKET;
(socket ? describe : describe.skip)(
  'Payment Operations disposable PostgreSQL acceptance',
  () => {
    let db: DataSource;
    let service: PaymentOperationsService;
    let organizationId: string;
    let foreignOrganizationId: string;
    let caseId: string;
    let invoiceId: string;
    const identity = () => ({
      actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      organizationId,
      role: 'admin',
      supabaseUserId: 'synthetic-admin',
    });

    beforeAll(async () => {
      if (!socket?.startsWith('/tmp/vineford-payment-operations.'))
        throw new Error('Disposable socket required');
      db = new DataSource({
        type: 'postgres',
        host: socket,
        username: 'postgres',
        database: 'postgres',
        entities: [],
        synchronize: false,
      });
      await db.initialize();
      await db.query(
        `CREATE ROLE vineford_app NOLOGIN; CREATE ROLE vineford_workflow_worker NOLOGIN`,
      );
      await db.query(`
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE clients(id uuid PRIMARY KEY);
      CREATE TABLE app_users(id uuid PRIMARY KEY);
      CREATE TABLE cases(id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),client_id uuid REFERENCES clients(id));
      CREATE TABLE invoices(id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),case_id uuid NOT NULL REFERENCES cases(id));
      CREATE TABLE payments(id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),invoice_id uuid REFERENCES invoices(id),amount numeric(20,2) NOT NULL,verification_status text NOT NULL,reference_number text);
      CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,user_id uuid,action text,resource_type text,resource_id uuid,case_id uuid,changes jsonb);
    `);
      await db.query(
        readFileSync(
          join(__dirname, '../database/migrations/0062-payment-operations.sql'),
          'utf8',
        ),
      );
      await db.query(
        readFileSync(
          join(
            __dirname,
            '../database/migrations/0063-payment-operation-installments.sql',
          ),
          'utf8',
        ),
      );
      const workflow = { publish: jest.fn().mockResolvedValue(true) };
      const feeConfig = {} as never;
      service = new PaymentOperationsService(db, workflow as never, feeConfig);
    });

    beforeEach(async () => {
      organizationId = randomUUID();
      foreignOrganizationId = randomUUID();
      caseId = randomUUID();
      invoiceId = randomUUID();
      await db.query('TRUNCATE organizations,app_users CASCADE');
      await db.query('INSERT INTO organizations(id) VALUES($1),($2)', [
        organizationId,
        foreignOrganizationId,
      ]);
      await db.query('INSERT INTO clients(id) VALUES($1)', [randomUUID()]);
      await db.query('INSERT INTO app_users(id) VALUES($1)', [
        identity().actorId,
      ]);
      await db.query('INSERT INTO cases(id,organization_id) VALUES($1,$2)', [
        caseId,
        organizationId,
      ]);
      await db.query(
        'INSERT INTO invoices(id,organization_id,case_id) VALUES($1,$2,$3)',
        [invoiceId, organizationId, caseId],
      );
    });

    afterAll(async () => {
      await db?.destroy();
    });

    async function create(overrides: Record<string, unknown> = {}) {
      return service.createRequirement(
        {
          caseId,
          invoiceId,
          amount: '100.00',
          currency: 'USD',
          description: 'Synthetic authorized payment requirement',
          businessPurpose: 'CASE_SERVICE',
          originatingModule: 'CASE',
          idempotencyKey: 'synthetic-operation-1',
          ...overrides,
        },
        identity(),
      );
    }

    it('persists an admin-created requirement and replays identical idempotency', async () => {
      const first = await create();
      const second = await create();
      expect(first.id).toBe(second.id);
      expect(first.state).toBe('DRAFT');
      expect(
        await db.query('SELECT count(*)::int AS count FROM payment_operations'),
      ).toEqual([{ count: 1 }]);
    });

    it('rejects conflicting idempotency and foreign-tenant access', async () => {
      await create();
      await expect(
        service.createRequirement(
          {
            caseId,
            invoiceId,
            amount: '101.00',
            currency: 'USD',
            description: 'Conflict',
            businessPurpose: 'CASE_SERVICE',
            originatingModule: 'CASE',
            idempotencyKey: 'synthetic-operation-1',
          },
          identity(),
        ),
      ).rejects.toThrow('idempotency conflict');
      await expect(
        service.listForCase(caseId, {
          ...identity(),
          organizationId: foreignOrganizationId,
        }),
      ).resolves.toEqual([]);
    });

    it('enforces lifecycle, authoritative verification, partial payment, and completion', async () => {
      const operation = await create();
      await service.authorize(
        String(operation.id),
        identity(),
        'Synthetic admin basis',
      );
      await service.issue(String(operation.id), identity());
      const paymentId = randomUUID();
      await db.query(
        `INSERT INTO payments(id,organization_id,invoice_id,amount,verification_status,reference_number)
       VALUES($1,$2,$3,40,'pending','synthetic-pending')`,
        [paymentId, organizationId, invoiceId],
      );
      await expect(
        service.recordAuthoritativePayment(
          String(operation.id),
          paymentId,
          identity(),
        ),
      ).rejects.toThrow('authoritative verified payment required');
      await db.query(
        `UPDATE payments SET verification_status='verified' WHERE id=$1`,
        [paymentId],
      );
      const partial = await service.recordAuthoritativePayment(
        String(operation.id),
        paymentId,
        identity(),
      );
      expect(partial.state).toBe('PARTIALLY_PAID');
      const replay = await service.recordAuthoritativePayment(
        String(operation.id),
        paymentId,
        identity(),
      );
      expect(replay.state).toBe('PARTIALLY_PAID');
      const finalPaymentId = randomUUID();
      await db.query(
        `INSERT INTO payments(id,organization_id,invoice_id,amount,verification_status,reference_number)
       VALUES($1,$2,$3,60,'verified','synthetic-final')`,
        [finalPaymentId, organizationId, invoiceId],
      );
      const verified = await service.recordAuthoritativePayment(
        String(operation.id),
        finalPaymentId,
        identity(),
      );
      expect(verified.state).toBe('VERIFIED');
      expect(verified.amount_paid).toBe('100.00');
      const finalReplay = await service.recordAuthoritativePayment(
        String(operation.id),
        finalPaymentId,
        identity(),
      );
      expect(finalReplay.state).toBe('VERIFIED');
    });

    it('keeps payment operations tenant-scoped under authenticated RLS', async () => {
      const operation = await create();
      await db.query('SET ROLE vineford_app');
      try {
        await db.query('SELECT set_config($1,$2,false)', [
          'app.organization_id',
          organizationId,
        ]);
        expect(
          await db.query('SELECT id FROM payment_operations WHERE id=$1', [
            operation.id,
          ]),
        ).toHaveLength(1);
        await db.query('SELECT set_config($1,$2,false)', [
          'app.organization_id',
          foreignOrganizationId,
        ]);
        expect(
          await db.query('SELECT id FROM payment_operations WHERE id=$1', [
            operation.id,
          ]),
        ).toEqual([]);
      } finally {
        await db.query('RESET ROLE');
      }
    });

    it('allocates verified payments deterministically across an installment plan', async () => {
      const operation = await create({
        installments: [
          { amount: '40.00', dueAt: '2030-01-01T00:00:00.000Z' },
          { amount: '60.00', dueAt: '2030-02-01T00:00:00.000Z' },
        ],
      });
      await service.authorize(
        String(operation.id),
        identity(),
        'plan approved',
      );
      await service.issue(String(operation.id), identity());
      const firstPayment = randomUUID();
      const secondPayment = randomUUID();
      await db.query(
        `INSERT INTO payments(id,organization_id,invoice_id,amount,verification_status)
         VALUES($1,$2,$3,25,'verified'),($4,$2,$3,75,'verified')`,
        [firstPayment, organizationId, invoiceId, secondPayment],
      );
      await service.recordAuthoritativePayment(
        String(operation.id),
        firstPayment,
        identity(),
      );
      await service.recordAuthoritativePayment(
        String(operation.id),
        secondPayment,
        identity(),
      );
      expect(
        await db.query(
          `SELECT sequence,status,amount_paid::text AS amount_paid
           FROM payment_operation_installments
           WHERE operation_id=$1 ORDER BY sequence`,
          [operation.id],
        ),
      ).toEqual([
        { sequence: 1, status: 'SATISFIED', amount_paid: '40.00' },
        { sequence: 2, status: 'SATISFIED', amount_paid: '60.00' },
      ]);
      expect(
        await db.query(
          `SELECT count(*)::int AS count FROM payment_operation_installment_allocations
           WHERE operation_id=$1`,
          [operation.id],
        ),
      ).toEqual([{ count: 3 }]);
    });

    it('expires due requirements safely and represents dispute/refund states', async () => {
      const operation = await create({ dueAt: '2000-01-01T00:00:00.000Z' });
      await service.authorize(String(operation.id), identity(), 'approved');
      await service.issue(String(operation.id), identity());
      expect(await service.processExpirations()).toBe(1);
      const expired = (await service.getRequirement(
        String(operation.id),
        identity(),
      )) as { state: string };
      expect(expired.state).toBe('EXPIRED');
      expect(await service.processExpirations()).toBe(0);

      const refundable = await create({ idempotencyKey: 'refund-operation' });
      await service.authorize(String(refundable.id), identity(), 'approved');
      await service.issue(String(refundable.id), identity());
      const paymentId = randomUUID();
      await db.query(
        `INSERT INTO payments(id,organization_id,invoice_id,amount,verification_status)
         VALUES($1,$2,$3,100,'verified')`,
        [paymentId, organizationId, invoiceId],
      );
      await service.recordAuthoritativePayment(
        String(refundable.id),
        paymentId,
        identity(),
      );
      await service.markDisputed(
        String(refundable.id),
        identity(),
        'synthetic dispute',
      );
      await service.resolveDispute(
        String(refundable.id),
        identity(),
        'synthetic resolution',
      );
      await service.recordRefundState(
        String(refundable.id),
        identity(),
        'PARTIALLY_REFUNDED',
        'synthetic partial refund record',
        '25.00',
      );
      const refunded = (await service.getRequirement(
        String(refundable.id),
        identity(),
      )) as { state: string };
      expect(refunded.state).toBe('PARTIALLY_REFUNDED');
    });
  },
);
