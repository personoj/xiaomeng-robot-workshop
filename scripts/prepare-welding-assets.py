"""Convert the pinned, official FANUC visual meshes without changing geometry.

Requires trimesh and pycollada. Source checkout lives under .local/vendor.
Output preserves the source's metre / Z-up coordinates for the articulated viewer.
"""
from pathlib import Path
import json
import shutil
import xml.etree.ElementTree as ET
import trimesh

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.local/vendor/fanuc_description'
OUT = ROOT / 'frontend/public/models/xiaomeng-h'
OUT.mkdir(parents=True, exist_ok=True)
package = SOURCE / 'fanuc_m10_description'
macro = package / 'urdf/m10_8_20d_urdf_macro.xacro'
links = []
for path in sorted((package / 'meshes/m10_8_20d/visual').glob('*.dae')):
    scene = trimesh.load(path, force='scene')
    scene.metadata.update(source='FANUC-CORPORATION/fanuc_description', units='metres', up_axis='Z')
    scene.export(OUT / (path.stem + '.glb'))
    links.append({'name': path.stem, 'bounds': scene.bounds.tolist(),
                  'triangles': sum(len(g.faces) for g in scene.geometry.values())})
tree = ET.parse(macro)
joints = []
for joint in tree.findall('.//joint'):
    if joint.get('type') != 'revolute':
        continue
    joints.append({'name': joint.get('name').replace('${prefix}', ''),
                   'origin': [float(v) for v in joint.find('origin').get('xyz').split()],
                   'axis': [float(v) for v in joint.find('axis').get('xyz').split()]})
manifest = {'model': 'FANUC M-10iD/8L', 'urdf_alias': 'm10_8_20d',
            'source_commit': 'fb40c9803a826ba68c7c8e28ba904a25efa7fcd2',
            'units': 'metres', 'up_axis': 'Z', 'joints': joints, 'links': links,
            'scope': 'Official arm geometry. Custom chassis and welding accessories are brochure-based approximations.'}
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
shutil.copy2(macro, OUT / macro.name)
shutil.copy2(SOURCE / 'LICENSES/Apache-2.0.txt', OUT / 'FANUC-LICENSE.txt')
print(json.dumps({'links': len(links), 'triangles': sum(l['triangles'] for l in links), 'output': str(OUT)}))
