"""One persistent scene, named props, parameterized physical skills and visual ingress."""
import copy
import json
import math
from pathlib import Path
import threading
import time
import uuid

import mujoco

from .planning import baseline_phase,candidates
from .workshop_physics import WorkshopWorld,SLOTS
from .workshop_decision import WorkshopDecision,resolve_payload,DecisionUnavailable

COLORS={"blue":"蓝","red":"红","yellow":"黄","green":"绿","steel":""}
KINDS={"ball":"球","cube":"块","tray":"盘","panel":"管排","welder":"焊接机器人","gripper":"抓手"}
STORE=Path(__file__).resolve().parents[2]/".local"/"workshop-scene.json"
PANEL_BAYS=[[1.1+3.4*i,2.25,1.25] for i in range(5)]
ROBOT_SPAWN=[4.2,-1.4,0]
WELDER_HOME=[0,-62,-62,0,-90,0]


def chinese_number(n):
    digits="零一二三四五六七八九"
    if n<10:return digits[n]
    if n<20:return "十"+(digits[n%10] if n%10 else "")
    if n<100:return digits[n//10]+"十"+(digits[n%10] if n%10 else "")
    return "".join(digits[int(c)] for c in str(n))


class Workshop:
    def __init__(self,store=STORE,speed=1.):
        self.lock=threading.RLock();self.store=Path(store) if store else None;self.speed=speed
        self.world=WorkshopWorld();self.scene_id=uuid.uuid4().hex;self.revision=0;self.geometry_revision=0
        self.robot_geoms=[i for i in range(self.world.model.ngeom) if (self.world.model.body(int(self.world.model.geom_bodyid[i])).name or '').startswith('link') or (self.world.model.body(int(self.world.model.geom_bodyid[i])).name or '') in {'hand','left_finger','right_finger'}]
        self.robot_collision_bits={i:(int(self.world.model.geom_contype[i]),int(self.world.model.geom_conaffinity[i])) for i in self.robot_geoms}
        self.objects=[];self.counters={};self.requests={};self.task=None;self.history=[];self.thread=None
        self.view=2;self.view_revision=0;self.view_target=None;self.snapshot_sequence=0;self.runtime_id=uuid.uuid4().hex
        self.cancel=threading.Event();self.wake=threading.Event();self.wake.set();self.decision=WorkshopDecision()
        if self.store and self.store.exists():
            saved=json.loads(self.store.read_text(encoding="utf-8"));self.scene_id=saved["scene_id"]
            self.objects=saved["objects"];self.counters=saved["counters"];self.revision=saved.get("revision",0)
            self.view=saved.get('view',2);self.view_target=saved.get('view_target')
            if saved.get('schema_version',1)<3:
                for bay,o in enumerate(v for v in self.objects if v['kind']=='panel'):
                    o.update(bay=bay,position=PANEL_BAYS[bay][:])
                    if o.get('weld_runs'):o['legacy_weld_runs']=o.pop('weld_runs')
                    o['welded_seams']=[]
                for o in self.objects:
                    if o['kind']=='welder':o.update(position=ROBOT_SPAWN[:],pose=WELDER_HOME[:],heading=0,status='parked',name='小萌 H7',spoken_name='小萌H七')
            for o in self.objects:
                if o["kind"] in {"ball","cube","tray"}:self.world.set_prop(o["kind"],o["slot"],o["color"],o["position"])
            if len(saved.get("qpos",[]))==self.world.model.nq:
                self.world.data.qpos[:]=saved["qpos"];self.world.data.ctrl[:7]=self.world.data.qpos[self.world.arm_q]
                self.world.data.ctrl[7]=255;mujoco.mj_forward(self.world.model,self.world.data)
            if saved.get("schema_version",1)<2:
                for color in ["red","blue"]:
                    if f"{color}_cube" not in self.counters:self._add("cube",color)
        else:
            self._add("gripper","steel");self._add("welder","yellow");self._add("panel","steel")
            self._add("ball","blue");self._add("ball","blue");self._add("tray","red");self._add("tray","blue");self._add("cube","red");self._add("cube","blue")
        for _ in range(100):self.world.tick()
        self._robot_visible(any(o["kind"]=="gripper" for o in self.objects))
        self._sync();self._save()

    def _robot_visible(self,visible):
        for i,(a,b) in self.robot_collision_bits.items():
            self.world.model.geom_contype[i]=a if visible else 0;self.world.model.geom_conaffinity[i]=b if visible else 0

    def _sync(self):
        for o in self.objects:
            if o["kind"] in {"ball","cube","tray"}:
                o["position"]=self.world.prop_position(o["kind"],o["slot"])
                o["status"]="held" if o["kind"]==self.world.selected_kind and o["slot"]==self.world.selected_ball and self.world.observe()["held"] else "available"

    def _save(self):
        if not self.store:return
        self._sync();self.store.parent.mkdir(parents=True,exist_ok=True)
        data={"schema_version":3,"scene_id":self.scene_id,"revision":self.revision,"objects":self.objects,"counters":self.counters,"qpos":self.world.data.qpos.tolist(),"view":self.view,"view_target":self.view_target}
        temporary=self.store.with_suffix(".tmp");temporary.write_text(json.dumps(data,ensure_ascii=False),encoding="utf-8");temporary.replace(self.store)

    def _find(self,reference):
        found=[o for o in self.objects if reference in {o["id"],o["name"],o["spoken_name"]}]
        if len(found)!=1:raise ValueError("指定对象不存在，请使用场内显示的完整编号")
        return found[0]

    def _free_position(self,kind):
        choices=([(.36,-.19),(.53,-.19),(.36,-.08),(.54,-.07),(.43,-.27),(.59,-.27)] if kind in {"ball","cube"} else [(.36,.18),(.55,.18)])
        self._sync()
        for x,y in choices:
            if all(math.hypot(x-o["position"][0],y-o["position"][1]) > ((.024 if kind in {"ball","cube"} else .085)+(.024 if o["kind"] in {"ball","cube"} else .085)+.012)
                   for o in self.objects if o["kind"] in {"ball","cube","tray"}):return [x,y,.021 if kind in {"ball","cube"} else 0]
        raise ValueError("抓取台暂时没有空闲位置，请先移除一个道具")

    def _add(self,kind,color):
        if kind not in KINDS or color not in COLORS:raise ValueError("不支持的道具或颜色")
        if kind in {'ball','cube','tray'} and color=='steel':raise ValueError('球、方块和托盘需要指定蓝、红、黄或绿')
        if kind in {'panel','gripper','welder'} and color!=('yellow' if kind=='welder' else 'steel'):raise ValueError('这个模型只支持原有配色')
        if kind in {"welder","gripper"} and any(o["kind"]==kind for o in self.objects):raise ValueError("这个机器人已在场内，请直接使用它")
        if kind=="panel" and sum(o["kind"]==kind for o in self.objects)>=5:raise ValueError("五个管排工位已满")
        key=f"{color}_{kind}" if kind in {"ball","cube","tray"} else kind;n=self.counters.get(key,0)+1
        name=COLORS[color]+KINDS[kind]+str(n) if kind in {"ball","cube","tray"} else KINDS[kind]+str(n)
        spoken=(COLORS[color]+"色" if kind in {"ball","cube","tray"} else "")+chinese_number(n)+"号"+({"tray":"托盘","cube":"方块"}.get(kind,KINDS[kind]))
        o={"id":f"{key}_{n}","name":name,"spoken_name":spoken,"kind":kind,"color":color,"status":"available"}
        if kind in {"ball","cube","tray"}:
            o["position"]=self._free_position(kind);used={v["slot"] for v in self.objects if v["kind"]==kind}
            o["slot"]=next(i for i in range(SLOTS) if i not in used);self.world.set_prop(kind,o["slot"],color,o["position"])
        elif kind=="welder":o.update(position=ROBOT_SPAWN[:],pose=WELDER_HOME[:],heading=0,status="parked",name='小萌 H7',spoken_name='小萌H七')
        elif kind=="panel":
            used={v.get('bay',i) for i,v in enumerate(v for v in self.objects if v['kind']=='panel')}
            bay=next(i for i in range(5) if i not in used)
            o.update(bay=bay,position=PANEL_BAYS[bay][:],orientation="upright",seams=7,welded_seams=[])
        else:o["position"]=[-2.6,-.35,.88];self._robot_visible(True)
        self.counters[key]=n;self.objects.append(o);self.revision+=1;self.geometry_revision+=1
        return o

    def snapshot(self,trace_cursors=None,compact=False):
        with self.lock:
            self._sync();task=copy.deepcopy(self.task)
            self.snapshot_sequence+=1
            objects=[]
            for o in self.objects:
                item={k:copy.deepcopy(v) for k,v in o.items() if k not in {'legacy_weld_runs','weld_runs'}}
                if 'weld_runs' in o:
                    item['weld_runs']=[]
                    for run in o['weld_runs']:
                        start=0 if trace_cursors is None else trace_cursors.get(run['task_id'],0)
                        if start>len(run['points']):start=0
                        copied={k:copy.deepcopy(v) for k,v in run.items() if k!='points'}
                        copied['points']=copy.deepcopy(run['points'][start:])
                        if trace_cursors is not None:
                            copied['points_start']=start;trace_cursors[run['task_id']]=len(run['points'])
                        item['weld_runs'].append(copied)
                objects.append(item)
            return {"id":task["id"] if task else self.scene_id,"scene_id":self.scene_id,"runtime_id":self.runtime_id,"sequence":self.snapshot_sequence,"revision":self.revision,"geometry_revision":self.geometry_revision,
                    "view":self.view,"view_revision":self.view_revision,"view_target":self.view_target,
                    "task":task["action"] if task else None,"status":task["status"] if task else "idle","phase":task["phase"] if task else None,
                    "message":task.get("message") if task else None,"instruction":task.get("instruction","") if task else "","job":task,
                    "objects":objects,"frame":self.world.frame(compact=compact),"frame_count":len(self.history),
                    "decision":self.decision.public_status(),"last_decision":getattr(self,"last_decision",None),
                    "capabilities":{"physical_pick_place":True,"visual_robot_ingress":True,"welding_execution":True,"welding_mode":"checked_kinematic_simulation","seam_numbering":"从上到下1到7"}}

    def scene(self):
        with self.lock:
            data=self.world.scene()
            if not any(o["kind"]=="gripper" for o in self.objects):data["geometries"]=[g for g in data["geometries"] if g["id"] not in self.robot_geoms]
            return {"episode_id":self.scene_id,"geometry_revision":self.geometry_revision,**data}

    def assets(self):
        with self.lock:
            return {"episode_id":self.scene_id,"robot_geom_ids":self.robot_geoms,**self.world.scene(include_inactive=True)}

    def resolve(self,operation,utterance,expected_revision):
        with self.lock:
            if expected_revision!=self.revision:raise ValueError("场景已改变，请读取最新对象后重试")
            self._sync();objects=copy.deepcopy(self.objects);version=self.revision
        state,questions,commands=resolve_payload(operation,utterance,objects)
        if state["guard_result"]:
            reason=state["guard_result"]
            message=state.get('clarification_message') if reason=='clarify' else None
            return {"resolved":False,"reason":reason,"message":message or {"clarify":"有多个符合描述的对象，请补充编号或位置。","not_found":"场内没有这个编号的对象，请核对道具栏。","unsupported":"这句话包含多个操作，请分步执行。"}[reason],"decision":{"source":"scene_reference_validation","model_called":False}}
        result=self.decision.evaluate(state,questions);choice=result["answers"]["selection"]["choice"]
        command=commands.get(choice)
        if command:
            for fact in state["reference_facts"]:
                if fact.get('strict') is False:continue
                selected=command.get(fact["role"] if operation=="pick_place" else "target" if operation=="weld" else "object_id")
                if selected not in fact["matching_ids"]:raise ValueError("模型选择不符合用户指定的编号或位置，未执行")
            if operation=="weld" and command["seam"]!=state["seam_number"]:raise ValueError("模型选择的焊缝编号不符，未执行")
        with self.lock:
            if version!=self.revision:raise ValueError("决策期间场景已改变，旧选择已作废")
            self.last_decision={"model":result["model"],"elapsed_ms":result["elapsed_ms"],"server_ms":result["server_ms"],"choice":choice}
        if choice not in commands:
            return {"resolved":False,"reason":choice,"message":{"clarify":"请指定要操作的对象编号，例如蓝球1或蓝球2。","not_found":"场内没有找到你指定的对象，请核对编号。","unsupported":"请先给出一个明确操作。"}[choice],"decision":self.last_decision}
        return {"resolved":True,"command":commands[choice],"expected_revision":version,"decision":self.last_decision}

    def command(self,value):
        if value["action"]=="reset":
            # The page reports cancellation first. Let that worker release its
            # scene references before removing objects, without holding its lock.
            with self.lock:
                finishing=self.thread if self.task and self.task["status"]=="stopped" else None
            if finishing and finishing.is_alive():finishing.join(timeout=3)
        with self.lock:
            rid=value["request_id"];payload={k:v for k,v in value.items() if k!="request_id"}
            if rid in self.requests:
                old,reply=self.requests[rid]
                if old!=payload:raise ValueError("同一请求编号不能用于不同操作")
                return {**reply,"duplicate":True,"state":self.snapshot()}
            action=value["action"]
            if action not in {"pause","resume","stop","set_view"} and value.get("expected_revision")!=self.revision:raise ValueError("场景已改变，请读取最新状态")
            busy=self.task and self.task["status"] in {"running","paused"}
            if self.thread and self.thread.is_alive() and not busy:raise ValueError("上一任务正在结束，请稍后重试")
            # Table props are outside the welding planner's obstacle space.
            # Keep the active panel/robot and all physical grasp jobs protected.
            table_add_during_weld=(busy and self.task['action']=='weld_seam' and action=='spawn' and value.get('kind') in {'ball','cube','tray'})
            if busy and action not in {"pause","resume","stop","set_view"} and not table_add_during_weld:raise ValueError("请先完成或停止当前任务")
            accepted=False;created=None
            if action=='set_view':
                view=value.get('view')
                if view not in {1,2,3}:raise ValueError('视角为1抓取、2全景、3焊接')
                target=value.get('target') or (self.task or {}).get('target')
                if target and not any(o['id']==target and o['kind']=='panel' for o in self.objects):target=None
                self.view=view;self.view_target=target;self.view_revision+=1;self._save()
            elif action=='summon_welder':
                robot=next((o for o in self.objects if o['kind']=='welder'),None)
                if robot is None:created=self._add('welder','yellow')
                else:
                    robot.update(position=ROBOT_SPAWN[:],heading=0,pose=WELDER_HOME[:],status='parked');self.revision+=1
                self._save()
            elif action=="spawn":
                kind=value['kind'];created=self._add(kind,value.get("color",{'panel':'steel','gripper':'steel','welder':'yellow'}.get(kind,'blue')));self._save()
            elif action=="remove":
                o=self._find(value["object_id"])
                if o["kind"]=="gripper":
                    if self.world.observe()["held"]:raise ValueError("夹爪仍持有物体，请先放下")
                    self._robot_visible(False)
                if o["kind"]==self.world.selected_kind and o.get("slot")==self.world.selected_ball and self.world.observe()["held"]:raise ValueError("夹爪仍持有这个球，请先放下")
                if o["kind"] in {"ball","cube","tray"}:self.world.set_prop(o["kind"],o["slot"],o["color"],o["position"],False)
                self.objects.remove(o);self.revision+=1;self.geometry_revision+=1;self._save()
            elif action in {"pick_place","enter_welder","exit_welder","weld_seam"}:
                self.cancel.clear();self.wake.set();self.history=[]
                if action=="pick_place":
                    if not any(o["kind"]=="gripper" for o in self.objects):raise ValueError("请先召唤抓手机械臂")
                    source,target=self._find(value["source"]),self._find(value["target"])
                    if source["kind"] not in {"ball","cube"} or target["kind"] not in {"tray","cube"} or source["id"]==target["id"]:raise ValueError("抓放需要一个球或方块，以及不同的托盘或支撑方块")
                    if source["kind"]=="ball" and target["kind"]=="cube":raise ValueError("球需要放入托盘；方块可以叠放到另一个方块上")
                    if self.world.observe()["held"]:raise ValueError("夹爪仍持有物体，请先完成当前放置")
                    self.world.bind(source["slot"],target["slot"],source["kind"],target["kind"]);instruction=f"将{source['spoken_name']}放到{target['spoken_name']}"
                    extra={"source":source["id"],"target":target["id"]}
                elif action=="weld_seam":
                    robot=next((o for o in self.objects if o['kind']=='welder'),None)
                    if robot is None:raise ValueError('请先召唤焊接机器人')
                    panel=self._find(value['target']);seam=value['seam']
                    if panel['kind']!='panel' or not isinstance(seam,int) or not 1<=seam<=7:raise ValueError('请指定管排及从上到下1到7号焊缝')
                    if seam in panel.get('welded_seams',[]):raise ValueError('这条焊缝已完成，请选择另一条')
                    instruction=f"焊接{panel['spoken_name']}的第{chinese_number(seam)}条缝"
                    extra={'source':robot['id'],'target':panel['id'],'seam':seam,'arc_on':False}
                    if self.view==3:self.view_target=panel['id'];self.view_revision+=1
                else:
                    robot=next((o for o in self.objects if o["kind"]=="welder"),None)
                    if robot is None:robot=self._add("welder","yellow")
                    instruction="焊接机器人驶入工作位" if action=="enter_welder" else "焊接机器人返回停靠位"
                    extra={"source":robot["id"]}
                self.task={"id":uuid.uuid4().hex,"action":action,"status":"running","phase":"approach","instruction":instruction,"started":time.time(),"success":False,**extra}
                if action=='weld_seam':self.task['phase']='planning'
                self.revision+=1;accepted=True
                self.thread=threading.Thread(target=self._run,name="workshop-task",daemon=True);self.thread.start()
            elif action=="pause":
                if not busy:raise ValueError("当前没有运行任务")
                self.wake.clear();self.task["status"]="paused"
            elif action=="resume":
                if not self.task or self.task["status"]!="paused":raise ValueError("当前没有暂停的任务")
                self.task["status"]="running";self.wake.set()
            elif action=="stop":
                if not busy:raise ValueError("当前没有运行任务")
                self.cancel.set();self.wake.set();self.task["status"]="stopped";self.task["message"]="任务已停止，保留场景";self.revision+=1;self._save()
            elif action=="reset":
                for o in self.objects:
                    if o["kind"] in {"ball","cube","tray"}:
                        self.world.set_prop(o["kind"],o["slot"],o["color"],o["position"],False)
                self.objects=[o for o in self.objects if o["kind"]=="gripper"]
                if not self.objects:self._add("gripper","steel")
                self.world.bind(0,0)
                self.world.closed=False
                self.world.data.ctrl[:7]=self.world.data.qpos[self.world.arm_q]
                self.world.data.qvel[self.world.arm_dof]=0
                self.world.data.ctrl[7]=255
                for name in ("finger_joint1","finger_joint2"):
                    joint=self.world.model.joint(name)
                    self.world.data.qpos[self.world.model.jnt_qposadr[joint.id]]=.04
                    self.world.data.qvel[self.world.model.jnt_dofadr[joint.id]]=0
                mujoco.mj_forward(self.world.model,self.world.data)
                self.task=None;self.history=[];self.last_decision=None
                self.view=1;self.view_target=None;self.view_revision+=1
                self.revision+=1;self.geometry_revision+=1;self._save()
            else:raise ValueError("Unsupported workshop command")
            reply={"ok":True,"accepted":accepted,"task_id":self.task["id"] if accepted else None,"created":created,"state":self.snapshot()}
            self.requests[rid]=(payload,{k:v for k,v in reply.items() if k!="state"})
            return reply

    def _wait(self):
        while not self.cancel.is_set():
            if self.wake.wait(.05):return True
        return False

    def _run(self):
        try:
            if self.task["action"]=="pick_place":self._run_pick()
            elif self.task['action']=='weld_seam':
                from .workshop_welding import run_weld
                run_weld(self)
            else:self._run_drive()
        except Exception as error:
            with self.lock:
                if not self.cancel.is_set():self.task.update(status="error",message=str(error),success=False);self.revision+=1;self._save()

    def _finish(self,physical):
        if self.cancel.is_set():return
        self.task.update(status="completed",phase="finish",success=True,verification="MuJoCo双侧抓持、目标支撑接触、释放后稳定及撤离" if physical else "模型到达指定工位；底盘为运动学演示")
        self.revision+=1;self._save()

    def _run_pick(self):
        for cycle in range(28):
            if not self._wait():return
            with self.lock:
                phase=baseline_phase(self.world);self.task["phase"]=phase
                if self.world.success():self._finish(True);return
                options=[o for o in candidates(self.world,phase,True) if o.admitted and o.id!="hold"]
                if not options:raise ValueError("物理预演未找到可执行动作，已保留现场")
                move=options[0];motion=self.world.motion(move.target,move.gripper,move.seconds)
                unsafe=self.world.unsafe_contacts
            previous_time=float(self.world.data.time)
            while self._wait():
                with self.lock:
                    if self.cancel.is_set():return
                    if not self.wake.is_set():continue
                    try:frame=next(motion)
                    except StopIteration:break
                    self.history.append(frame["observation"]["object"]);self._sync()
                    if self.world.unsafe_contacts>unsafe:raise ValueError("发现不允许的接触，动作已停止")
                if self.speed>0:self.cancel.wait(max(0,frame["time"]-previous_time)/self.speed)
                previous_time=frame["time"]
        raise ValueError("抓放未能在动作预算内完成，保留当前场景")

    def _run_drive(self):
        with self.lock:
            robot=self._find(self.task["source"]);start=list(robot["position"])
            target=[1.55,-.25,0] if self.task["action"]=="enter_welder" else [4.2,-1.4,0]
            self.task["destination"]=target
            if math.dist(start,target)<.001:
                robot["status"]="ready" if self.task["action"]=="enter_welder" else "parked"
                self._finish(False);return
            self.task["phase"]="carry";robot["status"]="moving"
        # This is a marked, empty vehicle lane; no inference or scene replacement.
        for i in range(1,151):
            if not self._wait():return
            with self.lock:
                t=i/150;u=t*t*(3-2*t);v=1-u;direction=-1 if target[0]<start[0] else 1
                p1=[start[0]+direction*.9,start[1],0];p2=[target[0]-direction*.9,target[1],0]
                robot["position"]=[v*v*v*start[j]+3*v*v*u*p1[j]+3*v*u*u*p2[j]+u*u*u*target[j] for j in range(3)]
                dx=3*v*v*(p1[0]-start[0])+6*v*u*(p2[0]-p1[0])+3*u*u*(target[0]-p2[0])
                dy=3*v*v*(p1[1]-start[1])+6*v*u*(p2[1]-p1[1])+3*u*u*(target[1]-p2[1])
                robot["heading"]=math.atan2(dy,dx)-(math.pi if direction<0 else 0)
                self.history.append(robot["position"][:])
            if self.speed>0:self.cancel.wait(.04/self.speed)
        with self.lock:robot["status"]="ready" if self.task["action"]=="enter_welder" else "parked";self._finish(False)

    def close(self):
        self.cancel.set();self.wake.set()
        if self.thread:self.thread.join(timeout=3)
        with self.lock:self._save()
        self.decision.close()
