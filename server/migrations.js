import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const migrations = [
  { version: 1, name: 'base', sql: `
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT,owner_id TEXT,status TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL,project_id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(user_id,project_id));
    CREATE TABLE IF NOT EXISTS resources(collection TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,project_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(collection,id));
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,entity TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,changes TEXT NOT NULL,at TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY,value INTEGER NOT NULL);
  ` },
  { version: 2, name: 'indexes', sql: `
    CREATE INDEX IF NOT EXISTS idx_resources_collection_project ON resources(collection, project_id);
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at, id);
  ` },
  { version: 3, name: 'relationship-integrity', sql: `
    CREATE TRIGGER IF NOT EXISTS memberships_user_fk_insert BEFORE INSERT ON memberships
      WHEN NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.user_id)
      BEGIN SELECT RAISE(ABORT, 'membership user does not exist'); END;
    CREATE TRIGGER IF NOT EXISTS memberships_project_fk_insert BEFORE INSERT ON memberships
      WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'membership project does not exist'); END;
    CREATE TRIGGER IF NOT EXISTS resources_project_fk_insert BEFORE INSERT ON resources
      WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'resource project does not exist'); END;
    CREATE TRIGGER IF NOT EXISTS resources_project_fk_update BEFORE UPDATE OF project_id ON resources
      WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id)
      BEGIN SELECT RAISE(ABORT, 'resource project does not exist'); END;
  ` }
];

export async function openDatabase(file) {
  await mkdir(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);');
  const current = db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get().version;
  for (const migration of migrations.filter((entry) => entry.version > current)) {
    db.exec('BEGIN');
    try { db.exec(migration.sql); db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(migration.version, migration.name, new Date().toISOString()); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  // Upgrade databases created before projects became canonical. The resource mirror is
  // copied only when the canonical row is absent, then removed so reads and writes
  // cannot diverge between two project stores.
  const legacyProjects = db.prepare("SELECT id,payload,created_at FROM resources WHERE collection='projects'").all();
  for (const legacy of legacyProjects) {
    const project = JSON.parse(legacy.payload);
    db.prepare('INSERT OR IGNORE INTO projects(id,name,description,owner_id,status,created_at) VALUES (?,?,?,?,?,?)').run(project.id, project.name, project.description || null, project.ownerId || null, project.status || 'Active', legacy.created_at);
  }
  db.prepare("DELETE FROM resources WHERE collection='projects'").run();
  return db;
}
