export const MOTION_DURATION=24;
export const MOTION_KEYFRAMES=[
  [0,-62,-62,0,-90,0],
  [20,-50,-72,20,-80,35],
  [0,-62,-62,0,-90,0],
  [-20,-72,-48,-20,-105,-35],
  [0,-62,-62,0,-90,0],
];
export function sampleMotion(seconds){
  const x=Math.max(0,Math.min(seconds/MOTION_DURATION,1))*(MOTION_KEYFRAMES.length-1);
  const i=Math.min(Math.floor(x),MOTION_KEYFRAMES.length-2),t=x-i;
  const u=t*t*t*(10+t*(-15+6*t)); // Zero velocity and acceleration at reversals.
  return MOTION_KEYFRAMES[i].map((q,j)=>q+(MOTION_KEYFRAMES[i+1][j]-q)*u);
}
