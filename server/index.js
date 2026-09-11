import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const dataDir = path.join(root, 'data');
const db = process.env.CRM_DATA_FILE || path.join(dataDir, 'crm.json');
const sessions = new Map();
const statuses = ['Request','Analyse','Clarify','Approve','Assign','Develop','Review','QA','UAT','Deploy','Verify','Resolve','Close','On Hold','Blocked','Rejected','Cancelled','Reopened'];
const transitions = { Request:['Analyse','Cancelled','On Hold','Blocked'], Analyse:['Clarify','Approve','Rejected','On Hold','Blocked'], Clarify:['Approve','Analyse','On Hold'], Approve:['Assign','Rejected','On Hold'], Assign:['Develop','On Hold'], Develop:['Review','On Hold','Blocked'], Review:['QA','Develop','Rejected'], QA:['UAT','Develop','Blocked'], UAT:['Deploy','Develop','Rejected'], Deploy:['Verify','Blocked'], Verify:['Resolve','Reopened','Blocked'], Resolve:['Close','Reopened'], Close:['Reopened'], 'On Hold':['Reopened','Cancelled'], Blocked:['Reopened','Cancelled'], Rejected:['Reopened'], Cancelled:['Reopened'], Reopened:['Analyse'] };
const collections = ['projects','tickets','tasks','comments','notifications','attachments','audit','departments','memberships','mentions','dependencies','clarifications','decisions','approvals','codeReviews','qaCases','qaResults','uatRecords','releases','deployments','meetings','actions','savedViews','reports'];
const roles = ['Admin','Manager','Developer','QA','Viewer'];
const writable = new Set(['projects','tickets','tasks','comments','notifications','attachments','departments','memberships','mentions','dependencies','clarifications','decisions','approvals','codeReviews','qaCases','qaResults','uatRecords','releases','deployments','meetings','actions','savedViews','reports']);
const required = { tickets:['title','projectId'], projects:['name'], departments:['name'], qaCases:['ticketId','name'], releases:['name','version'], deployments:['releaseId','environment'] };

