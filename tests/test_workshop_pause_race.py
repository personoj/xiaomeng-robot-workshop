"""Deterministic control interleavings at the drive worker's commit boundary."""
import threading
import uuid

import numpy as np
import pytest

from embodied_jev.workshop import Workshop


def command(workshop, action):
    return workshop.command({
        "request_id": uuid.uuid4().hex,
        "expected_revision": workshop.revision,
        "expected_runtime_id": workshop.runtime_id,
        "action": action,
    })


@pytest.mark.parametrize("action", ["enter_welder", "exit_welder"])
@pytest.mark.parametrize("control", ["pause", "stop"])
@pytest.mark.parametrize("boundary", [0, 73])
def test_drive_control_rechecks_after_wait_before_committing(
    monkeypatch, action, control, boundary
):
    workshop = Workshop(store=None, speed=0)
    passed_wait, release_wait, checked_again = (
        threading.Event(), threading.Event(), threading.Event()
    )
    original_wait = workshop._wait

    def delayed_wait():
        if passed_wait.is_set():
            checked_again.set()
        ready = original_wait()
        if ready and len(workshop.history) == boundary and not passed_wait.is_set():
            passed_wait.set()
            assert release_wait.wait(5), "Test did not release the waiting worker"
        return ready

    try:
        if action == "exit_welder":
            command(workshop, "enter_welder")
            workshop.thread.join(5)
            assert not workshop.thread.is_alive() and workshop.task["success"]
        monkeypatch.setattr(workshop, "_wait", delayed_wait)
        accepted = command(workshop, action)
        assert accepted["accepted"] and not accepted["state"]["job"]["success"]
        assert passed_wait.wait(5)
        controlled = command(workshop, control)
        before = controlled["state"]
        position = workshop._find("welder_1")["position"][:]
        qpos = workshop.world.data.qpos.copy()
        if control == "stop":
            with pytest.raises(ValueError, match="上一任务正在结束"):
                command(workshop, action)
        release_wait.set()
        if control == "pause":
            assert checked_again.wait(5), "Worker did not recheck after the control command"
        else:
            workshop.thread.join(5)
            assert not workshop.thread.is_alive()
        after = workshop.snapshot()
        assert workshop._find("welder_1")["position"] == position
        assert np.array_equal(workshop.world.data.qpos, qpos)
        assert len(workshop.history) == boundary
        assert after["scene_id"] == before["scene_id"]
        assert after["runtime_id"] == before["runtime_id"]
        assert after["job"]["id"] == before["job"]["id"]
        assert not after["job"]["success"]
        if control == "pause":
            assert after["status"] == "paused"
            command(workshop, "resume")
            workshop.thread.join(5)
            assert not workshop.thread.is_alive()
            assert workshop.task["success"] and workshop.task["status"] == "completed"
            assert len(workshop.history) == 150, "Pause must not consume a trajectory frame"
            assert workshop._find("welder_1")["position"] == (
                [1.55, -.25, 0] if action == "enter_welder" else [4.2, -1.4, 0]
            )
        else:
            workshop.thread.join(5)
            assert not workshop.thread.is_alive() and after["status"] == "stopped"
            # The retired worker must be gone before a new task can own the scene.
            monkeypatch.setattr(workshop, "_wait", original_wait)
            restarted = command(workshop, action)
            workshop.thread.join(5)
            assert restarted["task_id"] != accepted["task_id"]
            assert not workshop.thread.is_alive() and workshop.task["success"]
            assert len(workshop.history) == 150
    finally:
        release_wait.set()
        workshop.close()


def test_stop_releases_paused_drive_worker_without_another_frame(monkeypatch):
    workshop = Workshop(store=None, speed=0)
    entered_wait = threading.Event()
    original_wait = workshop._wait

    def observed_wait():
        entered_wait.set()
        return original_wait()

    try:
        # Hold the scene lock so pause commits before the worker can start motion.
        with workshop.lock:
            accepted = command(workshop, "enter_welder")
            command(workshop, "pause")
            monkeypatch.setattr(workshop, "_wait", observed_wait)
        assert entered_wait.wait(5)
        stopped = command(workshop, "stop")
        workshop.thread.join(5)
        assert not workshop.thread.is_alive()
        assert workshop.history == []
        assert workshop.task["id"] == accepted["task_id"]
        assert stopped["state"]["status"] == workshop.task["status"] == "stopped"
        assert not workshop.task["success"]
    finally:
        workshop.close()


def test_pause_before_final_pacing_ends_defers_drive_completion(monkeypatch):
    workshop = Workshop(store=None, speed=1)
    paced_last_frame, release_pacing, reached_boundary = (
        threading.Event(), threading.Event(), threading.Event()
    )
    original_wait = workshop._wait
    original_finish = workshop._finish

    def controlled_pacing(timeout=None):
        if len(workshop.history) == 150:
            paced_last_frame.set()
            assert release_pacing.wait(5)
        return workshop.cancel.is_set()

    def observed_wait():
        if paced_last_frame.is_set():
            reached_boundary.set()
        return original_wait()

    def observed_finish(physical):
        reached_boundary.set()
        return original_finish(physical)

    try:
        monkeypatch.setattr(workshop.cancel, "wait", controlled_pacing)
        monkeypatch.setattr(workshop, "_wait", observed_wait)
        monkeypatch.setattr(workshop, "_finish", observed_finish)
        accepted = command(workshop, "enter_welder")
        assert paced_last_frame.wait(5)
        command(workshop, "pause")
        release_pacing.set()
        assert reached_boundary.wait(5)
        paused = workshop.snapshot()
        assert paused["status"] == "paused" and not paused["job"]["success"]
        assert paused["job"]["id"] == accepted["task_id"]
        assert len(workshop.history) == 150
        command(workshop, "resume")
        workshop.thread.join(5)
        assert not workshop.thread.is_alive()
        assert workshop.task["status"] == "completed" and workshop.task["success"]
        assert len(workshop.history) == 150
    finally:
        release_pacing.set()
        workshop.close()
