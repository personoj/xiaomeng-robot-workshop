import time
import uuid
import numpy as np
import pytest
from embodied_jev.workshop import Workshop
from embodied_jev.workshop_decision import reference_facts,resolve_payload


def command(w,action,**kwargs):
    return w.command({"request_id":uuid.uuid4().hex,"expected_revision":w.revision,"action":action,**kwargs})


def test_one_world_numbering_and_save_restore(tmp_path):
    path=tmp_path/"scene.json";w=Workshop(store=path,speed=0)
    try:
        identity=w.scene_id;model=w.world.model;before=w.world.data.qpos.copy()
        command(w,"remove",object_id="blue_ball_1")
        created=command(w,"spawn",kind="ball",color="blue")["created"]
        assert created["name"]=="蓝球3" and created["spoken_name"]=="蓝色三号球"
        assert w.scene_id==identity and w.world.model is model
        assert np.allclose(before[w.world.arm_q],w.world.data.qpos[w.world.arm_q])
        assert any(o["id"]=="blue_ball_2" for o in w.objects)
        command(w,"remove",object_id="gripper_1");assert not any(o["kind"]=="gripper" for o in w.objects)
        assert command(w,"spawn",kind="gripper",color="steel")["created"]["name"]=="抓手2"
        counters=w.counters.copy()
    finally:w.close()
    restored=Workshop(store=path,speed=0)
    try:assert restored.scene_id==identity and restored.counters==counters
    finally:restored.close()


def test_zero_clears_props_and_welds_without_replacing_the_world(tmp_path):
    path=tmp_path/"scene.json";w=Workshop(store=path,speed=0)
    try:
        identity=w.scene_id;model=w.world.model;arm=w.world.data.qpos[w.world.arm_q].copy()
        old_ids={o["id"] for o in w.objects};counters=w.counters.copy()
        prop_names={g["name"] for g in w.scene()["geometries"] if g["name"].startswith(("ball_geom_","cube_geom_","tray_"))}
        w._find("panel_1")["welded_seams"]=[1]
        w._find("panel_1")["weld_runs"]=[{"task_id":"old-weld","points":[[0,0,0]]}]
        command(w,"set_view",view=3,target="panel_1")
        request={"request_id":uuid.uuid4().hex,"expected_revision":w.revision,"action":"reset"}
        state=w.command(request)["state"]
        assert state["scene_id"]==identity and w.world.model is model
        assert [o["id"] for o in state["objects"]]==["gripper_1"]
        assert state["status"]=="idle" and state["job"] is None and state["frame_count"]==0
        assert state["view"]==1 and state["view_target"] is None
        assert np.array_equal(w.world.data.qpos[w.world.arm_q],arm)
        assert w.counters==counters
        assert not (w.world.active_balls|w.world.active_cubes|w.world.active_trays)
        assert not any(g["name"].startswith(("ball_geom_","cube_geom_","tray_")) for g in w.scene()["geometries"])
        for i in range(w.world.model.ngeom):
            if w.world.model.geom(i).name in prop_names:
                assert w.world.model.geom_contype[i]==w.world.model.geom_conaffinity[i]==0
        created=command(w,"spawn",kind="ball",color="blue")["created"]
        assert created["id"] not in old_ids and created["slot"]==0
        assert w.world.active_balls=={0}
        # Retrying an acknowledged reset must not erase a newly added object.
        duplicate=w.command(request)
        assert duplicate["duplicate"] and any(o["id"]==created["id"] for o in duplicate["state"]["objects"])
        expected=[o["id"] for o in w.objects]
    finally:w.close()
    restored=Workshop(store=path,speed=0)
    try:
        assert restored.scene_id==identity
        assert [o["id"] for o in restored.objects]==expected
        assert restored.world.active_balls=={0} and not restored.world.active_cubes and not restored.world.active_trays
        panel=command(restored,"spawn",kind="panel",color="steel")["created"]
        assert panel["bay"]==0 and panel["welded_seams"]==[] and not panel.get("weld_runs")
        assert command(restored,"summon_welder")["created"]["kind"]=="welder"
    finally:restored.close()


def test_zero_waits_for_cancelled_worker_and_keeps_empty_scene():
    w=Workshop(store=None,speed=.2)
    try:
        command(w,"enter_welder");command(w,"pause")
        command(w,"stop");command(w,"reset")
        assert not w.thread.is_alive()
        assert w.task is None and [o["kind"] for o in w.objects]==["gripper"]
        command(w,"spawn",kind="ball",color="blue")
        command(w,"spawn",kind="tray",color="red")
        w.speed=0
        ball=next(o for o in w.objects if o["kind"]=="ball")
        tray=next(o for o in w.objects if o["kind"]=="tray")
        command(w,"pick_place",source=ball["id"],target=tray["id"]);w.thread.join(30)
        state=w.snapshot()
        assert state["status"]=="completed",state["message"]
        assert state["job"]["success"] and w.world.unsafe_contacts==0
    finally:w.close()


def test_static_assets_and_incremental_weld_snapshots_share_the_same_world():
    w=Workshop(store=None,speed=0)
    try:
        assets=w.assets();geometry_ids=[g['id'] for g in assets['geometries']]
        panel=w._find('panel_1')
        panel['weld_runs']=[{'task_id':'trace-test','seam':1,'seam_id':'seam-1','points':[[0,0,0],[.01,0,0]]}]
        cursors={};first=w.snapshot(cursors,True)
        panel['weld_runs'][0]['points'].extend([None,[.1,0,0]])
        second=w.snapshot(cursors,True);third=w.snapshot(cursors,True)
        run=lambda s:next(o for o in s['objects'] if o['kind']=='panel')['weld_runs'][0]
        assert run(first)['points_start']==0 and len(run(first)['points'])==2
        assert run(second)['points_start']==2 and run(second)['points']==[None,[.1,0,0]]
        assert run(third)['points_start']==4 and run(third)['points']==[]
        assert len(run(w.snapshot())['points'])==4
        assert first['sequence']<second['sequence']<third['sequence']
        assert 'positions' not in second['frame'] and 'qpos' in second['frame']
        command(w,'spawn',kind='ball',color='green')
        assert [g['id'] for g in w.assets()['geometries']]==geometry_ids
        assert assets['kinematics']['bodies'] and assets['robot_geom_ids']
        with pytest.raises(ValueError,match='原有配色'):command(w,'spawn',kind='panel',color='blue')
    finally:w.close()


