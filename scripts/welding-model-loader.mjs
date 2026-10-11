import fs from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FontLoader} from 'three/addons/loaders/FontLoader.js';
import {createXiaomengH} from '../frontend/welding-model.js';
const folder=new URL('../frontend/public/models/xiaomeng-h/',import.meta.url);
export async function loadWeldingModel(options={}){
  const loader=new GLTFLoader(),font=new FontLoader().parse(JSON.parse(await fs.readFile(new URL('helvetiker_regular.typeface.json',folder),'utf8')));
  return createXiaomengH({...options,font,loadLink:async name=>{const b=await fs.readFile(new URL(name+'.glb',folder));return (await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}});
}
