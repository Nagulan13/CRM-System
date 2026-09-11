import { randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import { openDatabase } from './migrations.js';
function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }

const file = process.env.CRM_DATA_FILE || path.resolve('data/crm.sqlite');
const db = await openDatabase(file);
let admin = db.prepare("SELECT id FROM users WHERE username='admin'").get();
if (!admin) { admin = { id:'u-admin' }; db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(admin.id,'admin','Admin User',passwordHash(process.env.DEMO_PASSWORD || 'admin123'),'Admin'); }
const now = new Date().toISOString(); const projectId='p-demo';
db.prepare('INSERT OR IGNORE INTO projects VALUES (?,?,?,?,?,?)').run(projectId,'Internal CRM MVP','Demo delivery workspace',admin.id,'Active',now);
const project={id:projectId,name:'Internal CRM MVP',description:'Demo delivery workspace',ownerId:admin.id,status:'Active'};

db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?)').run(admin.id,projectId,'Admin');
// Seeding is additive: never overwrite user data or move a counter backwards.
const existingTicket = db.prepare("SELECT payload FROM resources WHERE collection='tickets' AND id='t-demo'").get();
let ticket;
if (existingTicket) {
  ticket = JSON.parse(existingTicket.payload);
} else {
  const currentCounter = Number(db.prepare("SELECT value FROM counters WHERE name='ticket'").get()?.value || 0);
  const nextNumber = currentCounter + 1;
  ticket={id:'t-demo',key:`CRM-${String(nextNumber).padStart(5,'0')}`,title:'Create intake workflow',description:'Configure request intake and lifecycle tracking.',projectId,priority:'High',status:'Develop',assigneeId:admin.id,history:[{status:'Request',at:now,actorId:admin.id},{status:'Analyse',at:now,actorId:admin.id},{status:'Develop',at:now,actorId:admin.id}]};
  db.prepare('INSERT INTO resources VALUES (?,?,?,?,?,?)').run('tickets',ticket.id,JSON.stringify(ticket),projectId,now,now);
  db.prepare('INSERT INTO counters(name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=MAX(value,excluded.value)').run('ticket',nextNumber);
}
// Existing databases may contain tickets created without a matching counter.
// Reconcile upward only; a repeat seed must never reset numbering.
const highestKey = db.prepare("SELECT MAX(CAST(SUBSTR(json_extract(payload,'$.key'),5) AS INTEGER)) AS value FROM resources WHERE collection='tickets' AND json_extract(payload,'$.key') LIKE 'CRM-%'").get()?.value || 0;
db.prepare('INSERT INTO counters(name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=MAX(value,excluded.value)').run('ticket',highestKey);
const task={id:'task-demo',title:'Define acceptance criteria',ticketId:ticket.id,projectId,status:'In Progress'};db.prepare('INSERT OR IGNORE INTO resources VALUES (?,?,?,?,?,?)').run('tasks',task.id,JSON.stringify(task),projectId,now,now);
console.log(`Seeded SQLite CRM data at ${file}. Admin login: admin / ${process.env.DEMO_PASSWORD || 'admin123'}`);
