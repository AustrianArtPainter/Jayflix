// Deterministic DOM/event regressions, not a claim of browser visual testing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOrbitHarness } from './helpers/orbit-event-harness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const source = read('js/home-search-history.js');
const businessSource = read('js/ui.js');

function createHistoryHarness({ records = ['肖申克的救赎', '星际穿越'], readyState = 'complete',
    home = true, missingInput = false, initiallyFocused = false } = {}) {
    let input, wrapper, history, homeButton, searchButton, clearInput, outside;
    const bootstrapSource = `
        globalThis.window = globalThis;
        globalThis.SEARCH_HISTORY_KEY = 'test-history';
        const storage = new Map([['test-history', ${JSON.stringify(JSON.stringify(records))}]]);
        globalThis.localStorage = {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        };
        const searches = [], toasts = [];
        function search() { searches.push(document.getElementById('searchInput').value); }
        ${businessSource}
        showToast = (message, type) => toasts.push({ message, type });
        document.business = { renderSearchHistory, clearSearchHistory, getSearchHistory,
            searches, toasts, storage };
        renderSearchHistory();
    `;
    const h = createOrbitHarness({ count: 0, source, bootstrapSource,
        setupDocument({ document }) {
            document.readyState = readyState;
            document.body = document;
            if (home) document.classList.add('home-page');
            const create = (parent, tag, className = '', id = '') => {
                const node = document.createElement(tag);
                node.className = className; node.id = id;
                node.contains = target => node === target || node.querySelectorAll('*').includes(target);
                node.focus = () => {
                    const previous = document.activeElement;
                    if (previous === node) return;
                    document.activeElement = node;
                    previous?.dispatch('focusout', { relatedTarget: node });
                    node.dispatch('focus');
                };
                parent.appendChild(node);
                return node;
            };
            wrapper = create(document, 'div', 'home-search-wrap');
            const bar = create(wrapper, 'div', 'home-search-bar');
            homeButton = create(bar, 'button');
            input = create(bar, 'input', '', 'searchInput');
            input.setAttribute('aria-expanded', 'false');
            clearInput = create(bar, 'button', '', 'clearSearchInput');
            searchButton = create(bar, 'button');
            history = create(wrapper, 'div', 'home-search-history', 'recentSearches');
            history.hidden = true;
            outside = create(document, 'button');
            document.activeElement = initiallyFocused ? input : outside;
            const originalGet = document.getElementById;
            document.getElementById = id => id === 'recentSearches' ? history :
                id === 'searchInput' ? (missingInput ? null : input) : originalGet(id);
            // Model just the fixed header template used by the unchanged renderer.
            // The record buttons/spans are created by the actual ui.js functions.
            Object.defineProperty(history, 'innerHTML', {
                set(value) {
                    history.replaceChildren();
                    if (!value.trim()) return;
                    const header = create(history, 'div');
                    create(header, 'div').textContent = '最近搜索:';
                    const clear = create(header, 'button', '', 'clearHistoryBtn');
                    clear.addEventListener('click', () => document.business.clearSearchHistory());
                }
            });
            const append = history.appendChild.bind(history);
            history.appendChild = node => {
                if (node.classList.contains('search-tag')) {
                    node.addEventListener('click', () => node.onclick());
                    node.children[1].addEventListener('click', event => node.children[1].onclick(event));
                }
                return append(node);
            };
        }
    });
    Object.assign(h, { input, wrapper, history, homeButton, searchButton, clearInput, outside,
        mutate() { h.observers.mutation?.([{ target: history, type: 'childList' }]); }
    });
    Object.defineProperties(h, {
        tags: { get: () => history.querySelectorAll('.search-tag') },
        clearHistory: { get: () => history.querySelector('button') }
    });
    return h;
}

function assertOpen(h, open) {
    assert.equal(h.history.hidden, !open);
    assert.equal(h.input.getAttribute('aria-expanded'), String(open));
}

test('History is hidden initially, opens only on input focus/click and keeps the same original records', () => {
    const h = createHistoryHarness(), originalTags = h.tags.slice();
    assertOpen(h, false);
    h.wrapper.dispatch('pointerdown'); assertOpen(h, false);
    h.input.focus(); assertOpen(h, true);
    assert.deepEqual(h.tags, originalTags);
    assert.equal(h.document.business.searches.length, 0);
    h.input.dispatch('keydown', { key: 'Escape' }); assertOpen(h, false);
    h.input.click(); assertOpen(h, true);
});

test('Outside mouse/touch press and keyboard focus departure close the list without stealing defaults', () => {
    const h = createHistoryHarness();
    for (const pointerType of ['mouse', 'touch']) {
        h.input.focus(); h.input.click(); assertOpen(h, true);
        const event = h.outside.dispatch('pointerdown', { pointerType });
        assertOpen(h, false); assert.equal(event.defaultPrevented, false);
    }
    h.input.click(); h.outside.focus(); assertOpen(h, false);
});

test('Focus can move into the popup; Escape restores the input without reopening the popup', () => {
    const h = createHistoryHarness();
    h.input.focus(); h.clearHistory.focus(); assertOpen(h, true);
    const event = h.clearHistory.dispatch('keydown', { key: 'Escape' });
    assertOpen(h, false); assert.equal(h.document.activeElement, h.input);
    assert.equal(event.defaultPrevented, true);
    h.mutate(); assertOpen(h, false);
    h.input.click(); assertOpen(h, true);
});

