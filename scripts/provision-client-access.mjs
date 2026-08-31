// One-off operations tool: provisions or rotates the per-case client portal
// access (bcrypt PIN hash) for an existing case + authorized client.
//
// Usage:
//   CLIENT_REFERENCE=VF-2026-8282 \
//   CLIENT_EMAIL=gayl302726@yahoo.com \
//   [CLIENT_PIN=123456] \
//   node scripts/provision-client-access.mjs
//
// When CLIENT_PIN is omitted a random 6-digit PIN is generated and written to
// CLIENT_PIN_FILE (default: /opt/vineford/backups/<reference>-client-pin.secure)
// with root-only permissions. Only the bcrypt hash is stored in the database.
// No PIN or hash is ever printed to stdout.

import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Client } = pg;

const reference = (process.env.CLIENT_REFERENCE || '').trim();
const email = (process.env.CLIENT_EMAIL || '').trim().toLowerCase();
let pin = (process.env.CLIENT_PIN || '').trim();
const enabled = process.env.CLIENT_ACCESS_ENABLED !== '0';

if (!reference || !email) {
  console.error('CLIENT_REFERENCE and CLIENT_EMAIL are required.');
  process.exit(2);
}

const generated = !/^\d{6}$/.test(pin);
if (generated) {
  pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

if (!/^\d{6}$/.test(pin)) {
  console.error('CLIENT_PIN must be exactly 6 digits.');
  process.exit(2);
}

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

try {
  await client.connect();

  const lookup = await client.query(
    `SELECT c.id AS case_id, c.case_number, cl.id AS client_id, cl.email AS client_email
       FROM public.cases c
       JOIN public.clients cl ON cl.id = c.client_id
      WHERE upper(c.case_number) = upper($1)
        AND lower(cl.email) = lower($2)`,
    [reference, email],
  );

  if (lookup.rowCount === 0) {
    console.error('No matching case + client found. Nothing was changed.');
    process.exit(3);
  }

  const { case_id, case_number, client_id } = lookup.rows[0];
  const pinHash = await bcrypt.hash(pin, 10);

  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO public.client_case_access
       (client_id, case_id, pin_hash, enabled, pin_attempts, pin_locked_until, pin_set_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, NULL, $5, $5, $5)
     ON CONFLICT (case_id)
     DO UPDATE SET
       client_id = EXCLUDED.client_id,
       pin_hash = EXCLUDED.pin_hash,
       enabled = EXCLUDED.enabled,
       pin_attempts = 0,
       pin_locked_until = NULL,
       pin_set_at = EXCLUDED.pin_set_at,
       updated_at = EXCLUDED.updated_at`,
    [client_id, case_id, pinHash, enabled, now],
  );

  if (generated) {
    const pinFile =
      process.env.CLIENT_PIN_FILE ||
      path.join(
        '/opt/vineford/backups',
        `${case_number}-client-pin.secure`,
      );
    fs.writeFileSync(pinFile, `${pin}\n`, { mode: 0o600 });
    console.log(
      `Provisioned client access for ${case_number}. PIN written to ${pinFile} (root-only).`,
    );
  } else {
    console.log(`Provisioned client access for ${case_number}.`);
  }
} catch (error) {
  console.error('Provisioning failed:', error.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
