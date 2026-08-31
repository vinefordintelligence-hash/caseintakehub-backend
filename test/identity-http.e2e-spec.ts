import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { execFileSync } from 'node:child_process';

const ids = {
  orgA: '11111111-1111-4111-8111-111111111111',
  orgB: '22222222-2222-4222-8222-222222222222',
  actorA: '33333333-3333-4333-8333-333333333333',
  actorB: '44444444-4444-4444-8444-444444444444',
  subA: '55555555-5555-4555-8555-555555555555',
  subB: '66666666-6666-4666-8666-666666666666',
};

describe('identity HTTP integration (isolated database)', () => {
  let app: INestApplication;
  let auth: Server;
  let data: DataSource;
  const testDatabase = process.env.DB_DATABASE;
  const createAuthFixtures = () => {
    if (!testDatabase?.endsWith('_test')) {
      throw new Error(
        'identity HTTP fixtures require an isolated *_test database',
      );
    }
    const sql = `INSERT INTO auth.users (id,email,email_confirmed_at,raw_user_meta_data)
      VALUES (:'actor_a'::uuid,'admin-a@identity.test',now(),'{}'::jsonb),
             (:'actor_b'::uuid,'admin-b@identity.test',now(),'{}'::jsonb)
      ON CONFLICT (id) DO NOTHING;`;
    execFileSync(
      'sudo',
      [
        '-u',
        'postgres',
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        `actor_a=${ids.actorA}`,
        '-v',
        `actor_b=${ids.actorB}`,
        '-d',
        testDatabase,
        '-f',
        '-',
      ],
      { input: sql, stdio: 'pipe' },
    );
  };
  const deleteAuthFixtures = () => {
    if (!testDatabase?.endsWith('_test')) return;
    const sql = `DELETE FROM auth.users WHERE id IN (:'actor_a'::uuid, :'actor_b'::uuid);`;
    execFileSync(
      'sudo',
      [
        '-u',
        'postgres',
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        `actor_a=${ids.actorA}`,
        '-v',
        `actor_b=${ids.actorB}`,
        '-d',
        testDatabase,
        '-f',
        '-',
      ],
      { input: sql, stdio: 'pipe' },
    );
  };
  beforeAll(async () => {
    createAuthFixtures();
    auth = createServer((req, res) => {
      const token = req.headers.authorization;
      if (token === 'Bearer valid-a') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ id: ids.subA }));
      }
      if (token === 'Bearer valid-b') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ id: ids.subB }));
      }
      res.statusCode = 401;
      res.end('{}');
    });
    await new Promise<void>((resolve) => auth.listen(0, '127.0.0.1', resolve));
    process.env.SUPABASE_URL = `http://127.0.0.1:${(auth.address() as AddressInfo).port}`;
    process.env.SUPABASE_ANON_KEY = 'isolated-anon';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    data = app.get(DataSource);
    await data.query(
      `INSERT INTO public.organizations (id,name,slug) VALUES ($1,'Identity Test A','identity-test-a'),($2,'Identity Test B','identity-test-b')`,
      [ids.orgA, ids.orgB],
    );
    await data.query(
      `UPDATE public.app_users SET name = CASE id WHEN $1::uuid THEN 'Admin A' WHEN $3::uuid THEN 'Admin B' END, role = 'admin', organization_id = CASE id WHEN $1::uuid THEN $2::uuid WHEN $3::uuid THEN $4::uuid END, is_active = true WHERE id IN ($1::uuid,$3::uuid)`,
      [ids.actorA, ids.orgA, ids.actorB, ids.orgB],
    );
    await data.query(
      `INSERT INTO public.organization_memberships (organization_id,app_user_id,role,status) VALUES ($1,$2,'admin','active'),($3,$4,'admin','active')`,
      [ids.orgA, ids.actorA, ids.orgB, ids.actorB],
    );
    await data.query(
      `INSERT INTO public.vf_identity_links (app_user_id,organization_id,supabase_user_id,status) VALUES ($1,$2,$3,'active'),($4,$5,$6,'active')`,
      [ids.actorA, ids.orgA, ids.subA, ids.actorB, ids.orgB, ids.subB],
    );
  });
  afterAll(async () => {
    if (!data || !app) return;
    await data.query(
      `DELETE FROM public.vf_identity_links WHERE app_user_id IN ($1,$2)`,
      [ids.actorA, ids.actorB],
    );
    await data.query(
      `DELETE FROM public.organization_memberships WHERE app_user_id IN ($1,$2)`,
      [ids.actorA, ids.actorB],
    );
    await data.query(`DELETE FROM public.app_users WHERE id IN ($1,$2)`, [
      ids.actorA,
      ids.actorB,
    ]);
    await data.query(`DELETE FROM public.organizations WHERE id IN ($1,$2)`, [
      ids.orgA,
      ids.orgB,
    ]);
    deleteAuthFixtures();
    await app.close();
    await new Promise<void>((resolve) => auth.close(() => resolve()));
  });
  it('fails closed for missing/malformed identities and actor spoofing', async () => {
    await request(app.getHttpServer())
      .get('/enterprise/organizations')
      .expect(401);
    await request(app.getHttpServer())
      .get('/enterprise/organizations')
      .set('Authorization', 'Bearer malformed')
      .expect(401);
    await request(app.getHttpServer())
      .get('/enterprise/organizations')
      .set('Authorization', 'Bearer valid-a')
      .set('x-actor-id', ids.actorB)
      .expect(401);
  });
  it('allows same-organization access and rejects cross-tenant IDOR without writes', async () => {
    await request(app.getHttpServer())
      .get('/enterprise/organizations')
      .set('Authorization', 'Bearer valid-a')
      .set('x-actor-id', ids.actorA)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/enterprise/organizations/${ids.orgB}/members`)
      .set('Authorization', 'Bearer valid-a')
      .set('x-actor-id', ids.actorA)
      .expect(404);
    const rows = await data.query(
      `SELECT count(*)::int AS total FROM public.organization_memberships WHERE organization_id = $1`,
      [ids.orgB],
    );
    expect(rows[0].total).toBe(1);
  });
});