def test_real_ball_transfer_and_cube_stack_share_scene():
    w=Workshop(store=None,speed=0)
    try:
        scene_id=w.scene_id;blue2=w._find("blue_ball_2")["position"][:]
        for source,target in [("blue_ball_1","red_tray_1"),("red_cube_1","blue_cube_1")]:
            command(w,"pick_place",source=source,target=target);w.thread.join(30)
            s=w.snapshot()
            assert s["status"]=="completed",s["message"]
            assert s["job"]["success"] is True
            assert s["frame"]["observation"]["support_contact"] is True
            assert s["frame"]["observation"]["stable_seconds"]>=.4
            assert s["frame"]["observation"]["held"] is False
            assert w.world.unsafe_contacts==0 and w.world.max_lift>.04
            assert s["scene_id"]==scene_id
        assert np.linalg.norm(np.array(w._find("blue_ball_2")["position"])-blue2)<.001
        assert w._find("red_cube_1")["position"][2]>.055
    finally:w.close()


def test_pause_resume_and_vehicle_motion():
    w=Workshop(store=None,speed=20)
    try:
        command(w,"enter_welder");command(w,"pause")
        pose=w._find("welder_1")["position"][:];time.sleep(.04)
        assert w._find("welder_1")["position"]==pose
        identity=w.scene_id;job=w.task['id'];qpos=w.world.data.qpos.copy()
        for view in [1,3,2]:
            command(w,'set_view',view=view)
            assert w.view==view and w.scene_id==identity and w.task['id']==job and w.task['status']=='paused'
            assert np.array_equal(w.world.data.qpos,qpos) and w._find('welder_1')['position']==pose
        command(w,"resume");w.thread.join(5)
        assert w.task["success"] and w._find("welder_1")["position"]==[1.55,-.25,0]
        assert w.task["destination"]==[1.55,-.25,0]
        assert "运动学" in w.task["verification"]
        command(w,"enter_welder");w.thread.join(5)
        assert w.task["success"] and w.history==[]
    finally:w.close()


def test_identity_constraints_reject_missing_ambiguous_and_compound():
    objects=[{"id":"blue_ball_1","kind":"ball","color":"blue","position":[.3,0,0]},
             {"id":"blue_ball_2","kind":"ball","color":"blue","position":[.5,0,0]},
             {"id":"red_tray_1","kind":"tray","color":"red","position":[.4,.2,0]},
             {"id":"red_cube_1","kind":"cube","color":"red","position":[.3,-.1,0]},
             {"id":"blue_cube_1","kind":"cube","color":"blue","position":[.5,-.1,0]}]
    assert reference_facts("pick_place","把蓝球3放进红盘1",objects)[1]=="not_found"
    assert reference_facts("pick_place","把蓝球放进红盘1",objects)[1]=="clarify"
    assert reference_facts("pick_place","先添加一个蓝球，再把它放进红盘1",objects)[1]=="unsupported"
    facts,guard=reference_facts("pick_place","把右边的蓝球放进红盘1",objects)
    assert guard is None and facts[0]["matching_ids"]==["blue_ball_2"]
    facts,guard=reference_facts("pick_place","把红色一号方块叠到蓝色一号方块上",objects)
    assert guard is None and [f["role"] for f in facts]==["source","target"]


def test_weld_references_require_a_real_panel_and_explicit_seam():
    objects=[{'id':'panel_1','kind':'panel','name':'管排1'}]
    for text,number in [('焊接一号管排的第三条缝',3),('焊接管排1的第七条缝',7),('焊管牌一最上面的缝',1),('焊管排1最下面的缝',7)]:
        state,_,commands=resolve_payload('weld',text,objects)
        assert state['guard_result'] is None and state['seam_number']==number
        assert commands[f'panel_1__seam_{number}']['target']=='panel_1'
    for text,reason in [('焊接管排第八条缝','not_found'),('焊接管排2的第三条缝','not_found'),('焊接管排的一条缝','clarify')]:
        assert resolve_payload('weld',text,objects)[0]['guard_result']==reason


def test_five_independent_panel_bays_and_fixed_summon():
    w=Workshop(store=None,speed=0)
    try:
        identity=w.scene_id
        for _ in range(4):command(w,'spawn',kind='panel',color='steel')
        panels=[o for o in w.objects if o['kind']=='panel']
        assert [o['id'] for o in panels]==[f'panel_{i}' for i in range(1,6)]
        assert len({tuple(o['position']) for o in panels})==5
        command(w,'remove',object_id='panel_2')
        new=command(w,'spawn',kind='panel',color='steel')['created']
        assert new['id']=='panel_6' and new['bay']==1
        assert [o['id'] for o in w.objects if o['kind']=='panel'][:4]==['panel_1','panel_3','panel_4','panel_5']
        robot=w._find('welder_1');robot['position']=[2,1,0]
        command(w,'summon_welder')
        assert robot['position']==[4.2,-1.4,0] and robot['status']=='parked'
        assert w.task is None and w.scene_id==identity
    finally:w.close()
