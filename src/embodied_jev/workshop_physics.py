"""Persistent MuJoCo workcell with reusable ball/tray slots and stable object names.

Adding props activates slots; it never reconstructs the world or resets the arm.
The wheeled robot and pipe panels are separate visual assets in the larger room.
"""
import copy
import xml.etree.ElementTree as ET

import mujoco
import numpy as np

from .physics import RobotWorld, build_scene, HOME, DT
from .scenarios import SCENE_DEFAULTS

SLOTS = 12
PALETTE = {"blue": [.08,.32,.85,1], "red": [.85,.13,.16,1], "yellow": [.95,.68,.12,1], "green": [.12,.62,.39,1]}


class WorkshopWorld(RobotWorld):
    def __init__(self):
        xml, _, _ = build_scene()
        root = ET.fromstring(xml)
        # Preserve 0..255 -> 0..40 mm mapping, with firmer compliant spherical grasp.
        # Within the original actuator's +/-100 N limit; no attachment/equality weld.
        fingers=root.find(".//actuator/general[@name='actuator8']")
        fingers.set("gainprm","0.06274509804 0 0");fingers.set("biasprm","0 -400 -20")
        # Put the sphere's equator slightly above the pad centre, so the closing
        # contacts support it instead of squeezing it down out of the fingertips.
        root.find(".//site[@name='tcp']").set("pos","0 0 .0984")
        world = root.find("worldbody")
        for node in list(world):
            if node.get("name") in {"cube", "support"} or node.get("name", "").startswith("tray_wall_"):
                world.remove(node)
        for i in range(SLOTS):
            body = ET.SubElement(world, "body", name=f"ball_{i}", pos=f"0 0 {-5-i}", gravcomp="1")
            ET.SubElement(body, "freejoint", name=f"ball_joint_{i}")
            ET.SubElement(body, "geom", name=f"ball_geom_{i}", type="sphere", size=".02", mass=".045",
                          rgba=".08 .32 .85 0", friction="2.2 .05 .01", condim="6", solref=".006 1", contype="1", conaffinity="1")
            cube=ET.SubElement(world,"body",name=f"cube_{i}",pos=f"0 0 {-50-i}",gravcomp="1")
            ET.SubElement(cube,"freejoint",name=f"cube_joint_{i}")
            ET.SubElement(cube,"geom",name=f"cube_geom_{i}",type="box",size=".02 .02 .02",mass=".06",rgba=".8 .15 .12 0",friction="2 .04 .008",condim="6",solref=".006 1")
            tray = ET.SubElement(world, "body", name=f"tray_{i}", mocap="true", pos=f"0 0 {-30-i}")
            ET.SubElement(tray, "geom", name=f"tray_support_{i}", type="box", size=".07 .07 .003", pos="0 0 .003", rgba=".85 .13 .16 0", friction="1.5 .02 .002", contype="1", conaffinity="1")
            for j,(x,y,sx,sy) in enumerate([(-.076,0,.006,.082),(.076,0,.006,.082),(0,-.076,.07,.006),(0,.076,.07,.006)]):
                ET.SubElement(tray,"geom",name=f"tray_wall_{i}_{j}",type="box",size=f"{sx} {sy} .012",pos=f"{x} {y} .012",rgba=".85 .13 .16 0",contype="1",conaffinity="1")
        self.model = mujoco.MjModel.from_xml_string(ET.tostring(root,encoding="unicode"))
        self.data = mujoco.MjData(self.model)
        self.arm_q=np.array([self.model.jnt_qposadr[self.model.joint(f"joint{i}").id] for i in range(1,8)])
        self.arm_dof=np.array([self.model.jnt_dofadr[self.model.joint(f"joint{i}").id] for i in range(1,8)])
        self.ranges=np.array([self.model.jnt_range[self.model.joint(f"joint{i}").id] for i in range(1,8)])
        self.tcp=self.model.site("tcp").id
        self.left,self.right=(self.model.body(name).id for name in ("left_finger","right_finger"))
        self.task,self.seed,self.scene_name,self.scene_hash="transfer",0,"持续工作坊","persistent-workshop-v1"
        self.scene_config=copy.deepcopy(SCENE_DEFAULTS)
        self.active_balls,self.active_trays,self.active_cubes=set(),set(),set()
        self.closed=False;self.stable_seconds=self.contact_seconds=self.max_lift=0.;self.unsafe_contacts=self.steps=0
        self.bind(0,0)
        self.data.qpos[self.arm_q]=self.data.ctrl[:7]=HOME;self.data.ctrl[7]=255
        for name in ("finger_joint1","finger_joint2"):self.data.qpos[self.model.jnt_qposadr[self.model.joint(name).id]]=.04
        mujoco.mj_forward(self.model,self.data)
        q,err=self.solve_ik([.38,-.08,.22])
        if err>.004:raise RuntimeError("Workcell initial pose is unreachable")
        self.data.qpos[self.arm_q]=self.data.ctrl[:7]=q
        mujoco.mj_forward(self.model,self.data)
        self.start_time=0.

    def bind(self,ball,tray,source_kind="ball",target_kind="tray"):
        self.selected_ball,self.selected_tray=ball,tray;self.selected_kind=source_kind;self.target_kind=target_kind
        self.cube_id=self.model.body(f"{source_kind}_{ball}").id
        self.cube_geom=self.model.geom(f"{source_kind}_geom_{ball}").id
        self.cube_dof=self.model.jnt_dofadr[self.model.joint(f"{source_kind}_joint_{ball}").id]
        self.support_id=self.model.geom(f"tray_support_{tray}" if target_kind=="tray" else f"cube_geom_{tray}").id
        self.target_geom_ids=[self.support_id]+([self.model.geom(f"tray_wall_{tray}_{i}").id for i in range(4)] if target_kind=="tray" else [])
        self.source=self.data.xpos[self.cube_id].copy()
        if target_kind=="tray":
            tid=self.model.body_mocapid[self.model.body(f"tray_{tray}").id]
            self.target=self.data.mocap_pos[tid].copy()+[0,0,.026]
        else:self.target=self.data.xpos[self.model.body(f"cube_{tray}").id].copy()+[0,0,.040]
        self.stable_seconds=self.contact_seconds=self.max_lift=0.;self.unsafe_contacts=0

    def clone(self):
        other=object.__new__(WorkshopWorld);other.__dict__=self.__dict__.copy()
        other.data=copy.copy(self.data);other.scene_config=copy.deepcopy(self.scene_config)
        other.target=self.target.copy();other.source=self.source.copy()
        return other

    def motion(self,target=None,gripper=None,seconds=.6,emit=True):
        # Short Cartesian waypoints maintain downward fingers while transporting a sphere.
        # A single joint-space sweep can tilt the hand and roll the ball out of the pads.
        start=self.position.copy();end=start if target is None else np.asarray(target,dtype=float)
        segments=max(1,int(np.ceil(np.linalg.norm(end-start)/.015)))
        for i in range(1,segments+1):
            point=start+(end-start)*i/segments
            yield from super().motion(point,gripper if i==1 else None,seconds/segments,emit)

    def set_prop(self,kind,slot,color,position,active=True):
        rgba=PALETTE[color].copy();rgba[3]=1 if active else 0
        if kind in {"ball","cube"}:
            bid=self.model.body(f"{kind}_{slot}").id;gid=self.model.geom(f"{kind}_geom_{slot}").id
            adr=self.model.jnt_qposadr[self.model.joint(f"{kind}_joint_{slot}").id]
            dof=self.model.jnt_dofadr[self.model.joint(f"{kind}_joint_{slot}").id]
            self.data.qpos[adr:adr+7]=[*position,1,0,0,0] if active else [0,0,(-5 if kind=="ball" else -50)-slot,1,0,0,0]
            self.data.qvel[dof:dof+6]=0;self.model.body_gravcomp[bid]=0 if active else 1
            active_set=self.active_balls if kind=="ball" else self.active_cubes
            gids=[gid];(active_set.add if active else active_set.discard)(slot)
        else:
            bid=self.model.body(f"tray_{slot}").id;mid=self.model.body_mocapid[bid]
            self.data.mocap_pos[mid]=position if active else [0,0,-30-slot]
            gids=[self.model.geom(f"tray_support_{slot}").id]+[self.model.geom(f"tray_wall_{slot}_{i}").id for i in range(4)]
            (self.active_trays.add if active else self.active_trays.discard)(slot)
        for gid in gids:
            self.model.geom_rgba[gid]=rgba;self.model.geom_contype[gid]=self.model.geom_conaffinity[gid]=1 if active else 0
        mujoco.mj_forward(self.model,self.data)

    def prop_position(self,kind,slot):
        return self.data.xpos[self.model.body(f"{kind}_{slot}").id].round(6).tolist()

    def contacts(self):
        fingers,support,forbidden=super().contacts()
        for contact in self.data.contact[:self.data.ncon]:
            if contact.dist>.0005:continue
            a,b=int(contact.geom1),int(contact.geom2)
            for moving,other in [(a,b),(b,a)]:
                body=self.model.body(int(self.model.geom_bodyid[moving])).name or ""
                name=self.model.geom(other).name or ""
                if body in {"hand","link5","link6","link7"} and name.startswith(("tray_","ball_geom_","cube_geom_")):
                    forbidden=True
        return fingers,support,forbidden

    def tick(self):
        if self.target_kind=="cube":self.target=self.data.xpos[self.model.body(f"cube_{self.selected_tray}").id].copy()+[0,0,.040]
        super().tick()

    def frame(self,compact=False):
        if not compact:return {**super().frame(),"mocap_pos":self.data.mocap_pos.tolist(),"mocap_quat":self.data.mocap_quat.tolist()}
        return {"time":float(self.data.time),"qpos":self.data.qpos.tolist(),"mocap_pos":self.data.mocap_pos.tolist(),"mocap_quat":self.data.mocap_quat.tolist()}

    def scene(self,include_inactive=False):
        result=super().scene()
        if not include_inactive:result["geometries"]=[g for g in result["geometries"] if g["color"][3]>0]
        if include_inactive:
            bodies=[]
            for i in range(self.model.nbody):
                joints=[]
                for j in range(self.model.body_jntadr[i],self.model.body_jntadr[i]+self.model.body_jntnum[i]):
                    address=int(self.model.jnt_qposadr[j]);kind=int(self.model.jnt_type[j])
                    joints.append({"type":kind,"address":address,"axis":self.model.jnt_axis[j].tolist(),"position":self.model.jnt_pos[j].tolist(),"reference":float(self.model.qpos0[address])})
                bodies.append({"id":i,"parent":int(self.model.body_parentid[i]),"position":self.model.body_pos[i].tolist(),"quaternion":self.model.body_quat[i].tolist(),"mocap":int(self.model.body_mocapid[i]),"joints":joints})
            result["kinematics"]={"bodies":bodies}
            for g in result["geometries"]:
                i=g['id'];g.update(body=int(self.model.geom_bodyid[i]),position=self.model.geom_pos[i].tolist(),quaternion=self.model.geom_quat[i].tolist())
        return result