test('Enter and either search-bar action dismiss the popup while preserving input/clear and IME behavior', () => {
    const h = createHistoryHarness();
    h.input.focus();
    h.input.dispatch('keydown', { key: 'Enter', isComposing: true }); assertOpen(h, true);
    const event = h.input.dispatch('keydown', { key: 'Enter' });
    assertOpen(h, false); assert.equal(event.defaultPrevented, false);
    for (const button of [h.homeButton, h.searchButton]) {
        h.input.click();
        const clicked = button.click();
        assertOpen(h, false); assert.equal(clicked.defaultPrevented, false);
    }
    h.input.click(); h.clearInput.click(); assertOpen(h, true);
});

test('An original history tag searches exactly once, keeps its text and dismisses the popup', () => {
    const h = createHistoryHarness(); h.input.focus();
    const tag = h.tags[0]; tag.children[0].click();
    assert.deepEqual(Array.from(h.document.business.searches), ['肖申克的救赎']);
    assert.equal(h.input.value, '肖申克的救赎');
    assertOpen(h, false);
});

test('Original single deletion does not search or dismiss the remaining records; clearing closes an empty list', () => {
    const h = createHistoryHarness(); h.input.focus();
    h.tags[0].children[1].click(); h.mutate();
    assertOpen(h, true);
    assert.deepEqual(Array.from(h.document.business.getSearchHistory(), item => item.text), ['星际穿越']);
    assert.equal(h.document.business.searches.length, 0);
    h.clearHistory.click(); h.mutate(); assertOpen(h, false);
    assert.equal(h.tags.length, 0);
    assert.equal(h.document.business.storage.has('test-history'), false);
    assert.equal(h.document.business.toasts[0].message, '搜索历史已清除');
});

test('No-history and rerendered-history states synchronize visibility without opening a dismissed popup', () => {
    const h = createHistoryHarness({ records: [] });
    h.input.focus(); assertOpen(h, false);
    h.document.business.storage.set('test-history', JSON.stringify(['新片']));
    h.document.business.renderSearchHistory(); h.mutate(); assertOpen(h, true);
    h.outside.dispatch('pointerdown');
    h.document.business.renderSearchHistory(); h.mutate(); assertOpen(h, false);
    h.input.click(); assertOpen(h, true);
    h.document.business.storage.delete('test-history');
    h.document.business.renderSearchHistory(); h.mutate(); assertOpen(h, false);
});

test('Both DOM-loading and already-focused initialization work; unrelated pages and missing input are untouched', () => {
    const loading = createHistoryHarness({ readyState: 'loading' });
    assert.equal(loading.observers.mutation, undefined);
    loading.document.dispatch('DOMContentLoaded');
    loading.input.focus(); assertOpen(loading, true);
    assertOpen(createHistoryHarness({ initiallyFocused: true }), true);
    for (const options of [{ home: false }, { missingInput: true }]) {
        const h = createHistoryHarness(options);
        assert.equal(h.observers.mutation, undefined);
        h.input.focus(); assertOpen(h, false);
    }
});

test('Visibility adds no animation chain, storage/API calls, rerenders or sphere mutation observation', () => {
    const h = createHistoryHarness(), tags = h.tags.slice();
    for (let i = 0; i < 300; i++) {
        h.input.click(); h.outside.dispatch('pointerdown');
    }
    assert.equal(h.frameCount, 0);
    assert.deepEqual(h.tags, tags);
    assert.equal(h.observerStates.mutation.target, h.history);
    assert.deepEqual(Object.keys(h.observerStates.mutation.options), ['childList']);
    assert.doesNotMatch(source.replace(/\/\/[^\n]*/g, ''), /\b(?:fetch|localStorage|sessionStorage|requestAnimationFrame|setInterval|renderSearchHistory|search)\s*[.(]/);
});

test('Popup is hidden in HTML, spans the full responsive search bar, overlays without pushing content, and matches movie-title typography', () => {
    const html = read('index.html'), css = read('css/home-orbit.css'), shared = read('css/styles.css');
    assert.match(html, /id="recentSearches"[^>]*\bhidden>/);
    assert.match(html, /aria-controls="recentSearches"\s+aria-expanded="false"/);
    assert.match(html, /class="w-full max-w-2xl home-search-wrap">\s*<div[^>]*home-search-bar/);
    assert.match(html, /js\/home-search-history\.js\?v=20261003-1/);
    assert.doesNotMatch(read('orbit-test.html'), /home-search-history\.js/);
    assert.match(css, /\.home-page \.home-search-wrap \{ position: relative; \}/);
    const popup = css.match(/\.home-page #recentSearches \{([^}]+)\}/)[1];
    for (const declaration of ['position: absolute', 'top: 100%', 'left: 0', 'width: 100%',
        'box-sizing: border-box', 'margin: 0', 'overflow-y: auto', 'max-height: min(320px, 45vh)']) {
        assert.ok(popup.includes(declaration), declaration);
    }
    const movieTitle = [...shared.matchAll(/\.card-hover h3 \{([^}]+)\}/g)].at(-1)[1];
    const fontSize = Number(movieTitle.match(/font-size:\s*([.\d]+)rem/)[1]);
    assert.equal(Number(popup.match(/font-size:\s*([.\d]+)rem/)[1]), fontSize);
    assert.match(popup, /line-height: 1\.3rem/);
    assert.match(css, /#recentSearches\[hidden\], \.home-page #recentSearches:empty \{ display: none; \}/);
    assert.match(css, /#recentSearches #clearHistoryBtn \{[^}]*font-size: inherit; line-height: inherit/);
    assert.match(css, /#recentSearches \.search-tag \{[^}]*max-width: 100%;[^}]*font-size: inherit;[^}]*line-height: inherit/);
    assert.match(css, /#recentSearches \.search-tag > span:first-child \{[^}]*overflow-wrap: anywhere/);
    assert.doesNotMatch(css.slice(css.indexOf('/* Search history'), css.indexOf('/* End search history')),
        /(?:^|\n)(?!\.home-page)[.#][^{]+\{/);
});
