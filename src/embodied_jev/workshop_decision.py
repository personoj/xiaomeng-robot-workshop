"""Server-only structured decisions. Credentials never enter scene/tool context."""
from pathlib import Path
from urllib.parse import urlsplit
import json
import math
import re
import threading
import time

import httpx

CONFIG = Path(__file__).resolve().parents[2] / ".local" / "decision.json"


class DecisionUnavailable(RuntimeError):
    pass


class WorkshopDecision:
    def __init__(self,config_path=CONFIG):
        self.config_path=Path(config_path);self.client=None;self.lock=threading.Lock()

    def configuration(self):
        try:
            c=json.loads(self.config_path.read_text(encoding="utf-8"))
            host=urlsplit(c["endpoint"]).hostname or ""
            if not c["endpoint"].startswith("https://") or not (host.endswith(".maas.aliyuncs.com") or host in {"maas.qianwenaiapi.com","dashscope.aliyuncs.com","dashscope-intl.aliyuncs.com"}):
                raise ValueError("Unsupported decision endpoint")
            return c
        except (OSError,ValueError,KeyError):raise DecisionUnavailable("决策模型尚未配置") from None

    def public_status(self):
        try:c=self.configuration();return {"configured":True,"model":c["model"],"provider":"阿里云决策模型"}
        except DecisionUnavailable:return {"configured":False,"model":"decision-model-preview","provider":"阿里云决策模型"}

    def evaluate(self,state,questions):
        c=self.configuration()
        try:key=Path(c["key_file"]).read_text(encoding="utf-8-sig").strip()
        except OSError:raise DecisionUnavailable("无法读取本机决策模型密钥文件") from None
        if not key or "\n" in key or "\r" in key:raise DecisionUnavailable("决策模型密钥文件应只有一行Key")
        with self.lock:
            if self.client is None:self.client=httpx.Client(timeout=httpx.Timeout(25,connect=10),follow_redirects=False)
        start=time.perf_counter()
        try:
            response=self.client.post(c["endpoint"],headers={"Authorization":"Bearer "+key},json={"model":c["model"],"state":state,"questions":questions})
            if response.status_code!=200:raise DecisionUnavailable(f"决策模型请求失败（HTTP {response.status_code}）")
            body=response.json();answers=body.get("answers")
            if not isinstance(answers,dict) or set(answers)!=set(questions):raise ValueError("Missing answers")
            for name,question in questions.items():
                answer=answers[name]
                if question["type"]=="choice":
                    probs=answer.get("probabilities",{})
                    if answer.get("choice") not in question["criteria"] or set(probs)!=set(question["criteria"]):raise ValueError("Unknown candidate")
                    if any(type(p) not in (float,int) or not math.isfinite(p) or not 0<=p<=1 for p in probs.values()) or abs(sum(probs.values())-1)>.03:raise ValueError("Invalid probabilities")
            return {"model":body.get("model",c["model"]),"answers":answers,"elapsed_ms":round((time.perf_counter()-start)*1000,1),"server_ms":body.get("latency_ms"),"usage":body.get("usage",{})}
        except DecisionUnavailable:raise
        except (httpx.HTTPError,ValueError,KeyError,TypeError):raise DecisionUnavailable("决策模型通信或响应格式异常") from None

    def close(self):
        if self.client:self.client.close()


