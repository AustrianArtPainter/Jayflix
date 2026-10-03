/* Four browser-local colour groups. No requests, player calls or orbit work. */
(function (global) {
    'use strict';
    const STORAGE_KEY = 'jayflix.ui.palette.v1';
    const DEFAULTS = Object.freeze({ background: '#080d11', module: '#111e16', accent: '#a2e2ce', text: '#edf2ee' });
    const GROUPS = Object.freeze(Object.keys(DEFAULTS));
    const HEX = /^#[0-9a-f]{6}$/i;
    const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
    const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
    const hex = channels => '#' + channels.map(value => clamp(value).toString(16).padStart(2, '0')).join('');
    const luminance = colour => rgb(colour).map(value => {
        value /= 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);

    function normalize(value) {
        const result = { ...DEFAULTS };
        if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
        for (const group of GROUPS) if (typeof value[group] === 'string' && HEX.test(value[group])) result[group] = value[group].toLowerCase();
        return result;
    }

    // Preserve the approved shades exactly at defaults. A group changes as one
    // family; its light/dark offsets are not exposed as extra picker controls.
    function shade(original, group, colours) {
        if (colours[group] === DEFAULTS[group]) return original;
        const target = rgb(colours[group]), reference = rgb(DEFAULTS[group]), source = rgb(original);
        if (group === 'text') {
            const weight = Math.min(1, source.reduce((a, b) => a + b, 0) / reference.reduce((a, b) => a + b, 0));
            const background = rgb(colours.background);
            return hex(target.map((value, index) => background[index] + (value - background[index]) * weight));
        }
        return hex(source.map((value, index) => value + target[index] - reference[index]));
    }

    function buildVariables(value) {
        const colours = normalize(value), result = {};
        const set = (name, original, group) => { result[name] = shade(original, group, colours); };
        const families = {
            background: { '--home-ink': '#080d11' },
            module: { '--home-surface': '#10181d', '--ui-panel': '#0e1812', '--ui-dialog': '#111e16',
                '--ui-inset': '#142019', '--ui-input': '#101718', '--ui-control': '#17241e', '--ui-hover': '#21362b',
                '--ui-border': '#385240', '--ui-control-border': '#365044', '--ui-input-border': '#2b3a36' },
            accent: { '--home-accent': '#a2e2ce', '--ui-accent-hover': '#c0efde', '--ui-focus': '#789e91',
                '--palette-tag-active': '#b0d9bf', '--palette-card-focus': '#c2edcd' },
            text: { '--home-white': '#edf2ee', '--home-muted': '#82938f', '--ui-title': '#d4e9d9',
                '--ui-button-text': '#b7d5c5', '--ui-footer-text': '#657b6c', '--ui-footer-brand': '#9fbda8',
                '--ui-footer-link': '#a0b9a7', '--palette-tool-text': '#bac7c2', '--palette-placeholder': '#61746e',
                '--palette-subtle-text': '#63796c', '--palette-label-text': '#829a87', '--palette-value-text': '#b7c9bb',
                '--palette-card-text': '#e4ecdf', '--palette-number-text': '#ecf3e4' }
        };
        for (const [group, tokens] of Object.entries(families)) for (const [name, original] of Object.entries(tokens)) set(name, original, group);
        const accent = rgb(colours.accent), background = rgb(colours.background);
        result['--ui-accent-ink'] = colours.accent === DEFAULTS.accent ? '#0b2118' : luminance(colours.accent) > .179 ? '#000000' : '#ffffff';
        result['--home-line'] = `rgba(${rgb(shade('#d2e5df', 'text', colours)).join(', ')}, 0.12)`;
        for (const [name, opacity] of Object.entries({ '--palette-accent-faint': .04, '--palette-accent-track': .145,
            '--palette-accent-loaded': .25, '--palette-accent-hover': .125, '--palette-accent-focus': .19 })) {
            result[name] = `rgba(${accent.join(', ')}, ${opacity})`;
        }
        result['--palette-overlay'] = `rgba(${background.join(', ')}, 0.88)`;
        result['--palette-player-overlay'] = `rgba(${background.join(', ')}, 0.9)`;
        result['--palette-number-background'] = `rgba(${rgb(shade('#0b110d', 'module', colours)).join(', ')}, 0.55)`;
        result['--palette-card-border'] = `rgba(${rgb(shade('#bedac6', 'text', colours)).join(', ')}, 0.24)`;
        result['--palette-wire'] = `rgba(${accent.join(', ')}, 0.11)`;
        result['--palette-glow'] = `rgba(${accent.join(', ')}, 0.12)`;
        return result;
    }

    function load(storage) {
        try {
            const saved = JSON.parse(storage.getItem(STORAGE_KEY));
            if (saved?.version === 1) return normalize(saved.colors);
        } catch (_) { /* Disabled storage and malformed data must not block UI. */ }
        return { ...DEFAULTS };
    }

    const api = Object.freeze({ STORAGE_KEY, DEFAULTS, GROUPS, normalize, shade, buildVariables, load });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (!global.document) return;

    const document = global.document, root = document.documentElement;
    let storage;
    try { storage = global.localStorage; } catch (_) {}
    let colours = load(storage), pendingSave = null;
    const variables = Object.keys(buildVariables(DEFAULTS));

    function apply() {
        const customized = GROUPS.some(group => colours[group] !== DEFAULTS[group]);
        if (customized) {
            for (const [name, value] of Object.entries(buildVariables(colours))) root.style.setProperty(name, value);
            root.setAttribute('data-ui-palette', 'custom');
        } else {
            for (const name of variables) root.style.removeProperty(name);
            root.removeAttribute('data-ui-palette');
        }
        syncInputs();
    }
    function save() {
        if (pendingSave !== null) global.clearTimeout(pendingSave);
        pendingSave = null;
        try { storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, colors: colours })); } catch (_) {}
    }
    function queueSave() {
        if (pendingSave !== null) global.clearTimeout(pendingSave);
        pendingSave = global.setTimeout(save, 150);
    }
    function syncInputs() {
        // Safe before body parsing: settings are applied in <head> to avoid a
        // default-colour flash; the four native inputs are wired at DOM ready.
        for (const group of GROUPS) {
            const input = document.getElementById('palette-' + group);
            if (input) input.value = colours[group];
        }
    }
    apply();
    global.addEventListener('pagehide', () => { if (pendingSave !== null) save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && pendingSave !== null) save(); });
    global.addEventListener('storage', event => {
        if (event.storageArea && event.storageArea !== storage) return;
        if (event.key !== STORAGE_KEY && event.key !== null) return;
        if (pendingSave !== null) global.clearTimeout(pendingSave);
        pendingSave = null;
        colours = load(storage);
        apply(); // Same-origin tabs stay in sync without echoing a storage write.
    });

    function initializeControls() {
        const toggle = document.getElementById('paletteToggle'), panel = document.getElementById('palettePanel');
        if (!toggle || !panel) return; // Other production pages only reuse colours.
        const close = restoreFocus => {
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            if (restoreFocus) toggle.focus();
        };
        toggle.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            toggle.setAttribute('aria-expanded', String(!panel.hidden));
        });
        document.getElementById('paletteClose').addEventListener('click', () => close(true));
        for (const group of GROUPS) {
            const input = document.getElementById('palette-' + group);
            input.addEventListener('input', () => {
                if (!HEX.test(input.value)) return;
                colours = { ...colours, [group]: input.value.toLowerCase() };
                apply();
                queueSave();
            });
            input.addEventListener('change', () => { if (pendingSave !== null) save(); });
        }
        document.getElementById('paletteReset').addEventListener('click', () => {
            colours = { ...DEFAULTS };
            apply();
            save();
        });
        document.addEventListener('pointerdown', event => {
            if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) close(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(true); }
        });
        syncInputs();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeControls, { once: true });
    else initializeControls();
})(typeof window !== 'undefined' ? window : globalThis);
