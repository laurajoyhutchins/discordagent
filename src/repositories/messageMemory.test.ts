import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest'; import { openDatabase } from '../db/database.js'; import { runMigrations } from '../db/migrations.js';
import { createMessageRepository } from './messageRepository.js'; import { createMemoryRepository } from './memoryRepository.js';
const paths:string[]=[]; afterEach(()=>paths.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
function db(){const p=mkdtempSync(join(tmpdir(),'journal-'));paths.push(p);const d=openDatabase(join(p,'db.sqlite'));runMigrations(d);return d;}
describe('journal and memory',()=>{
 it('journals idempotently and retrieves with FTS',()=>{const d=db();const r=createMessageRepository(d);expect(r.append({id:'1',channelId:'c',authorId:'u',role:'user',content:'factory floor roadmap',createdAt:1})).toBe(true);expect(r.append({id:'1',channelId:'c',authorId:'u',role:'user',content:'duplicate',createdAt:2})).toBe(false);expect(r.search('factory',{channelId:'c'})).toHaveLength(1);d.close();});
 it('preserves read-only memory and revisions',()=>{const d=db();const r=createMemoryRepository(d);r.put({namespace:'policy',key:'auth',value:'owner only',sourceType:'system',confidence:1,readOnly:true});expect(()=>r.put({namespace:'policy',key:'auth',value:'everyone',sourceType:'direct_user',confidence:1,readOnly:false})).toThrow(/read-only/);d.close();});
});
