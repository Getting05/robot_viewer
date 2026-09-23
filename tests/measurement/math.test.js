import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { frameOf, toFrame, fromFrame, measure, groundPlane, resolvePoint, freePoint, parseCoordinates, onAxis, specialPoints, visibleObject } from '../../src/utils/MeasurementMath.js';
const v = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const close = (a,b) => assert.ok(a.distanceTo(b) < 1e-9, `${a.toArray()} != ${b.toArray()}`);

test('arbitrary 3D points: distance 13, signed components, zero length', () => {
    const frame = frameOf();
    assert.equal(measure(v(), v(3,4,12), frame).distance, 13);
    close(measure(v(3,4,12), v(), frame).delta, v(-3,-4,-12));
    assert.equal(measure(v(1,2,3), v(1,2,3), frame).distance, 0);
});
test('rotated and translated link frame round trips; dimensions ignore object scale', () => {
    const link = new THREE.Object3D(); link.position.set(5,7,9); link.rotation.z = Math.PI/2; link.scale.setScalar(2);
    const frame = frameOf(link);
    close(fromFrame(v(2,0,0), frame), v(5,9,9));
    close(toFrame(v(5,9,9), frame), v(2,0,0));
    close(measure(v(5,7,9), v(5,9,9), frame).delta, v(2,0,0));
});
test('point bindings follow motion, world free points remain fixed', () => {
    const object = new THREE.Object3D(); object.position.x = 1;
    const bound = freePoint(v(3,4,5), object), fixed = freePoint(v(3,4,5));
    object.position.x = 2; object.updateMatrixWorld(true);
    close(resolvePoint(bound), v(4,4,5)); close(resolvePoint(fixed), v(3,4,5));
    const world = resolvePoint(bound); const unbound = freePoint(world);
    close(resolvePoint(unbound), world);
});
test('ground projection follows actual transformed plane and source', () => {
    const ground = new THREE.Object3D(); ground.rotation.x = -Math.PI/2; ground.position.y = -2;
    const source = freePoint(v(3,4,12));
    close(resolvePoint({source}, ground), v(3,-2,12));
    ground.position.y = 7;
    close(resolvePoint({source}, ground), v(3,7,12));
    ground.rotation.z = 0.3;
    assert.ok(Math.abs(groundPlane(ground).distanceToPoint(resolvePoint({source}, ground))) < 1e-9);
});
test('coordinate input rejects missing / non-finite values and converts units', () => {
    close(parseCoordinates(['3000','-4000','12000'], 'mm'), v(3,-4,12));
    close(parseCoordinates(['3','4','12'], 'm'), v(3,4,12));
    for (const value of ['', ' ', 'NaN', 'Infinity', 'abc']) assert.equal(parseCoordinates(['0',value,'0'], 'm'), null);
});
test('axis snap respects perpendicular tolerance', () => {
    assert.ok(onAxis(v(5,1e-8,0), v(), v(1,0,0), 1e-6));
    assert.ok(!onAxis(v(5,0.001,0), v(), v(1,0,0), 1e-6));
});
test('special points exclude invalid masses and retain link origins without geometry', () => {
    const link = {name:'base', threeObject:new THREE.Object3D(), inertial:{mass:2,origin:{xyz:[1,2,3]}}};
    const model = {links:new Map([['base',link]]),joints:new Map()};
    assert.deepEqual(specialPoints(model).map(p=>p.kind), ['link','com']);
    close(resolvePoint(specialPoints(model)[1]), v(1,2,3));
    link.inertial.mass = NaN;
    assert.deepEqual(specialPoints(model).map(p=>p.kind), ['link']);
    link.inertial = null;
    assert.equal(specialPoints(model).length, 1);
});
test('hidden ancestors exclude surfaces from picking', () => {
    const root = new THREE.Object3D(), child = new THREE.Object3D(); root.add(child);
    assert.ok(visibleObject(child)); root.visible = false; assert.ok(!visibleObject(child));
});
