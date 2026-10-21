import { h, table, select, fmtDateTime, pageHead } from './ui.js';
import { getLogs } from '../api.js';

export async function render(root, ctx) {
    const logs = await getLogs();
    let action = 'all';
    const holder = h('div');

    const draw = () => {
        const q = ctx.query.toLowerCase();
        const rows = logs.filter((l) =>
            (action === 'all' || l.action === action) &&
            `${l.actor} ${l.action} ${l.target}`.toLowerCase().includes(q));

        holder.replaceChildren(table([
            { label: 'When', cell: (l) => fmtDateTime(l.time) },
            { label: 'Admin', cell: (l) => l.actor },
            { label: 'Action', cell: (l) => l.action },
            { label: 'Target', cell: (l) => l.target },
        ], rows, 'No log entries match these filters.'));
    };

    const actions = [...new Set(logs.map((l) => l.action))].map((a) => [a, a]);

    root.append(
        pageHead('Audit logs', 'Every admin action, newest first.'),
        h('section', { class: 'card' },
            h('div', { class: 'toolbar' },
                select([['all', 'All actions'], ...actions], action, (v) => { action = v; draw(); }, 'Action type')),
            holder));
    draw();
}
