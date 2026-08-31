import 'dotenv/config';
import { DataSource } from 'typeorm';
import {
  IdentityLinkBootstrapService,
  SupabaseProfile,
} from '../src/identity/identity-link-bootstrap.service';

async function profiles(): Promise<SupabaseProfile[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const response = await fetch(
    `${url.replace(/\/$/, '')}/rest/v1/app_users?select=id,email`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (!response.ok) throw new Error('trusted Supabase profile query failed');
  return (await response.json()) as SupabaseProfile[];
}
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  await dataSource.initialize();
  try {
    console.log(
      JSON.stringify(
        await new IdentityLinkBootstrapService(dataSource).run(
          await profiles(),
          dryRun,
        ),
      ),
    );
  } finally {
    await dataSource.destroy();
  }
}
void main();
