// Stream packets append weld points. HTTP command replies contain full traces.
// Sequence numbers order both channels so a late reply cannot rewind the scene.
export class WorkshopStateCache {
  constructor(){this.state=null;this.traces=new Map();this.retiredRuntimes=new Set();}
  accept(next){
    const previous=this.state;
    if(next.runtime_id&&this.retiredRuntimes.has(next.runtime_id))return null;
    const changed=previous?.runtime_id!==next.runtime_id||previous?.scene_id!==next.scene_id;
    // Validate the entire packet before publishing any trace or runtime changes.
    const traces=changed?new Map():new Map(this.traces);
    if(!changed&&next.sequence!=null&&previous?.sequence!=null&&next.sequence<=previous.sequence)return null;
    const wanted=new Set();
    for(const object of next.objects)for(const run of object.weld_runs||[]){
      const key=run.task_id,start=run.points_start??0,old=traces.get(key)||[];wanted.add(key);
      if(start>old.length)throw new Error('焊迹数据缺段，需要重新同步');
      if(start){run.points=run.points.length?old.slice(0,start).concat(run.points):old;}
      traces.set(key,run.points);delete run.points_start;
    }
    for(const key of traces.keys())if(!wanted.has(key))traces.delete(key);
    if(previous?.runtime_id&&previous.runtime_id!==next.runtime_id)this.retiredRuntimes.add(previous.runtime_id);
    this.traces=traces;this.state=next;return next;
  }
}
