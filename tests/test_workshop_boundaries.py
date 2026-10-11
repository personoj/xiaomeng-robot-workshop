"""Synthetic identities/model selections only; no online decision API or device."""
import copy
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from embodied_jev.workshop import Workshop
from embodied_jev.workshop_api import WorkshopCommand, ResolveRequest, workshop_router
from embodied_jev.workshop_decision import reference_facts, resolve_payload


@pytest.fixture
def workshop():
    value = Workshop(store=None, speed=0)
    try:
        yield value
    finally:
        value.close()


def command(workshop, action, **params):
    return workshop.command({"request_id": uuid.uuid4().hex, "action": action,
                             "expected_revision": workshop.revision, **params})


def choose(workshop, selection, after=None):
    def evaluate(state, questions):
        assert selection in questions["selection"]["criteria"]
        if after:
            after()
        return {"answers": {"selection": {"choice": selection}}, "model": "synthetic",
                "elapsed_ms": 0, "server_ms": 0}
    workshop.decision.evaluate = evaluate


@pytest.mark.parametrize("text", ["焊接第一排", "焊接最上面那条缝"])
def test_single_panel_first_seam_and_multiple_panel_ambiguity(text):
    panels = [{"id": "panel_1", "kind": "panel", "name": "管排1"}]
    state, _, commands = resolve_payload("weld", text, panels)
    assert state["guard_result"] is None and state["seam_number"] == 1
    assert commands["panel_1__seam_1"]["target"] == "panel_1"
    panels.append({"id": "panel_2", "kind": "panel", "name": "管排2"})
    state, _, _ = resolve_payload("weld", text, panels)
    assert state["guard_result"] == "clarify"
    assert "管排编号" in state["clarification_message"]


def test_asr_homophone_and_absent_unnumbered_correction_remain_model_evidence(workshop):
    command(workshop, "remove", object_id="blue_ball_2")
    choose(workshop, "blue_ball_1__to__red_tray_1")
    result = workshop.resolve("pick_place", "把篮球放到红盘子里", workshop.revision)
    assert result["command"]["source"] == "blue_ball_1"
    # The absent unnumbered fragment must not preempt the model's full-sentence choice.
    objects = [{"id": "blue_ball_5", "kind": "ball", "color": "blue", "name": "蓝球5"},
               {"id": "red_tray_1", "kind": "tray", "color": "red", "name": "红盘1"}]
    facts, guard = reference_facts("pick_place", "蓝色方块、蓝球五放进红盘1", objects)
    assert guard is None
    assert facts[0]["strict"] is False
    assert facts[1]["strict"] is True and facts[1]["matching_ids"] == ["blue_ball_5"]


def test_plain_cube_command_cannot_be_silently_replaced_with_ball(workshop):
    choose(workshop, "blue_ball_1__to__red_tray_1")
    with pytest.raises(ValueError, match="编号或位置"):
        workshop.resolve("pick_place", "把蓝色方块放进红盘1", workshop.revision)
    assert workshop.task is None


def test_explicit_nonexistent_number_rejects_before_model_and_never_reuses_ids(workshop):
    workshop.decision.evaluate = lambda *_: pytest.fail("Missing explicit ID must not call the model")
    assert workshop.resolve("pick_place", "把蓝球五放进红盘1", workshop.revision)["reason"] == "not_found"
    command(workshop, "remove", object_id="blue_ball_1")
    assert command(workshop, "spawn", kind="ball", color="blue")["created"]["id"] == "blue_ball_3"


def test_decision_invalidates_if_scene_changes_while_model_is_running(workshop):
    choose(workshop, "blue_ball_1__to__red_tray_1",
           after=lambda: command(workshop, "remove", object_id="blue_ball_1"))
    with pytest.raises(ValueError, match="旧选择已作废"):
        workshop.resolve("pick_place", "把蓝球1放进红盘1", workshop.revision)
    assert workshop.task is None


