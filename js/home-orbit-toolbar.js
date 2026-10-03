// Homepage disclosure only. The sphere controller owns all settings and motion.
(() => {
    function initialize() {
        if (!document.body?.classList.contains('home-page') || document.body.classList.contains('orbit-test-page')) return;
        const toolbar = document.getElementById('orbitToolbar');
        const toggle = document.getElementById('orbitToolbarToggle');
        const content = document.getElementById('orbitToolbarContent');
        if (!toolbar || !toggle || !content) return;

        function setExpanded(expanded) {
            toolbar.dataset.collapsed = String(!expanded);
            content.hidden = !expanded;
            toggle.textContent = expanded ? '↘' : '→';
            toggle.setAttribute('aria-expanded', String(expanded));
            const label = expanded ? '收起球体控制栏' : '展开球体控制栏';
            toggle.setAttribute('aria-label', label);
            toggle.setAttribute('title', label);
        }

        // A native button supports mouse, touch, Enter and Space without an
        // extra keyboard handler or any interaction with sphere state.
        toggle.addEventListener('click', () => setExpanded(toggle.getAttribute('aria-expanded') !== 'true'));
        setExpanded(false);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
