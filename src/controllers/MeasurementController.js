import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MeasurementPanel } from '../ui/MeasurementPanel.js';
import { i18n } from '../utils/i18n.js';
import { frameOf, toFrame, fromFrame, measure, resolvePoint, freePoint, parseCoordinates, onAxis, visibleObject, specialPoints } from '../utils/MeasurementMath.js';

export class MeasurementController {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.points = [null, null]; this.selectedObjects = [];
        this.active = false; this.selected = 0; this.frameMode = 'world';
        this.unit = 'mm'; this.axis = 'all'; this.reference = null;
        this.snap = { enabled: true, link: true, joint: true, com: true, projection: true };
        this.model = null; this.origins = false; this.originMarkers = new Map();
        this.panel = new MeasurementPanel(this);
        this.proxy = new THREE.Object3D(); sceneManager.scene.add(this.proxy);
        this.transform = new TransformControls(sceneManager.camera, sceneManager.canvas);
        this.transform.setMode('translate'); this.transform.setSpace('local'); this.transform.setSize(0.75);
        this.transform.showX = this.transform.showY = this.transform.showZ = true;
        // Axis-only handles: no planes or free-translation handles.
        for (const group of [this.transform._gizmo.gizmo.translate, this.transform._gizmo.picker.translate]) {
            [...group.children].forEach(child => { if (!['X','Y','Z'].includes(child.name)) group.remove(child); });
        }
        sceneManager.scene.add(this.transform);
        this.transform.addEventListener('dragging-changed', event => {
            if (event.value) {
                this.orbitEnabled = sceneManager.controls.enabled;
                this.dragPoint = this.points[this.selected];
                this.dragOrigin = this.proxy.position.clone();
                this.dragDirection = new THREE.Vector3();
                const axis = this.transform.axis?.toLowerCase();
                if (['x','y','z'].includes(axis)) this.dragDirection[axis] = 1;
                this.dragDirection.applyQuaternion(this.frame().rotation);
                sceneManager.controls.enabled = false;
                this.dragging = true;
            } else {
                sceneManager.controls.enabled = this.orbitEnabled ?? true;
                this.dragging = false; this.justDragged = true;
                if (!this.resetting) this.refresh();
            }
        });
        this.transform.addEventListener('objectChange', () => {
            if (!this.dragging) return;
            let world = this.proxy.position.clone();
            if (this.snap.enabled) {
                const candidates = this.candidates().filter(point => onAxis(resolvePoint(point, sceneManager.groundPlane), this.dragOrigin, this.dragDirection, this.modelScale * 1e-6));
                const nearby = this.nearestScreenPoint(this.screenPoint(world), candidates);
                if (nearby) {
                    const target = resolvePoint(nearby, sceneManager.groundPlane);
                    world = this.dragOrigin.clone().addScaledVector(this.dragDirection, target.sub(this.dragOrigin).dot(this.dragDirection));
                }
            }
            this.points[this.selected] = freePoint(world, this.frameMode === 'local' ? this.reference : null);
            this.proxy.position.copy(world); this.refresh();
        });
        this.transform.addEventListener('change', () => sceneManager.redraw());
        this.tooltip = document.createElement('div'); this.tooltip.id = 'measure-tooltip'; this.tooltip.hidden = true; document.body.append(this.tooltip);
        this.preview = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x40e9ed, depthTest: false }));
        this.preview.renderOrder = 1001; this.preview.visible = false; sceneManager.scene.add(this.preview);
        this.bindEvents();
        sceneManager.measurementController = this;
        this.refresh();
    }
    supported() {
        const model = this.sceneManager.currentModel;
        return !!model?.threeObject && !model.userData?.isUSDWASM && model.threeObject.visible && !this.sceneManager._renderingPaused;
    }
    frame() { return frameOf(this.frameMode === 'local' ? this.reference : null); }
    syncModel() {
        const model = this.sceneManager.currentModel;
        if (model === this.model) return;
        this.resetting = true;
        this.clearMeasurement();
        this.resetting = false; this.infoLink = null; this.panel.info.hidden = true;
        this.originMarkers.forEach(marker => { marker.material.dispose(); marker.removeFromParent(); }); this.originMarkers.clear();
        this.model = model;
        this.modelScale = Math.max(0.001, model?.threeObject ? this.sceneManager.getModelBoundingBox(model.threeObject).getSize(new THREE.Vector3()).length() : 1);
        this.special = specialPoints(model);
        for (const point of this.special.filter(point => point.kind === 'link')) {
            const marker = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x55dbed, depthTest: false }));
            marker.renderOrder = 980; marker.userData.point = point;
            this.originMarkers.set(point.name, marker); this.sceneManager.scene.add(marker);
        }
    }
    bindEvents() {
        const canvas = this.sceneManager.canvas;
        document.getElementById('show-link-origins').onclick = event => {
            this.origins = !this.origins; event.currentTarget.classList.toggle('active', this.origins);
            event.currentTarget.setAttribute('aria-pressed', String(this.origins)); this.refresh();
        };
        document.getElementById('measure-tool').onclick = () => this.setActive(!this.active);
        canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            this.down = { x: event.clientX, y: event.clientY }; this.moved = false;
            this.handleDown = this.active && !!this.transform.axis; this.justDragged = false;
        }, true);
        canvas.addEventListener('pointermove', event => {
            if (this.down && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 4) this.moved = true;
            if (this.dragging || !this.supported()) return;
            const point = this.active && this.snap.enabled ? this.nearestScreenPoint(event, this.candidates()) : this.origins ? this.nearestScreenPoint(event, this.special?.filter(p => p.kind === 'link') || []) : null;
            this.hoverPoint = point;
            this.preview.visible = !!point && this.active;
            if (point) {
                this.preview.position.copy(resolvePoint(point, this.sceneManager.groundPlane));
                this.tooltip.textContent = `${i18n.t('measureKind_' + point.kind)}: ${point.name || 'A'}`;
                this.tooltip.style.left = `${event.clientX + 14}px`; this.tooltip.style.top = `${event.clientY + 14}px`;
            }
            this.tooltip.hidden = !point; this.sceneManager.redraw();
        });
        canvas.addEventListener('pointerup', event => {
            if (event.button !== 0 || !this.down) return;
            this.down = null;
            if (this.moved || this.handleDown || this.justDragged || !this.supported()) return;
            if (!this.active) {
                if (this.origins) {
                    const origin = this.nearestScreenPoint(event, this.special.filter(p => p.kind === 'link'));
                    if (origin) { this.infoLink = origin.link; this.refresh(); }
                }
                return;
            }
            const endpoints = this.points.map((point, index) => point ? { ...point, endpointIndex: index } : null).filter(Boolean);
            const existing = this.nearestScreenPoint(event, endpoints);
            if (existing) { this.selectEndpoint(existing.endpointIndex); return; }
            const point = (this.snap.enabled && this.nearestScreenPoint(event, this.candidates())) || this.pickSurface(event);
            if (!point) return;
            const index = this.selected;
            const freeWorlds = this.points.map(p => p?.kind === 'free' ? resolvePoint(p, this.sceneManager.groundPlane) : null);
            this.points[index] = point;
            if (index === 0) {
                this.reference = point.link?.threeObject || null;
                if (!this.reference) this.frameMode = 'world';
                if (freeWorlds[1]) this.points[1] = freePoint(freeWorlds[1], this.frameMode === 'local' ? this.reference : null);
            }
            if (point.kind === 'link') this.infoLink = point.link;
            this.selected = !this.points[1] ? 1 : index;
            this.refresh();
        });
        canvas.addEventListener('pointerleave', () => { this.down = null; this.preview.visible = false; this.tooltip.hidden = true; this.sceneManager.redraw(); });
        canvas.addEventListener('pointercancel', () => { this.down = null; this.cancelDrag(); });
        window.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            if (this.dragging) this.cancelDrag();
            else if (this.active) this.setActive(false);
            this.preview.visible = false; this.tooltip.hidden = true;
        });
        new MutationObserver(() => this.refresh()).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }
    cancelDrag() {
        if (!this.dragging) return;
        this.points[this.selected] = this.dragPoint;
        this.transform.pointerUp(null);
        this.refresh();
    }
    setActive(active) {
        this.syncModel();
        if (!active && this.dragging) this.cancelDrag();
        this.active = active && this.supported();
        if (!this.active) { this.preview.visible = false; this.tooltip.hidden = true; }
        this.panel.element.hidden = !active;
        document.getElementById('measure-tool').classList.toggle('active', this.active);
        document.getElementById('measure-tool').setAttribute('aria-pressed', String(this.active));
        this.refresh();
    }
    selectEndpoint(index) { this.selected = index; this.refresh(); }
    setCoordinates(index, values) {
        if (!this.supported()) return;
        const local = parseCoordinates(values, this.unit);
        this.panel.field('error').textContent = local ? '' : i18n.t('measureInvalid');
        if (!local) return;
        this.points[index] = freePoint(fromFrame(local, this.frame()), this.frameMode === 'local' ? this.reference : null);
        this.selected = index; this.refresh();
    }
    setFrame(mode) {
        if (mode === 'local' && !this.reference) return;
        const worlds = this.points.map(point => resolvePoint(point, this.sceneManager.groundPlane));
        this.frameMode = mode;
        this.points = this.points.map((point, index) => point?.kind === 'free' ? freePoint(worlds[index], mode === 'local' ? this.reference : null) : point);
        this.refresh();
    }
    candidates() {
        const base = this.special || [];
        const points = base.filter(point => this.snap[point.kind]);
        if (this.snap.projection && this.sceneManager.groundPlane) {
            for (const source of [...base, ...(this.points[0] && !this.points[0].source ? [this.points[0]] : [])]) {
                points.push({ kind: 'projection', name: source.name || 'A', source, link: source.link });
            }
        }
        return points;
    }
    screenPoint(world) {
        const rect = this.sceneManager.canvas.getBoundingClientRect();
        const projected = world.clone().project(this.sceneManager.camera);
        return { clientX: rect.left + (projected.x + 1) * rect.width / 2, clientY: rect.top + (1 - projected.y) * rect.height / 2, z: projected.z };
    }
    nearestScreenPoint(event, candidates) {
        let best = null, distance = 12;
        for (const point of candidates) {
            const projected = this.screenPoint(resolvePoint(point, this.sceneManager.groundPlane));
            if (projected.z < -1 || projected.z > 1) continue;
            const d = Math.hypot(event.clientX - projected.clientX, event.clientY - projected.clientY);
            if (d < distance) { best = point; distance = d; }
        }
        return best;
    }
    pickSurface(event) {
        const sm = this.sceneManager, rect = sm.canvas.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), sm.camera);
        const helpers = new Set([...sm.axesManager.linkAxesHelpers.values(), ...sm.axesManager.jointAxesHelpers.values()]);
        const meshes = [...new Set([...sm.visualizationManager.visualMeshes, ...sm.visualizationManager.collisionMeshes, sm.groundPlane])].filter(object => {
            if (!object?.isMesh || !visibleObject(object)) return false;
            for (let node = object; node; node = node.parent) {
                if (helpers.has(node) || node.userData.isCenterOfMass || node.userData.isInertiaBox || node.userData.isConstraintVisualization) return false;
            }
            return true;
        });
        // Collision meshes intentionally disable their raycast for joint dragging.
        // Use mesh intersection locally, without changing that existing behavior.
        const hits = [];
        for (const mesh of meshes) THREE.Mesh.prototype.raycast.call(mesh, ray, hits);
        const hit = hits.sort((a, b) => a.distance - b.distance)[0];
        if (!hit) return null;
        let link;
        for (let node = hit.object; node && !link; node = node.parent) link = [...this.model.links.values()].find(item => item.threeObject === node);
        return { kind: 'surface', object: hit.object, local: hit.object.worldToLocal(hit.point.clone()), link };
    }
    refresh() {
        this.syncModel();
        const sm = this.sceneManager;
        sm.currentModel?.threeObject?.updateWorldMatrix(true, true);
        const supported = this.supported();
        for (const id of ['measure-tool', 'show-link-origins']) document.getElementById(id).title = supported ? '' : i18n.t('measureUnavailable');
        if (sm.dragControls) sm.dragControls.measurementActive = this.active && supported;
        const worlds = this.points.map(point => resolvePoint(point, sm.groundPlane));
        const frame = this.frame();
        const result = worlds.every(Boolean) ? measure(worlds[0], worlds[1], frame) : null;
        if (supported && worlds.some(Boolean)) sm.measurementManager.showPoints(worlds, result, frame, this.axis, this.unit);
        else sm.measurementManager.measurementHelper.visible = false;
        this.panel.update(worlds.map(point => point ? toFrame(point, frame) : null), result, this);
        if (this.active && supported && worlds[this.selected]) {
            if (!this.dragging) { this.proxy.position.copy(worlds[this.selected]); this.proxy.quaternion.copy(frame.rotation); }
            if (this.transform.object !== this.proxy) this.transform.attach(this.proxy);
        } else this.transform.detach();
        this.updateInfo(); this.updateVisuals(); sm.redraw();
    }
    updateVisuals() {
        const sm = this.sceneManager, supported = this.supported();
        this.originMarkers.forEach(marker => {
            marker.visible = this.origins && supported;
            if (marker.visible) marker.position.copy(resolvePoint(marker.userData.point, sm.groundPlane));
        });
        const height = sm.canvas.clientHeight || 1;
        const size = point => sm.camera.isPerspectiveCamera ? Math.max(0.001, point.distanceTo(sm.camera.position)) * 2 * Math.tan(THREE.MathUtils.degToRad(sm.camera.fov / 2)) / height : (sm.camera.top - sm.camera.bottom) / sm.camera.zoom / height;
        this.originMarkers.forEach(marker => marker.scale.setScalar(size(marker.position) * 10));
        if (this.preview.visible && this.hoverPoint) this.preview.position.copy(resolvePoint(this.hoverPoint, sm.groundPlane));
        this.preview.scale.setScalar(size(this.preview.position) * 13);
        sm.measurementManager.updateScale(sm.camera, height);
        if (!supported) { this.transform.detach(); this.preview.visible = false; this.tooltip.hidden = true; sm.measurementManager.measurementHelper.visible = false; }
    }
    updateInfo() {
        const link = this.infoLink;
        this.panel.info.hidden = !link || !this.supported();
        if (!link || !this.supported()) return;
        const joint = [...this.model.joints.values()].find(joint => joint.child === link.name);
        let parent = joint ? this.model.links.get(joint.parent) : null;
        if (!parent) for (let node = link.threeObject.parent; node && !parent; node = node.parent) parent = [...this.model.links.values()].find(item => item.threeObject === node);
        const world = frameOf(link.threeObject), relative = frameOf(parent?.threeObject);
        const xyz = toFrame(world.origin, relative);
        const rotation = relative.rotation.clone().invert().multiply(world.rotation);
        const rpy = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
        const format = vector => vector.toArray().slice(0, 3).map(value => Number(value).toFixed(5)).join(', ');
        this.panel.info.querySelector('pre').textContent = `Link: ${link.name}\n${i18n.t('measureParentJoint')}: ${joint?.name || '—'}\n${i18n.t('measureParentLink')}: ${parent?.name || i18n.t('measureRoot')}\n${i18n.t('measureWorld')} XYZ (m):\n${format(world.origin)}\n${i18n.t('measureRelative')} XYZ (m):\n${format(xyz)}\n${i18n.t('measureRelative')} RPY XYZ (rad):\n${format(rpy)}`;
    }
    updateMeasurement() { this.refresh(); }
    handleSelection(object, element, type) {
        this.syncModel(); if (!this.supported()) return;
        const index = this.selectedObjects.findIndex(item => item.name === object.name && item.type === type);
        if (index >= 0) this.selectedObjects.splice(index, 1);
        else { if (this.selectedObjects.length === 2) this.selectedObjects.shift(); this.selectedObjects.push({ ...object, type, element }); }
        document.querySelectorAll('.measurement-selected').forEach(node => node.classList.remove('measurement-selected'));
        this.selectedObjects.forEach(item => item.element?.classList.add('measurement-selected'));
        this.points = [null, null];
        this.selectedObjects.forEach((item, i) => {
            if (item.name !== 'ground' && item.threeObject) this.points[i] = { kind: item.type === 'joint' ? 'joint' : 'link', name: item.name, object: item.threeObject, local: new THREE.Vector3(), link: this.model.links.get(item.type === 'joint' ? item.child : item.name) };
        });
        this.selectedObjects.forEach((item, i) => { if (item.name === 'ground' && this.points[1-i]) this.points[i] = { kind: 'projection', name: 'ground', source: this.points[1-i] }; });
        this.reference = this.points[0]?.link?.threeObject || null; this.frameMode = 'world';
        this.panel.element.hidden = false; this.refresh();
    }
    clearMeasurement() {
        this.points = [null, null]; this.selectedObjects = []; this.reference = null; this.frameMode = 'world'; this.selected = 0;
        document.querySelectorAll('.measurement-selected').forEach(node => node.classList.remove('measurement-selected'));
        if (this.dragging) {
            this.transform.pointerUp(null);
            this.sceneManager.controls.enabled = this.orbitEnabled ?? true;
            this.dragging = false;
        }
        this.transform?.detach(); this.sceneManager.measurementManager.clearMeasurement();
        this.hoverPoint = null;
        if (this.preview) this.preview.visible = false;
        if (this.tooltip) this.tooltip.hidden = true;
        if (this.panel) { this.panel.field('error').textContent = ''; this.panel.update([null, null], null, this); }
    }
    getSelectedObjects() { return this.selectedObjects; }
}
