import { randomUUID } from 'node:crypto';
import type { AgentProviderId } from '../agents/contracts.js';
import type { DatabaseHandle } from '../db/database.js';
import { redactSensitiveValue } from '../utils/redaction.js';
export type EstimateConfidence = 'low'|'medium'|'high';
export interface UsageSnapshot { provider: AgentProviderId; windowType: string; utilization?: number; remaining?: number; resetsAt?: number; capturedAt: number; payload?: unknown; }
export interface UsageReservation { id:string; taskId?:string; provider:AgentProviderId; taskClass:string; low:number; high:number; confidence:EstimateConfidence; status:'active'|'released'|'consumed'; actualCost?:number; createdAt:number; releasedAt?:number; }
export interface UsageObservation { provider:AgentProviderId; taskClass:string; actualCost:number; tokenCount?:number; durationMs?:number; recordedAt:number; }
export interface UsageRepository {
  recordSnapshot(snapshot: UsageSnapshot): void; latestSnapshots(provider: AgentProviderId): UsageSnapshot[];
  createHold(input:{provider:AgentProviderId;taskClass:string;low:number;high:number;confidence:EstimateConfidence}):UsageReservation;
  attachTask(id:string,taskId:string):void; finish(id:string,status:'released'|'consumed',actualCost?:number):void;
  activeReservations(provider?:AgentProviderId):UsageReservation[]; reservationForTask(taskId:string):UsageReservation|undefined;
  recordObservation(observation:UsageObservation):void; observations(provider:AgentProviderId,taskClass:string,limit?:number):UsageObservation[];
}
function mapReservation(row:any):UsageReservation{return{id:row.id,...(row.task_id?{taskId:row.task_id}:{}),provider:row.provider,taskClass:row.task_class,low:row.estimated_low,high:row.estimated_high,confidence:row.confidence,status:row.status,...(row.actual_cost==null?{}:{actualCost:row.actual_cost}),createdAt:row.created_at,...(row.released_at==null?{}:{releasedAt:row.released_at})};}
export function createUsageRepository(db:DatabaseHandle):UsageRepository{return{
 recordSnapshot(s){db.raw.prepare(`INSERT INTO usage_snapshots(provider,window_type,utilization,remaining,resets_at,payload_json,captured_at) VALUES(?,?,?,?,?,?,?)`).run(s.provider,s.windowType,s.utilization??null,s.remaining??null,s.resetsAt??null,JSON.stringify(redactSensitiveValue(s.payload??{})),s.capturedAt);},
 latestSnapshots(provider){const rows=db.raw.prepare(`SELECT u.* FROM usage_snapshots u JOIN (SELECT window_type,MAX(captured_at) t FROM usage_snapshots WHERE provider=? GROUP BY window_type) x ON x.window_type=u.window_type AND x.t=u.captured_at WHERE u.provider=?`).all(provider,provider) as any[];return rows.map(r=>({provider:r.provider,windowType:r.window_type,...(r.utilization==null?{}:{utilization:r.utilization}),...(r.remaining==null?{}:{remaining:r.remaining}),...(r.resets_at==null?{}:{resetsAt:r.resets_at}),capturedAt:r.captured_at,payload:JSON.parse(r.payload_json)}));},
 createHold(input){const id=randomUUID(),now=Date.now();db.raw.prepare(`INSERT INTO usage_reservations(id,task_id,provider,task_class,estimated_low,estimated_high,confidence,status,created_at) VALUES(?,NULL,?,?,?,?,?,'active',?)`).run(id,input.provider,input.taskClass,input.low,input.high,input.confidence,now);return mapReservation(db.raw.prepare('SELECT * FROM usage_reservations WHERE id=?').get(id));},
 attachTask(id,taskId){const r=db.raw.prepare(`UPDATE usage_reservations SET task_id=? WHERE id=? AND status='active' AND task_id IS NULL`).run(taskId,id);if(r.changes!==1)throw new Error('Active pre-task usage hold not found');},
 finish(id,status,actualCost){const r=db.raw.prepare(`UPDATE usage_reservations SET status=?,actual_cost=?,released_at=? WHERE id=? AND status='active'`).run(status,actualCost??null,Date.now(),id);if(r.changes!==1)throw new Error('Active usage reservation not found');},
 activeReservations(provider){const rows=(provider?db.raw.prepare(`SELECT * FROM usage_reservations WHERE status='active' AND provider=?`).all(provider):db.raw.prepare(`SELECT * FROM usage_reservations WHERE status='active'`).all()) as any[];return rows.map(mapReservation);},
 reservationForTask(taskId){const row=db.raw.prepare(`SELECT * FROM usage_reservations WHERE task_id=? ORDER BY created_at DESC LIMIT 1`).get(taskId);return row?mapReservation(row):undefined;},
 recordObservation(o){db.raw.prepare(`INSERT INTO usage_observations(provider,task_class,actual_cost,token_count,duration_ms,recorded_at) VALUES(?,?,?,?,?,?)`).run(o.provider,o.taskClass,o.actualCost,o.tokenCount??null,o.durationMs??null,o.recordedAt);},
 observations(provider,taskClass,limit=50){return(db.raw.prepare(`SELECT * FROM usage_observations WHERE provider=? AND task_class=? ORDER BY recorded_at DESC LIMIT ?`).all(provider,taskClass,limit) as any[]).map(r=>({provider:r.provider,taskClass:r.task_class,actualCost:r.actual_cost,...(r.token_count==null?{}:{tokenCount:r.token_count}),...(r.duration_ms==null?{}:{durationMs:r.duration_ms}),recordedAt:r.recorded_at}));},
};}

