const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(process.env.VIEWER_URL || 'http://127.0.0.1:3000');
        await page.waitForFunction(() => window.app?.sceneManager?.viewCube && window.app?.measurementController);
        await page.evaluate(async xml => {
            const { ModelLoaderFactory } = await import('/src/loaders/ModelLoaderFactory.js');
            const model = await ModelLoaderFactory.loadModel('urdf', xml, 'fixture.urdf');
            await window.app.handleModelLoaded(model, new File([xml], 'fixture.urdf'));
        }, fs.readFileSync(path.join(__dirname, 'fixtures', 'two-links.urdf'), 'utf8'));
        await page.waitForTimeout(1200); // SceneManager fits complete models after 1000 ms.
        await page.click('#show-link-origins');
        await page.click('#show-com');
        const marker = await page.evaluate(() => {
            const markers = [...window.app.measurementController.originMarkers.values()];
            return markers.map(marker => ({ count: marker.children.length, meshes: marker.children.every(child => child.isMesh), colors: [...new Set(marker.children.map(child => child.material.color.getHex()))], radius: marker.children[0].geometry.parameters.radius }));
        });
        for (const entry of marker) {
            assert.equal(entry.count, 8); assert.equal(entry.meshes, true);
            assert.deepEqual(entry.colors.sort(), [0xfff4df, 0xf59e0b].sort()); assert.equal(entry.radius, 0.02);
        }
        const views = { front: [0,0,1], back: [0,0,-1], right: [1,0,0], left: [-1,0,0], top: [0,1,0], bottom: [0,-1,0] };
        for (const [name, direction] of Object.entries(views)) {
            const before = await page.evaluate(direction => {
                const sm = window.app.sceneManager;
                const offset = sm.camera.position.clone().set(...direction).addScalar(0.22).normalize();
                const distance = sm.camera.position.distanceTo(sm.controls.target);
                sm.camera.position.copy(sm.controls.target).addScaledVector(offset, distance);
                sm.controls.update(); sm.render();
                return { distance, target: sm.controls.target.toArray(), zoom: sm.camera.zoom };
            }, direction);
            await page.locator(`#view-cube [data-view="${name}"]`).click();
            const after = await page.evaluate(() => {
                const sm = window.app.sceneManager;
                return { direction: sm.camera.position.clone().sub(sm.controls.target).normalize().toArray(), distance: sm.camera.position.distanceTo(sm.controls.target), target: sm.controls.target.toArray(), zoom: sm.camera.zoom };
            });
            assert.ok(after.direction.reduce((sum, value, i) => sum + value * direction[i], 0) > 0.99999, name);
            assert.ok(Math.abs(before.distance - after.distance) < 1e-8, name + ' preserves distance ' + JSON.stringify({before,after}));
            assert.deepEqual(after.target, before.target); assert.equal(after.zoom, before.zoom);
        }
        await page.click('#view-cube [data-view=iso]');
        const beforeDrag = await page.evaluate(() => window.app.sceneManager.camera.position.toArray());
        const rect = await page.locator('.view-cube-viewport').boundingBox();
        await page.mouse.move(rect.x + 60, rect.y + 60); await page.mouse.down();
        await page.mouse.move(rect.x + 95, rect.y + 75, { steps: 8 }); await page.mouse.up();
        const afterDrag = await page.evaluate(() => window.app.sceneManager.camera.position.toArray());
        assert.notDeepEqual(afterDrag, beforeDrag);
        // After dragging, a normal click still switches views.
        await page.click('#view-cube [data-view=iso]');
        const iso = await page.evaluate(() => window.app.sceneManager.camera.position.clone().sub(window.app.sceneManager.controls.target).normalize().toArray());
        assert.ok(iso.every(value => Math.abs(value - 1 / Math.sqrt(3)) < 1e-8));
        for (const theme of ['dark','light']) {
            await page.evaluate(theme => { document.documentElement.dataset.theme = theme; window.app.sceneManager.updateBackgroundColor(); }, theme);
            await page.waitForTimeout(600);
            await page.screenshot({ path: path.join(require('node:os').tmpdir(), `robot-cube-${theme}.png`) });
        }
        assert.deepEqual(errors, []);
        console.log('SPHERICAL_ORIGINS_SIX_FACE_CLICKS_ORBIT_DISTANCE_DRAG_THEMES_OK');
    } finally { await browser.close(); }
})();
