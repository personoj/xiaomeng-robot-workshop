"""Execute preflighted model poses; only accepted FK contacts deposit metal."""
import copy
import json
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]


def run_weld(workshop):
    w=workshop
    with w.lock:
        robot=w._find(w.task['source']);panel=w._find(w.task['target'])
        spec={'robot':copy.deepcopy(robot),'panel':copy.deepcopy(panel),
              'panels':[copy.deepcopy(o) for o in w.objects if o['kind']=='panel'],'seam':w.task['seam']}
        task_id=w.task['id']
    folder=ROOT/'.local'/'weld-plans';folder.mkdir(parents=True,exist_ok=True)
    source=folder/f'{task_id}.input.json';target=folder/f'{task_id}.json'
    source.write_text(json.dumps(spec,ensure_ascii=False),encoding='utf-8')
    process=subprocess.Popen(['node','scripts/plan-workshop-weld.mjs',str(source),str(target)],cwd=ROOT,
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    deadline=time.monotonic()+150
    while process.poll() is None:
        if w.cancel.wait(.1) or time.monotonic()>deadline:
            process.terminate();process.communicate(timeout=5)
            if w.cancel.is_set():return
            raise ValueError('焊接路径预检超时，机器人保持原位')
    _,error=process.communicate()
    if process.returncode:
        # Model geometry errors contain no credentials; return the useful reason.
        detail=next((line.split('Error:',1)[1].strip() for line in error.splitlines() if 'Error:' in line),'未找到满足约束的路径')
        raise ValueError('焊接预检未通过：'+detail)
    plan=json.loads(target.read_text(encoding='utf-8'))
    with w.lock:
        if w.cancel.is_set():return
        w.task['validation']=plan['validation'];w.task['destination']=plan['frames'][-1]['tcp']
        w.task['frame_total']=len(plan['frames']);w.task['deposited_length']=0.
        run={'task_id':task_id,'seam':w.task['seam'],'seam_id':plan['seam_id'],'points':[],'complete':False,'pattern':'intermittent-stitch'}
        w.task['pattern']=plan['pattern'];w.task['parking']=plan['parking']
        panel.setdefault('weld_runs',[]).append(run)
    last_contact=None;last_saved=time.monotonic()
    for index,frame in enumerate(plan['frames']):
        while True:
            if not w._wait():return
            w.lock.acquire()
            if w.wake.is_set() and not w.cancel.is_set():break
            w.lock.release()
        try:
            if w.cancel.is_set():return
            if frame['phase']!='positioning' and (frame['position']!=plan['parking']['position'] or frame['heading']!=plan['parking']['heading']):raise ValueError('点焊中底盘位置改变，已停弧')
            robot.update(position=frame['position'],heading=frame['heading'],pose=frame['pose'],status='moving' if frame['phase']=='positioning' else 'welding' if frame['arc_on'] else 'ready')
            w.task.update(phase=frame['phase'],frame_index=index,weld_frame=frame,progress=index/max(1,len(plan['frames'])-1))
            w.history.append(frame['tcp'])
            if frame['arc_on']:
                point=frame['contact'];run['points'].append(point)
                if last_contact is not None:w.task['deposited_length']+=abs(point[0]-last_contact[0])
                last_contact=point
            else:
                if last_contact is not None:run['points'].append(None)
                last_contact=None
            if time.monotonic()-last_saved>1:w._save();last_saved=time.monotonic()
        finally:w.lock.release()
        if w.speed>0:w.cancel.wait(frame['seconds']/w.speed)
    with w.lock:
        if w.cancel.is_set():return
        run['complete']=True;panel.setdefault('welded_seams',[]).append(w.task['seam'])
        robot['status']='ready';w.task.update(status='completed',phase='finish',success=True,
            verification='完整枪尖轨迹、定长管线、接头锚定、机械臂与工件碰撞预检及停弧撤离通过')
        w.revision+=1;w._save()
