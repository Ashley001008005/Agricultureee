const KEY = 'tanikala-theme';
const root = document.documentElement;

function getSaved() {
    try { return localStorage.getItem(KEY); } catch { return null; }
}

function save(theme) {
    try { localStorage.setItem(KEY, theme); } catch { /* storage blocked: ignore */ }
}

function applyTheme(theme) {
    root.setAttribute('data-theme', theme);

    const toggle = document.getElementById('themeToggle');
    if (toggle) {
        const isDark = theme === 'dark';
        toggle.setAttribute('aria-pressed', String(isDark));
        toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    }
}

// Runs in <head>, before the page paints, so there is no flash of the wrong theme
applyTheme(getSaved() === 'dark' ? 'dark' : 'light');

document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;

    applyTheme(root.getAttribute('data-theme')); // sync the button's state

    toggle.addEventListener('click', () => {
        const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        save(next);
    });
});