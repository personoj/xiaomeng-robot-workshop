from typing import Literal
import asyncio
import json
import time
import gzip
import threading
from fastapi import APIRouter,HTTPException,Request
from fastapi.responses import StreamingResponse,Response
from pydantic import BaseModel,ConfigDict,Field
from .workshop_decision import DecisionUnavailable


class WorkshopCommand(BaseModel):
    model_config=ConfigDict(extra="forbid")
    request_id:str=Field(min_length=1,max_length=160)
    action:Literal["spawn","remove","pick_place","enter_welder","exit_welder","summon_welder","set_view","weld_seam","pause","resume","stop","reset"]
    expected_revision:int
    expected_runtime_id:str|None=Field(default=None,min_length=1,max_length=64)
    kind:Literal["ball","cube","tray","panel","welder","gripper"]|None=None
    color:Literal["blue","red","yellow","green","steel"]|None=None
    source:str|None=Field(default=None,max_length=80)
    target:str|None=Field(default=None,max_length=80)
    object_id:str|None=Field(default=None,max_length=80)
    seam:int|None=Field(default=None,ge=1,le=7)
    view:int|None=Field(default=None,ge=1,le=3)


class ResolveRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    operation:Literal["spawn","remove","pick_place","weld"]
    utterance:str=Field(min_length=1,max_length=2000)
    expected_revision:int
    expected_runtime_id:str|None=Field(default=None,min_length=1,max_length=64)


def workshop_router(workshop):
    router=APIRouter(prefix="/api/workshop")
    asset_cache=None;asset_lock=threading.Lock()
    @router.get("/state")
    def state():return workshop.snapshot()
    @router.get("/scene")
    def scene():return workshop.scene()
    @router.get("/assets")
    def assets(request:Request):
        nonlocal asset_cache
        with asset_lock:
            if asset_cache is None:
                raw=json.dumps(workshop.assets(),ensure_ascii=False,separators=(',',':')).encode()
                asset_cache=gzip.compress(raw,compresslevel=3)
        compressed='gzip' in request.headers.get('accept-encoding','')
        return Response(asset_cache if compressed else gzip.decompress(asset_cache),media_type='application/json',headers={'Vary':'Accept-Encoding',**({'Content-Encoding':'gzip'} if compressed else {})})
    @router.get("/events")
    async def events():
        async def frames():
            cursors={}
            while True:
                started=time.monotonic()
                state=await asyncio.to_thread(workshop.snapshot,cursors,True)
                yield 'data: '+json.dumps(state,ensure_ascii=False,separators=(',',':'))+'\n\n'
                period=1/30 if state['status']=='running' else .35
                await asyncio.sleep(max(.005,period-(time.monotonic()-started)))
        return StreamingResponse(frames(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})
    @router.get("/trajectory")
    def trajectory(episode_id:str):
        with workshop.lock:
            state=workshop.snapshot()
            if state["id"]!=episode_id:raise HTTPException(409,"任务已变化")
            points=workshop.history;count=len(points)
            indices=sorted({round(i*(count-1)/min(179,count-1)) for i in range(min(count,180))}) if count>1 else list(range(count))
            destination=(state["job"] or {}).get("destination",workshop.world.target.tolist())
            return {"episode_id":state["id"],"frame_count":count,"points":[points[i] for i in indices],"destination":destination}
    @router.post("/command")
    def command(value:WorkshopCommand):
        try:return workshop.command(value.model_dump(exclude_none=True))
        except (ValueError,KeyError,StopIteration) as e:raise HTTPException(409,str(e) if isinstance(e,ValueError) else "道具参数缺失或工位已满") from None
    @router.post("/resolve")
    def resolve(value:ResolveRequest):
        try:return workshop.resolve(value.operation,value.utterance,value.expected_revision,value.expected_runtime_id)
        except DecisionUnavailable as e:raise HTTPException(503,str(e)) from None
        except ValueError as e:raise HTTPException(409,str(e)) from None
    return router
