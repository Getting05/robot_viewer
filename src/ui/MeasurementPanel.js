import { i18n } from '../utils/i18n.js';
import './measurement.css';

export class MeasurementPanel {
    constructor(controller, panelManager = null) {
        this.panelManager = panelManager;
        this.controller = controller;
        this.element = document.createElement('section');
        this.element.id = 'measurement-panel';
        this.element.className = 'floating-panel measurement-panel';
        this.element.hidden = true;
        const t = key => `<span data-i18n="${key}">${i18n.t(key)}</span>`;
        const header = (title, id, closeAttributes) => `<div class="floating-panel-header"><span data-i18n="${title}">${i18n.t(title)}</span><button type="button" class="panel-maximize-btn" data-panel-id="${id}" aria-label="${i18n.t('measureMaximize')}">⛶</button><button type="button" class="panel-close-btn" ${closeAttributes} aria-label="${i18n.t('measureClose')}">✕</button></div>`;
        const snapToggle = (kind, title) => `<label class="control-button active measure-snap-toggle"><input type="checkbox" data-snap="${kind}" checked>${t(title)}</label>`;
        this.element.innerHTML = `
            ${header('measurement', 'measurement-panel', 'data-action="close"')}
            <div class="floating-panel-content measure-content">
                <p class="measure-hint" data-role="status" aria-live="polite"></p>
                <div class="measure-row"><label>${t('measureFrame')} <select class="control-bar-select viewer-select" data-role="frame"><option value="world" data-i18n="measureWorld">${i18n.t('measureWorld')}</option><option value="local" data-i18n="measureLocal">${i18n.t('measureLocal')}</option></select></label><label>${t('measureUnit')} <select class="control-bar-select viewer-select" data-role="unit"><option>mm</option><option>m</option></select></label></div>
                <p class="measure-hint" data-role="reference"></p>
                <label class="measure-row">${t('measureAxes')} <select class="control-bar-select viewer-select" data-role="axis"><option value="all" data-i18n="measureAll">${i18n.t('measureAll')}</option><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
                ${['A','B'].map((name, index) => `<div class="joint-control measure-endpoint"><div class="joint-header"><button type="button" class="control-button" data-select="${index}" aria-pressed="false">${name}</button><span class="measure-binding" data-binding="${index}"></span></div><form data-point="${index}"><div class="measure-coordinates">${['X','Y','Z'].map(axis => `<label>${axis}<input class="joint-value-input" aria-label="${name} ${axis}" type="number" step="any" required value="0"></label>`).join('')}</div><div class="measure-endpoint-actions"><button class="control-button" type="submit">${t('measureApply')}</button></div></form></div>`).join('')}
                <div class="measure-snap-header">${snapToggle('enabled', 'measureSnap')}</div>
                <div class="measure-snap">${['link','joint','com','projection'].map(kind => snapToggle(kind, 'measureKind_' + kind)).join('')}</div>
                <output class="joint-control measure-result" data-role="result"></output>
                <p data-role="error" role="alert"></p>
                <div class="measure-row"><button class="control-button" data-action="restart">${t('measureRestart')}</button><button class="control-button" data-action="clear">${t('measureClear')}</button></div>
                <p class="measure-hint" data-i18n="measureHint">${i18n.t('measureHint')}</p>
            </div>`;
        document.getElementById('canvas-container').append(this.element);
        this.info = document.createElement('section');
        this.info.id = 'link-origin-info'; this.info.className = 'floating-panel measurement-panel'; this.info.hidden = true;
        this.info.innerHTML = `${header('measureOrigins', 'link-origin-info', 'data-close-origin')}
            <div class="floating-panel-content measure-content">
                <div class="joint-control"><div class="joint-name" data-info="name"></div>
                    <div class="measure-info-row"><span data-i18n="measureParentJoint">${i18n.t('measureParentJoint')}</span><span data-info="joint"></span></div>
                    <div class="measure-info-row"><span data-i18n="measureParentLink">${i18n.t('measureParentLink')}</span><span data-info="parent"></span></div>
                </div>
                <div class="joint-control"><span class="measure-hint" data-i18n="measureWorld">${i18n.t('measureWorld')}</span><div class="measure-info-row"><span>XYZ (m)</span><span data-info="world"></span></div></div>
                <div class="joint-control"><span class="measure-hint" data-i18n="measureRelative">${i18n.t('measureRelative')}</span><div class="measure-info-row"><span>XYZ (m)</span><span data-info="xyz"></span></div><div class="measure-info-row"><span>RPY (rad)</span><span data-info="rpy"></span></div></div>
            </div>`;
        this.info.querySelector('[data-close-origin]').onclick = () => { controller.infoLink = null; this.info.hidden = true; };
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
    show(panel, visible) {
        if (panel.hidden === !visible) return;
        panel.hidden = !visible;
        if (visible) this.panelManager?.bringToFront(panel);
    }
    setLinkInfo(values) {
        for (const [key, value] of Object.entries(values)) this.info.querySelector(`[data-info="${key}"]`).textContent = value;
    }
    field(name) { return this.element.querySelector(`[data-role="${name}"]`); }
    update(points, result, controller) {
        this.element.querySelectorAll('[data-snap]').forEach(input => {
            input.checked = controller.snap[input.dataset.snap];
            input.parentElement.classList.toggle('active', input.checked);
        });
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
            this.element.querySelector(`[data-select="${index}"]`).setAttribute('aria-pressed', String(controller.selected === index));
        });
        this.field('result').textContent = result ? `|B−A| = ${format(result.distance)} ${controller.unit}\n` + ['x','y','z'].map(axis => `Δ${axis.toUpperCase()} = ${format(result.delta[axis])} ${controller.unit}`).join('\n') : '—';
    }
}
