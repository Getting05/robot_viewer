import * as THREE from 'three';

/** Reusable measurement geometry. All points and labels use scene world space. */
export class MeasurementManager {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.measurementHelper = new THREE.Group();
        this.measurementHelper.name = 'measurementHelper';
        sceneManager.scene.add(this.measurementHelper);
        this.lines = [];
        this.labels = [];
        for (const color of [0xffd54f, 0xff6565, 0x65db85, 0x72aaff]) {
            const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
            const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
            line.renderOrder = 990;
            this.measurementHelper.add(line);
            this.lines.push(line);
            this.labels.push(this.createLabel(color));
        }
        this.markers = ['A', 'B'].map(name => {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: name === 'A' ? 0xffd54f : 0xffffff, depthTest: false }));
            sprite.name = name;
            sprite.renderOrder = 1000;
            this.measurementHelper.add(sprite);
            return sprite;
        });
        this.clearMeasurement();
    }
    createLabel(color) {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 64;
        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
        sprite.renderOrder = 1000;
        sprite.userData = { canvas, text: null, color: `#${color.toString(16).padStart(6, '0')}` };
        this.measurementHelper.add(sprite);
        return sprite;
    }
    label(sprite, text, position) {
        sprite.position.copy(position);
        if (sprite.userData.text === text) return;
        const { canvas, color } = sprite.userData;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 512, 64);
        ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#18202a'; ctx.lineWidth = 5; ctx.strokeText(text, 256, 32);
        ctx.fillStyle = color; ctx.fillText(text, 256, 32);
        sprite.material.map.needsUpdate = true; sprite.userData.text = text;
    }
    setLine(index, a, b, text, visible) {
        const line = this.lines[index], label = this.labels[index];
        line.visible = label.visible = visible;
        const positions = line.geometry.attributes.position;
        positions.setXYZ(0, a.x, a.y, a.z); positions.setXYZ(1, b.x, b.y, b.z);
        positions.needsUpdate = true; line.geometry.computeBoundingSphere();
        this.label(label, text, a.clone().add(b).multiplyScalar(0.5));
    }
    showPoints(points, result, frame, axis = 'all', unit = 'mm') {
        this.measurementHelper.visible = true;
        const factor = unit === 'mm' ? 1000 : 1;
        const format = n => `${(n * factor).toFixed(unit === 'mm' ? 2 : 5)} ${unit}`;
        this.markers.forEach((marker, i) => { marker.visible = !!points[i]; if (points[i]) marker.position.copy(points[i]); });
        this.lines.forEach(line => { line.visible = false; });
        this.labels.forEach(label => { label.visible = false; });
        if (!result) return;
        this.setLine(0, points[0], points[1], format(result.distance), true);
        let start = points[0].clone();
        ['x', 'y', 'z'].forEach((key, i) => {
            if (axis !== 'all') start.copy(points[0]);
            const vector = new THREE.Vector3(); vector[key] = result.delta[key]; vector.applyQuaternion(frame.rotation);
            const end = start.clone().add(vector);
            this.setLine(i + 1, start, end, `Δ${key.toUpperCase()} ${format(result.delta[key])}`, axis === 'all' || axis === key);
            start = end;
        });
    }
    updateScale(camera, height) {
        const scale = position => camera.isPerspectiveCamera
            ? Math.max(0.001, position.distanceTo(camera.position)) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(height, 1)
            : (camera.top - camera.bottom) / camera.zoom / Math.max(height, 1);
        this.markers.forEach(marker => marker.scale.setScalar(scale(marker.position) * 10));
        this.labels.forEach(label => label.scale.set(scale(label.position) * 190, scale(label.position) * 24, 1));
    }
    clearMeasurement() { this.measurementHelper.visible = false; this.sceneManager.redraw(); }
    clear() { this.clearMeasurement(); }
    dispose() {
        this.measurementHelper.traverse(object => { object.geometry?.dispose(); object.material?.map?.dispose(); object.material?.dispose(); });
        this.measurementHelper.removeFromParent();
    }
}
