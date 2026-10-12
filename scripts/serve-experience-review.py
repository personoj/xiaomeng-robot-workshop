"""Disposable local scene for the browser review runner. Never loads user state."""
from pathlib import Path
from contextlib import asynccontextmanager
from unittest.mock import patch
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

def main():
    from embodied_jev.xiaoyun_demo import create_app
    from embodied_jev.workshop import Workshop
    from fastapi import FastAPI
    import uvicorn
    # Inject only the persistence-free scene factory. Application source and
    # permissions remain unchanged, and no saved user scene is read or written.
    with patch("embodied_jev.workshop.Workshop", lambda: Workshop(store=None)):
        application = create_app()

    @asynccontextmanager
    async def lifespan(app):
        yield
        application.state.demo.session.stop()
        application.state.workshop.close()

    app = FastAPI(lifespan=lifespan)

    @app.get("/api/review-mode")
    def review_mode():
        return {"synthetic": True, "hardware": False}

    app.mount("/", application)
    uvicorn.run(app, host="127.0.0.1", port=8092)

if __name__ == "__main__":
    main()
