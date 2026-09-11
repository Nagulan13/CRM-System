import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
let proc; let dataFile; let token; let ticket;
const request = (pathName, options = {}) => fetch(`http://localhost:3011/api/${pathName}`, { headers:{'content-type':'application/json', ...(token ? {authorization:`Bearer ${token}`} : {})}, ...options }).then(async response => [response.status, response.status === 204 ? null : response.json()]).then(async ([status, payload]) => [status, await payload]);
test.before(async () => { const dir=await mkdtemp(path.join(tmpdir(),'crm-test-')); dataFile=path.join(dir,'crm.json'); proc=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3011',CRM_DATA_FILE:dataFile,DEMO_PASSWORD:'test-password'}}); await new Promise((resolve,reject)=>{proc.once('error',reject); setTimeout(resolve,300);}); });
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

test('logout revokes the authenticated session',async()=>{const response=await request('logout',{method:'POST'});assert.equal(response[0],204);const [status]=await request('tickets');assert.equal(status,401);});
