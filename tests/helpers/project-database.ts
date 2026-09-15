import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";

const migrations = new URL("../../supabase/migrations/", import.meta.url);
export const creationMigration = "20260915140858_fix_project_creation_rls.sql";

export async function migrate(db: PGlite, filename: string) {
  await db.exec(readFileSync(new URL(filename, migrations), "utf8"));
}

export async function projectDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    // Only Supabase's platform schemas are fixtures. Application tables,
    // functions, triggers and RLS come from the actual repository migrations.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema extensions;
      create schema storage;
      create table auth.users (
        id uuid primary key, email text, raw_user_meta_data jsonb default '{}',
        created_at timestamptz default now(), updated_at timestamptz default now()
      );
      create function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
      $$;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
      $$;
      create table storage.buckets (
        id text primary key, name text, public boolean, file_size_limit bigint,
        allowed_mime_types text[]
      );
      create table storage.objects (
        id uuid primary key default gen_random_uuid(), bucket_id text,
        name text, owner uuid, metadata jsonb default '{}'
      );
      alter table storage.objects enable row level security;
      create function storage.extension(text) returns text language sql immutable as $$
        select reverse(split_part(reverse($1), '.', 1))
      $$;
      create function storage.foldername(text) returns text[] language sql immutable as $$
        select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1]
      $$;
      grant usage on schema auth, public, storage to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    `);
    for (const filename of readdirSync(migrations).sort()) {
      // This import requires a specific production account and is not schema.
      if (filename === "20260822120000_seed_projetos_de_legado_christiane.sql") continue;
      if (!filename.endsWith(".sql") || filename >= creationMigration) continue;
      try {
        await migrate(db, filename);
      } catch (cause) {
        throw new Error(`Migration failed: ${filename}`, { cause });
      }
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
