// Compact visual chapter signposts; full mathematical animations live in the board.
const wrap = body => `<svg viewBox="0 0 120 72" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const dot=(x,y,r=2,orange=false)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${orange?'#ffa447':'#66d7ff'}"/>`;
const dots=()=>Array.from({length:26},(_,i)=>{const a=i*2.4,r=5+Math.sqrt(i/26)*25;return dot(60+Math.cos(a)*r*1.6,37+Math.sin(a)*r,1.5);}).join('');
const edge=(points,color='#6fd6ff')=>`<polyline points="${points}" stroke="${color}" stroke-width="2"/>`;
export function principleThumbnail(topic,index){
  if(topic==='pointnet')return wrap(dots()+[
    dot(27,41,3,true)+dot(77,20,3,true)+dot(86,48,3,true),
    '<circle cx="60" cy="37" r="22" fill="#72ccff18" stroke="#5ea8d9"/><ellipse cx="60" cy="37" rx="22" ry="8" stroke="#70c9ee60"/>'+dot(60,37,3,true),
    '<rect x="39" y="44" width="9" height="16" rx="2" fill="#ed983e"/><rect x="56" y="33" width="9" height="27" rx="2" fill="#ed983e"/><rect x="73" y="39" width="9" height="21" rx="2" fill="#ed983e"/>',
  ][index]);
  if(topic==='coordinates')return wrap([
    edge('31,55 78,55')+edge('31,55 31,13')+edge('31,55 62,19','#ffaf58')+'<path d="M59 54 A28 28 0 0 0 47 31" stroke="#ffaf58" stroke-width="2"/>',
    edge('24,52 58,39','#ffaf58')+edge('58,39 78,13')+edge('24,52 78,13','#f1f6ff70')+dot(24,52)+dot(58,39,3,true)+dot(78,13),
    edge('20,48 60,32 100,18')+dot(20,48,5)+dot(60,32,5,true)+dot(100,18,5),
  ][index]);
  if(topic==='inverse_kinematics')return wrap(edge('24,57 47,27 77,16')+dot(24,57,4)+dot(47,27,4)+dot(77,16,4)+[
    '<circle cx="89" cy="43" r="6" stroke="#ffaf58" stroke-width="2"/>'+edge('77,16 89,43','#ffaf58'),
    '<path d="M77 16 Q96 26 83 42" stroke="#ffaf58" stroke-width="2" stroke-dasharray="3 5"/>'+dot(83,42,4,true),
    edge('24,57 65,55 77,16','#ffaf58')+dot(65,55,4,true),
  ][index]);
  return wrap('<circle cx="59" cy="36" r="14" fill="#728ba54d" stroke="#7791a8"/>'+[
    '<circle cx="59" cy="36" r="24" stroke="#ffaf58" stroke-dasharray="4 4"/>',
    edge('15,36 25,50 43,64 75,62 99,45 110,36','#7edfbe')+dot(15,36,3)+dot(110,36,3,true),
    edge('15,36 48,63 110,36','#7edfbe')+dot(72,52,5)+dot(110,36,3,true),
  ][index]);
}