@pytest.mark.parametrize("status", ["running", "paused"])
@pytest.mark.parametrize("kind,color", [("ball", "green"), ("cube", "green"), ("tray", "green")])
def test_only_table_props_can_be_added_during_welding(workshop, status, kind, color):
    for item in list(workshop.objects):
        if item["kind"] in {"ball", "cube", "tray"}:
            command(workshop, "remove", object_id=item["id"])
    workshop.task = {"id": "synthetic-weld", "action": "weld_seam", "status": status,
                     "phase": "welding", "source": "welder_1", "target": "panel_1"}
    identity, task = workshop.scene_id, copy.deepcopy(workshop.task)
    robot, panel = copy.deepcopy(workshop._find("welder_1")), copy.deepcopy(workshop._find("panel_1"))
    created = command(workshop, "spawn", kind=kind, color=color)["created"]
    assert created["kind"] == kind and workshop.task == task
    assert workshop.scene_id == identity
    assert workshop._find("welder_1") == robot and workshop._find("panel_1") == panel
    for action, params in [("spawn", {"kind": "panel", "color": "steel"}),
                           ("summon_welder", {}), ("remove", {"object_id": "panel_1"}),
                           ("pick_place", {"source": created["id"], "target": "panel_1"})]:
        with pytest.raises(ValueError, match="当前任务"):
            command(workshop, action, **params)
    workshop.task["action"] = "pick_place"
    with pytest.raises(ValueError, match="当前任务"):
        command(workshop, "spawn", kind="ball", color="yellow")


def test_new_server_accepts_legacy_requests_but_rejects_stale_guarded_runtime(workshop):
    snapshot = workshop.snapshot()
    assert snapshot["capabilities"]["runtime_identity_guard"] is True
    legacy = WorkshopCommand(request_id="legacy", action="set_view", expected_revision=workshop.revision, view=1)
    assert workshop.command(legacy.model_dump(exclude_none=True))["ok"]
    guarded = WorkshopCommand(request_id="guarded", action="set_view", expected_revision=workshop.revision,
                              expected_runtime_id=workshop.runtime_id, view=2)
    payload = guarded.model_dump(exclude_none=True)
    assert workshop.command(payload)["ok"]
    assert workshop.command(payload)["duplicate"]
    before = copy.deepcopy(workshop.objects)
    for action, params in [("spawn", {"kind": "ball", "color": "green"}), ("set_view", {"view": 3})]:
        with pytest.raises(ValueError, match="服务已重启"):
            command(workshop, action, expected_runtime_id="old-runtime-with-same-revision", **params)
    assert workshop.objects == before and workshop.view == 2
    workshop.decision.evaluate = lambda *_: pytest.fail("Stale runtime must not call the model")
    value = ResolveRequest(operation="remove", utterance="蓝球1", expected_revision=workshop.revision,
                           expected_runtime_id="old-runtime-with-same-revision")
    with pytest.raises(ValueError, match="服务已重启"):
        workshop.resolve(value.operation, value.utterance, value.expected_revision, value.expected_runtime_id)


def test_resolved_command_carries_the_original_runtime(workshop):
    choose(workshop, "blue_ball_1")
    result = workshop.resolve("remove", "蓝球1", workshop.revision, workshop.runtime_id)
    assert result["expected_runtime_id"] == workshop.runtime_id
    assert result["expected_revision"] == workshop.revision


def test_http_runtime_guard_and_legacy_wire_compatibility(workshop):
    app = FastAPI()
    app.include_router(workshop_router(workshop))
    choose(workshop, "blue_ball_1")
    with TestClient(app) as client:
        revision = workshop.revision
        resolution = {"operation": "remove", "utterance": "蓝球1", "expected_revision": revision}
        assert client.post("/api/workshop/resolve", json={**resolution, "expected_runtime_id": "retired"}).status_code == 409
        current = client.post("/api/workshop/resolve", json={**resolution, "expected_runtime_id": workshop.runtime_id})
        assert current.status_code == 200
        assert current.json()["expected_runtime_id"] == workshop.runtime_id
        assert client.post("/api/workshop/resolve", json=resolution).status_code == 200
        mutation = {"request_id": "http-guard", "action": "remove", "object_id": "blue_ball_1", "expected_revision": revision}
        assert client.post("/api/workshop/command", json={**mutation, "expected_runtime_id": "retired"}).status_code == 409
        assert any(item["id"] == "blue_ball_1" for item in workshop.objects)
        assert client.post("/api/workshop/command", json={**mutation, "expected_runtime_id": ""}).status_code == 422
        assert client.post("/api/workshop/command", json=mutation).status_code == 200
        assert client.post("/api/workshop/command", json=mutation).json()["duplicate"] is True
