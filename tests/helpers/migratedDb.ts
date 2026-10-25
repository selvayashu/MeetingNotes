import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * An in-process Postgres with every real migration applied (stand-ins for Supabase's auth/storage schemas).
 * Migrations with "cron" in their name need pg_cron/pg_net, which this engine lacks, so they are skipped; the
 * logic worth testing lives in the migrations before them.
 */
export async function migratedDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as
      $$ select string_to_array(name, '/') $$;
    grant usage on schema auth, storage, public to authenticated, anon;
  `)
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  for (const f of fs.readdirSync(dir).sort().filter((n) => !n.includes('cron'))) {
    // Supabase grants table privileges to `authenticated` when a table is created; mimic that once, before the
    // migrations that later narrow them with REVOKE/GRANT.
    if (f.includes('000004')) await db.exec('grant select,insert,update,delete on all tables in schema public, storage to authenticated;')
    await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))
  }
  return db
}

/** Run `sql` as a signed-in user (RLS and column grants apply). */
export async function asUser<T = Record<string, unknown>>(db: PGlite, uid: string, sql: string) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false)`)
  try {
    return await db.query<T>(sql)
  } finally {
    await db.exec('reset role')
  }
}

export async function fails(db: PGlite, uid: string, sql: string): Promise<boolean> {
  try {
    await asUser(db, uid, sql)
    return false
  } catch {
    return true
  }
}
