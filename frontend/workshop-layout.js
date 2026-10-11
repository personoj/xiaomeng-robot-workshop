// All presets share one world. Panel identity is separate from its reusable bay.
export const PANEL_BAYS=[1.1,4.5,7.9,11.3,14.7].map(x=>[x,2.25,1.25]);
export const ROBOT_SPAWN=[4.2,-1.4,0];
export const STITCH_PATTERN={count:14,length:.032,firstCentre:1.15,lastCentre:-1.15};
export function parkingForPanel(panel){return {position:[panel.position[0]-.03,panel.position[1]-1.8178,0],heading:-Math.PI/2};}
export function rollWheels(root,previous,current,heading){
  const travel=(current[0]-previous[0])*Math.cos(heading)+(current[1]-previous[1])*Math.sin(heading);
  root.traverse(o=>{if(o.name==='road-wheel-rotor')o.rotation.y+=travel/.254;});
  return travel/.254;
}