def reference_facts(operation,utterance,objects):
    facts=[];guard=None
    if operation=="spawn":return facts,None
    if re.search(r"先.+(?:再|然后)|(?:添加|放入|放进|删除).+(?:再|然后).+(?:添加|放|删除)",utterance):return facts,"unsupported"
    number=r"[0-9一二两三四五六七八九十]+"
    pattern=rf"(蓝|红|黄|绿)(?:色)?(?:的)?(?:(?P<before>{number})(?:号)?(?P<noun1>托盘|盘子|方块|盘|球|块)|(?P<noun2>托盘|盘子|方块|盘|球|块)(?:\s*(?P<after>{number})(?:号)?)?)"
    def integer(s):
        if s.isdigit():return int(s)
        d={c:i for i,c in enumerate("零一二三四五六七八九")};d["两"]=2
        if "十" in s:
            a,b=s.split("十",1);return (d.get(a,1) if a else 1)*10+(d.get(b,0) if b else 0)
        return d.get(s)
    previous=0
    for match in re.finditer(pattern,utterance):
        color={"蓝":"blue","红":"red","黄":"yellow","绿":"green"}[match[1]]
        noun=match["noun1"] or match["noun2"];kind="ball" if noun=="球" else "cube" if noun in {"方块","块"} else "tray"
        index=match["before"] or match["after"];n=integer(index) if index else None
        candidates=[o for o in objects if o["kind"]==kind and o.get("color")==color and (n is None or o["id"].endswith("_"+str(n)))]
        prefix=utterance[max(previous,match.start()-8):match.start()];previous=match.end()
        direction="left" if "左" in prefix else "right" if "右" in prefix else None
        if direction and len(candidates)>1:
            x=(min if direction=="left" else max)(o["position"][0] for o in candidates)
            candidates=[o for o in candidates if abs(o["position"][0]-x)<.003]
        role="target" if re.search(r"放[到进入]|叠[在到]|摞[在到]",utterance[:match.start()]) else "source"
        fact={"reference":match.group(),"role":role,"kind":kind,"color":color,"explicit_number":n,"position_hint":direction,"matching_ids":[o["id"] for o in candidates],"match_count":len(candidates),"strict":n is not None or bool(candidates)}
        facts.append(fact)
        # An unnumbered noun fragment can precede a spoken correction. Let the
        # decision model read the entire utterance before declaring it absent.
        if not candidates and n is not None:guard="not_found"
        elif len(candidates)>1 and guard!="not_found":guard="clarify"
    for match in re.finditer(rf"(焊接机器人|小萌机器人|小萌\s*H|钢管管排|管排|抓手机械臂|机械臂|抓手)\s*({number})?(?:号)?",utterance,re.I):
        label=match[1];kind="panel" if "管排" in label else "welder" if "焊接" in label or "小萌" in label else "gripper"
        n=integer(match[2]) if match[2] else None
        matches=[o for o in objects if o["kind"]==kind and (n is None or o["id"].endswith("_"+str(n)))]
        facts.append({"reference":match.group(),"role":"source","kind":kind,"explicit_number":n,"matching_ids":[o["id"] for o in matches],"match_count":len(matches)})
        if not matches:guard="not_found"
        elif len(matches)>1 and guard!="not_found":guard="clarify"
    if operation=="remove" and not facts:guard="clarify"
    return facts,guard


