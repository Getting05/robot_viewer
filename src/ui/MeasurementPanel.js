import { i18n } from '../utils/i18n.js';
import './measurement.css';

export class MeasurementPanel {
    constructor(controller) {
        this.controller = controller;
        this.element = document.createElement('section');
        this.element.id = 'measurement-panel';
        this.element.hidden = true;
        const t = key => `<span data-i18n="${key}">${i18n.t(key)}</span>`;
        this.element.innerHTML = `
            <header>${t('measurement')} <button data-action="close" aria-label="${i18n.t('measureClose')}">×</button></header>
            <p data-role="status"></p>
            <div class="measure-row"><label>${t('measureFrame')} <select data-role="frame"><option value="world" data-i18n="measureWorld">${i18n.t('measureWorld')}</option><option value="local" data-i18n="measureLocal">${i18n.t('measureLocal')}</option></select></label><select data-role="unit" aria-label="${i18n.t('measureUnit')}"><option>mm</option><option>m</option></select></div>
            <p data-role="reference"></p>
            <label>${t('measureAxes')} <select data-role="axis"><option value="all" data-i18n="measureAll">${i18n.t('measureAll')}</option><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
            ${['A','B'].map((name, index) => `<fieldset><legend><button data-select="${index}">${name}</button> <span data-binding="${index}"></span></legend><form data-point="${index}"><div class="measure-coordinates">${['X','Y','Z'].map(axis => `<label>${axis}<input aria-label="${name} ${axis}" type="number" step="any" required value="0"></label>`).join('')}</div><button type="submit">${t('measureApply')}</button></form></fieldset>`).join('')}
            <label><input type="checkbox" data-snap="enabled" checked> ${t('measureSnap')}</label>
            <div class="measure-snap">${['link','joint','com','projection'].map(kind => `<label><input type="checkbox" data-snap="${kind}" checked>${t('measureKind_' + kind)}</label>`).join('')}</div>
            <output data-role="result"></output><p data-role="error" role="alert"></p>
            <div class="measure-row"><button data-action="restart">${t('measureRestart')}</button><button data-action="clear">${t('measureClear')}</button></div>
            <p class="measure-hint" data-i18n="measureHint">${i18n.t('measureHint')}</p>`;
        document.getElementById('canvas-container').append(this.element);
        this.info = document.createElement('section');
        this.info.id = 'link-origin-info'; this.info.hidden = true;
        this.info.innerHTML = '<button type="button" aria-label="Close">×</button><pre></pre>';
        this.info.firstChild.onclick = () => { controller.infoLink = null; this.info.hidden = true; };
        document.getElementById('canvas-container').append(this.info);
        this.element.querySelectorAll('[data-action]').forEach(button => button.onclick = () => {
            if (button.dataset.action === 'close') controller.setActive(false);
            else { controller.clearMeasurement(); if (button.dataset.action === 'restart') controller.setActive(true); }
        });
        this.element.querySelectorAll('form').forEach(form => form.onsubmit = event => {
            event.preventDefault();
            controller.setCoordinates(Number(form.dataset.point), [...form.querySelectorAll('input')].map(input => input.value));
        });
        this.element.querySelectorAll('[data-select]').forEach(button => button.onclick = () => controller.selectEndpoint(Number(button.dataset.select)));
        this.element.querySelectorAll('[data-snap]').forEach(input => input.onchange = () => { controller.snap[input.dataset.snap] = input.checked; controller.refresh(); });
        this.field('frame').onchange = event => controller.setFrame(event.target.value);
        this.field('unit').onchange = event => { controller.unit = event.target.value; controller.refresh(); };
        this.field('axis').onchange = event => { controller.axis = event.target.value; controller.refresh(); };
    }
    field(name) { return this.element.querySelector(`[data-role="${name}"]`); }
    update(points, result, controller) {
        const factor = controller.unit === 'mm' ? 1000 : 1;
        const format = value => (value * factor).toFixed(controller.unit === 'mm' ? 2 : 5);
        this.field('frame').value = controller.frameMode;
        this.field('frame').options[1].disabled = !controller.reference;
        this.field('reference').textContent = controller.frameMode === 'local' ? controller.reference.name : i18n.t('measureWorldHint');
        this.field('status').textContent = controller.supported() ? i18n.t('measurePick') + ' ' + (controller.selected === 0 ? 'A' : 'B') : i18n.t('measureUnavailable');
        this.element.querySelectorAll('form').forEach((form, index) => {
            if (!(form.contains(document.activeElement) && document.activeElement?.matches('input'))) {
                form.querySelectorAll('input').forEach((input, axis) => { input.value = points[index] ? Number(format(points[index].getComponent(axis))) : 0; });
            }
            const point = controller.points[index];
            const binding = point ? `${i18n.t('measureKind_' + point.kind)} · ${point.object?.name || point.source?.name || i18n.t('measureWorld')}` : '—';
            this.element.querySelector(`[data-binding="${index}"]`).textContent = binding;
            this.element.querySelector(`[data-select="${index}"]`).classList.toggle('active', controller.selected === index);
        });
        this.field('result').textContent = result ? `|B−A| = ${format(result.distance)} ${controller.unit}\n` + ['x','y','z'].map(axis => `Δ${axis.toUpperCase()} = ${format(result.delta[axis])} ${controller.unit}`).join('\n') : '—';
    }
}
