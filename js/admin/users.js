import { h, table, badge, person, select, fmtDate, toast, pageHead, ROLE } from './ui.js';
import { listUsers, setUserStatus } from './api.js';
import { openDetails } from './details.js';

const HEADINGS = {
    '': ['Users', 'Every registered account, including pending ones.'],
    pending: ['Pending accounts', 'Accounts waiting for approval.'],
    active: ['Active users', 'Approved accounts.'],
    suspended: ['Suspended users', 'Accounts that are blocked from signing in.'],
    rejected: ['Rejected accounts', 'Applications that were declined.'],
};

export async function render(root, ctx) {
    // The status comes from the sidebar dropdown (#users/pending, #users/active, ...)
    const status = HEADINGS[ctx.sub] !== undefined ? ctx.sub : '';
    const filter = { role: 'all' };
    const holder = h('div');

    const change = async (user, next, doneText) => {
        try {
            await setUserStatus(user, next);
            toast(`${doneText} ${user.name}`);
            await draw();
            ctx.refreshBadge();
        } catch (err) {
            console.error('Could not update user:', err);
            toast('Could not update this user. Check Supabase permissions.');
        }
    };

    const actionsFor = (u) => [
        h('button', { class: 'btn ghost', type: 'button', onclick: () => openDetails(u, (s) => change(u, s, s === 'active' ? 'Approved' : 'Rejected')) }, 'View details'),
        u.status === 'pending' && h('button', { class: 'btn', type: 'button', onclick: () => change(u, 'active', 'Approved') }, 'Approve'),
        u.status === 'pending' && h('button', { class: 'btn danger', type: 'button', onclick: () => change(u, 'rejected', 'Rejected') }, 'Reject'),
        u.status === 'rejected' && h('button', { class: 'btn', type: 'button', onclick: () => change(u, 'active', 'Approved') }, 'Approve'),
        u.status === 'active' && h('button', { class: 'btn danger', type: 'button', onclick: () => change(u, 'suspended', 'Suspended') }, 'Suspend'),
        u.status === 'suspended' && h('button', { class: 'btn', type: 'button', onclick: () => change(u, 'active', 'Reactivated') }, 'Reactivate'),
    ];

    const draw = async () => {
        try {
            const q = ctx.query.toLowerCase();
            const rows = (await listUsers()).filter((u) =>
                (!status || u.status === status) &&
                (filter.role === 'all' || u.role === filter.role) &&
                `${u.name} ${u.email}`.toLowerCase().includes(q));

            holder.replaceChildren(table([
                { label: 'User', cell: person },
                { label: 'Email', cell: (u) => u.email },
                { label: 'Role', cell: (u) => ROLE[u.role].label.slice(0, -1) },
                { label: 'Joined', cell: (u) => fmtDate(u.joined) },
                { label: 'Status', cell: (u) => badge(u.status) },
                { label: 'Action', cell: (u) => h('div', { class: 'actions' }, actionsFor(u)) },
            ], rows, status ? `No ${status} accounts match these filters.` : 'No users match these filters.'));
        } catch (err) {
            console.error('Failed to load users:', err);
            holder.replaceChildren(h('p', { class: 'msg error' }, 'Could not load users. Check the browser console and Supabase permissions.'));
        }
    };

    root.append(
        pageHead(...HEADINGS[status]),
        h('section', { class: 'card' },
            h('div', { class: 'toolbar' },
                select([['all', 'All roles'], ['farmer', 'Farmers'], ['buyer', 'Buyers'], ['supplier', 'Suppliers']], filter.role,
                    (v) => { filter.role = v; draw(); }, 'User role'),
                // Picking a status here moves to the matching dropdown item so the sidebar stays in sync
                select([['', 'All statuses'], ['pending', 'Pending'], ['active', 'Active'], ['suspended', 'Suspended'], ['rejected', 'Rejected']], status,
                    (v) => { location.hash = v ? `users/${v}` : 'users'; }, 'Account status')),
            holder));
    await draw();
}
