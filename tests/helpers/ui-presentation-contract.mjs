// Strip ONLY the approved theme hooks/extraction before comparing original
// hashes. Any altered content, layout, handler, script or other CSS still fails.
export const themeLink = '<link rel="stylesheet" href="css/ui-theme.css?v=20261003-1">';
export const officialPages = ['index.html', 'player.html', 'watch.html', 'about.html'];
const homeTokens = `    --home-ink: #080d11;
    --home-surface: #10181d;
    --home-line: rgba(210, 229, 223, .12);
    --home-muted: #82938f;
    --home-accent: #a2e2ce;
    --home-white: #edf2ee;
`;
const homeShared = `.home-page #historyPanel, .home-page #settingsPanel { background: #0e1812; border-color: #385240; box-shadow: 0 0 70px #0008; }
.home-page #settingsPanel > .space-y-5 > div { border: 1px solid #273c2c; background: #142019; box-shadow: none; }
.home-page #modal > div, .home-page #passwordModal > div { background: #111e16; border-color: #385240; border-radius: 13px; }
.home-page #historyPanel .gradient-text, .home-page #settingsPanel .gradient-text, .home-page #modal .gradient-text, .home-page #passwordModal .gradient-text { background: none; color: #d4e9d9; -webkit-text-fill-color: #d4e9d9; }
`;

export function withoutThemeHooks(file, text) {
    if (officialPages.includes(file)) {
        text = text.replace(/^[\t ]*<link rel="stylesheet" href="css\/ui-theme\.css\?v=20261003-1">\r?\n/m, '');
        const bodies = {
            'index.html': ['<body class="page-bg text-white home-page jayflix-ui">', '<body class="page-bg text-white home-page">'],
            'player.html': ['<body class="jayflix-ui player-page">', '<body>'],
            'watch.html': ['<body class="jayflix-ui watch-page">', '<body>'],
            'about.html': ['<body class="page-bg text-white flex flex-col min-h-screen jayflix-ui about-page">', '<body class="page-bg text-white flex flex-col min-h-screen">'],
        };
        text = text.replace(...bodies[file]);
        if (file === 'index.html') text = text.replace('css/home-orbit.css?v=20261003-18', 'css/home-orbit.css?v=20261003-17');
    }
    if (file === 'css/home-orbit.css') {
        text = text.replace('@import url("ui-tokens.css");\n\n', '')
            .replace('/* Homepage geometry and presentation. Tokens and common components are shared. */',
                '/* Homepage-only presentation. Shared pages and business styles stay independent. */')
            .replace('.home-page {\n', '.home-page {\n' + homeTokens)
            .replace('font-family: var(--ui-font);',
                'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;')
            .replace('\n\n@media (max-width: 900px)', '\n' + homeShared + '\n@media (max-width: 900px)');
    }
    return text;
}
