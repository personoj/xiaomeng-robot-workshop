export const STAGES=['对准目标','夹持与抬升','移动至目标','释放与验证'];
const phaseIndex={approach:0,descend:0,grasp:1,lift:1,carry:2,lower:2,release:3,withdraw:3,finish:3};
export function presentation(s){
  const started=!!s.job,success=s.status==='completed'&&s.job?.success===true,drive=['enter_welder','exit_welder'].includes(s.task);
  const weld=s.task==='weld_seam';
  const stage=weld?Math.max(s.job?.deposited_length>0?2:0,({planning:0,positioning:0,approach:1,welding:2,indexing:2,withdraw:3,finish:3}[s.phase]??0)):phaseIndex[s.phase]??0,labels=weld?['驶入固定工位','焊枪就位','从右向左点焊','停弧撤离']:drive?['确认工位','驶入通道','移动至工位','到位检查']:STAGES;
  const observation=s.frame?.observation||{},source=s.objects.find(o=>o.id===s.job?.source),target=s.objects.find(o=>o.id===s.job?.target);
  return {started,success,arrived:weld?stage>=2:drive?success:started&&observation.support_contact===true,stable:success,
    copy:started?{instruction:s.instruction,source:source?.name||'',target:(target?.name||'')+(weld?` · 缝${s.job.seam}`:'')||(drive?'指定工位':''),kind:drive||weld?'robot':'tray'}:null,
    stages:labels.map((label,i)=>({label,status:success||i<stage?'done':started&&i===stage?'current':'pending'})),
    status:success?'success':['error','stopped'].includes(s.status)?'error':s.status,
    title:success?'任务完成':weld&&s.status==='running'?({planning:'正在检查焊接路径',positioning:'正在驶入工位',approach:'焊枪正在就位',welding:'正在点焊',indexing:'正在移动到下一焊段',withdraw:'正在停弧撤离'}[s.phase]||'正在执行'):({idle:'等待指令',running:'正在执行',paused:'任务已暂停',stopped:'任务已停止',error:'执行未完成'}[s.status]||'等待指令')};
}
