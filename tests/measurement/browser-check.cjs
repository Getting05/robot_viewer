const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE || undefined,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader']});
try {
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[]; page.on('pageerror',error=>errors.push(error.message));
await page.goto(process.env.VIEWER_URL || 'http://127.0.0.1:3000');
await page.waitForFunction(()=>window.app?.measurementController);
for (const type of ['urdf','mjcf']) {
const name = type === 'urdf' ? 'two-links.urdf' : 'two-links.xml';
const xml=fs.readFileSync(require('node:path').join(__dirname,'fixtures',name),'utf8');
await page.evaluate(async ({type,name,xml})=> {
 const {ModelLoaderFactory}=await import('/src/loaders/ModelLoaderFactory.js');
 const model=await ModelLoaderFactory.loadModel(type,xml,name);
 await window.app.handleModelLoaded(model,new File([xml],name));
}, {type,name,xml});

await page.waitForTimeout(500); // Model-ready framing runs after the geometry load.
await page.click('#show-link-origins');
const origin=await page.evaluate(async()=>{
 const c=window.app.measurementController;
 const {resolvePoint}=await import('/src/utils/MeasurementMath.js');
 return c.screenPoint(resolvePoint(c.special.find(p=>p.kind==='link'&&p.name==='arm')));
});
await page.mouse.move(origin.clientX,origin.clientY);
assert.match(await page.locator('#measure-tooltip').textContent(),/arm/);
await page.mouse.click(origin.clientX,origin.clientY);
assert.match(await page.locator('#link-origin-info').textContent(),/hinge/);
await page.click('#measure-tool');
await page.locator('[data-role=unit]').selectOption('m');
for (const [index, values] of [[0,['0','0','0']], [1,['3','4','12']]]) {
 for(let axis=0;axis<3;axis++) await page.locator(`[data-point="${index}"] input`).nth(axis).fill(values[axis]);
 await page.locator(`[data-point="${index}"] button`).click();
}
assert.match(await page.locator('[data-role=result]').textContent(), /13\.00000 m/);
await page.locator('[data-role=unit]').selectOption('mm');
assert.match(await page.locator('[data-role=result]').textContent(),/13000\.00 mm/);
await page.locator('[data-role=unit]').selectOption('m');
const results=await page.evaluate(async ()=> {
 const app=window.app, c=app.measurementController, sm=app.sceneManager;
 const {resolvePoint,freePoint}=await import('/src/utils/MeasurementMath.js');
 const THREE=await import('/node_modules/three/build/three.module.js');
 const report={linkCount:c.originMarkers.size, special:c.special.map(p=>p.kind)};
 const arm=c.special.find(p=>p.kind==='com'&&p.name==='arm');
 c.points=[arm,freePoint(new THREE.Vector3(3,4,12))]; c.reference=arm.link.threeObject;
 c.setFrame('local'); const before=resolvePoint(c.points[1]).clone(); c.setFrame('world');
 report.frameStable=before.distanceTo(resolvePoint(c.points[1]))<1e-8;
 const start=resolvePoint(arm).clone(); app.poseController.setJointValue('hinge',0.6); sm.currentModel.threeObject.updateMatrixWorld(true);
 report.boundMoved=start.distanceTo(resolvePoint(arm))>0.01;
 report.freeFixed=resolvePoint(c.points[1]).distanceTo(new THREE.Vector3(3,4,12))<1e-8;
 c.setFrame('local'); c.setCoordinates(0,['0','0','0']); report.referenceRetained=!!c.reference;
 c.infoLink=arm.link; c.origins=true; c.refresh();
 report.info=c.panel.info.textContent;
 // Screen-distance snap and disabled categories.
 c.snap={enabled:true,link:true,joint:false,com:false,projection:false};
 const candidate=c.special.find(p=>p.kind==='link'&&p.name==='base');
 report.onlyLinks=c.candidates().every(p=>p.kind==='link');
 report.snap=!!c.nearestScreenPoint(c.screenPoint(resolvePoint(candidate)),[candidate]);
 const screen=c.screenPoint(resolvePoint(candidate)); screen.clientX+=13;
 report.outsideSnap=!c.nearestScreenPoint(screen,[candidate]);
 // Ground selection uses the opposite point's projection.
 c.handleSelection({name:'arm',threeObject:arm.link.threeObject},null,'link');
 c.handleSelection({name:'ground'},null,'link');
 const a=resolvePoint(c.points[0],sm.groundPlane), b=resolvePoint(c.points[1],sm.groundPlane);
 report.groundVertical=Math.abs(a.x-b.x)<1e-8&&Math.abs(a.z-b.z)<1e-8;
 const memoryBefore={...sm.renderer.info.memory};
 for(let i=0;i<100;i++){ c.refresh(); c.clearMeasurement(); c.points=[freePoint(new THREE.Vector3()),freePoint(new THREE.Vector3(1,2,3))]; }
 c.refresh(); sm.render(); report.memoryBefore=memoryBefore;report.memoryAfter={...sm.renderer.info.memory};
 const warmed={...sm.renderer.info.memory};
 for(let i=0;i<30;i++) { c.clearMeasurement(); c.points=[freePoint(new THREE.Vector3()),freePoint(new THREE.Vector3(1,2,3))]; sm.render(); }
 report.stableResources=JSON.stringify(warmed)===JSON.stringify(sm.renderer.info.memory);
 const savedVisible=sm.currentModel.threeObject.visible;
 sm.currentModel.threeObject.visible=false;c.refresh();report.unsupportedHidden=!sm.measurementManager.measurementHelper.visible&&!c.transform.object;
 sm.currentModel.threeObject.visible=savedVisible;c.refresh();
 return report;
});
console.log(type,JSON.stringify(results));
for(const key of ['frameStable','boundMoved','freeFixed','referenceRetained','onlyLinks','snap','outsideSnap','groundVertical','stableResources','unsupportedHidden']) assert.equal(results[key],true,key);
assert.match(results.info,/hinge/);

// Reset to a visible, near-robot pair and exercise actual mouse picking/dragging.
const target=await page.evaluate(async()=>{
 const app=window.app,c=app.measurementController,sm=app.sceneManager;
 app.poseController.setJointValue('hinge',0);
 c.clearMeasurement(); c.setActive(true); c.snap.enabled=false; c.origins=false;
 document.querySelectorAll('#file-tree-panel, #joint-controls-panel, #graph-panel, #code-editor-panel').forEach(n=>n.style.visibility='hidden');
 sm.currentModel.threeObject.updateMatrixWorld(true);
 const THREE=await import('/node_modules/three/build/three.module.js');
 const arm=sm.currentModel.links.get('arm').threeObject;
 const screen=c.screenPoint(arm.localToWorld(new THREE.Vector3(0.04,0,0.5)));
 return {screen,hit:!!c.pickSurface(screen),hitObject:c.pickSurface(screen)?.object?.name};
});
assert.equal(target.hit,true,'surface ray hit'); assert.notEqual(target.hitObject,'groundPlane','pick robot rather than ground');
await page.mouse.click(target.screen.clientX,target.screen.clientY);
assert.equal(await page.evaluate(()=>window.app.measurementController.points[0]?.kind),'surface','pointer selects surface');
assert.equal(await page.evaluate(()=>window.app.measurementController.points[0]?.link?.name),'arm','pointer selects robot arm');
if (type==='mjcf') {
 const collisionHit=await page.evaluate(async()=>{
  const c=window.app.measurementController,sm=window.app.sceneManager;
  sm.visualizationManager.toggleVisual(false,sm.currentModel);sm.visualizationManager.toggleCollision(true);
  sm.currentModel.threeObject.updateMatrixWorld(true);
  const THREE=await import('/node_modules/three/build/three.module.js');
  const point=c.screenPoint(sm.currentModel.links.get('base').threeObject.localToWorld(new THREE.Vector3(0.1,0,0)));
  const hit=c.pickSurface(point);
  let collider=false; for(let node=hit?.object;node;node=node.parent) if(node.isURDFCollider) collider=true;
  sm.visualizationManager.toggleVisual(true,sm.currentModel);sm.visualizationManager.toggleCollision(false);
  return collider;
 });
 assert.equal(collisionHit,true,'visible collision geometry can be picked');
}

await page.evaluate(()=>{const c=window.app.measurementController;c.setCoordinates(1,['0.1','0.6','0']);c.selectEndpoint(1);});
const handle=await page.evaluate(()=>{
 const c=window.app.measurementController; window.app.sceneManager.render(); c.transform.updateMatrixWorld(true);
 const arrow=c.transform._gizmo.gizmo.translate.children.find(n=>n.name==='X'&&n.geometry?.type==='CylinderGeometry');
 arrow.geometry.computeBoundingBox();
 const screen=c.screenPoint(arrow.localToWorld(arrow.geometry.boundingBox.getCenter(c.proxy.position.clone())));
 return {screen,position:c.proxy.position.toArray()};
});
await page.mouse.move(handle.screen.clientX,handle.screen.clientY);
const axis=await page.evaluate(()=>window.app.measurementController.transform.axis);
assert.equal(axis,'X','hover X handle');
await page.mouse.down();
assert.equal(await page.evaluate(()=>window.app.sceneManager.controls.enabled),false,'orbit disabled while dragging');
await page.mouse.move(handle.screen.clientX+55,handle.screen.clientY+25,{steps:8});
await page.mouse.up();
const moved=await page.evaluate(()=>({position:window.app.measurementController.proxy.position.toArray(),orbit:window.app.sceneManager.controls.enabled}));
assert.ok(Math.abs(moved.position[0]-handle.position[0])>0.001,'drag moves X');
assert.ok(Math.abs(moved.position[1]-handle.position[1])<1e-8,'drag preserves Y');
assert.ok(Math.abs(moved.position[2]-handle.position[2])<1e-8,'drag preserves Z');
assert.equal(moved.orbit,true,'orbit restored');
const cancelHandle=await page.evaluate(()=>{
 const c=window.app.measurementController; window.app.sceneManager.render();c.transform.updateMatrixWorld(true);
 const arrow=c.transform._gizmo.gizmo.translate.children.find(n=>n.name==='X'&&n.geometry?.type==='CylinderGeometry');
 arrow.geometry.computeBoundingBox();
 return c.screenPoint(arrow.localToWorld(arrow.geometry.boundingBox.getCenter(c.proxy.position.clone())));
});
await page.mouse.move(cancelHandle.clientX,cancelHandle.clientY);await page.mouse.down();
await page.mouse.move(cancelHandle.clientX+35,cancelHandle.clientY+20,{steps:5});
await page.keyboard.press('Escape');await page.mouse.up();
assert.deepEqual(await page.evaluate(()=>window.app.measurementController.proxy.position.toArray()),moved.position,'Escape restores endpoint');
assert.equal(await page.evaluate(()=>window.app.sceneManager.controls.enabled),true,'Escape restores camera');

// Orbit drag must not replace an endpoint.
const beforeOrbit=await page.evaluate(()=>window.app.measurementController.points.map(p=>p.local.toArray()));
await page.mouse.move(450,230);await page.mouse.down();await page.mouse.move(500,280,{steps:6});await page.mouse.up();
assert.deepEqual(await page.evaluate(()=>window.app.measurementController.points.map(p=>p.local.toArray())),beforeOrbit);
await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),`robot-viewer-${type}.png`)});
console.log(type,'POINTER_PICK_DRAG_ORBIT_OK');

await page.evaluate(()=>{const c=window.app.measurementController;c.setActive(false);window.app.sceneManager.removeModel(window.app.sceneManager.currentModel);});
assert.equal(await page.evaluate(()=>window.app.measurementController.points.every(p=>p===null)),true);
}
console.log('ERRORS',errors); assert.deepEqual(errors,[]);
} finally { await browser.close(); }
})();
