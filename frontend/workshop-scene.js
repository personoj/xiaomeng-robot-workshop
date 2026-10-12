import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FontLoader} from 'three/addons/loaders/FontLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RobotScene} from './robot-scene.js';
import {createPipePanel,appendPanelWeldContact} from './tube-panel-model.js';
import {createXiaomengH,ASSET_ROOT} from './welding-model.js';
import {createWeldingEffects} from './welding-effects.js';
import {rollWheels} from './workshop-layout.js';
import {CameraTransition} from './camera-transition.js';

export const WORKCELL_OFFSET=new T.Vector3(-2.6,-.35,.88);
const material=(color,roughness=.7,metalness=.08)=>new T.MeshStandardMaterial({color,roughness,metalness});
const box=(parent,name,size,position,mat)=>{const m=new T.Mesh(new T.BoxGeometry(...size),mat);m.name=name;m.position.set(...position);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};

export class WorkshopScene extends RobotScene{
  constructor(container,options={}){
    super(container,{...options,label:'持续机器人工作坊，可拖动旋转与滚轮缩放'});
    this.assets=new Map();this.labels=new Map();this.pending=new Set();this.generation=0;this.thumbnails=new Map();this.hoveredId=null;
    this.rigs=new Map();this.traceOffsets=new Map();this.weldFX=createWeldingEffects({scene:this.scene});
    this.fxTime=performance.now();this.fxTimer=setInterval(()=>this.animateWeld(),33);
    this.robot.position.copy(WORKCELL_OFFSET);
    this.camera.far=100;this.camera.updateProjectionMatrix();this.controls.maxDistance=23;this.controls.minDistance=.5;
    this.scene.background=new T.Color('#eff2f6');
    const pmrem=new T.PMREMGenerator(this.renderer);this.environment=pmrem.fromScene(new RoomEnvironment(),.035).texture;pmrem.dispose();
    this.scene.environment=this.environment;this.scene.environmentIntensity=.52;
    this.scene.traverse(o=>{if(o.isDirectionalLight&&o.castShadow){o.position.set(-3,-5,9);o.shadow.mapSize.set(2048,2048);Object.assign(o.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:30});}});
    this.stage=new T.Group();this.stage.name='persistent-workshop-room';this.scene.add(this.stage);
    const floor=box(this.stage,'workshop-floor',[24,12,.08],[5,0,-.042],material('#e9edf2',.9));floor.castShadow=false;
    const grid=new T.GridHelper(24,48,'#cbd4df','#dfe5ed');grid.rotation.x=Math.PI/2;grid.position.set(5,0,.003);grid.material.transparent=true;grid.material.opacity=.5;this.stage.add(grid);
    box(this.stage,'back-wall',[24,.13,2.7],[5,3.9,1.35],material('#dde3ed'));
    box(this.stage,'wall-base',[24,.16,.12],[5,3.8,.06],material('#b7c2d1'));
    for(const x of [-5,-1,3,7,11,15]){
      box(this.stage,'wall-column',[.10,.20,2.7],[x,3.78,1.35],material('#c8d2de'));
      box(this.stage,'window',[2.1,.04,1.03],[x+1.4,3.805,1.86],material('#edf4fa',.35));
    }
    this.zone([-2.25,-.30],[2.4,2.0],'#b8c6dd');this.zone([1.15,.15],[3.6,3.2],'#c5c1ee');
    // MuJoCo tabletop: 1.10 x .86 m, centred at (-2.28,-.35), underside .83.
    // Four hollow-section rails sit flush underneath, inset from the cut edge.
    const benchSteel=material('#647481',.46,.62),feet=material('#30383c',.88,.04);
    for(const x of [-2.775,-1.785])for(const y of [-.725,.025]){
      box(this.stage,'workbench-leg',[.05,.05,.755],[x,y,.3925],benchSteel);
      box(this.stage,'levelling-foot',[.066,.066,.015],[x,y,.0075],feet);
    }
    for(const y of [-.73,.03])box(this.stage,'workbench-long-rail',[1.04,.04,.07],[-2.28,y,.795],benchSteel);
    for(const x of [-2.78,-1.78])box(this.stage,'workbench-end-rail',[.04,.72,.07],[x,-.35,.795],benchSteel);
    box(this.stage,'workbench-lower-brace',[.99,.032,.045],[-2.28,.025,.24],benchSteel);
    this.loader=new GLTFLoader();
    this.raycaster=new T.Raycaster();this.pointer=new T.Vector2();
    this.pointerMove=event=>{
      const now=performance.now();if(now-(this.lastHoverTime||0)<65)return;this.lastHoverTime=now;
      const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
      const roots=[this.robot,...this.assets.values()].filter(node=>this.raycaster.ray.intersectsBox(new T.Box3().setFromObject(node)));
      const hit=this.raycaster.intersectObjects(roots,true)[0];let node=hit?.object,id=null;
      while(node&&!id){id=node.userData.workshopId;node=node.parent;}this.hoveredId=id;this.requestRender();
    };
    this.pointerLeave=()=>{this.hoveredId=null;this.requestRender();};
    this.renderer.domElement.addEventListener('pointermove',this.pointerMove);this.renderer.domElement.addEventListener('pointerleave',this.pointerLeave);
    this.cameraHome();
    this.setupCameraTransitions();
  }
  zone([x,y],[w,h],color){
    const m=material(color);for(const [size,p] of [[[w,.025,.005],[x,y-h/2,.006]],[[w,.025,.005],[x,y+h/2,.006]],[[.025,h,.005],[x-w/2,y,.006]],[[.025,h,.005],[x+w/2,y,.006]]])box(this.stage,'floor-zone',size,p,m);
  }
  setupCameraTransitions(){
    this.cameraMotion=new CameraTransition();
    this.cameraMotionPreference=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.onCameraInteraction=()=>{this.cameraInteracting=true;this.cameraMotion.cancel();this.cameraHomeAspect=null;};
    this.onCameraInteractionEnd=()=>{this.cameraInteracting=false;};
    this.onCameraMotionPreference=()=>{
      if(!this.cameraMotionPreference.matches||this.disposed)return;
      const pose=this.cameraMotion.finish();this.cameraHomeAspect=null;
      if(pose){this.writeCameraPose(pose);this.requestRender();}
    };
    this.controls.addEventListener('start',this.onCameraInteraction);
    this.controls.addEventListener('end',this.onCameraInteractionEnd);
    this.cameraMotionPreference?.addEventListener('change',this.onCameraMotionPreference);
  }
  writeCameraPose(pose){
    this.controls.target.fromArray(pose.target);this.camera.position.fromArray(pose.position);
    this.controls.update();
  }
  moveCameraTo(pose,{animate=true,home=false}={}){
    if(this.disposed||this.cameraInteracting)return;
    const from={position:this.camera.position.toArray(),target:this.controls.target.toArray()};
    // Flush orbit inertia through its public API, then restore the displayed pose.
    // No intermediate pose is rendered and manual controls stay enabled throughout.
    const damping=this.controls.enableDamping;
    this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damping;
    const immediate=!animate||!this.cameraMotion||!!this.cameraMotionPreference?.matches;
    this.writeCameraPose(this.cameraMotion?.start(from,pose,performance.now(),{immediate})||pose);
    this.cameraHomeAspect=home&&this.cameraMotion?.active?this.camera.aspect:null;
    this.requestRender();
  }
  cameraHome({animate=false}={}){
    if(this.disposed)return;
    const right=Math.max(5.5,...(this.latestObjects||[]).map(o=>o.position[0]+(o.kind==='panel'?1.2:o.kind==='welder'?1.5:0)));
    const centre=new T.Vector3((right-3.1)/2,.15,1.15),direction=new T.Vector3(-.4,-1,.65).normalize();
    // Compute the overview without temporarily moving the live camera. This also
    // runs during RobotScene's constructor, before the coordinator is installed.
    const orientation=new T.Matrix4().lookAt(centre.clone().addScaledVector(direction,20),centre,this.camera.up);
    const inverse=new T.Quaternion().setFromRotationMatrix(orientation).invert(),tan=Math.tan(this.camera.fov*Math.PI/360);let distance=0;
    for(const x of [-3.1,right])for(const y of [-2.5,2.75])for(const z of [0,2.6]){
      const p=new T.Vector3(x,y,z).sub(centre).applyQuaternion(inverse);
      distance=Math.max(distance,p.z+Math.abs(p.x)/(tan*this.camera.aspect*.90),p.z+Math.abs(p.y)/(tan*.90));
    }
    this.controls.maxDistance=50;
    this.moveCameraTo({target:centre.toArray(),position:centre.clone().addScaledVector(direction,distance).toArray()},{animate,home:true});
  }
  applyView(view,revision,target){
    if(this.disposed)return;
    const key=view+':'+revision;if(key===this.viewKey)return;
    const animate=this.viewKey!==undefined;this.viewKey=key;
    if(view===1)this.moveCameraTo({target:[-2.28,-.30,1.00],position:[-2.34,-2.02,1.97]},{animate});
    else if(view===3){
      const panel=this.latestObjects?.find(o=>o.id===target&&o.kind==='panel')||this.latestObjects?.find(o=>o.kind==='panel'),p=panel?.position||[1.1,2.25,1.25];
      this.moveCameraTo({target:[p[0],p[1]-.15,p[2]+.08],position:[p[0]-1.6,p[1]-1.9,p[2]+.70]},{animate});
    }else this.cameraHome({animate});
  }
  focus(kind){
    if(['gripper','ball','cube','tray'].includes(kind))this.moveCameraTo({target:[-2.15,-.30,1.15],position:[-4.05,-2.8,2.9]});
    else if(kind==='welder'||kind==='panel'){
      const panel=this.latestObjects?.find(o=>o.kind==='panel'),p=panel?.position||[1.1,2.25,1.25];
      this.moveCameraTo({target:[p[0]+.35,p[1]-.35,p[2]-.1],position:[p[0]-2.8,p[1]-3.2,p[2]+1.65]});
    }else this.cameraHome({animate:true});
  }
  load(data){super.load(data);this.robot.position.copy(WORKCELL_OFFSET);this.geometryNames=new Map(data.geometries.map(g=>[g.id,g.name]));this.robotGeomIds=new Set(data.robot_geom_ids||[]);}
  async syncAssets(objects){
    this.latestObjects=objects;const wanted=new Set(objects.map(o=>o.id));
    for(const [id,node] of this.assets)if(!wanted.has(id)){
      const geometries=new Set(),materials=new Set();node.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m);});
      this.scene.remove(node);for(const g of geometries)g.dispose();for(const m of materials)m.dispose();this.assets.delete(id);this.rigs.delete(id);this.renderer.shadowMap.needsUpdate=true;this.requestRender();
    }
    for(const [id,label] of this.labels)if(!wanted.has(id)){label.remove();this.labels.delete(id);}
    for(const o of objects){
      if(!this.labels.has(o.id)){const label=document.createElement('span');label.className='scene-object-label';label.hidden=true;label.textContent=o.name;this.container.append(label);this.labels.set(o.id,label);}
      if(!['welder','panel'].includes(o.kind)||this.assets.has(o.id)||this.pending.has(o.id))continue;
      this.pending.add(o.id);
      try{
        let node;
        if(o.kind==='welder'){
          const font=await new FontLoader().loadAsync(ASSET_ROOT+'helvetiker_regular.typeface.json');
          const rig=await createXiaomengH({font,loadLink:async name=>(await this.loader.loadAsync(ASSET_ROOT+name+'.glb')).scene});
          if(this.disposed||!this.latestObjects.some(v=>v.id===o.id))continue;
          node=rig.root;this.rigs.set(o.id,rig);
        }else{
          node=new T.Group();const panel=createPipePanel();panel.rotation.x=Math.PI/2;node.add(panel);node.userData.panel=panel;
          const frame=material('#687a8b',.55,.4);
          for(const x of [-.82,.82]){
            box(node,'pipe-panel-upright',[.055,.055,1.35],[x,.13,-.55],frame);
            box(node,'pipe-panel-foot',[.13,.46,.07],[x,.27,-1.215],frame);
          }
        }
        node.name=o.id;node.userData.workshopId=o.id;node.position.set(...o.position);node.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});this.assets.set(o.id,node);this.scene.add(node);this.renderer.shadowMap.needsUpdate=true;this.requestRender();
      }finally{this.pending.delete(o.id);}
    }
    this.updateObjects(objects);
  }
  updateObjects(objects){
    this.latestObjects=objects;
    for(const o of objects){const node=this.assets.get(o.id);if(node){
      const before=node.position.clone(),after=new T.Vector3(...o.position),distance=before.distanceTo(after);
      if(distance>0||node.rotation.z!==(o.heading||0)){this.renderer.shadowMap.needsUpdate=true;this.requestRender();}
      node.position.copy(after);node.rotation.z=o.heading||0;
      const rig=this.rigs.get(o.id);
      if(rig&&o.pose&&node.userData.poseKey!==o.pose.join(',')){
        const result=rig.setPose(o.pose,{endpointOnly:true});this.poseBlocked=!result.ok;
        if(result.ok){node.userData.poseKey=o.pose.join(',');this.renderer.shadowMap.needsUpdate=true;this.requestRender();}
      }
      if(o.kind==='welder'&&o.status==='moving'&&distance<.4)rollWheels(node,before.toArray(),after.toArray(),o.heading||0);
      if(o.kind==='panel')this.syncWeldTrace(o,node.userData.panel);
    }}
    const props=new Map(objects.filter(o=>['ball','cube','tray'].includes(o.kind)).map(o=>[o.kind+':'+o.slot,o])),gripper=objects.find(o=>o.kind==='gripper');
    const colors={blue:[.08,.32,.85],red:[.85,.13,.16],yellow:[.95,.68,.12],green:[.12,.62,.39]};
    for(const [id,mesh] of this.objects){
      const name=this.geometryNames?.get(id)||'',match=name.match(/^(ball|cube)_geom_(\d+)$|^(tray)_(?:support|wall)_(\d+)/);
      const item=match?props.get((match[1]||match[3])+':'+(match[2]||match[4])):this.robotGeomIds.has(id)?gripper:null;
      if(!match&&!this.robotGeomIds.has(id))continue;
      const signature=item?item.id+':'+item.color:'';
      if(mesh.userData.visibilityKey===signature)continue;
      mesh.userData.visibilityKey=signature;mesh.userData.workshopId=item?.id||null;mesh.visible=!!item;
      if(item&&match){mesh.material.color.setRGB(...colors[item.color]).convertSRGBToLinear();mesh.material.opacity=1;mesh.material.transparent=false;mesh.material.needsUpdate=true;}
      this.renderer.shadowMap.needsUpdate=true;
      this.requestRender();
    }
  }
  syncWeldTrace(o,panel){
    if(!panel||this.poseBlocked)return;
    for(const run of o.weld_runs||[]){
      const key=o.id+':'+run.task_id;let offset=this.traceOffsets.get(key)||0;
      if(offset<run.points.length){this.renderer.shadowMap.needsUpdate=true;this.requestRender();}
      if(!offset)appendPanelWeldContact(panel,{arcOn:false});
      for(;offset<run.points.length;offset++){
        const p=run.points[offset];appendPanelWeldContact(panel,p?{seamId:run.seam_id,position:p,arcOn:true,deferGeometry:offset<run.points.length-1}:{arcOn:false});
      }
      this.traceOffsets.set(key,offset);
    }
    if(o.weld_runs?.length)this.container.dataset.weldTrace=JSON.stringify({panel:o.id,length:panel.userData.depositedLength||0,meshes:panel.getObjectByName('trajectory-weld-deposits')?.children.length||0});
  }
  setWeldState(state){
    if(!state.job&&this.weldState?.job){this.weldFX.clear();this.traceOffsets.clear();this.poseBlocked=false;delete this.container.dataset.weldTrace;}
    this.weldState=state;this.lastWeldSnapshot=performance.now();
  }
  animateWeld(){
    if(this.disposed)return;const now=performance.now(),dt=Math.min(.1,(now-this.fxTime)/1000);this.fxTime=now;
    const s=this.weldState,f=s?.job?.weld_frame,rig=this.rigs.get(s?.job?.source);
    const arc=!!(f?.arc_on&&s.status==='running'&&s.task==='weld_seam'&&rig&&!this.poseBlocked&&now-this.lastWeldSnapshot<700);
    const stats=this.weldFX.getStats();if(!arc&&!stats.activeSmoke&&!stats.activeSparks)return;
    const point=rig?rig.accessories.tcp.getWorldPosition(new T.Vector3()):new T.Vector3();
    const direction=rig?new T.Vector3(.72,0,.69).normalize().transformDirection(rig.accessories.torch.matrixWorld).negate():new T.Vector3(0,0,1);
    this.weldFX.setViewport(this.renderer.domElement.height,this.camera.fov);
    this.weldFX.update({point,direction,arcOn:arc,dt,camera:this.camera,occluders:[...this.assets.values()]});
    if(arc||this.weldFX.getStats().activeSmoke||this.weldFX.getStats().activeSparks)this.requestRender();
  }
  async thumbnail(kind){
    if(this.thumbnails.has(kind))return this.thumbnails.get(kind);
    const renderer=new T.WebGLRenderer({alpha:true,antialias:true});renderer.setSize(176,112);renderer.setPixelRatio(1.5);renderer.setClearColor(0xffffff,0);renderer.toneMapping=T.ACESFilmicToneMapping;
    const scene=new T.Scene();scene.environment=this.environment;scene.environmentIntensity=.8;
    scene.add(new T.HemisphereLight(0xffffff,0xbac6d7,1.8));const light=new T.DirectionalLight(0xffffff,2.2);light.position.set(-3,-4,6);scene.add(light);
    const object=new T.Group();scene.add(object);
    if(kind==='welder'){this.machinePromise??=this.loader.loadAsync('/models/xiaomeng-h/xiaomeng-h.glb');const gltf=await this.machinePromise;const model=gltf.scene.clone(true);model.rotation.x=Math.PI/2;object.add(model);}
    else if(kind==='panel'){const panel=createPipePanel();panel.rotation.x=Math.PI/2;object.add(panel);}
    else if(kind==='gripper'){
      this.robot.updateMatrixWorld(true);const inverse=this.robot.matrixWorld.clone().invert();
      for(const [id,m] of this.objects)if(this.robotGeomIds.has(id)){const copy=m.clone();new T.Matrix4().multiplyMatrices(inverse,m.matrixWorld).decompose(copy.position,copy.quaternion,copy.scale);copy.visible=true;object.add(copy);}
    }else if(kind==='ball'){
      for(const [i,c] of ['#367cef','#ed657a','#f0bb40'].entries()){const m=new T.Mesh(new T.SphereGeometry(.2,32,24),material(c,.28,.10));m.position.set(i*.29-.29,(i%2)*.10,0);object.add(m);}
    }else if(kind==='cube'){
      box(object,'red-cube',[.34,.34,.34],[-.17,0,0],material('#ed657a',.36));box(object,'blue-cube',[.34,.34,.34],[.18,.08,.12],material('#397eed',.36));
    }else{
      const blue=material('#4a80d8',.30,.14);box(object,'tray-base',[.8,.6,.035],[0,0,0],blue);
      for(const [size,p] of [[[.8,.05,.08],[0,-.3,.04]],[[.8,.05,.08],[0,.3,.04]],[[.05,.6,.08],[-.4,0,.04]],[[.05,.6,.08],[.4,0,.04]]])box(object,'tray-rim',size,p,blue);
    }
    object.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(object),centre=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()),span=Math.max(size.x,size.y,size.z)*.73;
    const camera=new T.OrthographicCamera(-span*1.57,span*1.57,span,-span,.01,30);camera.up.set(0,0,1);camera.position.copy(centre).add(new T.Vector3(-2.8,-4,2.6).normalize().multiplyScalar(Math.max(4,span*5)));camera.lookAt(centre);
    camera.updateMatrixWorld(true);const fit=bounds.clone().applyMatrix4(camera.matrixWorldInverse).getSize(new T.Vector3()),half=Math.max(fit.y/2,fit.x/(2*1.57))*1.10;
    camera.left=-half*1.57;camera.right=half*1.57;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();
    renderer.render(scene,camera);const url=renderer.domElement.toDataURL('image/png');renderer.dispose();renderer.forceContextLoss();this.thumbnails.set(kind,url);return url;
  }
  setSelected(ids=[]){const key=ids.join('|');if(this.selectionKey===key)return;this.selectionKey=key;this.selectedIds=new Set(ids);this.requestRender();}
  requestRender(){
    if(this.renderRequested||this.disposed)return;this.renderRequested=true;
    this.renderFrame=requestAnimationFrame(now=>{
      this.renderFrame=null;this.renderRequested=false;
      if(this.disposed||!this.container.clientWidth||!this.container.clientHeight)return;
      if(this.cameraMotion?.active&&this.cameraHomeAspect!==null&&this.cameraHomeAspect!==this.camera.aspect)this.cameraHome({animate:true});
      const pose=this.cameraMotion?.sample(now);
      if(pose)this.writeCameraPose(pose);else this.controls.update();
      this.drawScene(now);
      for(const o of this.latestObjects||[]){
        const label=this.labels?.get(o.id);if(!label)continue;
        const p=new T.Vector3(...o.position);
        if(['ball','cube','tray'].includes(o.kind))p.add(WORKCELL_OFFSET).add(new T.Vector3(0,0,.065));
        else if(o.kind==='gripper')p.add(new T.Vector3(.12,0,.64));
        else p.z+=o.kind==='welder'?2.12:.45;
        p.project(this.camera);const visible=this.hoveredId===o.id&&p.z<1&&Math.abs(p.x)<.98&&Math.abs(p.y)<.94;
        label.hidden=!visible;label.style.left=((p.x*.5+.5)*this.container.clientWidth)+'px';label.style.top=((-p.y*.5+.5)*this.container.clientHeight)+'px';
        label.classList.toggle('selected',this.selectedIds?.has(o.id)||false);
      }
      if(this.cameraMotion?.active)this.requestRender();
    });
  }
  dispose(){
    if(this.disposed)return;
    this.cameraMotion?.cancel();
    this.controls.removeEventListener('start',this.onCameraInteraction);
    this.controls.removeEventListener('end',this.onCameraInteractionEnd);
    this.cameraMotionPreference?.removeEventListener('change',this.onCameraMotionPreference);
    if(this.renderFrame!=null)cancelAnimationFrame(this.renderFrame);
    this.renderFrame=null;this.renderRequested=false;
    clearInterval(this.fxTimer);this.weldFX.dispose();this.renderer.domElement.removeEventListener('pointermove',this.pointerMove);this.renderer.domElement.removeEventListener('pointerleave',this.pointerLeave);for(const label of this.labels.values())label.remove();this.environment?.dispose();super.dispose();}
}
