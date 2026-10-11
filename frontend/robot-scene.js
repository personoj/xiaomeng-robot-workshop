import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PhysicsPose, PoseTimeline } from './physics-pose.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export class RobotScene {
  constructor(
    container,
    {
      label = "MuJoCo 机械臂三维场景",
      pixelRatio = 2,
      onError = () => {},
    } = {},
  ) {
    this.container = container;
    this.objects = new Map();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#eef2f1");
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 20);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
    });
    this.metrics={assetLoads:0,assetBuildMs:0,draws:0,drawMs:0};
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, pixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.setAttribute("aria-label", label);
    container.prepend(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.65;
    this.controls.maxDistance = 3.2;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0xa6b9ad, 1.3);
    hemisphere.position.set(0, 0, 3);
    this.scene.add(hemisphere);
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(-0.8, -1.1, 2.5);
    light.castShadow = true;
    light.shadow.mapSize.set(
      pixelRatio < 2 ? 512 : 1024,
      pixelRatio < 2 ? 512 : 1024,
    );
    Object.assign(light.shadow.camera, {
      left: -1.2,
      right: 1.2,
      top: 1.2,
      bottom: -1.2,
    });
    light.shadow.normalBias = 0.001;
    light.shadow.bias = -0.0001;
    this.scene.add(light);
    const fill = new THREE.DirectionalLight(0xdce9ff, 0.6);
    fill.position.set(1, 1, 1.4);
    this.scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0xeef2f1, roughness: 0.93 }),
    );
    floor.position.z = -0.075;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.robot = new THREE.Group();
    this.scene.add(this.robot);
    this.controls.addEventListener("change", () => this.requestRender());
    this.renderer.domElement.addEventListener("webglcontextlost", () => {
      if (!this.disposed) onError("三维渲染上下文已丢失，请刷新页面");
    });
    this.observer = new ResizeObserver(() => {
      if (!container.clientWidth || !container.clientHeight) return;
      this.renderer.setSize(
        container.clientWidth,
        container.clientHeight,
        false,
      );
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.requestRender();
    });
    this.observer.observe(container);
    this.cameraHome();
  }

  cameraHome() {
    this.camera.position.set(1.4, -1.65, 1.27);
    this.controls.target.set(0.32, 0, 0.24);
    this.controls.update();
    this.requestRender();
  }

  cameraTop() {
    this.camera.position.set(0.42, -0.001, 1.85);
    this.controls.target.set(0.4, 0, 0.05);
    this.controls.update();
    this.requestRender();
  }

  clearRobot() {
    const geometries=new Set(),materials=new Set();
    for(const mesh of this.objects.values()){geometries.add(mesh.geometry);materials.add(mesh.material);}
    for(const geometry of geometries)geometry.dispose();
    for(const material of materials)material.dispose();
    this.robot.clear();this.physicsPose=null;this.poseTimeline=null;this.displayedFrame=null;
    this.objects.clear();
  }

  load(data) {
    const started=performance.now();
    this.clearRobot();
    this.lastFrame = null;
    const geometryCache=new Map();
    if(data.kinematics){this.physicsPose=new PhysicsPose(this.robot,data.kinematics);this.poseTimeline=new PoseTimeline(data.kinematics);}
    for (const item of data.geometries) {
      const key=item.type===7?'mesh:'+item.mesh:item.type+':'+item.size.join(',');
      let geometry=geometryCache.get(key);
      if(!geometry){
        if (item.type === 7) {
          const mesh = data.meshes[item.mesh];
          geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3),
          );
          geometry.setIndex(mesh.faces.flat());
          geometry.computeVertexNormals();
        } else if (item.type === 6) {
          geometry = new THREE.BoxGeometry(...item.size.map((size) => size * 2));
        } else if (item.type === 2) {
          geometry = new THREE.SphereGeometry(item.size[0], 24, 16);
        } else if (item.type === 5) {
          geometry = new THREE.CylinderGeometry(
            item.size[0],
            item.size[0],
            item.size[1] * 2,
            32,
          );
          geometry.rotateX(Math.PI / 2);
        } else continue;
        geometryCache.set(key,geometry);
      }
      const [red, green, blue, alpha] = item.color;
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(red, green, blue).convertSRGBToLinear(),
        roughness: item.name === "cube_geom" ? 0.35 : 0.56,
        metalness: 0.08,
        transparent: alpha < 1,
        opacity: alpha,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.visible=alpha>0;
      if(this.physicsPose)this.physicsPose.attach(mesh,item);else this.robot.add(mesh);
      this.objects.set(item.id, mesh);
    }
    this.metrics.assetLoads++;this.metrics.assetBuildMs=performance.now()-started;
    this.renderer.shadowMap.needsUpdate=true;
    this.requestRender();
  }

  render(frame,{moving=false}={}) {
    const motionChanged=this.poseMoving!==moving;this.poseMoving=moving;
    if (
      !frame ||
      (!motionChanged&&this.lastFrame?.time === frame.time &&
        JSON.stringify(this.lastFrame.qpos) === JSON.stringify(frame.qpos))
    )
      return;
    this.lastFrame = frame;
    if(this.physicsPose){this.poseTimeline.push(frame,moving);this.requestRender();return;}
    for (const [id, mesh] of this.objects) {
      const position = frame.positions[id],
        rotation = frame.rotations[id];
      if (!position || !rotation) continue;
      mesh.position.set(...position);
      mesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().set(
          rotation[0],
          rotation[1],
          rotation[2],
          0,
          rotation[3],
          rotation[4],
          rotation[5],
          0,
          rotation[6],
          rotation[7],
          rotation[8],
          0,
          0,
          0,
          0,
          1,
        ),
      );
    }
    this.renderer.shadowMap.needsUpdate=true;
    this.requestRender();
  }

  drawScene(now=performance.now()){
    const pose=this.poseTimeline?.sample(now);
    if(pose&&pose!==this.displayedFrame){this.physicsPose.apply(pose);this.displayedFrame=pose;this.renderer.shadowMap.needsUpdate=true;}
    const started=performance.now();this.renderer.render(this.scene,this.camera);
    this.metrics.draws++;this.metrics.drawMs=performance.now()-started;
    if(this.poseTimeline?.pending(now))this.requestRender();
  }

  requestRender() {
    if (this.renderRequested || this.disposed) return;
    this.renderRequested = true;
    requestAnimationFrame(() => {
      this.renderRequested = false;
      if (
        this.disposed ||
        !this.container.clientWidth ||
        !this.container.clientHeight
      )
        return;
      this.controls.update();
      this.drawScene();
    });
  }

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.controls.dispose();
    this.clearRobot();
    this.scene.traverse((object) => {
      object.geometry?.dispose();
      object.material?.dispose();
      object.shadow?.map?.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