function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function passwordMatches(password, encoded) { const [salt, digest] = String(encoded || '').split(':'); if (!salt || !digest) return false; const actual = scryptSync(password, salt, 64); const expected = Buffer.from(digest, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); }
const seed = () => ({ users: [{ id:'u-admin', username:'admin', name:'Admin User', passwordHash: passwordHash(process.env.DEMO_PASSWORD || randomBytes(18).toString('base64url')), role:'Admin', projectIds:[] }], projects:[], tickets:[], audit:[], counters:{ ticket:0 }, ...Object.fromEntries(collections.map(key => [key, []])) });
async function load() { if (!existsSync(db)) { await mkdir(path.dirname(db), { recursive:true }); await writeFile(db, JSON.stringify(seed(), null, 2)); } return JSON.parse(await readFile(db, 'utf8')); }
async function save(data) { await writeFile(db, JSON.stringify(data, null, 2)); }
function json(res, status, body) { res.writeHead(status, {'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'content-type, authorization','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS'}); res.end(status === 204 ? '' : JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { let raw=''; req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) reject(new Error('Request body too large')); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function actor(req, data) { const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const userId = sessions.get(token); return data.users.find(user => user.id === userId); }
function can(user, method, collection, item) { if (!user) return false; if (user.role === 'Admin' || method === 'GET' && user.role !== 'Viewer') return true; if (method === 'GET') return true; if (user.role === 'Viewer') return false; if (collection === 'users' || collection === 'departments') return user.role === 'Admin'; if (item?.projectId && user.projectIds?.length && !user.projectIds.includes(item.projectId)) return false; return true; }
function validate(collection, input, existing = {}) { const merged = {...existing, ...input}; for (const field of required[collection] || []) if (!merged[field]) throw new Error(`${field} is required`); if (collection === 'tickets' && merged.status && !statuses.includes(merged.status)) throw new Error('Invalid status'); if (collection === 'tickets' && merged.priority && !['Critical','High','Medium','Low'].includes(merged.priority)) throw new Error('Invalid priority'); }
function audit(data, user, entity, entityId, action, changes = {}) { data.audit.push({ id:randomUUID(), entity, entityId, action, changes, at:new Date().toISOString(), actorId:user.id, actorName:user.name }); }
function publicUser(user) { const {passwordHash:_, ...safe} = user; return safe; }

async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, 'http://localhost'); const parts = url.pathname.split('/').filter(Boolean); const data = await load();
  if (parts[0] !== 'api') { if (req.method !== 'GET') return json(res, 405, {error:'Method not allowed'}); let file = parts.length ? path.join(root,'public',...parts) : path.join(root,'public','index.html'); if (!existsSync(file)) file = path.join(root,'public','index.html'); res.writeHead(200, {'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}); return res.end(await readFile(file)); }
  try {
    if (req.method === 'POST' && parts[1] === 'login') { const b=await readBody(req); const user=data.users.find(x => x.username === b.username && passwordMatches(b.password, x.passwordHash)); if (!user) return json(res,401,{error:'Invalid username or password'}); const token=randomBytes(32).toString('hex'); sessions.set(token,user.id); return json(res,200,{user:publicUser(user),token}); }
    if (req.method === 'POST' && parts[1] === 'logout') { sessions.delete((req.headers.authorization||'').replace(/^Bearer\s+/i,'')); return json(res,204,{}); }
    const user = actor(req, data); if (!user) return json(res,401,{error:'Authentication required'});
    if (req.method === 'GET' && parts[1] === 'me') return json(res,200,{user:publicUser(user)});
    if (req.method === 'GET' && parts[1] === 'meta') return json(res,200,{statuses,transitions,roles,sla:{Critical:['1 hour','4 hours'],High:['4 hours','1 business day'],Medium:['1 business day','3 business days'],Low:['2 business days','5 business days']}});
    if (req.method === 'GET' && parts[1] === 'dashboard') { const open=data.tickets.filter(x=>!['Close','Cancelled','Rejected'].includes(x.status)); return json(res,200,{projects:data.projects.length,tickets:data.tickets.length,open:open.length,byStatus:Object.fromEntries(statuses.map(s=>[s,data.tickets.filter(x=>x.status===s).length]))}); }
    const collection=parts[1], id=parts[2]; if (!collections.includes(collection)) return json(res,404,{error:'Route not found'}); const list=data[collection];
    if (req.method === 'GET' && !id) return json(res,200,list.filter(item => can(user,'GET',collection,item)));
    const item=id ? list.find(x=>x.id===id) : null; if (id && !item) return json(res,404,{error:'Not found'}); if (collection==='audit' && req.method==='DELETE') return json(res,405,{error:'Audit is append-only'}); if (!can(user,req.method,collection,item)) return json(res,403,{error:'Forbidden'});
    if (req.method === 'POST') { if (!writable.has(collection)) return json(res,405,{error:'Collection is read-only'}); const input=await readBody(req); validate(collection,input); const now=new Date().toISOString(); const newItem={id:randomUUID(),createdAt:now,updatedAt:now,...input}; if (collection==='tickets') { data.counters.ticket += 1; newItem.key=`CRM-${String(data.counters.ticket).padStart(5,'0')}`; newItem.status=newItem.status||'Request'; newItem.priority=newItem.priority||'Medium'; newItem.history=[{status:newItem.status,at:now,actorId:user.id}]; } list.push(newItem); audit(data,user,collection.slice(0,-1),newItem.id,'created'); await save(data); return json(res,201,newItem); }
    if (req.method === 'PATCH') { const input=await readBody(req); if (Object.keys(input).some(k=>['id','createdAt','updatedAt','history','key','actorId','passwordHash'].includes(k))) return json(res,400,{error:'Protected field in update'}); validate(collection,input,item); if (collection==='tickets' && input.status && input.status!==item.status) { if (!(transitions[item.status]||[]).includes(input.status)) return json(res,422,{error:`Invalid transition ${item.status} → ${input.status}`,allowed:transitions[item.status]||[]}); if (input.status==='Blocked' && !input.blockerReason) return json(res,422,{error:'blockerReason is required when blocking'}); if (input.status==='Close' && !item.closureEvidence) return json(res,422,{error:'closureEvidence is required before closure'}); if (input.status==='Reopened' && !input.reopenReason) return json(res,422,{error:'reopenReason is required'}); }
      const now=new Date().toISOString(); Object.assign(item,input,{updatedAt:now}); if(collection==='tickets'&&input.status&&input.status!==item.history.at(-1)?.status)item.history.push({status:input.status,at:now,actorId:user.id}); audit(data,user,collection.slice(0,-1),item.id,'updated',input); await save(data); return json(res,200,item); }
    if (req.method === 'DELETE') { if (collection==='audit') return json(res,405,{error:'Audit is append-only'}); if (user.role!=='Admin') return json(res,403,{error:'Admin required'}); list.splice(list.indexOf(item),1); audit(data,user,collection.slice(0,-1),item.id,'deleted'); await save(data); return json(res,204,{}); }
    return json(res,405,{error:'Method not allowed'});
  } catch (error) { return json(res,400,{error:error.message}); }
}
await load();
http.createServer(handler).listen(process.env.PORT || 3000, () => console.log(`CRM running on http://localhost:${process.env.PORT || 3000}`));
export { passwordHash };
