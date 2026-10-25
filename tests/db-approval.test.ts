import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'

// Runs every migration on an in-process Postgres (with stand-ins for Supabase's auth/storage
// schemas) and checks the admin-approval rules, including attempts to cheat.
const dir = new URL('../supabase/migrations/', import.meta.url)

describe('admin approval (database policies)', () => {
  it('enforces approval, blocks self-approval, and protects admin functions', async () => {
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
    const files = fs.readdirSync(dir).sort()
    const A = '00000000-0000-0000-0000-00000000000a' // legacy user (exists before migration 5)
    const ADM = '00000000-0000-0000-0000-0000000000ad' // bootstrap admin
    const P = '00000000-0000-0000-0000-0000000000b1' // new, pending
    const Q = '00000000-0000-0000-0000-0000000000b2' // second new user
    
    for (const f of files) {
      if (f.includes('000004')) await db.exec('grant select,insert,update,delete on all tables in schema public, storage to authenticated;')
      if (f.includes('000005')) await db.exec(`insert into auth.users values ('${A}','legacy@x.co','{}')`) // signed up before approval existed
      await db.exec(fs.readFileSync(new URL(f, dir), 'utf8'))
    }
    await db.exec(`revoke all on public.admin_emails from anon, authenticated;`)
    
    const q = (sql: string) => db.query(sql)
    const as = async (uid: string, sql: string) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false)`)
      try { return await db.query(sql) } finally { await db.exec('reset role') }
    }
    const denied = async (uid: string, sql: string) => { try { await as(uid, sql); return false } catch { return true } }
    const failures: string[] = []
    const ok = (n: string, c: boolean) => { if (!c) failures.push(n) }
    
    // --- bootstrap + grandfathering
    ok('legacy account is grandfathered as approved', (await q(`select status from profiles where id='${A}'`)).rows[0].status === 'approved')
    await q(`insert into admin_emails values ('boss@x.co')`)
    await q(`insert into auth.users values ('${ADM}','Boss@X.co','{}'),('${P}','pending@x.co','{}'),('${Q}','q@x.co','{}')`)
    const prof = async (id: string) => (await q(`select status,is_admin from profiles where id='${id}'`)).rows[0]
    ok('listed email becomes approved admin on sign-up (case-insensitive)', JSON.stringify(await prof(ADM)) === '{"status":"approved","is_admin":true}')
    ok('ordinary new sign-up is pending and not admin', JSON.stringify(await prof(P)) === '{"status":"pending","is_admin":false}')
    ok('admin_emails is invisible to signed-in users', await denied(P, `select * from admin_emails`))
    
    // --- a pending user has no access to data
    await q(`insert into meetings(id,user_id,title) values ('11111111-1111-1111-1111-111111111111','${P}','pre-existing')`)
    ok('pending user cannot read even their own meetings', (await as(P, `select 1 from meetings`)).rows.length === 0)
    ok('pending user cannot create a meeting', await denied(P, `insert into meetings(user_id,title) values ('${P}','x')`))
    ok('pending user cannot upload audio', await denied(P, `insert into storage.objects(bucket_id,name) values ('recordings','${P}/a.webm')`))
    ok('pending user cannot add child rows', await denied(P, `insert into action_items(meeting_id,task) values ('11111111-1111-1111-1111-111111111111','x')`))
    
    // --- a pending user cannot approve themselves
    ok('cannot self-approve via UPDATE', await denied(P, `update profiles set status='approved' where id='${P}'`))
    ok('cannot make self admin', await denied(P, `update profiles set is_admin=true where id='${P}'`))
    ok('cannot insert a profile row as approved', await denied(Q, `insert into profiles(id,status) values ('${Q}','approved') on conflict (id) do update set status='approved'`))
    ok('cannot delete own profile', await denied(P, `delete from profiles where id='${P}'`))
    await as(P, `update profiles set preferred_language='hi', delete_audio_after_notes=true where id='${P}'`)
    ok('can still edit own preferences', (await q(`select preferred_language from profiles where id='${P}'`)).rows[0].preferred_language === 'hi')
    ok('can read own profile to see their status', (await as(P, `select status from profiles`)).rows.length === 1)
    ok('cannot read other profiles', (await as(P, `select 1 from profiles where id<>'${P}'`)).rows.length === 0)
    
    // --- admin RPCs
    ok('non-admin cannot list users', await denied(P, `select * from admin_list_users()`))
    ok('non-admin cannot approve anyone (incl. self)', await denied(P, `select admin_set_status('${P}','approved')`))
    const list = (await as(ADM, `select email,status from admin_list_users()`)).rows
    ok('admin lists everyone, pending first', list.length === 4 && list[0].status === 'pending')
    ok('admin sees emails', list.some((r: any) => r.email === 'pending@x.co'))
    ok('admin cannot change own status', await denied(ADM, `select admin_set_status('${ADM}','rejected')`))
    ok('invalid status is refused', await denied(ADM, `select admin_set_status('${P}','superuser')`))
    
    // --- approval grants access; revoking removes it again
    await as(ADM, `select admin_set_status('${P}','approved')`)
    ok('after approval the user sees their data', (await as(P, `select 1 from meetings`)).rows.length === 1)
    await as(P, `insert into meetings(user_id,title) values ('${P}','mine')`)
    await as(P, `insert into storage.objects(bucket_id,name) values ('recordings','${P}/ok.webm')`)
    ok('approved user can create meetings and upload', (await as(P, `select 1 from meetings`)).rows.length === 2)
    ok('approved user still cannot read others\' meetings', (await as(Q, `select 1 from meetings`)).rows.length === 0)
    ok('approved user still cannot touch admin RPCs', await denied(P, `select admin_set_status('${Q}','approved')`))
    await as(ADM, `select admin_set_status('${P}','rejected')`)
    ok('rejecting removes access again', (await as(P, `select 1 from meetings`)).rows.length === 0 && await denied(P, `insert into meetings(user_id,title) values ('${P}','z')`))
    ok('rejected user cannot read audio', (await as(P, `select 1 from storage.objects`)).rows.length === 0)
    ok('decided_at is recorded', (await q(`select decided_at is not null d from profiles where id='${P}'`)).rows[0].d)
    
    // --- regression: the existing per-user isolation still holds for approved users
    await as(ADM, `select admin_set_status('${Q}','approved')`)
    await as(ADM, `select admin_set_status('${P}','approved')`)
    ok('approved users stay isolated from each other', (await as(Q, `select 1 from meetings`)).rows.length === 0)
    
    
    expect(failures).toEqual([])
  }, 60_000)
})
