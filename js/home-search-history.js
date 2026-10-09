// Homepage presentation only. Existing ui.js owns history, deletion and search.
(() => {
    function initialize() {
        if (!document.body.classList.contains('home-page')) return;
        const input = document.getElementById('searchInput');
        const history = document.getElementById('recentSearches');
        const wrapper = input?.closest('.home-search-wrap');
        if (!input || !history || !wrapper) return;

        let requested = false;
        function setOpen(open) {
            requested = open;
            const visible = requested && history.childElementCount > 0;
            history.hidden = !visible;
            input.setAttribute('aria-expanded', String(visible));
        }

        input.addEventListener('focus', () => setOpen(true));
        // A click reopens the list after Escape, even when focus never moved.
        input.addEventListener('click', () => setOpen(true));
        history.addEventListener('pointerdown', event => {
            // Keep the input focused until the real click runs. Browsers that
            // blur it without focusing the button otherwise hide the target
            // between press and release. Do not search on press (scroll/cancel).
            if (event.button === 0 && event.target.closest('button')) event.preventDefault();
        });
        wrapper.addEventListener('focusout', event => {
            if (!wrapper.contains(event.relatedTarget)) setOpen(false);
        });
        document.addEventListener('pointerdown', event => {
            if (!wrapper.contains(event.target)) setOpen(false);
        }, true);

        wrapper.addEventListener('keydown', event => {
            if (event.key === 'Escape' && requested) {
                // Restore keyboard focus before dismissing so focus cannot reopen it.
                if (history.contains(document.activeElement)) input.focus({ preventScroll: true });
                setOpen(false);
                event.preventDefault();
            } else if (event.key === 'Enter' && event.target === input && !event.isComposing) {
                setOpen(false);
            }
        });
        wrapper.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (button?.closest('.home-search-bar') && button.id !== 'clearSearchInput') setOpen(false);
        });
        history.addEventListener('click', event => {
            if (event.target.closest('.search-tag')) setOpen(false);
            // Single-delete stops propagation in ui.js, so it keeps the list open.
        });

        // Rerendering or clearing the existing list must keep visibility and ARIA
        // synchronized; observe only its direct children, never the sphere.
        new MutationObserver(() => setOpen(requested)).observe(history, { childList: true });
        setOpen(document.activeElement === input);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
