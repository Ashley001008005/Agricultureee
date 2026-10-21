import { supabase } from '../connection.js';

// UI status -> value stored in profiles.status. Change the right-hand values if your database uses different ones.
const DB_STATUS = { active: 'approved', pending: 'pending', rejected: 'rejected', suspended: 'suspended' };
const ROLES = ['farmer', 'buyer', 'supplier'];
const COLUMNS = 'id, full_name, email, phone, residential_address, role, status, created_at';

const toUi = (s) => Object.keys(DB_STATUS).find((k) => DB_STATUS[k] === s) ?? s;
const normalize = (p) => ({
    ...p,
    name: p.full_name || p.email || 'Unnamed',
    role: String(p.role ?? '').toLowerCase(),
    status: toUi(p.status),
    joined: p.created_at,
});

async function fetchProfiles() {
    const { data, error } = await supabase.from('profiles').select(COLUMNS).order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(normalize).filter((p) => ROLES.includes(p.role));
}

// --- Auth -------------------------------------------------------------------
export async function requireAdmin() {
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user) return false;

        const { data: admin, error: adminError } = await supabase
            .from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle();
        if (adminError) { console.error('Admin lookup failed:', adminError); return false; }

        if (!admin) { await supabase.auth.signOut(); return false; }
        return true;
    } catch (err) {
        console.error('Admin verification failed:', err);
        return false;
    }
}

export async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

// --- Users & applications ---------------------------------------------------
export const listUsers = fetchProfiles;

export async function setUserStatus(user, status) {
    const { data, error } = await supabase
        .from('profiles').update({ status: DB_STATUS[status] ?? status }).eq('id', user.id).select(COLUMNS).single();
    if (error) throw error;

    log(status === 'active' ? (user.status === 'suspended' ? 'Reactivated user' : 'Approved application')
        : status === 'rejected' ? 'Rejected application' : 'Suspended user', user.name);
    return normalize(data);
}

// --- Applicant details (role-specific tables) -------------------------------
const ROLE_DETAILS = {
    farmer: { table: 'farmer_details', fields: [['Farm name', 'farm_name'], ['Farm location', 'farm_location']], link: ['farmer_crops', 'Main crops grown'] },
    buyer: { table: 'buyer_details', fields: [['Buyer type', 'buyer_type'], ['Business name', 'business_name']], link: ['buyer_interests', 'Interested products'] },
    supplier: { table: 'supplier_details', fields: [['Business name', 'business_name'], ['Business address', 'business_address']], link: ['supplier_products', 'Supplied products'] },
};

export async function getApplicantDetails(app) {
    const cfg = ROLE_DETAILS[app.role];
    if (!cfg) return [];

    const { data, error } = await supabase
        .from(cfg.table).select(cfg.fields.map(([, k]) => k).join(', ')).eq('user_id', app.id).maybeSingle();
    if (error) throw error;

    const [linkTable, linkLabel] = cfg.link;
    const { data: links, error: linkError } = await supabase.from(linkTable).select('product_id').eq('user_id', app.id);
    if (linkError) throw linkError;

    const ids = [...new Set((links ?? []).map((l) => l.product_id))];
    let names = [];
    if (ids.length) {
        const { data: products, error: productsError } = await supabase.from('products').select('id, product_name').in('id', ids);
        if (productsError) throw productsError;
        names = (products ?? []).map((p) => p.product_name);
    }

    return [...cfg.fields.map(([label, key]) => [label, data?.[key]]), [linkLabel, names.join(', ') || 'None listed']];
}

// --- Registration documents (private, via Edge Function) --------------------
async function review(body) {
    const { data, error } = await supabase.functions.invoke('admin-review-application', { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
}

export const listDocuments = async (userId) => (await review({ action: 'list', userId }))?.documents ?? [];

export async function getDocumentUrl(documentId) {
    const data = await review({ action: 'view', documentId });
    if (!data?.signedUrl) throw new Error('No document viewing link was returned.');
    return data.signedUrl;
}

// --- Dashboard --------------------------------------------------------------
export async function getStats() {
    const u = await fetchProfiles();
    const count = (k, v) => u.filter((x) => x[k] === v).length;

    const days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (6 - i));
        return d;
    });
    const perDay = (role) => days.map((d) => u.filter((x) => x.role === role && new Date(x.joined).toDateString() === d.toDateString()).length);

    return {
        total: u.length,
        pending: count('status', 'pending'),
        byRole: Object.fromEntries(ROLES.map((r) => [r, count('role', r)])),
        byStatus: Object.fromEntries(Object.keys(DB_STATUS).map((s) => [s, count('status', s)])),
        approval: ROLES.map((role) => {
            const decided = u.filter((x) => x.role === role && x.status !== 'pending');
            const approved = decided.filter((x) => x.status === 'active' || x.status === 'suspended').length;
            return { role, decided: decided.length, approved, rate: decided.length ? Math.round((approved / decided.length) * 100) : 0 };
        }),
        weekly: {
            labels: days.map((d) => d.toLocaleDateString('en-US', { weekday: 'short' })),
            ...Object.fromEntries(ROLES.map((r) => [r, perDay(r)])),
        },
    };
}

// --- Audit logs & settings (in memory for now) -------------------------------
const logs = [];
const settings = { requireApproval: true, allowFarmer: true, allowBuyer: true, allowSupplier: true, maintenance: false };
const log = (action, target) => logs.unshift({ time: new Date().toISOString(), actor: 'Admin', action, target });

export const getLogs = async () => structuredClone(logs);
export const getSettings = async () => structuredClone(settings);
export async function saveSettings(values) {
    Object.assign(settings, values);
    log('Updated settings', 'Platform');
    return structuredClone(settings);
}
