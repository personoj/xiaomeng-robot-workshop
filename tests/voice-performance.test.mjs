import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceVisuals} from '../frontend/voice-visuals.js';
import {installVoiceHarness} from '../scripts/voice-performance-harness.mjs';

test('idle meters stop RAF; telemetry, reset and resize wake them without duplicate frames',()=>{
  const h=installVoiceHarness();let meter;
  try{
    meter=new VoiceVisuals(h.canvas,h.bars,h.caption);
    for(let i=0;i<120;i++)h.step();
    assert.equal(h.stats.callbacks,1);assert.equal(h.stats.pendingFrames,0);
    meter.activity.update({channel:'output',active:true,level:.5});
    meter.activity.update({channel:'output',active:true,level:.6});
    assert.equal(h.stats.pendingFrames,1);
    h.step();assert.ok(meter.output>0);assert.equal(h.canvas.dataset.active,'true');
    for(let i=0;i<150;i++)h.step();
    assert.equal(meter.output,0);assert.equal(h.canvas.dataset.active,'false');
    assert.equal(h.stats.pendingFrames,0);
    const draws=h.stats.draws;meter.resize.callback();h.step();assert.equal(h.stats.draws,draws+1);
    meter.activity.update({channel:'input',active:true,level:.8,text:'合成测试'});h.step();
    assert.equal(h.caption.textContent,'合成测试');
    assert.equal(h.caption.parentElement.dataset.active,'true');
    meter.activity.reset();h.step();assert.equal(h.caption.textContent,'');
    assert.equal(h.caption.parentElement.dataset.active,'false');
    for(let i=0;i<120;i++)h.step();assert.equal(h.stats.pendingFrames,0);
  }finally{meter?.dispose();h.restore();}
});

test('a sleeping transcript expires on its original clock and disposal cancels all wakes',()=>{
  const h=installVoiceHarness();let meter;
  try{
    meter=new VoiceVisuals(h.canvas,h.bars,h.caption);h.step();
    meter.activity.transcript('合成文本');h.step();
    assert.equal(h.caption.textContent,'合成文本');assert.equal(h.stats.pendingFrames,0);assert.equal(h.stats.pendingTimers,1);
    h.step(6400);assert.equal(h.caption.textContent,'合成文本');
    h.step(100);assert.equal(h.caption.textContent,'');assert.equal(h.stats.pendingTimers,0);
    meter.activity.transcript('停止后不重画');h.step();meter.dispose();
    assert.equal(h.stats.pendingFrames,0);assert.equal(h.stats.pendingTimers,0);
    const callbacks=h.stats.callbacks;meter.activity.reset();meter.resize.callback();h.step(7000);
    assert.equal(h.stats.callbacks,callbacks);
  }finally{meter?.dispose();h.restore();}
});
