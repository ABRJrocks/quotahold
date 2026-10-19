import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Ledger, QuotaError, decide } from '../src/index.js';
const fingerprint=createHash('sha256').update('public-example').digest('hex');
const policy={capacity:100,periodSeconds:60,maxInflight:3,unit:'tokens'};
function fixture(t, spec=policy) {
  const root=mkdtempSync(join(tmpdir(),'quotahold-test-'));let now=120;
  const path=join(root,'ledger.db');let ledger=Ledger.create(path,{clock:()=>now});
  ledger.configure('team',spec);
  t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
  return { get ledger(){return ledger;},path,root,setTime(value){now=value;},reopen(){ledger.close();ledger=new Ledger(path,{clock:()=>now});},
    reserve(key='job-1',estimate=40,ttlSeconds=60){return ledger.reserve('team',{key,fingerprint,estimate,ttlSeconds});}};
}
function code(expected) {return error=>error instanceof QuotaError && error.code===expected;}

test('held allowance is counted before any call starts',t=>{
  const f=fixture(t);const a=f.reserve('a',60);assert.equal(a.kind,'reserved');assert.equal(a.usage.available,40);
  const b=f.reserve('b',60);assert.equal(b.kind,'denied');assert.equal(b.reason,'units');
  assert.equal(f.ledger.list('team').length,1);assert.equal(f.ledger.events('team').at(-1).kind,'denied');
});
test('settlement frees unused units and records actual usage',t=>{
  const f=fixture(t);const h=f.reserve().reservation;f.ledger.start('team',h.id);
  f.ledger.settle('team',h.id,{actual:25,receipt:'provider-1'});
  const s=f.ledger.status('team');assert.equal(s.spent,25);assert.equal(s.held,0);assert.equal(s.available,75);assert.equal(s.inflight,0);
});
test('replayed keys cannot issue a second start permission',t=>{
  const f=fixture(t);const a=f.reserve();assert.equal(f.reserve().kind,'replay');
  f.ledger.start('team',a.reservation.id);assert.throws(()=>f.ledger.start('team',a.reservation.id),code('STATE'));
  assert.throws(()=>f.reserve('job-1',41),code('CONFLICT'));assert.throws(()=>f.reserve('job-1',40,1),code('CONFLICT'));
  assert.throws(()=>f.ledger.reserve('team',{key:'job-1',fingerprint:'b'.repeat(64),estimate:40}),code('CONFLICT'));
});
test('only unstarted reservations expire, exactly at the start deadline',t=>{
  const f=fixture(t);const a=f.reserve('a',40,10).reservation,b=f.reserve('b',40,10).reservation;
  f.ledger.start('team',b.id);f.setTime(129);assert.equal(f.ledger.status('team').held,80);
  f.setTime(130);assert.throws(()=>f.ledger.start('team',a.id),code('STATE'));
  assert.equal(f.ledger.status('team').held,40);assert.equal(f.ledger.list('team').find(h=>h.id===a.id).state,'expired');
  f.setTime(900);assert.equal(f.ledger.status('team').held,40);
});
test('unknown calls retain both allowance and concurrency until reconciliation',t=>{
  const f=fixture(t,{...policy,maxInflight:1});const h=f.reserve().reservation;
  f.ledger.start('team',h.id);f.ledger.uncertain('team',h.id);f.ledger.uncertain('team',h.id);f.setTime(10000);
  assert.equal(f.reserve('next').reason,'concurrency');assert.equal(f.ledger.status('team').uncertain,1);
  assert.throws(()=>f.ledger.cancel('team',h.id),code('STATE'));
  assert.throws(()=>f.ledger.settle('team',h.id,{actual:20,receipt:'r-1'}),code('INPUT'));
  f.ledger.settle('team',h.id,{actual:20,receipt:'r-1',note:'Usage confirmed in provider logs'});
  assert.equal(f.reserve('next').kind,'reserved');
});
test('crashed started calls survive reopening and period rollover',t=>{
  const f=fixture(t);const h=f.reserve('a',80).reservation;f.ledger.start('team',h.id);f.reopen();f.setTime(181);
  assert.equal(f.ledger.status('team').available,20);assert.equal(f.reserve('b',21).reason,'units');
  f.ledger.settle('team',h.id,{actual:70,receipt:'r-1'});
  assert.equal(f.ledger.status('team').spent,0);assert.equal(f.ledger.status('team').available,100);
  assert.equal(f.ledger.list('team')[0].windowStart,120);
});
test('underestimates record overage instead of hiding actual usage',t=>{
  const f=fixture(t);const h=f.reserve().reservation;f.ledger.start('team',h.id);f.ledger.settle('team',h.id,{actual:130,receipt:'r-1'});
  const s=f.ledger.status('team');assert.equal(s.spent,130);assert.equal(s.overage,30);assert.equal(s.available,0);assert.equal(f.reserve('b',1).kind,'denied');
  assert.equal(f.ledger.events('team').at(-2).reason,'underestimated');
});
test('settlement retries require identical actual usage, receipt and note',t=>{
  const f=fixture(t);const h=f.reserve().reservation;f.ledger.start('team',h.id);
  const input={actual:20,receipt:'r-1'};const a=f.ledger.settle('team',h.id,input);
  assert.deepEqual(f.ledger.settle('team',h.id,input),a);assert.equal(f.ledger.events('team').filter(e=>e.kind==='settled').length,1);
  assert.throws(()=>f.ledger.settle('team',h.id,{actual:21,receipt:'r-1'}),code('CONFLICT'));
  const b=f.reserve('b').reservation;f.ledger.start('team',b.id);assert.throws(()=>f.ledger.settle('team',b.id,input),code('CONFLICT'));
});
test('cancellation is limited to unstarted calls and keys remain retained',t=>{
  const f=fixture(t);const h=f.reserve().reservation;f.ledger.cancel('team',h.id);f.ledger.cancel('team',h.id);
  assert.equal(f.ledger.status('team').held,0);assert.equal(f.reserve().kind,'replay');assert.throws(()=>f.ledger.start('team',h.id),code('STATE'));
});
test('scopes isolate usage, receipts and request keys',t=>{
  const f=fixture(t);f.ledger.configure('other',policy);const h=f.reserve().reservation;
  const b=f.ledger.reserve('other',{key:'job-1',fingerprint,estimate:40}).reservation;
  assert.notEqual(h.id,b.id);assert.equal(f.ledger.status('other').held,40);
  assert.throws(()=>f.ledger.start('other',h.id),code('NOT_FOUND'));
});
test('policies are immutable and duplicate configuration is idempotent',t=>{
  const f=fixture(t);assert.deepEqual(f.ledger.configure('team',policy),policy);
  assert.throws(()=>f.ledger.configure('team',{...policy,capacity:200}),code('CONFLICT'));
});
test('backward host clocks fail closed across connections',t=>{
  const f=fixture(t);f.reserve();f.setTime(119);assert.throws(()=>f.ledger.status('team'),code('CLOCK'));
  f.setTime(120);assert.equal(f.ledger.status('team').held,40);
});
test('invalid units, policies, fingerprints and cursor inputs reject without writes',t=>{
  const f=fixture(t);
  for(const estimate of [0,-1,1.2,NaN,Infinity,true,'4',1e10])assert.throws(()=>f.reserve('a',estimate),code('INPUT'));
  for(const spec of [{...policy,maxInflight:0},{...policy,capacity:true},{...policy,periodSeconds:1},{...policy,extra:1}])assert.throws(()=>f.ledger.configure('invalid',spec),code('INPUT'));
  assert.throws(()=>f.ledger.reserve('team',{key:'a',fingerprint:'no',estimate:1}),code('INPUT'));
  assert.throws(()=>f.ledger.list('team',{limit:1001}),code('INPUT'));
  assert.equal(f.ledger.list('team').length,0);
});
test('file creation is exclusive and reopening a missing file cannot create it',t=>{
  const f=fixture(t);assert.throws(()=>Ledger.create(f.path));const missing=join(f.root,'typo.db');assert.throws(()=>new Ledger(missing));assert.equal(existsSync(missing),false);
  assert.throws(()=>Ledger.create(':memory:'),code('INPUT'));
});
test('event cursor and reservation cursor return bounded pages',t=>{
  const f=fixture(t);f.reserve('a',10);f.reserve('b',10);const page=f.ledger.list('team',{limit:1});
  assert.equal(f.ledger.list('team',{after:page[0].id}).length,1);
  const events=f.ledger.events('team',{limit:2});assert.equal(f.ledger.events('team',{after:events[1].seq}).length,1);
});
test('policy arithmetic reports independent quota and concurrency constraints',()=>{
  assert.equal(decide(policy,{spent:20,held:40,inflight:2},40).allowed,true);
  assert.equal(decide(policy,{spent:20,held:40,inflight:3},1).reason,'concurrency');
  assert.equal(decide(policy,{spent:20,held:40,inflight:2},41).reason,'units');
});
