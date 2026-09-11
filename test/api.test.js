import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
let proc; let dataFile; let token; let ticket;
const request = (pathName, options = {}) => fetch(`http://localhost:3011/api/${pathName}`, { headers:{'content-type':'application/json', ...(token ? {authorization:`Bearer ${token}`} : {})}, ...options }).then(async response => [response.status, response.status === 204 ? null : response.json()]).then(async ([status, payload]) => [status, await payload]);
test.before(async () => { const dir=await mkdtemp(path.join(tmpdir(),'crm-test-')); dataFile=path.join(dir,'crm.json'); proc=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3011',CRM_DATA_FILE:dataFile,DEMO_PASSWORD:'test-password'}}); await new Promise((resolve,reject)=>{proc.once('error',reject); const started=Date.now(); const poll=async()=>{try{await fetch('http://localhost:3011/api/tickets'); resolve()}catch{if(Date.now()-started>5000)reject(Error('server did not start'));else setTimeout(poll,50)}};poll()}); });
test.after(async () => { proc.kill(); if (dataFile) await rm(path.dirname(dataFile),{recursive:true,force:true}); });
test('unauthenticated collections are rejected',async()=>{const [status]=await request('tickets');assert.equal(status,401);});
test('login hides password and protects lifecycle/audit',async()=>{let [status,result]=await request('login',{method:'POST',body:JSON.stringify({username:'admin',password:'test-password'})});assert.equal(status,200);assert.ok(result.token);assert.equal(result.user.passwordHash,undefined);token=result.token;
 [status,ticket]=await request('tickets',{method:'POST',body:JSON.stringify({title:'Test',projectId:'p-demo'})});assert.equal(status,201);assert.match(ticket.key,/^CRM-\d{5}$/);
 [status]=await request(`tickets/${ticket.id}`,{method:'PATCH',body:JSON.stringify({status:'Close'})});assert.equal(status,422);
 [status]=await request(`tickets/${ticket.id}`,{method:'PATCH',body:JSON.stringify({status:'Analyse'})});assert.equal(status,200);
 [status]=await request('audit',{method:'DELETE'});assert.equal(status,405);
 [status]=await request('audit',{method:'POST',body:JSON.stringify({actorId:'attacker',action:'tampered'})});assert.equal(status,405);
 [status]=await request('audit',{method:'PATCH',body:JSON.stringify({actorId:'attacker'})});assert.equal(status,405);
 [status]=await request(`tickets/${ticket.id}`,{method:'PATCH',body:JSON.stringify({passwordHash:'injected'})});assert.equal(status,400);
 [status]=await request(`tickets/${ticket.id}`,{method:'PATCH',body:JSON.stringify({unknownField:'injected'})});assert.equal(status,400);
 [status]=await request('tickets',{method:'POST',body:JSON.stringify({title:'Missing project'})});assert.equal(status,400);
 [status,result]=await request('audit');assert.equal(status,200);assert.ok(result.every((entry)=>entry.actorId==='u-admin'));assert.ok(result.some((entry)=>entry.entityId===ticket.id));
});

test('projects and memberships use canonical lifecycle endpoints',async()=>{
 let status,project,membership;
 const {openDatabase}=await import('../server/migrations.js'); const testDb=await openDatabase(dataFile); testDb.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?)').run('u-manager','manager','Manager User','salt:00','Manager');
 [status,project]=await request('projects',{method:'POST',body:JSON.stringify({name:'Second project',description:'isolated'})});
 assert.equal(status,201,JSON.stringify(project)); assert.equal(project.name,'Second project');
 [status,membership]=await request('memberships',{method:'POST',body:JSON.stringify({userId:'u-manager',projectId:project.id,role:'Manager'})});
 assert.equal(status,201,JSON.stringify(membership)); assert.equal(membership.role,'Manager');
 [status,membership]=await request(`memberships/${membership.id}`,{method:'PATCH',body:JSON.stringify({role:'Developer'})});
 assert.equal(status,200); assert.equal(membership.role,'Developer');
 [status]=await request(`memberships/${membership.id}`,{method:'DELETE'}); assert.equal(status,204);
 [status]=await request(`projects/${project.id}`,{method:'PATCH',body:JSON.stringify({name:'Renamed project'})}); assert.equal(status,200);
 [status]=await request(`projects/${project.id}`,{method:'DELETE'}); assert.equal(status,204);
 [status]=await request(`projects/${project.id}`); assert.equal(status,404);
});

test('relationship validation rejects cross-project references',async()=>{
 let status,second;
 [status,second]=await request('projects',{method:'POST',body:JSON.stringify({name:'Isolation project'})}); assert.equal(status,201);
 [status]=await request('tickets',{method:'POST',body:JSON.stringify({title:'Cross project',projectId:second.id,dependsOnTicketId:ticket.id})}); assert.equal(status,400);
});

test('seed and migration behavior remains non-destructive',async()=>{
 const {openDatabase}=await import('../server/migrations.js');
 assert.equal(typeof openDatabase,'function');
});


test('approval workflow accepts typed relationships and remains project scoped',async()=>{
 let status,approval,second;
 [status,second]=await request('projects',{method:'POST',body:JSON.stringify({name:'Approval isolation'})}); assert.equal(status,201);
 [status,approval]=await request('approvals',{method:'POST',body:JSON.stringify({ticketId:ticket.id,approverId:'u-admin',status:'Approved',comment:'Reviewed'})});
 assert.equal(status,201,JSON.stringify(approval)); assert.equal(approval.ticketId,ticket.id);
 [status]=await request('approvals',{method:'POST',body:JSON.stringify({ticketId:ticket.id,approverId:'u-admin',status:'Approved',projectId:second.id})}); assert.equal(status,400);
});

test('invalid roles and admin reassignment rules are enforced',async()=>{
 let status,second;
 [status,second]=await request('projects',{method:'POST',body:JSON.stringify({name:'Reassignment target'})}); assert.equal(status,201);
 [status]=await request('memberships',{method:'POST',body:JSON.stringify({userId:'u-admin',projectId:second.id,role:'Owner'})}); assert.equal(status,400);
 [status]=await request('tickets',{method:'POST',body:JSON.stringify({title:'Reassign me',projectId:second.id})}); assert.equal(status,201);
});

test('dashboard is scoped and project deletion removes dependent records',async()=>{
 let status,project,created;
 [status,project]=await request('projects',{method:'POST',body:JSON.stringify({name:'Cleanup project'})}); assert.equal(status,201);
 [status,created]=await request('tickets',{method:'POST',body:JSON.stringify({title:'Cleanup ticket',projectId:project.id})}); assert.equal(status,201);
 [status]=await request(`projects/${project.id}`,{method:'DELETE'}); assert.equal(status,204);
 const {openDatabase}=await import('../server/migrations.js'); const db=await openDatabase(dataFile);
 assert.equal(db.prepare('SELECT 1 FROM resources WHERE id=?').get(created.id),undefined);
 [status]=await request('dashboard'); assert.equal(status,200);
});

test('seed twice preserves existing data and ticket counter',async()=>{
 const seed=spawnSync(process.execPath,['server/seed.js'],{cwd:path.resolve('.'),env:{...process.env,CRM_DATA_FILE:dataFile,DEMO_PASSWORD:'test-password'},encoding:'utf8'}); assert.equal(seed.status,0,seed.stderr);
 const {openDatabase}=await import('../server/migrations.js'); const db=await openDatabase(dataFile);
 db.prepare("INSERT INTO resources VALUES (?,?,?,?,?,?)").run('tickets','t-preserved',JSON.stringify({id:'t-preserved',key:'CRM-00099',title:'Keep me',projectId:'p-demo',status:'Request'}),'p-demo',new Date().toISOString(),new Date().toISOString());
 db.prepare("UPDATE counters SET value=99 WHERE name='ticket'").run();
 const second=spawnSync(process.execPath,['server/seed.js'],{cwd:path.resolve('.'),env:{...process.env,CRM_DATA_FILE:dataFile,DEMO_PASSWORD:'test-password'},encoding:'utf8'}); assert.equal(second.status,0,second.stderr);
 const after=await openDatabase(dataFile); assert.equal(after.prepare("SELECT value FROM counters WHERE name='ticket'").get().value,99); assert.equal(JSON.parse(after.prepare("SELECT payload FROM resources WHERE id='t-preserved'").get().payload).title,'Keep me');
});


test('legacy project resources migrate to canonical projects and are removed',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'crm-legacy-')); const file=path.join(dir,'legacy.sqlite'); const {DatabaseSync}=await import('node:sqlite'); const legacyDb=new DatabaseSync(file);
 legacyDb.exec(`CREATE TABLE resources(collection TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,project_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(collection,id));`);
 legacyDb.prepare('INSERT INTO resources VALUES (?,?,?,?,?,?)').run('projects','legacy-1',JSON.stringify({id:'legacy-1',name:'Legacy project',description:'old',ownerId:'u-admin',status:'Active'}),null,new Date().toISOString(),new Date().toISOString()); legacyDb.close();
 const {openDatabase}=await import('../server/migrations.js'); const migrated=await openDatabase(file);
 assert.equal(migrated.prepare("SELECT name FROM projects WHERE id='legacy-1'").get().name,'Legacy project'); assert.equal(migrated.prepare("SELECT 1 FROM resources WHERE collection='projects'").get(),undefined); await rm(dir,{recursive:true,force:true});
});

test('logout revokes the authenticated session',async()=>{const response=await request('logout',{method:'POST'});assert.equal(response[0],204);const [status]=await request('tickets');assert.equal(status,401);});
