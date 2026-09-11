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
const ticket={id:'t-demo',key:'CRM-00001',title:'Create intake workflow',description:'Configure request intake and lifecycle tracking.',projectId,priority:'High',status:'Develop',assigneeId:admin.id,history:[{status:'Request',at:now,actorId:admin.id},{status:'Analyse',at:now,actorId:admin.id},{status:'Develop',at:now,actorId:admin.id}]};
db.prepare('INSERT OR IGNORE INTO resources VALUES (?,?,?,?,?,?)').run('tickets',ticket.id,JSON.stringify(ticket),projectId,now,now);db.prepare('INSERT OR REPLACE INTO counters VALUES (?,?)').run('ticket',1);
const task={id:'task-demo',title:'Define acceptance criteria',ticketId:ticket.id,projectId,status:'In Progress'};db.prepare('INSERT OR IGNORE INTO resources VALUES (?,?,?,?,?,?)').run('tasks',task.id,JSON.stringify(task),projectId,now,now);
console.log(`Seeded SQLite CRM data at ${file}. Admin login: admin / ${process.env.DEMO_PASSWORD || 'admin123'}`);