def resolve_payload(operation,utterance,objects):
    """Finite candidates refer to actual live IDs; no model-generated coordinates."""
    original=utterance
    utterance=utterance.replace('管牌','管排').replace('钢排','管排').replace('小蒙','小萌')
    utterance=re.sub(r'小萌\s*[Hh]\s*(?:7|七)', '小萌焊接机器人',utterance)
    items=[{k:o[k] for k in ("id","name","spoken_name","kind","color","position","status") if k in o} for o in objects]
    facts,guard=reference_facts(operation,utterance,objects)
    seam_number=None
    if operation=='weld':
        def number(text):
            if text.isdigit():return int(text)
            if text=='两':return 2
            digits='零一二三四五六七八九'
            if '十' in text:
                a,b=text.split('十',1);return (digits.index(a) if a else 1)*10+(digits.index(b) if b else 0)
            return digits.index(text) if text in digits else 0
        nums=r'[0-9一二两三四五六七八九十]+'
        match=re.search(rf'第?\s*({nums})\s*(?:条|号|道)?\s*(?:焊缝|缝|排)',utterance)
        explicit=match and (match.group().lstrip().startswith('第') or '号' in match.group() or match[1].isdigit())
        seam_number=number(match[1]) if explicit else None
        if seam_number is None:
            if re.search(r'最上|最顶|顶部|最上面',utterance):seam_number=1
            elif re.search(r'最下|最底|底部|最下面',utterance):seam_number=7
            elif '中间' in utterance:seam_number=4
        elif '从下' in utterance:seam_number=8-seam_number
        panel_match=re.search(rf'(?:管排\s*({nums})(?:号)?|({nums})号\s*管排)',utterance)
        panel_number=number(panel_match[1] or panel_match[2]) if panel_match else None
        panels=[o for o in objects if o['kind']=='panel' and (panel_number is None or o['id'].endswith('_'+str(panel_number)))]
        facts=[{'reference':'管排','role':'target','matching_ids':[o['id'] for o in panels],'match_count':len(panels)}]
        guard='not_found' if not panels or seam_number is not None and not 1<=seam_number<=7 else 'clarify' if len(panels)>1 or seam_number is None else None
        clarification='请说明要焊接的管排编号。' if len(panels)>1 else '请说明第几条焊缝，或最上面、最下面的缝。'
    candidates={};commands={}
    if operation=="pick_place":
        for source in objects:
            if source["kind"] not in {"ball","cube"}:continue
            for target in objects:
                if target["kind"] not in {"tray","cube"} or target["id"]==source["id"]:continue
                if target["kind"]=="cube" and source["kind"]!="cube":continue
                key=f"{source['id']}__to__{target['id']}"
                candidates[key]=(f"将{source['name']}叠放到{target['name']}上" if target["kind"]=="cube" else f"将{source['name']}放入{target['name']}")
                commands[key]={"action":"pick_place","source":source["id"],"target":target["id"]}
    elif operation=='weld':
        for panel in objects:
            if panel['kind']!='panel':continue
            for seam in range(1,8):
                key=f"{panel['id']}__seam_{seam}"
                candidates[key]=f"焊接{panel['name']}从上往下第{seam}条缝"
                commands[key]={'action':'weld_seam','target':panel['id'],'seam':seam}
    elif operation=="remove":
        for o in objects:
            candidates[o["id"]]=f"移除{o['name']}";commands[o["id"]]={"action":"remove","object_id":o["id"]}
    elif operation=="spawn":
        for kind,label in [("ball","球"),("cube","方块"),("tray","托盘")]:
            for color,cn in [("blue","蓝色"),("red","红色"),("green","绿色"),("yellow","黄色")]:
                key=f"add_{color}_{kind}";candidates[key]=f"添加一个{cn}{label}";commands[key]={"action":"spawn","kind":kind,"color":color}
        for kind,label in [("welder","小萌焊接机器人"),("panel","钢管管排"),("gripper","抓手机械臂")]:
            candidates[f"add_{kind}"]=f"添加一个{label}";commands[f"add_{kind}"]={"action":"spawn","kind":kind,"color":"yellow" if kind=="welder" else "steel"}
            if kind=="welder":
                commands[f"add_{kind}"]={"action":"summon_welder"}
                candidates[f"add_{kind}"]='召唤小萌H7/小蒙H七焊接机器人，在固定出生位出现；H7是型号，不是对象编号7，已有实例也可召唤'
    else:raise ValueError("Unsupported decision operation")
    if len(candidates)>250:raise ValueError("场内候选对象过多，请先用编号缩小范围")
    candidates.update(clarify="存在多个符合描述的对象，缺少编号或可判定位置，需要用户澄清",not_found="用户明确指定的对象不存在，或没有符合要求的候选",unsupported="指令不属于当前操作，或同时包含多项操作")
    instructions=("根据用户中文原话，从候选中选择唯一匹配的操作。编号严格对应，不把1换成2；一号/1号/1表示同一编号。"
                  "场景X较小是左边、X较大是右边，Y较小是前面。只使用给出的对象。"
                  "有多个符合描述的对象且用户未提供编号或可区分位置，选clarify，不自行挑一个。"
                  "用户明确指定的编号不存在选not_found。其他操作或包含多个步骤选unsupported。"
                  "本题用于选择对象，不是判断机器人是否已完成动作；不要编造执行结果。")
    instructions+=" reference_facts是文字片段匹配证据，不是完整语义。strict=true或未注明strict的事实是编号/位置约束，必须遵守；strict=false只说明某个未编号片段没有字面匹配，不能据此直接判不存在。guard_result非空时选择同名处理选项。"
    instructions+=' 用户输入来自语音转写，可能有同音字、重复和口头改口。结合完整句子与场内候选理解：例如场内有蓝色球时，\"把篮球放进红盘\"中的篮球可能是蓝球的同音转写；\"蓝色方块、蓝球五\"可能是在改口指蓝球五。只在候选能唯一支持纠正时选择；确有冲突选clarify，不能擅改明确编号。普通明确的方块请求不能替换成球。'
    instructions+=' 焊缝从上到下编号1到7，严格使用seam_number，不改变管排或焊缝编号。'
    instructions+=' normalized_utterance已处理语音同音词和设备型号别名。H7或H七是小萌焊接机器人型号，不是第7号对象；召唤该型号选add_welder，即使场内已有该机器人。'
    return {"utterance":original,"normalized_utterance":utterance,"operation":operation,"objects":items,"reference_facts":facts,"guard_result":guard,"seam_number":seam_number,"clarification_message":clarification if operation=='weld' else None},{"selection":{"type":"choice","instructions":instructions,"criteria":candidates}},commands
