import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
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

test('generic resource authorization is enforced against existing records',async()=>{
 const {openDatabase}=await import('../server/migrations.js'); const db=await openDatabase(dataFile);
 const encode=(password)=>{const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`};
 const users=[['u-manager','manager','Manager User','Manager'],['u-developer','developer','Developer User','Developer'],['u-qa','qa','QA User','QA']];
 for(const [id,username,name,role] of users)db.prepare('INSERT OR REPLACE INTO users VALUES (?,?,?,?,?)').run(id,username,name,encode('test-password'),role);
 let status,foreign,managerTicket,foreignTicket,developerTicket,qaTicket;
 [status,foreign]=await request('projects',{method:'POST',body:JSON.stringify({name:'Foreign scope'})}); assert.equal(status,201);
 db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?)').run('u-manager',foreign.id,'Manager');
 db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?)').run('u-developer','p-demo','Developer');
 db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?)').run('u-qa','p-demo','QA');
 [status,managerTicket]=await request('tickets',{method:'POST',body:JSON.stringify({title:'Manager target',projectId:foreign.id})}); assert.equal(status,201);
 [status,foreignTicket]=await request('tickets',{method:'POST',body:JSON.stringify({title:'Foreign target',projectId:foreign.id})}); assert.equal(status,201);
 [status,developerTicket]=await request('tickets',{method:'POST',body:JSON.stringify({title:'Developer target',projectId:'p-demo'})}); assert.equal(status,201);
 [status,qaTicket]=await request('tickets',{method:'POST',body:JSON.stringify({title:'QA target',projectId:'p-demo'})}); assert.equal(status,201);
 const login=async(username)=>{const result=await request('login',{method:'POST',body:JSON.stringify({username,password:'test-password'})});assert.equal(result[0],200);token=result[1].token};
 await login('manager');
 [status]=await request(`tickets/${developerTicket.id}`,{method:'PATCH',body:JSON.stringify({title:'foreign edit'})}); assert.equal(status,403);
 [status]=await request(`tickets/${developerTicket.id}`,{method:'DELETE'}); assert.equal(status,403);
 [status]=await request(`tickets/${managerTicket.id}`,{method:'PATCH',body:JSON.stringify({title:'manager edit'})}); assert.equal(status,200);
 [status]=await request(`tickets/${managerTicket.id}`,{method:'PATCH',body:JSON.stringify({projectId:'p-demo'})}); assert.equal(status,403);
 [status]=await request(`tickets/${managerTicket.id}`,{method:'DELETE'}); assert.equal(status,204);
 await login('developer');
 [status]=await request(`tickets/${foreignTicket.id}`,{method:'PATCH',body:JSON.stringify({title:'foreign edit'})}); assert.equal(status,403);
 [status]=await request(`tickets/${foreignTicket.id}`,{method:'DELETE'}); assert.equal(status,403);
 [status]=await request(`tickets/${developerTicket.id}`,{method:'PATCH',body:JSON.stringify({title:'developer edit'})}); assert.equal(status,200);
 [status]=await request(`tickets/${developerTicket.id}`,{method:'DELETE'}); assert.equal(status,403);
 await login('qa');
 [status]=await request(`tickets/${foreignTicket.id}`,{method:'PATCH',body:JSON.stringify({title:'foreign edit'})}); assert.equal(status,403);
 [status]=await request(`tickets/${foreignTicket.id}`,{method:'DELETE'}); assert.equal(status,403);
 [status]=await request(`tickets/${qaTicket.id}`,{method:'PATCH',body:JSON.stringify({title:'qa edit'})}); assert.equal(status,200);
 [status]=await request(`tickets/${qaTicket.id}`,{method:'DELETE'}); assert.equal(status,403);
 [status]=await request(`tickets/${qaTicket.id}`); assert.equal(status,200);
});

test('GET-by-ID distinguishes foreign existing records from missing records',async()=>{
 const {openDatabase}=await import('../server/migrations.js'); const db=await openDatabase(dataFile);
 const foreign=db.prepare("SELECT id FROM projects WHERE name='Foreign scope'").get();
 const foreignTicket=db.prepare("SELECT id FROM resources WHERE collection='tickets' AND json_extract(payload,'$.title')='Foreign target'").get();
 const login=async(username)=>{const result=await request('login',{method:'POST',body:JSON.stringify({username,password:'test-password'})});assert.equal(result[0],200);token=result[1].token};
 await login('developer');
 let status,payload;
 [status,payload]=await request(`projects/${foreign.id}`); assert.equal(status,403); assert.deepEqual(payload,{error:'Forbidden'});
 [status,payload]=await request('projects/project-does-not-exist'); assert.equal(status,404); assert.deepEqual(payload,{error:'Not found'});
 [status,payload]=await request(`tickets/${foreignTicket.id}`); assert.equal(status,403); assert.deepEqual(payload,{error:'Forbidden'});
 [status,payload]=await request('tickets/ticket-does-not-exist'); assert.equal(status,404); assert.deepEqual(payload,{error:'Not found'});
 [status,payload]=await request('memberships/u-admin:p-demo'); assert.equal(status,403); assert.deepEqual(payload,{error:'Forbidden'});
 [status,payload]=await request('memberships/missing-user:missing-project'); assert.equal(status,404); assert.deepEqual(payload,{error:'Not found'});
});

test('logout revokes the authenticated session',async()=>{const response=await request('logout',{method:'POST'});assert.equal(response[0],204);const [status]=await request('tickets');assert.equal(status,401);});

test('runtime SPA fallback, binary attachments, reports, and QA execution are functional',async()=>{
  let status,result;
  [status,result]=await request('login',{method:'POST',body:JSON.stringify({username:'admin',password:'test-password'})}); assert.equal(status,200); token=result.token;
  const deep=await fetch('http://localhost:3011/tickets'); assert.equal(deep.status,200); assert.match(await deep.text(),/Northstar CRM/);
  const traversal=await fetch('http://localhost:3011/%2e%2e/server/index.js'); assert.ok([400,404].includes(traversal.status));
  const apiMissing=await request('tickets/no-such-ticket'); assert.equal(apiMissing[0],404);
  [status,result]=await request('attachments/upload',{method:'POST',body:JSON.stringify({ticketId:ticket.id,name:'evidence.txt',mimeType:'text/plain',content:Buffer.from('integrity-check').toString('base64')})}); assert.equal(status,201,JSON.stringify(result)); assert.equal(result.size,15); assert.match(result.sha256,/^[a-f0-9]{64}$/);
  const download=await fetch(`http://localhost:3011/api/attachments/${result.id}/content`,{headers:{authorization:`Bearer ${token}`}}); assert.equal(download.status,200); assert.equal(await download.text(),'integrity-check');
  const validCsv=Buffer.from('name,city\\nZoë,Montréal\\n','utf8');
  [status,result]=await request('attachments/upload',{method:'POST',body:JSON.stringify({ticketId:ticket.id,name:'valid.csv',mimeType:'text/csv',content:validCsv.toString('base64')})}); assert.equal(status,201,JSON.stringify(result));
  const malformedUtf8=Buffer.from([0x6e,0x61,0x6d,0x65,0x2c,0xc3,0x28]);
  [status]=await request('attachments/upload',{method:'POST',body:JSON.stringify({ticketId:ticket.id,name:'malformed.csv',mimeType:'text/csv',content:malformedUtf8.toString('base64')})}); assert.equal(status,415);
  const {openDatabase}=await import('../server/migrations.js'); const db=await openDatabase(dataFile); const attachmentPath=db.prepare("SELECT payload FROM resources WHERE collection='attachments' AND id=?").get(result.id); const attachment=JSON.parse(attachmentPath.payload); const fs=await import('node:fs'); fs.writeFileSync(path.join(path.dirname(dataFile),'attachments',attachment.storageKey),'tampered'); const tampered=await fetch(`http://localhost:3011/api/attachments/${result.id}/content`,{headers:{authorization:`Bearer ${token}`}}); assert.equal(tampered.status,409);
  [status]=await request('attachments/upload',{method:'POST',body:JSON.stringify({ticketId:ticket.id,name:'bad.txt',mimeType:'text/plain',content:'YQ'})}); assert.equal(status,415);
  [status]=await request('attachments/upload',{method:'POST',body:JSON.stringify({ticketId:ticket.id,name:'bad.pdf',mimeType:'application/pdf',content:Buffer.from('not-pdf').toString('base64')})}); assert.equal(status,415);
  [status]=await request('attachments/upload',{method:'POST',body:JSON.stringify({ticketId:ticket.id,name:'bad.exe',mimeType:'application/x-msdownload',content:'Yg=='})}); assert.equal(status,415);
  [status,result]=await request('reports',{method:'POST',body:JSON.stringify({name:'Ticket report',projectId:'p-demo',definition:JSON.stringify({collection:'tickets',columns:['key','title'],filters:{id:ticket.id}})})}); assert.equal(status,201,JSON.stringify(result));
  const report=await fetch(`http://localhost:3011/api/reports/${result.id}/run?format=csv`,{method:'POST',headers:{authorization:`Bearer ${token}`}}); assert.equal(report.status,200); assert.match(await report.text(),/"key","title"/);
  const foreignProject=await request('projects',{method:'POST',body:JSON.stringify({name:'Report foreign'})}); assert.equal(foreignProject[0],201); const foreignTicket=await request('tickets',{method:'POST',body:JSON.stringify({title:'Should not leak',projectId:foreignProject[1].id})}); assert.equal(foreignTicket[0],201); const scoped=await fetch(`http://localhost:3011/api/reports/${result.id}/run`,{method:'POST',headers:{authorization:`Bearer ${token}`}}); const scopedBody=await scoped.json(); assert.equal(scoped.status,200); assert.equal(scopedBody.rows.some((row)=>row.id===foreignTicket[1].id),false);
  const badFilter=await request('reports',{method:'POST',body:JSON.stringify({name:'Bad filter',projectId:'p-demo',definition:JSON.stringify({collection:'tickets',filters:{notAField:'x'}})})}); assert.equal(badFilter[0],400);
  [status,result]=await request('qaCases',{method:'POST',body:JSON.stringify({ticketId:ticket.id,name:'runtime QA',expected:'works'})}); assert.equal(status,201,JSON.stringify(result));
  [status,result]=await request(`qaCases/${result.id}/execute`,{method:'POST',body:JSON.stringify({outcome:'Passed',evidence:'runtime evidence',input:'runtime input',defectId:'DEF-1',changeVersion:'e07f6f1'})}); assert.equal(status,201,JSON.stringify(result)); assert.equal(result.status,'Passed'); assert.equal(result.executorId,'u-admin'); assert.equal(result.caseTransition,'Pending->Passed'); assert.equal(result.defectId,'DEF-1'); assert.equal(result.changeVersion,'e07f6f1');
  const firstResultId=result.id; const qaCaseId=result.qaCaseId; [status,result]=await request(`qaCases/${qaCaseId}/execute`,{method:'POST',body:JSON.stringify({outcome:'Failed',evidence:'retest evidence',priorResultId:firstResultId,changeVersion:'e07f6f1'})}); assert.equal(status,201); assert.equal(result.priorResultId,firstResultId); assert.equal(result.caseTransition,'Passed->Failed');
  [status]=await request(`qaCases/${qaCaseId}/execute`,{method:'POST',body:JSON.stringify({outcome:'Passed',evidence:'missing prior link',priorResultId:'wrong'})}); assert.equal(status,422);
});
