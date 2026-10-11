export {api} from './demo-controller.js';
import {api} from './demo-controller.js';
import {WorkshopStateCache} from './workshop-state.js';
export const TERMINAL=new Set(['completed','stopped','error']);
function assertCurrent(options){
  if(options.isCurrent&&!options.isCurrent())throw new Error('当前指令已失效');
}
const sameRuntime=(a,b)=>a?.runtime_id===b?.runtime_id&&a?.scene_id===b?.scene_id;
export function summarize(s){
  return {application:'小萌持续机器人工作坊',scene_id:s.scene_id,scene_revision:s.revision,task_id:s.job?.id||null,
    status:s.status,phase:s.phase,instruction:s.instruction,success:s.job?.success===true,verification:s.job?.verification||null,
    welding:s.task==='weld_seam'?{seam:s.job.seam,numbering:'从上往下',progress:s.job.progress||0,deposited_metres:s.job.deposited_length||0,arc_on:s.status==='running'&&s.job.weld_frame?.arc_on===true}:null,
    objects:s.objects.map(({slot,weld_runs,legacy_weld_runs,...o})=>o),view:s.view,
    naming:'语音按spoken_name播读。编号不重排，存在多个同色候选且未指明哪个时才澄清。语音转写可能有同音字或改口，请结合场内对象理解，不能仅凭历史回答认定对象不存在。',
    concurrent_operations:'焊接期间可以添加抓取台上的球、方块和托盘，不影响当前焊接。抓放期间不能新增道具；焊接期间不能改动管排或焊接机器人。',
    execution:'抓放和叠放使用MuJoCo。召唤小萌H7在固定出生位出现；指定管排和焊缝后先驶入工位、固定底盘，仅机械臂从右向左完成14个间隔短焊段。最上面是第1缝，最下面是第7缝。视角1抓取、2全景、3当前焊接工位，只切镜头，不改场景或任务。模型仿真，不是实体设备控制。',
    capabilities:s.capabilities,decision_model:s.decision};
}
export class DemoController{
  constructor({onState=()=>{},onError=()=>{}}={}){this.onState=onState;this.onError=onError;this.busy=false;this.state=null;this.transcript='';this.cache=new WorkshopStateCache();this.metrics={};}
  acceptState(state){
    const accepted=this.cache.accept(state);if(!accepted)return this.state;
    this.state=accepted;this.pendingRender=accepted;
    if(!this.rendering)this.rendering=Promise.resolve().then(async()=>{
      while(this.pendingRender){const next=this.pendingRender;this.pendingRender=null;const start=performance.now();
        try{await this.onState(next);}catch(error){this.onError(new Error('场景显示未更新：'+error.message));}
        this.metrics.presentation_ms=performance.now()-start;
      }
    }).finally(()=>{this.rendering=null;});
    return this.state;
  }
  acceptReadState(state,before){
    // A newly connected stream outranks an HTTP read started in an older runtime,
    // including a first read whose runtime was not yet known to the cache.
    if(this.state&&!sameRuntime(this.state,before)&&!sameRuntime(this.state,state))return this.state;
    return this.acceptState(state);
  }
  async refresh(options={}){
    const before=this.state,next=await api('/api/workshop/state');
    if(options.isCurrent&&!options.isCurrent())return this.state;
    return this.acceptReadState(next,before);
  }
  connectStream(onStatus=()=>{}){
    this.stream?.close();const stream=this.stream=new EventSource('/api/workshop/events');
    const isCurrent=()=>this.stream===stream;
    stream.onopen=()=>{if(isCurrent()){this.streamConnected=true;onStatus(true);}};
    stream.onerror=()=>{if(isCurrent()){this.streamConnected=false;onStatus(false);}};
    stream.onmessage=({data})=>{if(!isCurrent())return;try{this.acceptState(JSON.parse(data));}catch(error){this.onError(error);this.refresh({isCurrent}).catch(this.onError);}};
  }
  dispose(){this.stream?.close();this.stream=null;this.streamConnected=false;}
  async command(action,params={},options={}){
    if(this.busy)throw new Error('上一个操作尚未结束');this.busy=true;
    const started=performance.now();
    try{
      assertCurrent(options);
      const observedBeforeRead=this.state;
      const before=options.expectedRevision==null?await api('/api/workshop/state'):null;
      // A BOOT interruption can invalidate the intent while the read is in flight.
      // Check immediately before the mutation, without changing its revision guard.
      assertCurrent(options);
      if(before&&this.state&&!sameRuntime(this.state,observedBeforeRead)&&!sameRuntime(this.state,before))throw new Error('工作坊服务已变化，当前指令已失效');
      const runtime=options.expectedRuntimeId??(before?.capabilities?.runtime_identity_guard?before.runtime_id:undefined);
      const observedBeforeCommand=this.state;
      const result=await api('/api/workshop/command',{request_id:options.requestId||crypto.randomUUID(),action,expected_revision:options.expectedRevision??before.revision,...(runtime?{expected_runtime_id:runtime}:{}),...(typeof params==='object'?params:{})});
      this.acceptReadState(result.state,observedBeforeCommand);this.metrics.command_ms=performance.now()-started;
      return {ok:true,accepted:result.accepted,task_id:result.task_id,status:result.accepted?'accepted':'completed',created:result.created,state:summarize(result.state),message:result.accepted?'任务已受理，等待完成通知。':result.created?`已添加${result.created.spoken_name}`:'操作已完成'};
    }finally{this.busy=false;}
  }
  async resolve(operation,utterance,options={}){
    assertCurrent(options);
    const started=performance.now();const before=await this.refresh();
    assertCurrent(options);
    const data=await api('/api/workshop/resolve',{operation,utterance,expected_revision:before.revision,...(before.capabilities?.runtime_identity_guard?{expected_runtime_id:before.runtime_id}:{})});
    assertCurrent(options);
    if(!sameRuntime(this.state,before))throw new Error('工作坊服务已变化，当前指令已失效');
    this.metrics.resolve_ms=performance.now()-started;this.metrics.decision=data.decision;
    if(!data.resolved)return {ok:false,needs_clarification:true,message:data.message,decision:data.decision};
    const {action,...params}=data.command;return this.command(action,params,{...options,expectedRevision:data.expected_revision,expectedRuntimeId:data.expected_runtime_id});
  }
}
export function voiceActions(controller,onAccepted){
  const empty={type:'object',properties:{},additionalProperties:false};
  const request={type:'object',properties:{request:{type:'string',description:'本次工具调用对应的单步用户意图，保留原对象描述和编号。复合指令分步提供，不自行填入源/目标ID'}},additionalProperties:false};
  const run=handler=>async(args,execution)=>{
    try{const result=await handler(args,{requestId:execution.callId,isCurrent:execution.isCurrent});if(result.accepted)onAccepted(result.task_id,execution.callId);return {result,context:summarize(controller.state)};}
    catch(e){return {result:{error:e.outcome==='unknown'?'workshop_outcome_unknown':'workshop_command_rejected',message:e.outcome==='unknown'?'操作回执丢失，结果未知。请先查询场景状态，不要重复发出操作。':e.message,...(e.outcome?{outcome:e.outcome}:{})},context:controller.state?summarize(controller.state):{}};}
  };
  return [
    {name:'add_workshop_object',description:'添加一个道具。焊接期间也可以立即添加抓取台上的球、方块和托盘，不必停止焊接。用户明确类型和颜色时直接填写kind和color；用户说颜色随意时可选一种，否则不猜未说明的颜色。管排/抓手为steel，焊机为yellow。复杂描述只传request，由决策模型选择。一次一个，编号递增。',side_effect:true,parameters:{type:'object',properties:{request:request.properties.request,kind:{type:'string',enum:['ball','cube','tray','panel','welder','gripper']},color:{type:'string',enum:['blue','red','yellow','green','steel']}},additionalProperties:false},execute:run((args,options)=>args.kind&&args.color?controller.command('spawn',{kind:args.kind,color:args.color},options):controller.resolve('spawn',args.request||controller.transcript,options))},
    {name:'switch_workshop_view',description:'切换场景一/二/三：1抓取台近景，2工作坊全景，3当前焊接工位近景。仅切镜头，任务继续、道具保留。',side_effect:true,parameters:{type:'object',properties:{view:{type:'integer',enum:[1,2,3]}},required:['view'],additionalProperties:false},execute:run((args,options)=>controller.command('set_view',{view:args.view},options))},
    ...[['weld_workshop_seam','weld','焊接指定管排的一条焊缝。从上到下编号1到7，传用户单步原话，由决策模型选择管排和缝号。先预检关节、定长管线和工件碰撞，驶入工位后固定底盘，仅机械臂从右到左执行间隔短焊段并覆盖全长，accepted不是完成。'],['remove_workshop_object','remove','移除场内一个指定编号的对象。含糊时要求澄清；不能改变其余对象编号。'],['place_workshop_object','pick_place','将场内一个球或方块放入托盘，或将一个方块叠放到另一个方块上。把用户原话交给决策模型选择对象，随后执行真实物理抓放；accepted不代表已完成。']].map(([name,operation,description])=>({name,description,side_effect:true,parameters:request,execute:run((args,options)=>{const text=args.request||controller.transcript;if(!text)throw new Error('没有收到本次用户指令');return controller.resolve(operation,text,options);})})),
    ...[['bring_welding_robot','summon_welder','召唤小萌H7（小蒙H七），立即在规定出生位出现，不开始焊接；焊接工具自行完成驶入工位。'],['park_welding_robot','exit_welder','让焊接机器人返回停靠位。'],['pause_robot_task','pause','暂停当前任务，保留场景和进度。'],['resume_robot_task','resume','继续当前暂停任务。'],['stop_robot_task','stop','停止当前任务，保留所有场内对象。']].map(([name,action,description])=>({name,description,side_effect:true,parameters:empty,execute:run((_,options)=>controller.command(action,{},options))})),
    {name:'get_workshop_state',description:'查看当前大场景所有对象的编号、状态及任务结果。焊缝从上到下1到7号，可查询焊接任务进度和完成情况。',side_effect:false,parameters:empty,execute:async()=>{await controller.refresh();return {result:summarize(controller.state)};}}
  ];
}
