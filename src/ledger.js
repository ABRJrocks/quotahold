import * as sqlite from 'node:sqlite';
import { openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { availability, decide, identifier, integer, requireValue, validatePolicy, windowStart } from './policy.js';

const Database = sqlite.Database ?? sqlite.DatabaseSync;
const active = "('reserved','started','uncertain')";
const schema = `
CREATE TABLE meta(version INTEGER NOT NULL, last_time INTEGER NOT NULL);
INSERT INTO meta VALUES(1,0);
CREATE TABLE policies(scope TEXT PRIMARY KEY,capacity INTEGER NOT NULL,period_seconds INTEGER NOT NULL,max_inflight INTEGER NOT NULL,unit TEXT NOT NULL) STRICT;
CREATE TABLE reservations(
 id TEXT PRIMARY KEY,scope TEXT NOT NULL REFERENCES policies(scope),request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,
 estimate INTEGER NOT NULL,window_start INTEGER NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,ttl_seconds INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('reserved','started','uncertain','settled','cancelled','expired')),
 actual INTEGER,receipt TEXT,note TEXT,updated_at INTEGER NOT NULL,UNIQUE(scope,request_key)
) STRICT;
CREATE INDEX active_scope ON reservations(scope,state);
CREATE INDEX settled_window ON reservations(scope,window_start,state);
CREATE UNIQUE INDEX unique_receipt ON reservations(scope,receipt) WHERE receipt IS NOT NULL;
CREATE TABLE events(seq INTEGER PRIMARY KEY,at INTEGER NOT NULL,scope TEXT NOT NULL,reservation_id TEXT,kind TEXT NOT NULL,units INTEGER,reason TEXT) STRICT;
CREATE INDEX scope_events ON events(scope,seq);
`;
function policyRow(row) {
  return {capacity:row.capacity,periodSeconds:row.period_seconds,maxInflight:row.max_inflight,unit:row.unit};
}
function reservationRow(row) {
  return {id:row.id,scope:row.scope,key:row.request_key,fingerprint:row.fingerprint,estimate:row.estimate,
    windowStart:row.window_start,createdAt:row.created_at,expiresAt:row.expires_at,ttlSeconds:row.ttl_seconds,
    state:row.state,actual:row.actual,receipt:row.receipt,note:row.note,updatedAt:row.updated_at};
}

export class Ledger {
  #db; #clock;
  constructor(path, {clock = () => Math.floor(Date.now()/1000)} = {}) {
    requireValue(typeof clock === 'function','INPUT','Clock must be a function');
    this.#clock=clock;
    requireValue(typeof path==='string' && path.length>0 && path!==':memory:','INPUT','A durable local database path is required');
    if(path !== ':memory:') { const fd=openSync(resolve(path),'r+'); closeSync(fd); }
    this.#db=new Database(path === ':memory:' ? path : resolve(path),{timeout:5000,enableForeignKeyConstraints:true,allowExtension:false});
    try {
      const row=this.#db.prepare('SELECT version,last_time FROM meta').get();
      requireValue(row?.version===1,'SCHEMA','Unsupported QuotaHold schema');
      this.#configure();
    } catch(error) {this.#db.close(); throw error;}
  }
  static create(path, options = {}) {
    requireValue(typeof path === 'string' && path.length > 0 && path !== ':memory:','INPUT','Database path is required');
    if(path !== ':memory:') { const fd=openSync(resolve(path),'wx',0o600); closeSync(fd); }
    const db=new Database(path === ':memory:' ? path : resolve(path),{timeout:5000});
    try { db.exec('BEGIN IMMEDIATE'); db.exec(schema); db.exec('COMMIT'); }
    catch(error) {if(db.isTransaction) db.exec('ROLLBACK'); db.close();throw error;}
    db.close(); return new Ledger(path,options);
  }
  #configure() {
    this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
    requireValue(this.#db.prepare('PRAGMA journal_mode').get().journal_mode==='delete','CONFIG','Only DELETE journaling on local disk is supported');
  }
  close() {this.#db.close();}
  #transaction(scope, operation) {
    identifier(scope,'Scope');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const now=integer(this.#clock(),'Clock seconds',0,253_402_300_799);
      const last=this.#db.prepare('SELECT last_time FROM meta').get().last_time;
      requireValue(now>=last,'CLOCK','Clock moved backwards; repair the host clock before admitting work');
      this.#db.prepare('UPDATE meta SET last_time=?').run(now);
      const row=this.#db.prepare('SELECT * FROM policies WHERE scope=?').get(scope);
      const policy=row ? policyRow(row) : null;
      if(policy) this.#expire(scope,now);
      const result=operation(now,policy);
      this.#db.exec('COMMIT'); return result;
    } catch(error) {if(this.#db.isTransaction)this.#db.exec('ROLLBACK');throw error;}
  }
  #event(now,scope,id,kind,units=null,reason=null) {
    this.#db.prepare('INSERT INTO events(at,scope,reservation_id,kind,units,reason) VALUES(?,?,?,?,?,?)').run(now,scope,id,kind,units,reason);
  }
  #expire(scope,now) {
    const rows=this.#db.prepare("SELECT id,estimate FROM reservations WHERE scope=? AND state='reserved' AND expires_at<=?").all(scope,now);
    this.#db.prepare("UPDATE reservations SET state='expired',updated_at=? WHERE scope=? AND state='reserved' AND expires_at<=?").run(now,scope,now);
    for(const row of rows)this.#event(now,scope,row.id,'expired',row.estimate);
  }
  #usage(scope,policy,now) {
    requireValue(policy,'NOT_FOUND','Policy does not exist');
    const period=windowStart(now,policy.periodSeconds);
    const spent=this.#db.prepare("SELECT COALESCE(SUM(actual),0) AS spent FROM reservations WHERE scope=? AND state='settled' AND window_start=?").get(scope,period).spent;
    const row=this.#db.prepare(`SELECT COALESCE(SUM(estimate),0) AS held,COUNT(*) AS inflight,
      COALESCE(SUM(CASE WHEN state='uncertain' THEN 1 ELSE 0 END),0) AS uncertain
      FROM reservations WHERE scope=? AND state IN ${active}`).get(scope);
    row.spent=spent;
    return {...availability(policy,row),scope,unit:policy.unit,windowStart:period,windowEnd:period+policy.periodSeconds,now};
  }
  configure(scope, specification) {
    const desired=validatePolicy(specification);
    return this.#transaction(scope,(now,existing)=>{
      if(existing) {
        requireValue(JSON.stringify(existing)===JSON.stringify(desired),'CONFLICT','Policy is immutable; use a new scope for a different policy');return existing;
      }
      this.#db.prepare('INSERT INTO policies VALUES(?,?,?,?,?)').run(scope,desired.capacity,desired.periodSeconds,desired.maxInflight,desired.unit);
      this.#event(now,scope,null,'configured'); return desired;
    });
  }
  reserve(scope,{key,fingerprint,estimate,ttlSeconds=60}) {
    identifier(key,'Request key');
    requireValue(typeof fingerprint==='string' && /^[a-f0-9]{64}$/.test(fingerprint),'INPUT','Fingerprint must be a lowercase SHA256 hex digest');
    integer(estimate,'Estimated units',1);integer(ttlSeconds,'Start deadline seconds',1,3600);
    return this.#transaction(scope,(now,policy)=>{
      requireValue(policy,'NOT_FOUND','Policy does not exist');
      const found=this.#db.prepare('SELECT * FROM reservations WHERE scope=? AND request_key=?').get(scope,key);
      if(found) {
        requireValue(found.fingerprint===fingerprint && found.estimate===estimate && found.ttl_seconds===ttlSeconds,'CONFLICT','Request key was already used with different reservation inputs');
        return {kind:'replay',reservation:reservationRow(found),usage:this.#usage(scope,policy,now)};
      }
      const check=decide(policy,this.#usage(scope,policy,now),estimate);
      if(!check.allowed) {this.#event(now,scope,null,'denied',estimate,check.reason);return {kind:'denied',reason:check.reason,usage:this.#usage(scope,policy,now)};}
      const id=randomUUID();
      this.#db.prepare("INSERT INTO reservations(id,scope,request_key,fingerprint,estimate,window_start,created_at,expires_at,ttl_seconds,state,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'reserved',?)").run(id,scope,key,fingerprint,estimate,windowStart(now,policy.periodSeconds),now,now+ttlSeconds,ttlSeconds,now);
      this.#event(now,scope,id,'reserved',estimate);
      return {kind:'reserved',reservation:this.#get(scope,id),usage:this.#usage(scope,policy,now)};
    });
  }
  #get(scope,id) {
    const row=this.#db.prepare('SELECT * FROM reservations WHERE scope=? AND id=?').get(scope,id);
    requireValue(row,'NOT_FOUND','Reservation does not exist in this scope');return reservationRow(row);
  }
  #change(scope,id,operation) {
    identifier(id,'Reservation ID');
    return this.#transaction(scope,(now,policy)=>{requireValue(policy,'NOT_FOUND','Policy does not exist');return operation(this.#get(scope,id),now,policy);});
  }
  start(scope,id) {
    return this.#change(scope,id,(hold,now)=>{
      requireValue(hold.state==='reserved','STATE','Only an unstarted, unexpired reservation can start; do not repeat the external call');
      this.#db.prepare("UPDATE reservations SET state='started',updated_at=? WHERE id=?").run(now,id);
      this.#event(now,scope,id,'started');return this.#get(scope,id);
    });
  }
  uncertain(scope,id) {
    return this.#change(scope,id,(hold,now)=>{
      if(hold.state==='uncertain')return hold;
      requireValue(hold.state==='started','STATE','Only a started call can become uncertain');
      this.#db.prepare("UPDATE reservations SET state='uncertain',updated_at=? WHERE id=?").run(now,id);
      this.#event(now,scope,id,'uncertain');return this.#get(scope,id);
    });
  }
  cancel(scope,id) {
    return this.#change(scope,id,(hold,now)=>{
      if(hold.state==='cancelled')return hold;
      requireValue(hold.state==='reserved','STATE','Only an unstarted reservation can be cancelled; reconcile started calls with actual usage');
      this.#db.prepare("UPDATE reservations SET state='cancelled',updated_at=? WHERE id=?").run(now,id);
      this.#event(now,scope,id,'cancelled',hold.estimate);return this.#get(scope,id);
    });
  }
  settle(scope,id,{actual,receipt,note=''}) {
    integer(actual,'Actual units');identifier(receipt,'Receipt');
    requireValue(typeof note==='string' && note.length<=256 && !/[\x00-\x1f\x7f]/.test(note),'INPUT','Note must be up to 256 printable characters');
    return this.#change(scope,id,(hold,now)=>{
      if(hold.state==='settled') {requireValue(hold.actual===actual && hold.receipt===receipt && hold.note===note,'CONFLICT','Settlement conflicts with the recorded receipt');return hold;}
      requireValue(hold.state==='started'||hold.state==='uncertain','STATE','Only started or uncertain calls can settle');
      requireValue(!this.#db.prepare('SELECT id FROM reservations WHERE scope=? AND receipt=?').get(scope,receipt),'CONFLICT','Receipt is already assigned to another reservation');
      if(hold.state==='uncertain')requireValue(note.trim(),'INPUT','Reconciling an uncertain call requires a note');
      this.#db.prepare("UPDATE reservations SET state='settled',actual=?,receipt=?,note=?,updated_at=? WHERE id=?").run(actual,receipt,note,now,id);
      this.#event(now,scope,id,'settled',actual,actual>hold.estimate?'underestimated':null);return this.#get(scope,id);
    });
  }
  status(scope) {return this.#transaction(scope,(now,policy)=>this.#usage(scope,policy,now));}
  list(scope,{after='',limit=100}={}) {
    integer(limit,'List limit',1,1000);if(after)identifier(after,'Cursor');
    return this.#transaction(scope,(_now,policy)=>{
      requireValue(policy,'NOT_FOUND','Policy does not exist');
      return this.#db.prepare('SELECT * FROM reservations WHERE scope=? AND id>? ORDER BY id LIMIT ?').all(scope,after,limit).map(reservationRow);
    });
  }
  events(scope,{after=0,limit=100}={}) {
    integer(after,'Event cursor',0,Number.MAX_SAFE_INTEGER);integer(limit,'Event limit',1,1000);
    return this.#transaction(scope,(_now,policy)=>{requireValue(policy,'NOT_FOUND','Policy does not exist');return this.#db.prepare('SELECT seq,at,reservation_id AS reservationId,kind,units,reason FROM events WHERE scope=? AND seq>? ORDER BY seq LIMIT ?').all(scope,after,limit).map(row=>({...row}));});
  }
}
