import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger, runCall } from '../src/index.js';
import { httpDemo } from '../examples/http-worker.js';
test('the HTTP example verifies replay blocking and unknown-outcome recovery',async()=>{
  assert.equal((await httpDemo()).verified,true);
});
test('invalid provider usage leaves its call held for investigation',async t=>{
  const root=mkdtempSync(join(tmpdir(),'quotahold-worker-'));const ledger=Ledger.create(join(root,'usage.db'));
  t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
  ledger.configure('team',{capacity:100,periodSeconds:60,maxInflight:2,unit:'tokens'});
  await assert.rejects(runCall(ledger,'team',{key:'bad-usage',fingerprint:'a'.repeat(64),estimate:40},async()=>({value:'response',actual:NaN,receipt:'r-1'})),{code:'INPUT'});
  assert.equal(ledger.status('team').held,40);assert.equal(ledger.status('team').uncertain,1);
});
