import {drawCoordinates,drawInverse} from './principle-scenes/spatial.js';
import {drawPointnet,drawPlanning} from './principle-scenes/cloud-planning.js';

// The generated keyframes guide material and composition. Every intermediate
// frame is recomputed from geometry, with no generated-image slideshow.
export function drawPrinciple(ctx,topic,step,progress,{width=600,height=430,annotationOpacity=1}={}){
  // A short flex panel can constrain height independently of width. Keep
  // angles, circles and glyphs in one uniformly scaled teaching coordinate
  // frame instead of stretching them to whatever rectangle the host supplies.
  const scale=Math.min(width/600,height/430);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1;ctx.clearRect(0,0,width,height);
  ctx.fillStyle='#07172b';ctx.fillRect(0,0,width,height);
  ctx.setTransform(scale,0,0,scale,(width-600*scale)/2,(height-430*scale)/2);
  const halo=ctx.createRadialGradient(300,240,5,300,240,315);
  halo.addColorStop(0,'#0d2c46');halo.addColorStop(.65,'#0a2138');halo.addColorStop(1,'#07172b');
  ctx.fillStyle=halo;ctx.fillRect(0,0,600,430);
  const draw={coordinates:drawCoordinates,inverse_kinematics:drawInverse,pointnet:drawPointnet,planning:drawPlanning}[topic];
  if(draw)draw(ctx,step,Math.max(0,Math.min(1,progress)),{annotationOpacity});
  ctx.restore();
}
