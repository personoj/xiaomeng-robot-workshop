export const TASKS={
  transfer:{name:'搬运入盘',goal:'把红色方块放进蓝色托盘',label:'抓取 · 搬运 · 放置',number:'01'},
  stack:{name:'方块堆叠',goal:'把红色方块稳稳放到蓝色方块上',label:'对齐 · 叠放 · 稳定',number:'02'},
  barrier:{name:'越障搬运',goal:'让红色方块越过障碍，放入托盘',label:'抬升 · 越障 · 放置',number:'03'},
};
export const PHASES={approach:'移至物体上方',descend:'下降对准',grasp:'闭合夹爪',lift:'抬升物体',carry:'移向目标',lower:'降低放置',release:'松开夹爪',withdraw:'撤离并验证',recover:'重新抓取',finish:'完成'};
export const STATUSES={idle:'准备就绪',running:'正在执行',paused:'已暂停',completed:'任务完成',stopped:'已停止',error:'执行异常',exhausted:'未完成',stalled:'执行停滞',uncertain:'需要处理'};
export const TERMINAL=new Set(['completed','stopped','error','exhausted','stalled','uncertain']);

export async function api(path,body){
  let response,data;
  try{
    response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    data=await response.json();
  }catch(error){if(body!==undefined)error.outcome='unknown';throw error;}
  if(!response.ok){const error=new Error(typeof data.detail==='string'?data.detail:'请求未被接受，请检查当前任务。');if(body!==undefined&&response.status>=500)error.outcome='unknown';throw error;}
  return data;
}

export function summarize(state){
  const observation=state.frame?.observation||{};
  return {application:'小云机器人演示',task_id:state.id,task:state.task,goal:TASKS[state.task].goal,
    status:state.status,status_label:STATUSES[state.status]||state.status,phase:state.phase,phase_label:PHASES[state.phase]||'等待任务',
    completed_actions:state.cycles,success:state.status==='completed'&&observation.success===true,
    held:!!observation.held,supported:!!observation.support_contact,forbidden_contact:!!observation.forbidden_contact,
    message:state.message||null,execution:'本地 MuJoCo 物理仿真，规则/预设技能执行；语音模型选择高层任务',
    controls:{can_pause:state.status==='running',can_resume:state.status==='paused',can_start:!['running','paused','uncertain'].includes(state.status)}};
}

export class DemoController{
  constructor({onState=()=>{},onError=()=>{}}={}){this.onState=onState;this.onError=onError;this.busy=false;this.state=null;}
  async refresh(){const state=await api('/api/state');this.state=state;await this.onState(state);return state;}
  async command(action,task,{requestId=crypto.randomUUID(),isCurrent=()=>true}={}){
    if(this.busy)throw new Error('上一个操作正在处理中，请稍后。');
    this.busy=true;
    try{
      if(!isCurrent())throw new Error('页面状态已变化，请重新读取当前任务。');
      const before=await api('/api/state');
      // An old voice intent must not reset a different episode after an asynchronous fetch.
      if(!isCurrent()||this.state&&before.id!==this.state.id){this.state=before;await this.onState(before);throw new Error('任务已变化，请重新读取当前任务。');}
      const response=await api('/api/demo/command',{request_id:requestId,action,task:task||null,expected_episode_id:before.id});
      this.state=response.state;await this.onState(response.state);
      return {ok:true,task_id:response.task_id,status:response.accepted?'accepted':response.state.status,
        message:response.accepted?'任务已受理，正在执行，尚未确认完成。':STATUSES[response.state.status],state:summarize(response.state)};
    }finally{this.busy=false;}
  }
}

export function voiceActions(controller,onAccepted){
  const empty={type:'object',properties:{},additionalProperties:false};
  const taskSchema={type:'object',properties:{task:{type:'string',enum:Object.keys(TASKS),description:'transfer 搬运入盘；stack 方块堆叠；barrier 越障搬运'}},required:['task'],additionalProperties:false};
  const execute=(action)=>async(args,execution)=>{
    try{
      const result=await controller.command(action,args.task,{requestId:execution.callId,isCurrent:execution.isCurrent});
      if(action==='run')onAccepted(result.task_id,execution.callId);
      return {result,context:summarize(controller.state)};
    }catch(error){return {result:{error:error.outcome==='unknown'?'robot_command_unconfirmed':'robot_command_rejected',message:error.message,...(error.outcome?{outcome:error.outcome}:{})}};}
  };
  return [
    {name:'start_robot_task',description:'启动一次机械臂仿真任务：搬运红方块入蓝托盘、方块堆叠或越障搬运。返回 accepted 仅代表已开始，必须等待任务完成通知或查询结果，不能声称已经完成。',side_effect:true,parameters:taskSchema,execute:execute('run')},
    {name:'pause_robot_task',description:'暂停当前正在执行的机械臂任务。用户说暂停、等一下或先停住时使用。',side_effect:true,parameters:empty,execute:execute('pause')},
    {name:'resume_robot_task',description:'继续之前已经暂停的机械臂任务，保持原任务和进度。',side_effect:true,parameters:empty,execute:execute('resume')},
    {name:'stop_robot_task',description:'终止当前机械臂任务，此次任务不再继续。与只打断小云说话不同。',side_effect:true,parameters:empty,execute:execute('stop')},
    {name:'reset_robot_scene',description:'重置指定仿真场景到初始状态，不开始执行。用户说重新运行一次时使用 start_robot_task 即可；执行中应先停止。',side_effect:true,parameters:taskSchema,execute:execute('reset')},
    {name:'get_robot_status',description:'查询当前机械臂任务、执行阶段、是否完成和物理验证结果。成功必须以真实 success 字段为准。',side_effect:false,parameters:empty,execute:async()=>{try{await controller.refresh();return {result:summarize(controller.state)};}catch(error){return {result:{error:'simulation_unavailable',message:error.message}};}}},
  ];
}
