import * as THREE from 'three';

export function frameOf(object) {
    return {
        origin: object ? object.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(),
        rotation: object ? object.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()
    };
}
export function toFrame(point, frame) {
    return point.clone().sub(frame.origin).applyQuaternion(frame.rotation.clone().invert());
}
export function fromFrame(point, frame) {
    return point.clone().applyQuaternion(frame.rotation).add(frame.origin);
}
export function measure(a, b, frame) {
    return { distance: a.distanceTo(b), delta: b.clone().sub(a).applyQuaternion(frame.rotation.clone().invert()) };
}
export function groundPlane(object) {
    object.updateWorldMatrix(true, false);
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0).applyMatrix4(object.matrixWorld);
}
export function resolvePoint(point, ground) {
    if (!point) return null;
    if (point.source) {
        const source = resolvePoint(point.source, ground);
        return ground ? groundPlane(ground).projectPoint(source, new THREE.Vector3()) : source;
    }
    return point.object ? point.object.localToWorld(point.local.clone()) : point.local.clone();
}
export function freePoint(world, reference) {
    return { kind: 'free', object: reference || null, local: reference ? reference.worldToLocal(world.clone()) : world.clone() };
}
export function parseCoordinates(values, unit) {
    if (values.some(v => String(v).trim() === '' || !Number.isFinite(Number(v)))) return null;
    return new THREE.Vector3(...values.map(v => Number(v) / (unit === 'mm' ? 1000 : 1)));
}
export function onAxis(point, origin, direction, tolerance) {
    const offset = point.clone().sub(origin);
    return offset.addScaledVector(direction, -offset.dot(direction)).length() <= tolerance;
}
export function visibleObject(object) {
    for (let node = object; node; node = node.parent) if (!node.visible) return false;
    return true;
}
export function specialPoints(model) {
    const points = [];
    for (const link of model?.links?.values() || []) {
        if (!link.threeObject) continue;
        points.push({ kind: 'link', name: link.name, link, object: link.threeObject, local: new THREE.Vector3() });
        const inertial = link.inertial;
        const xyz = inertial?.origin?.xyz ?? (Array.isArray(inertial?.origin) ? inertial.origin : [0, 0, 0]);
        if (Number.isFinite(inertial?.mass) && inertial.mass > 0 && xyz.length === 3 && xyz.every(Number.isFinite)) {
            points.push({ kind: 'com', name: link.name, link, object: link.threeObject, local: new THREE.Vector3(...xyz) });
        }
    }
    for (const joint of model?.joints?.values() || []) {
        if (joint.threeObject) points.push({ kind: 'joint', name: joint.name, link: model.links.get(joint.child), object: joint.threeObject, local: new THREE.Vector3() });
    }
    return points;
}
