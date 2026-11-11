import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL('../supabase/or-submission-admin-notifications.sql', import.meta.url);
const migration = await readFile(fileURLToPath(migrationUrl), 'utf8');

test('OR submission migration creates idempotent per-active-admin notifications in the RPC transaction', () => {
  assert.match(migration, /create or replace function public\.submit_request_or\(/i);
  assert.match(migration, /insert into public\.admin_notifications/i);
  assert.match(migration, /from public\.admins as admin\s+where admin\.is_active = true/i);
  assert.match(migration, /on conflict \(admin_id, event_key\) do nothing/i);
  assert.match(migration, /'or-upload:' \|\| updated_request\.id::text \|\| ':' \|\| p_submitted_at::text/i);
  assert.match(migration, /updated_request\.tracking_code/i);
  assert.match(migration, /updated_request\.request_type/i);
  assert.match(migration, /p_submitted_at\s*\n\s*from public\.admins/i);
  const notificationInsert = migration.match(/insert into public\.admin_notifications([\s\S]*?)on conflict/i)?.[1] || '';
  assert.doesNotMatch(notificationInsert, /image_url|image_public_id|or_number/i);
});