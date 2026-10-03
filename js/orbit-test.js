/* Image-free, API-free diagnostic fixtures. This script is never loaded by index.html. */
(function (global) {
    'use strict';
    const COUNT = 212;
    const BUILD = '20261003-11';

    function createFrame(document, index, count) {
        const number = String(index + 1).padStart(Math.max(3, String(count).length), '0');
        const card = document.createElement('div');
        card.dataset.orbitPlaceholder = 'true';
        card.style.setProperty('--frame-hue', String(135 + index * 180 / count));
        const poster = document.createElement('div');
        poster.className = 'orbit-test-poster';
        const label = document.createElement('strong');
        label.textContent = number;
        poster.appendChild(label);
        const footer = document.createElement('div');
        footer.className = 'orbit-test-footer';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `框 ${number}`;
        footer.appendChild(button);
        card.append(poster, footer);
        return card;
    }

    function createFrames(document, count = COUNT) {
        return Array.from({ length: count }, (_, index) => createFrame(document, index, count));
    }

    async function buildFramesInBatches(document, count, { onBatch, schedule, signal, onProgress = () => {}, batchSize = 256 }) {
        if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(batchSize) || batchSize < 1) {
            throw new RangeError('Invalid fixture count or batch size');
        }
        let created = 0;
        while (created < count && !signal?.cancelled) {
            const start = created, end = Math.min(count, start + batchSize);
            const cards = Array.from({ length: end - start }, (_, offset) => createFrame(document, start + offset, count));
            onBatch(cards, start);
            created = end;
            onProgress(created, count);
            // Yield after the last batch too, so its MutationObserver sees the
            // loading guard before the single final reconciliation.
            await schedule();
        }
        return { created, cancelled: Boolean(signal?.cancelled) };
    }

    function describeLayout(math, width, height, count, mode, zoom, cardScale) {
        const slots = math.createSlots(count);
        const reference = mode !== 'current';
        const layout = (reference ? math.computeReferenceLayout : math.computeLayout)(width, height, slots);
        const dimensions = math.cardDimensionsFromScale(layout, cardScale);
        const faceScale = reference ? 1 : zoom;
        const cardWidth = dimensions.cardWidth * faceScale;
        const cardHeight = dimensions.cardHeight * faceScale;
        const minimumChord = layout.minimumChord * zoom;
        const envelope = Math.hypot(cardWidth, cardHeight, 2 * layout.faceOffset * zoom);
        const clearanceChord = minimumChord * math.CARD_CLEARANCE;
        // The auto-size formula lies exactly on this conservative boundary;
        // tolerate only floating-point roundoff, not the real 212/213 gap.
        const epsilon = Math.max(1, minimumChord) * 1e-12;
        return { count, radius: layout.radius * zoom, cardWidth, cardHeight,
            minimumChord, envelope, safe: count > 0 && layout.radius > 0 && envelope <= clearanceChord + epsilon };
    }

    function summarizeCadence(intervals) {
        const positive = intervals.filter(value => Number.isFinite(value) && value > 0);
        if (!positive.length) return null;
        const sorted = positive.slice().sort((a, b) => a - b);
        const mean = positive.reduce((sum, value) => sum + value, 0) / positive.length;
        return { fps: 1000 / mean, p95: sorted[Math.ceil(sorted.length * .95) - 1] };
    }

    global.JayflixOrbitTest = Object.freeze({ COUNT, BUILD, createFrames, buildFramesInBatches, describeLayout, summarizeCadence });
    if (!global.document) return;
    const document = global.document;
    const scene = document.getElementById('recommendationOrbit');
    const container = document.getElementById('douban-results');
    if (!scene || !container) return;
    const requestedMode = new URLSearchParams(global.location.search).get('mode');
    const mode = ['current', 'capacity'].includes(requestedMode) ? requestedMode : 'reference';
    scene.dataset.orbitTest = mode === 'capacity' ? 'capacity-reference' : `212-${mode}`;
    scene.dataset.orbitLoadedBuild = BUILD;
    const version = document.getElementById('orbitTestVersion');
    if (version) version.textContent = `测试版本：${BUILD}`;
    container.replaceChildren(...(mode === 'capacity' ? [] : createFrames(document)));
    for (const link of document.querySelectorAll('[data-orbit-mode]')) {
        link.setAttribute('href', `orbit-test.html?mode=${link.dataset.orbitMode}&v=${BUILD}`);
        if (link.dataset.orbitMode === mode) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    }
    document.getElementById('orbitTestModeDescription').textContent = mode === 'capacity'
        ? '原16张封面尺寸为基准：封面50%，球体半径500%。按现有布点、完整包围盒和2%间距计算上限。完整生成，不虚拟化；默认暂停，手动加载后可拖动或继续旋转。'
        : mode === 'reference'
        ? '固定原16张布局的参考尺寸：封面初始50%，只把球体半径扩大到200%。不会因为增加到212张而自动缩小封面；调整比例后，安全间距可能不再通过。'
        : '复用当前首页算法：212个点重新决定默认封面尺寸，球体按钮连封面一起缩放。此模式不保持原16张布局的封面大小。';

    function initializeCapacity() {
        const panel = document.getElementById('orbitCapacityPanel');
        if (panel) panel.hidden = mode !== 'capacity';
        if (mode !== 'capacity') return;
        const load = document.getElementById('orbitCapacityLoad');
        const clear = document.getElementById('orbitCapacityClear');
        const progress = document.getElementById('orbitCapacityProgress');
        const status = document.getElementById('orbitCapacityStatus');
        const warning = document.getElementById('orbitCapacityWarning');
        const math = global.JayflixOrbitMath;
        const expectedMin = Number(scene.dataset.orbitExpectedMin ?? .5);
        const expectedMax = Number(scene.dataset.orbitExpectedMax ?? 5);
        if (!math || math.MIN_ZOOM !== expectedMin || math.MIN_CARD_SCALE !== expectedMin ||
            math.MAX_ZOOM !== expectedMax || math.MAX_CARD_SCALE !== expectedMax) {
            load.disabled = true;
            document.getElementById('orbitTestHeading').textContent = '测试资源版本不一致，已停止生成。';
            status.textContent = `本页要求球体及封面范围 ${expectedMin * 100}%–${expectedMax * 100}%，当前脚本不匹配。请打开带版本号的新测试入口。`;
            document.getElementById('orbitTestCount').textContent = '0';
            document.getElementById('orbitTestDimensions').textContent = '—';
            document.getElementById('orbitTestSpacing').textContent = '—';
            document.getElementById('orbitTestSafety').textContent = '版本不一致 · 未验证';
            document.getElementById('orbitTestSafety').dataset.status = 'error';
            delete document.getElementById('orbitTestSafety').dataset.pass;
            document.getElementById('orbitTestCadence').textContent = '—';
            return false;
        }
        const result = global.JayflixOrbitCapacity.calculateCapacity(math);
        if (warning) warning.textContent = `高负载测试：空框将生成 ${(result.count * 10).toLocaleString()} 个DOM节点（含文字），另加页面固定节点，可能占用大量内存并卡顿。只计算几何容量，不保证浏览器流畅。手动加载全部空框，不抽样、不隐藏数量；默认暂停旋转。`;
        document.title = `JAYFLIX · ${result.count.toLocaleString()}个空框容量测试`;
        document.getElementById('orbitTestHeading').textContent = `${result.count.toLocaleString()} 个框，同一个球体。`;
        document.getElementById('orbitTestPointLabel').textContent = `${result.count} DISTINCT SPHERE POINTS`;
        scene.setAttribute('aria-label', `${result.count}个空白封面框容量测试`);
        scene.dataset.capacity = String(result.count);
        load.textContent = `生成全部 ${result.count.toLocaleString()} 个空框`;
        load.disabled = false;
        progress.max = result.count;
        let active = null;
        const notify = (type, detail) => scene.dispatchEvent(new global.CustomEvent(type, { detail }));
        const remove = () => {
            if (active) active.cancelled = true;
            active = null;
            container.replaceChildren();
            scene.dataset.orbitTestLoading = 'false';
            notify('orbit-fixtures-ready');
            progress.value = 0;
            load.disabled = false;
        };
        clear.addEventListener('click', () => {
            remove();
            status.textContent = '已清空全部测试框，可重新生成。';
        });
        load.addEventListener('click', async () => {
            remove();
            const signal = active = { cancelled: false };
            load.disabled = true;
            scene.dataset.orbitTestLoading = 'true';
            status.textContent = '分批生成中；可随时取消并清空。';
            try {
                const built = await buildFramesInBatches(document, result.count, {
                    signal,
                    schedule: () => new Promise(resolve => global.requestAnimationFrame(resolve)),
                    onBatch(cards, start) {
                        notify('orbit-fixtures-batch', { cards, start });
                        const fragment = document.createDocumentFragment();
                        cards.forEach(card => fragment.appendChild(card));
                        container.appendChild(fragment);
                    },
                    onProgress(created, total) {
                        progress.value = created;
                        status.textContent = `已生成 ${created.toLocaleString()} / ${total.toLocaleString()} 个空框`;
                    }
                });
                if (active !== signal || built.cancelled) return;
                // Geometry and initial paint still need one full pass. This
                // stress test does not promise that thousands of DOM cards stay smooth.
                status.textContent = '全部生成完成，正在计算位置与首屏；大数量可能造成等待。';
                scene.dataset.orbitTestLoading = 'false';
                notify('orbit-fixtures-ready');
                active = null;
                status.textContent = `完整 ${built.created.toLocaleString()} 个空框已就绪 · 默认暂停 · 可拖动或点击“继续” · 清空可释放节点`;
            } catch (error) {
                if (active !== signal) return;
                remove();
                status.textContent = `生成失败，已清空：${error.message}`;
            }
        });
    }

    function startDiagnostics() {
        if (initializeCapacity() === false) return;
        let previous = 0, reportTime = 0, frame = 0;
        const intervals = [];
        let previousKey = '', cachedLayout = null;
        const text = (id, value) => { document.getElementById(id).textContent = value; };
        function update() {
            const count = container.childElementCount;
            const safety = document.getElementById('orbitTestSafety');
            text('orbitTestCount', String(count));
            if (scene.dataset.orbitTestLoading === 'true') {
                text('orbitTestDimensions', '—');
                text('orbitTestSpacing', '—');
                text('orbitTestSafety', '生成中，尚未定位');
                delete safety.dataset.pass;
                safety.dataset.status = 'loading';
            } else if (count === 0) {
                text('orbitTestDimensions', '—');
                text('orbitTestSpacing', '—');
                text('orbitTestSafety', '尚未加载 · 未验证间距');
                delete safety.dataset.pass;
                safety.dataset.status = 'empty';
            } else {
                const width = scene.clientWidth, height = scene.clientHeight;
                const zoom = Number(scene.dataset.zoom), scale = Number(scene.dataset.cardScale);
                const key = [count, width, height, zoom, scale].join('/');
                if (key !== previousKey) {
                    cachedLayout = describeLayout(global.JayflixOrbitMath, width, height, count, mode, zoom, scale);
                    previousKey = key;
                }
                const layout = cachedLayout;
                text('orbitTestDimensions', `${layout.cardWidth.toFixed(2)} × ${layout.cardHeight.toFixed(2)} px`);
                text('orbitTestSpacing', `${layout.minimumChord.toFixed(2)} / ${layout.envelope.toFixed(2)} px`);
                text('orbitTestSafety', layout.safe ? '通过 · 2%间距余量' : '超出安全间距');
                safety.dataset.pass = String(layout.safe);
                safety.dataset.status = layout.safe ? 'safe' : 'unsafe';
            }
            const cadence = summarizeCadence(intervals);
            if (cadence) text('orbitTestCadence', `${cadence.fps.toFixed(1)} / P95 ${cadence.p95.toFixed(1)}ms`);
        }
        function tick(time) {
            frame = 0;
            if (document.hidden) return;
            if (previous) {
                intervals.push(time - previous);
                if (intervals.length > 180) intervals.shift();
            }
            previous = time;
            if (time - reportTime >= 500) { update(); reportTime = time; }
            frame = global.requestAnimationFrame(tick);
        }
        document.addEventListener('visibilitychange', () => {
            previous = 0;
            intervals.length = 0;
            if (document.hidden) { global.cancelAnimationFrame(frame); frame = 0; }
            else if (!frame) frame = global.requestAnimationFrame(tick);
        });
        update();
        frame = global.requestAnimationFrame(tick);
    }
    if (document.readyState === 'loading' || document.readyState === 'interactive') {
        document.addEventListener('DOMContentLoaded', startDiagnostics, { once: true });
    } else startDiagnostics();
})(typeof window !== 'undefined' ? window : globalThis);
