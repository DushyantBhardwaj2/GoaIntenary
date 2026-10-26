import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { migrate, openDatabase } from '../src/database.js';

const secret = 'planning-synthetic-test-secret-with-32-bytes';
const profileId = '10000000-0000-4000-8000-000000000001';

test('trip planning migration records version 4 once when applied twice', async () => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-trip-planning-test-'));
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
  const database = await openDatabase(config);
  try {
    await migrate(database, 4);
    await migrate(database, 4);
    const versions = await database.query<{ version: number }>('SELECT version FROM goa_core_migrations ORDER BY version');
    assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4]);
    assert.equal(versions.filter((row) => row.version === 4).length, 1);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a trip created at migration 3 survives trip planning without invented rows', async () => {
  const testRoot = fileURLToPath(new URL('../../../.data/tests/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'goa-trip-planning-legacy-'));
  const config = loadConfig({ NODE_ENV: 'test', ENABLE_LOCAL_DEMO: 'true', LOCAL_SESSION_SECRET: secret, PGLITE_DATA_DIR: directory });
  const database = await openDatabase(config);
  try {
    const legacyId = randomUUID();
    await migrate(database, 3);
    await database.query('INSERT INTO goa_core_profiles (id,display_name,email) VALUES ($1,$2,$3)', [profileId, 'Aman', 'aman@example.invalid']);
    await database.query("INSERT INTO goa_core_trips (id,name,start_date,end_date,created_by) VALUES ($1,'Existing v1 trip','2026-12-04','2026-12-06',$2)", [legacyId, profileId]);
    await database.query("INSERT INTO goa_core_memberships (trip_id,user_id,role,status,joined_at) VALUES ($1,$2,'organiser','accepted',now())", [legacyId, profileId]);
    await migrate(database);
    await migrate(database);
    const trips = await database.query<{ name: string }>('SELECT name FROM goa_core_trips WHERE id = $1', [legacyId]);
    assert.equal(trips.length, 1);
    assert.equal(trips[0]?.name, 'Existing v1 trip');
    const counts = await database.query<{ votes: number; stays: number; items: number }>(`
      SELECT
        (SELECT count(*)::int FROM goa_core_place_votes WHERE trip_id = $1) AS votes,
        (SELECT count(*)::int FROM goa_core_stays WHERE trip_id = $1) AS stays,
        (SELECT count(*)::int FROM goa_core_checklist_items WHERE trip_id = $1) AS items`, [legacyId]);
    const count = counts[0];
    assert.ok(count);
    assert.equal(Number(count.votes), 0);
    assert.equal(Number(count.stays), 0);
    assert.equal(Number(count.items), 0);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
