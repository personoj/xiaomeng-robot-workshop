"""Local demo boundary: baseline physics, explicit task identity, idempotent UI/voice commands."""
from contextlib import asynccontextmanager
from pathlib import Path
import threading
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .runtime import Session


class Command(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=160)
    action: Literal["run", "pause", "resume", "stop", "reset"]
    task: Literal["transfer", "stack", "barrier"] | None = None
    expected_episode_id: str = Field(min_length=1, max_length=64)


class Demo:
    def __init__(self):
        self.lock = threading.RLock()
        self.session = self.make("transfer")
        self.requests = {}

    @staticmethod
    def make(task):
        return Session(task=task, seed=0, provider="baseline", control_mode="skills",
                       observation_mode="privileged", camera_views=[], preview=True, speed=1.0)

    def command(self, value):
        payload = value.model_dump(exclude={"request_id"})
        with self.lock:
            if value.request_id in self.requests:
                old, result = self.requests[value.request_id]
                if old != payload:
                    raise HTTPException(409, "同一请求编号不能用于不同操作。")
                return {**result, "duplicate": True, "state": self.session.snapshot()}
            session = self.session
            snapshot = session.snapshot()
            if value.expected_episode_id != session.id:
                raise HTTPException(409, "任务已变化，请读取当前状态后再操作。")
            if value.action == "run":
                if snapshot["status"] in {"running", "paused", "uncertain"}:
                    raise HTTPException(409, "已有任务正在进行；请继续、暂停或停止它，再开始新任务。")
                next_task = value.task or session.world.task
                replacement = self.make(next_task)
                session.stop()
                self.session = session = replacement
                session.start()
            elif value.action == "reset":
                replacement = self.make(value.task or session.world.task)
                session.stop()
                self.session = session = replacement
            elif value.action == "pause":
                if snapshot["status"] not in {"running", "paused"}:
                    raise HTTPException(409, "当前没有可暂停的运行任务。")
                session.pause()
            elif value.action == "resume":
                if snapshot["status"] != "paused":
                    raise HTTPException(409, "只有已暂停的任务可以继续。")
                session.start()
            elif value.action == "stop":
                if snapshot["status"] not in {"running", "paused", "uncertain", "stopped"}:
                    raise HTTPException(409, "当前没有需要停止的任务。")
                session.stop()
            result = {"ok": True, "action": value.action, "task_id": session.id,
                      "accepted": value.action == "run", "state": session.snapshot()}
            self.requests[value.request_id] = (payload, result)
            return result


def create_app():
    demo = Demo()
    from .workshop import Workshop
    from .workshop_api import workshop_router
    workshop = Workshop()

    @asynccontextmanager
    async def lifespan(app):
        yield
        demo.session.stop()
        workshop.close()

    app = FastAPI(title="小萌 · 机器人演示", lifespan=lifespan)
    app.state.demo = demo
    app.state.workshop = workshop
    app.include_router(workshop_router(workshop))
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])

    @app.middleware("http")
    async def same_origin(request: Request, call_next):
        if request.method == "POST":
            origin = request.headers.get("origin")
            if origin and origin not in {f"http://127.0.0.1:{request.url.port}", f"http://localhost:{request.url.port}"}:
                return JSONResponse({"detail": "Cross-origin control is disabled"}, status_code=403)
        return await call_next(request)

    @app.get("/api/health")
    def health():
        return {"ok": True, "service": "xiaoyun-robot-demo", "policy": "baseline", "simulation": "MuJoCo"}

    @app.get("/api/state")
    def state():
        with demo.lock:
            return demo.session.snapshot()

    @app.get("/api/scene")
    def scene():
        with demo.lock, demo.session.lock:
            return {"episode_id": demo.session.id, **demo.session.world.scene()}

    @app.get("/api/trajectory")
    def trajectory(episode_id: str):
        # Read recorded observations only; do not step or mutate the physics world.
        with demo.lock, demo.session.lock:
            session = demo.session
            if session.id != episode_id:
                raise HTTPException(409, "任务已变化，旧轨迹已过期。")
            frames = session.frames
            count = len(frames)
            indices = sorted({round(i * (count - 1) / min(179, count - 1))
                              for i in range(min(180, count))}) if count > 1 else list(range(count))
            return {"episode_id": session.id, "frame_count": count, "units": "metres",
                    "points": [frames[i]["observation"]["object"] for i in indices],
                    "destination": frames[-1]["evaluation_target"] if count else None}

    @app.post("/api/demo/command")
    def command(value: Command):
        return demo.command(value)

    @app.get("/api/replay/{index}")
    def replay(index: int, episode_id: str):
        with demo.lock:
            if demo.session.id != episode_id:
                raise HTTPException(409, "任务已变化，旧回放已过期。")
            try:
                return demo.session.replay_frame(index)
            except ValueError as exc:
                raise HTTPException(404, str(exc)) from None

    @app.get("/api/export")
    def export():
        with demo.lock:
            return JSONResponse(demo.session.export(), headers={"Content-Disposition": "attachment; filename=xiaoyun-episode.json"})

    web = Path(__file__).parent / "web"
    if web.exists():
        app.mount("/", StaticFiles(directory=web, html=True), name="demo")
    return app
