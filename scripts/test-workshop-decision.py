"""Small real API evaluation; uses the server-side config and emits no credentials."""
import json
import statistics
from pathlib import Path

from embodied_jev.workshop_decision import WorkshopDecision,resolve_payload

OBJECTS=[
    {"id":"blue_ball_1","name":"蓝球1","spoken_name":"蓝色一号球","kind":"ball","color":"blue","position":[.35,-.2,.02],"status":"available"},
    {"id":"blue_ball_2","name":"蓝球2","spoken_name":"蓝色二号球","kind":"ball","color":"blue","position":[.55,-.2,.02],"status":"available"},
    {"id":"red_ball_1","name":"红球1","kind":"ball","color":"red","position":[.42,-.07,.02],"status":"available"},
    {"id":"red_tray_1","name":"红盘1","kind":"tray","color":"red","position":[.35,.2,0],"status":"available"},
    {"id":"blue_tray_1","name":"蓝盘1","kind":"tray","color":"blue","position":[.56,.2,0],"status":"available"},
    {"id":"welder_1","name":"焊接机器人1","kind":"welder","color":"yellow","position":[3,0,0],"status":"parked"},
    {"id":"panel_1","name":"管排1","kind":"panel","color":"steel","position":[1,2,1.3],"status":"available"},
]
CASES=[
    ("pick_place","把蓝球2放进红盘1","blue_ball_2__to__red_tray_1"),
    ("pick_place","把蓝色二号球放到红色一号托盘里面","blue_ball_2__to__red_tray_1"),
    ("pick_place","请将蓝球一放入蓝盘一","blue_ball_1__to__blue_tray_1"),
    ("pick_place","把左边的蓝球放进红盘1","blue_ball_1__to__red_tray_1"),
    ("pick_place","把右边那个蓝球放进蓝盘1","blue_ball_2__to__blue_tray_1"),
    ("pick_place","把蓝球放进红盘1","clarify"),
    ("pick_place","把蓝球3放进红盘1","not_found"),
    ("pick_place","把红球1放进红盘2","not_found"),
    ("pick_place","把红球1放到蓝盘1","red_ball_1__to__blue_tray_1"),
    ("pick_place","先添加一个蓝球，再把它放进红盘1","unsupported"),
    ("remove","删除蓝色二号球","blue_ball_2"),
    ("remove","去掉左边的蓝球","blue_ball_1"),
    ("remove","移除蓝球","clarify"),
    ("remove","删除蓝球9","not_found"),
    ("remove","把管排1移除","panel_1"),
    ("spawn","放一个钢管管排进来","add_panel"),
    ("spawn","添加一个蓝色的盘子","add_blue_tray"),
    ("spawn","添加一个红色小球","add_red_ball"),
    ("spawn","把小萌焊接机器人召唤进来","add_welder"),
    ("spawn","添加一个绿色的球","add_green_ball"),
]

client=WorkshopDecision();rows=[]
try:
    for n,(operation,text,expected) in enumerate(CASES):
        state,questions,_=resolve_payload(operation,text,OBJECTS)
        result=client.evaluate(state,questions);actual=result["answers"]["selection"]["choice"]
        rows.append({"operation":operation,"utterance":text,"expected":expected,"actual":actual,"passed":actual==expected,**result})
        print(json.dumps({"case":n+1,"passed":actual==expected,"choice":actual,"elapsed_ms":result["elapsed_ms"]},ensure_ascii=False),flush=True)
finally:client.close()
elapsed=[r["elapsed_ms"] for r in rows]
summary={"model":"decision-model-preview","cases":len(rows),"passed":sum(r["passed"] for r in rows),"median_ms":statistics.median(elapsed),"warm_median_ms":statistics.median(elapsed[1:]),"max_ms":max(elapsed),"scope":"Synthetic Chinese object/intent selection; no physical execution or end-to-end ESP32 timing","rows":rows}
out=Path(__file__).resolve().parents[1]/".local"/"decision-evaluation.json";out.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({k:v for k,v in summary.items() if k!='rows'},ensure_ascii=False))
