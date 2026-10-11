import time

from fastapi.testclient import TestClient

from embodied_jev.xiaoyun_demo import create_app


def command(client, state, action, rid, task=None):
    return client.post('/api/demo/command', json={
        'request_id':rid,'action':action,'task':task,'expected_episode_id':state['id']})


def test_real_physics_start_pause_resume_completion_and_duplicate_request():
    with TestClient(create_app()) as client:
        initial=client.get('/api/state').json()
        reply=command(client,initial,'run','voice-start','transfer')
        assert reply.status_code==200
        data=reply.json()
        assert data['accepted'] and data['state']['status']=='running'
        running=data['state']
        duplicate=command(client,initial,'run','voice-start','transfer').json()
        assert duplicate['duplicate'] and duplicate['task_id']==running['id']
        assert command(client,initial,'reset','stale-reset').status_code==409
        paused=command(client,running,'pause','pause').json()['state']
        assert paused['status']=='paused'
        resumed=command(client,paused,'resume','resume').json()['state']
        assert resumed['id']==running['id'] and resumed['status']=='running'
        deadline=time.monotonic()+35
        while time.monotonic()<deadline:
            final=client.get('/api/state').json()
            if final['status']!='running':break
            time.sleep(.1)
        assert final['status']=='completed'
        assert final['frame']['observation']['success'] is True
        assert final['model_calls']==0
        path=client.get(f"/api/trajectory?episode_id={final['id']}").json()
        assert 2 < len(path['points']) <= 180
        assert path['frame_count']==final['frame_count']
        assert path['points'][-1]==final['frame']['observation']['object']
        assert max(p[2] for p in path['points']) > path['points'][0][2]+.04
        assert client.get(f"/api/replay/0?episode_id={final['id']}").status_code==200
        assert command(client,final,'resume','bad-resume').status_code==409
        assert command(client,final,'pause','pause-again').status_code==409
        reset=command(client,final,'reset','reset','stack').json()['state']
        assert reset['status']=='idle' and reset['task']=='stack'
        assert client.get(f"/api/trajectory?episode_id={final['id']}").status_code==409
        assert command(client,final,'reset','reset','barrier').status_code==409


def test_cross_origin_control_rejected_and_rules_fixed():
    with TestClient(create_app()) as client:
        state=client.get('/api/state').json()
        body={'request_id':'cross','action':'run','expected_episode_id':state['id']}
        assert client.post('/api/demo/command',json=body,headers={'origin':'https://example.com'}).status_code==403
        assert client.post('/api/demo/command',json={**body,'provider':'chat'}).status_code==422
