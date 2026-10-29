
import { supabase } from '../connection.js';
import { h, pageHead, table, person } from '../admin/ui.js';

function normalizeLocation(value) {
    return (value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

async function getAssignedMunicipality() {
    const {
        data: { user },
        error: authError
    } = await supabase.auth.getUser();

    if (authError) throw authError;
    if (!user) throw new Error('No authenticated user found.');

    const { data: staff, error: staffError } = await supabase
        .from('staff_accounts')
        .select('staff_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (staffError) throw staffError;
    if (!staff) throw new Error('Farm Manager staff record not found.');

    const { data, error } = await supabase
        .from('farm_manager_details')
        .select('assigned_farm_location')
        .eq('staff_id', staff.staff_id)
        .maybeSingle();

    if (error) throw error;

    return data?.assigned_farm_location?.trim() || null;
}

export async function render(root, ctx) {
    const holder = h('div');

    root.append(
        pageHead('Farmers', 'Farmers in your assigned municipality.'),
        holder
    );


    const load = async () => {
        holder.replaceChildren(
            h('p', { class: 'muted' }, 'Loading farmers...')
        );

        try {
            const municipality = await getAssignedMunicipality();

            if (!municipality) {
                holder.replaceChildren(
                    h(
                        'section',
                        { class: 'card' },
                        h(
                            'p',
                            { class: 'muted' },
                            'No municipality is assigned to your account. Please contact the administrator.'
                        )
                    )
                );
                return;
            }

            const { data, error } = await supabase.rpc(
                'manager_list_residential_farmers'
            );

            if (error) throw error;

            const q = (ctx?.query ?? '').trim().toLowerCase();

            const rows = (data ?? [])
                .map((r) => ({
                    name: r.full_name,
                    email: r.email,
                    type: ({
                        farm_operator_manager: 'Owner/Operator',
                        owner: 'Owner/Operator',
                        tenant_lessee: 'Tenant/Lesse',
                        farm_worker: 'Hired Farm Worker'
                    })[r.farming_arrangement] ?? 'Farmer',
                    location: r.residential_address
                }))
                .filter((r) =>
                    `${r.name ?? ''} ${r.email ?? ''} ${r.type} ${r.location ?? ''}`
                        .toLowerCase()
                        .includes(q)
                );

            holder.replaceChildren(
                h(
                    'section',
                    { class: 'card' },
                    table(
                        [
                            { label: 'Farmer', cell: person },
                            { label: 'Farmer Type', cell: (r) => r.type },
                            {
                                label: 'Residential Address',
                                cell: (r) => r.location
                            }
                        ],
                        rows,
                        q
                            ? 'No farmers match your search.'
                            : 'No approved farmers found in your assigned municipality.'
                    )
                )
            );
        } catch (err) {
            console.error('Failed to load farmers:', err);

            holder.replaceChildren(
                h('p', { class: 'msg error' }, 'Could not load farmers.'),
                h(
                    'button',
                    {
                        class: 'btn ghost staff-retry',
                        type: 'button',
                        onclick: load
                    },
                    'Retry'
                )
            );
        }
    };


    await load();
}
