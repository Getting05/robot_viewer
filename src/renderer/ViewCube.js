import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { i18n } from '../utils/i18n.js';
import '../ui/view-cube.css';

// Viewer world axes: Y up. Directions point from the orbit target to the camera.
export const VIEW_DIRECTIONS = {
    front: [0, 0, 1], back: [0, 0, -1],
    right: [1, 0, 0], left: [-1, 0, 0],
    top: [0, 1, 0], bottom: [0, -1, 0], iso: [1, 1, 1]
};

/** DOM cube synchronized with the scene camera; no extra WebGL context or render loop. */
export class ViewCube {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(32, 1, 1, 1000);
        this.renderer = new CSS3DRenderer();
        this.renderer.setSize(128, 128);
        this.element = document.createElement('aside');
        this.element.id = 'view-cube';
        this.element.setAttribute('aria-label', i18n.t('viewCube'));
        this.element.innerHTML = `<div class="view-cube-title" data-i18n="viewCube">${i18n.t('viewCube')}</div><div class="view-cube-viewport"></div><button class="control-button" data-view="iso" data-i18n="viewIso">${i18n.t('viewIso')}</button>`;
        this.viewport = this.element.querySelector('.view-cube-viewport');
        this.viewport.append(this.renderer.domElement);
        this.renderer.domElement.style.pointerEvents = 'none';
        document.getElementById('canvas-container').append(this.element);
        const rotations = { front: [0,0,0], back: [0,Math.PI,0], right: [0,Math.PI/2,0], left: [0,-Math.PI/2,0], top: [-Math.PI/2,0,0], bottom: [Math.PI/2,0,0] };
        const axes = { front: '+Z', back: '−Z', right: '+X', left: '−X', top: '+Y', bottom: '−Y' };
        this.faces = [];
        for (const [name, rotation] of Object.entries(rotations)) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'view-cube-face'; button.dataset.view = name;
            button.innerHTML = `<span data-i18n="view_${name}">${i18n.t('view_' + name)}</span><small>${axes[name]}</small>`;
            const object = new CSS3DObject(button);
            object.position.fromArray(VIEW_DIRECTIONS[name]).multiplyScalar(32);
            object.rotation.set(...rotation);
            this.scene.add(object); this.faces.push({ name, button });
        }
        this.element.addEventListener('click', event => {
            if (this.suppressClick) { this.suppressClick = false; return; }
            const name = event.target.closest('[data-view]')?.dataset.view;
            if (name) this.setView(name);
        });
        // Drag the cube to expose hidden faces without interacting with the model.
        this.viewport.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !this.available()) return;
            this.drag = { x: event.clientX, y: event.clientY, offset: this.sceneManager.camera.position.clone().sub(this.sceneManager.controls.target), moved: false };
            this.suppressClick = false;
        });
        this.viewport.addEventListener('pointermove', event => {
            if (!this.drag) return;
            const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
            if (Math.hypot(dx, dy) < 4 && !this.drag.moved) return;
            this.drag.moved = true;
            this.viewport.setPointerCapture(event.pointerId);
            const spherical = new THREE.Spherical().setFromVector3(this.drag.offset);
            spherical.theta -= dx * 0.012;
            spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.012, 1e-6, Math.PI - 1e-6);
            this.sceneManager.camera.position.copy(this.sceneManager.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
            this.sceneManager.controls.update(); this.sceneManager.redraw();
        });
        this.viewport.addEventListener('pointerup', () => { this.suppressClick = !!this.drag?.moved; this.drag = null; });
        this.viewport.addEventListener('pointercancel', () => { this.drag = null; this.suppressClick = true; });
        this.viewport.addEventListener('pointerleave', () => { if (!this.drag?.moved) this.drag = null; });
        this.viewport.addEventListener('contextmenu', event => event.preventDefault());
        this.render();
    }
    available() {
        const sm = this.sceneManager;
        return !sm._renderingPaused && sm.canvas.style.display !== 'none';
    }
    setView(name) {
        if (!this.available() || !VIEW_DIRECTIONS[name]) return;
        const { camera, controls } = this.sceneManager;
        const distance = camera.position.distanceTo(controls.target) || 1;
        const direction = new THREE.Vector3(...VIEW_DIRECTIONS[name]).normalize();
        // OrbitControls keeps Y up and clamps polar views by 1e-6 radians.
        // A tiny Z component gives top/bottom a stable roll and preserves orbiting.
        if (Math.abs(direction.y) === 1) direction.z = 1e-6;
        camera.position.copy(controls.target).addScaledVector(direction.normalize(), distance);
        controls.update(); camera.updateMatrixWorld(true);
        this.sceneManager.redraw(); this.render();
    }
    render() {
        this.element.hidden = !this.available();
        if (this.element.hidden) return;
        const source = this.sceneManager.camera;
        source.getWorldQuaternion(this.camera.quaternion);
        this.camera.position.set(0, 0, 230).applyQuaternion(this.camera.quaternion);
        this.camera.updateMatrixWorld(true);
        const direction = this.camera.position.clone().normalize();
        for (const face of this.faces) {
            const dot = direction.dot(new THREE.Vector3(...VIEW_DIRECTIONS[face.name]));
            face.button.classList.toggle('active', dot > 0.9999);
            face.button.setAttribute('aria-pressed', String(dot > 0.9999));
            face.button.tabIndex = dot > 0.001 ? 0 : -1;
        }
        this.renderer.render(this.scene, this.camera);
    }
    dispose() {
        this.scene.clear(); this.element.remove();
    }
}
