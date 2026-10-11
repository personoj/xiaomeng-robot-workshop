import * as T from 'three';

const quaternion=(q)=>new T.Quaternion(q[1],q[2],q[3],q[0]);
const unit=new T.Vector3(1,1,1);

// MuJoCo body/joint transforms, rather than interpolating each mesh in world
// space. Adjacent links keep their common joint and fixed local dimensions.
export class PhysicsPose {
  constructor(root,{bodies}){
    this.specs=bodies;this.nodes=bodies.map(()=>new T.Group());
    this.matrix=new T.Matrix4();this.move=new T.Matrix4();this.rotation=new T.Quaternion();this.vector=new T.Vector3();
    for(const b of bodies){const node=this.nodes[b.id];node.matrixAutoUpdate=false;(b.id===0?root:this.nodes[b.parent]).add(node);}
  }
  apply(frame){
    const q=frame.qpos;
    for(const b of this.specs){
      const node=this.nodes[b.id],free=b.joints.find(j=>j.type===0);
      if(b.mocap>=0){node.matrix.compose(this.vector.fromArray(frame.mocap_pos[b.mocap]),quaternion(frame.mocap_quat[b.mocap]),unit);}
      else if(free){const a=free.address;node.matrix.compose(this.vector.fromArray(q,a),quaternion(q.slice(a+3,a+7)),unit);}
      else{
        node.matrix.compose(this.vector.fromArray(b.position),quaternion(b.quaternion),unit);
        for(const j of b.joints){
          const a=j.address;
          if(j.type===2){this.vector.fromArray(j.axis).multiplyScalar(q[a]-j.reference);node.matrix.multiply(this.move.makeTranslation(this.vector.x,this.vector.y,this.vector.z));}
          else{
            const p=j.position;
            node.matrix.multiply(this.move.makeTranslation(...p));
            if(j.type===1)this.rotation.copy(quaternion(q.slice(a,a+4)));
            else this.rotation.setFromAxisAngle(this.vector.fromArray(j.axis),q[a]-j.reference);
            node.matrix.multiply(this.matrix.makeRotationFromQuaternion(this.rotation));
            node.matrix.multiply(this.move.makeTranslation(-p[0],-p[1],-p[2]));
          }
        }
      }
      node.matrixWorldNeedsUpdate=true;
    }
  }
  attach(mesh,item){mesh.position.fromArray(item.position);mesh.quaternion.copy(quaternion(item.quaternion));this.nodes[item.body].add(mesh);}
}

export class PoseTimeline {
  constructor(kinematics,delay=.07){this.joints=kinematics.bodies.flatMap(b=>b.joints);this.delay=delay;this.frames=[];this.arrival=0;}
  push(frame,moving,now=performance.now()){
    const last=this.frames.at(-1);
    if(!moving||!last||frame.time<last.time){this.frames=[frame];this.arrival=now;return;}
    if(frame.time===last.time){this.frames[this.frames.length-1]=frame;return;}
    this.frames.push(frame);if(this.frames.length>12)this.frames.shift();this.arrival=now;
  }
  sample(now=performance.now()){
    const latest=this.frames.at(-1);if(!latest)return null;
    if(this.frames.length===1)return latest;
    const time=Math.min(latest.time,latest.time+(now-this.arrival)/1000-this.delay);
    let i=1;while(i<this.frames.length-1&&this.frames[i].time<time)i++;
    const a=this.frames[i-1],b=this.frames[i],t=T.MathUtils.clamp((time-a.time)/(b.time-a.time),0,1);
    if(t===1)return b;
    const q=a.qpos.map((v,n)=>T.MathUtils.lerp(v,b.qpos[n],t));
    for(const j of this.joints){if(j.type!==0&&j.type!==1)continue;
      const index=j.address+(j.type===0?3:0),r=quaternion(a.qpos.slice(index,index+4)).slerp(quaternion(b.qpos.slice(index,index+4)),t);
      q.splice(index,4,r.w,r.x,r.y,r.z);
    }
    return {...b,time,qpos:q};
  }
  pending(now=performance.now()){return this.frames.length>1&&(now-this.arrival)<this.delay*1000;}
}
