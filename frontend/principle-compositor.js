import {lessonFrame} from './principle-lessons.js';
import {drawPrinciple} from './principle-diagrams.js';

export const CHAPTER_BLEND_SECONDS=.7;
const smoother=value=>{const t=Math.max(0,Math.min(1,value));return t*t*t*(t*(t*6-15)+10);};
const layers=new WeakMap();
export function principleTransitionAt(lesson,elapsed,{skipBefore=-1}={}){
  const frame=lessonFrame(lesson,elapsed);
  const boundary=lesson.steps.slice(0,frame.index).reduce((n,s)=>n+s.seconds,0);
  const since=elapsed-boundary;
  const transition=frame.index>0&&boundary>skipBefore&&since<CHAPTER_BLEND_SECONDS;
  const until=boundary+frame.step.seconds-elapsed;
  let contentOpacity=1;
  if(transition)contentOpacity=smoother(since/CHAPTER_BLEND_SECONDS);
  else if(frame.index<lesson.steps.length-1&&until<.4)contentOpacity=smoother(until/.4);
  return {...frame,boundary,blend:transition?smoother(since/CHAPTER_BLEND_SECONDS):1,transition,contentOpacity};
}
function surfaces(context,width,height,createCanvas){
  let pair=layers.get(context);
  if(!pair){
    const make=createCanvas||((w,h)=>{
      if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(w,h);
      if(context.canvas.ownerDocument){const c=context.canvas.ownerDocument.createElement('canvas');c.width=w;c.height=h;return c;}
      throw new Error('Offline composition requires options.createCanvas(width,height).');
    });
    pair=[make(width,height),make(width,height)];layers.set(context,pair);
  }
  for(const canvas of pair)if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  return pair;
}

// The browser and offline reviewer use the same time-based compositor.
// Geometry remains in the same coordinate frame within each topic; transitions
// only bridge consecutive teaching diagrams, never move the physical robot.
export function drawPrincipleTimeline(context,lesson,elapsed,options={}){
  const {width=600,height=430,createCanvas,skipBefore=-1}=options;
  const frame=principleTransitionAt(lesson,elapsed,{skipBefore});
  if(!frame.transition){drawPrinciple(context,lesson.id,frame.index,frame.beat?.visualProgress??frame.progress,{width,height});return frame;}
  const [outgoing,incoming]=surfaces(context,width,height,createCanvas);
  const seconds=elapsed-frame.boundary;
  drawPrinciple(outgoing.getContext('2d'),lesson.id,frame.index-1,1,{width,height,annotationOpacity:1-smoother(seconds/.28)});
  drawPrinciple(incoming.getContext('2d'),lesson.id,frame.index,frame.beat?.visualProgress??frame.progress,{width,height,annotationOpacity:smoother((seconds-.34)/.36)});
  context.save();context.setTransform(1,0,0,1,0,0);context.globalAlpha=1;context.clearRect(0,0,width,height);context.drawImage(outgoing,0,0);
  context.globalAlpha=frame.blend;context.drawImage(incoming,0,0);context.restore();
  return frame;
}
