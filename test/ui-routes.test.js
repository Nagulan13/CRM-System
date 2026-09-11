import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('collection routes preserve Tickets and camelCase workflow names', () => {
  assert.match(appSource, /const collectionRoutes=\{/);
  for (const route of [
    "Tickets:'tickets'",
    "Clarifications:'clarifications'",
    "Approvals:'approvals'",
    "'QA cases':'qaCases'",
    "'QA results':'qaResults'",
    "'UAT records':'uatRecords'",
    "Releases:'releases'",
    "Deployments:'deployments'",
    "Comments:'comments'",
    "Notifications:'notifications'",
    "Meetings:'meetings'",
    "'Meeting actions':'actions'",
    "Reports:'reports'",
    "Departments:'departments'",
    "'Project memberships':'memberships'",
    "Users:'users'",
    "'Audit history':'audit'",
  ]) assert.ok(appSource.includes(route), `missing route mapping: ${route}`);
  assert.doesNotMatch(appSource, /item\?\.\[1\]\?\.toLowerCase\(\)/);
});

test('form routes are passed through without destructive lowercasing', () => {
  assert.match(appSource, /async function openForm\(c,item=null\)\{state\.formCollection=c;/);
  assert.doesNotMatch(appSource, /openForm\(c,item=null\)\{c=c\.toLowerCase\(\)/);
});
