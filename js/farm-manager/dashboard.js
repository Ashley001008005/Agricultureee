
import { supabase } from '../connection.js';
import { h, pageHead, select, donut } from '../admin/ui.js';
import { loadFarms, farmCard, statBox } from './farms.js';

const COLORS = [
    'var(--primary-color)',
    'var(--secondary)',
    'var(--warning)',
    'var(--success)',
    'var(--error)',
    'var(--secondary-text)'
];

async function loadAssignedMunicipality() {
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

// Count all farmers returned by the manager's farmer-list RPC,
// including owners/operators, tenants/lessees, and farm workers.
async function loadTotalFarmers() {
    const { data, error } = await supabase.rpc(
        'manager_list_residential_farmers'
    );

    if (error) throw error;

    // Use unique email addresses to avoid counting the same farmer twice.
    // Fall back to the name when an email is unavailable.
    const uniqueFarmers = new Set();

    for (const farmer of data ?? []) {
        const email = farmer.email?.trim().toLowerCase();
        const name = farmer.full_name?.trim().toLowerCase();

        const key = email || name;

        if (key) {
            uniqueFarmers.add(key);
        }
    }

    return uniqueFarmers.size;
}

async function loadCrops(farmIds) {
    if (!farmIds?.length) return [];

    const { data, error } = await supabase
        .from('farmer_farm_crops')
        .select('farm_id, crop_name')
        .in('farm_id', farmIds)
        .order('crop_name', { ascending: true });

    if (error) throw error;

    return data ?? [];
}

// Count the number of farms growing each crop.
function tally(crops) {
    const byName = new Map();

    for (const crop of crops) {
        const key = crop.crop_name?.trim();

        if (!key) continue;

        if (!byName.has(key)) {
            byName.set(key, new Set());
        }

        byName.get(key).add(crop.farm_id);
    }

    const sorted = [...byName]
        .map(([name, farms]) => ({
            name,
            value: farms.size
        }))
        .sort((a, b) => b.value - a.value);

    const top = sorted.slice(0, 5);

    const rest = sorted
        .slice(5)
        .reduce((total, crop) => total + crop.value, 0);

    if (rest) {
        top.push({
            name: 'Other crops',
            value: rest
        });
    }

    return top.map((crop, index) => ({
        ...crop,
        color: COLORS[index % COLORS.length]
    }));
}

const emptyNote = (text) =>
    h('p', { class: 'muted' }, text);

function municipalityCard(municipality) {
    return h(
        'section',
        { class: 'card' },
        h(
            'div',
            { class: 'card-head' },
            h('h2', {}, 'Assigned Municipality')
        ),
        h(
            'div',
            { class: 'fm-muni' },
            h(
                'div',
                {},
                h(
                    'b',
                    {},
                    municipality || 'No municipality assigned'
                ),
                h(
                    'small',
                    {},
                    municipality
                        ? 'is your assigned area of responsibility'
                        : 'Please contact the administrator to get your municipality assigned.'
                )
            )
        )
    );
}

function summary(farms, municipality, totalFarmers) {
    return h(
        'div',
        { class: 'fm-stack' },

        municipalityCard(municipality),

        h(
            'section',
            { class: 'card' },
            h(
                'div',
                { class: 'card-head' },
                h('h2', {}, 'My Assigned Farms'),
                h(
                    'small',
                    {},
                    `${farms.length} farm${farms.length === 1 ? '' : 's'}`
                )
            ),

            farms.length
                ? h(
                    'div',
                    { class: 'fm-stack' },
                    farms.map((farm) =>
                        h(
                            'div',
                            { class: 'fm-muni' },
                            h(
                                'div',
                                {},
                                h(
                                    'small',
                                    {},
                                    farm.farm_location || 'Location not set'
                                ),
                                h('b', {}, farm.farm_name)
                            ),
                            h('small', {}, farm.farmerName || 'Unknown farmer')
                        )
                    )
                )
                : emptyNote(
                    'No farms are available for your assigned area yet.'
                )
        ),

        h(
            'div',
            { class: 'stat-boxes fm-tiles' },
            statBox('Total farms', String(farms.length)),
            statBox('Total farmers', String(totalFarmers))
        )
    );
}

function overviewCard(crops) {
    const body = h('div');
    let buttons = [];

    const drawCrop = () => {
        const items = tally(crops);

        if (!items.length) {
            body.replaceChildren(
                emptyNote('No crops are recorded for your farms yet.')
            );
            return;
        }

        const chart = donut(items);
        const unit = [...chart.querySelectorAll('text')].pop();

        if (unit) unit.textContent = 'crops';

        body.replaceChildren(
            h(
                'div',
                { class: 'donut-row' },
                chart,
                h(
                    'ul',
                    { class: 'legend' },
                    items.map((item) =>
                        h(
                            'li',
                            {},
                            h('i', {
                                style: `background:${item.color}`
                            }),
                            h(
                                'div',
                                {},
                                h('b', {}, item.name),
                                h(
                                    'small',
                                    {},
                                    `${item.value} farm${item.value === 1 ? '' : 's'}`
                                )
                            )
                        )
                    )
                )
            )
        );
    };

    const drawHealth = () => {
        body.replaceChildren(
            emptyNote(
                'Crop health is not tracked yet. It will appear here once monitoring records exist.'
            )
        );
    };

    const tabs = [
        ['By crop', drawCrop],
        ['By health', drawHealth]
    ];

    buttons = tabs.map(([label, callback], index) =>
        h(
            'button',
            {
                type: 'button',
                class: index === 0 ? 'on' : '',
                onclick: (event) => {
                    buttons.forEach((button) =>
                        button.classList.toggle(
                            'on',
                            button === event.currentTarget
                        )
                    );

                    callback();
                }
            },
            label
        )
    );

    drawCrop();

    return h(
        'section',
        { class: 'card' },
        h(
            'div',
            { class: 'card-head' },
            h('h2', {}, 'Crops overview')
        ),
        h('div', { class: 'tabs' }, buttons),
        body
    );
}

function growthCard() {
    return h(
        'section',
        { class: 'card' },
        h(
            'div',
            { class: 'card-head' },
            h('h2', {}, 'Crop growth monitoring')
        ),
        emptyNote(
            'No growth readings yet. Charts will appear once planting and monitoring records are added.'
        )
    );
}

function myCropsCard(farm, crops) {
    const mine = [
        ...new Set(
            crops
                .filter((crop) => crop.farm_id === farm?.id)
                .map((crop) => crop.crop_name?.trim())
                .filter(Boolean)
        )
    ].sort();

    return h(
        'section',
        { class: 'card' },
        h(
            'div',
            { class: 'card-head' },
            h('h2', {}, 'My crops'),
            h('small', {}, farm?.farm_name ?? '')
        ),

        mine.length
            ? h(
                'ul',
                { class: 'bars' },
                mine.map((name) =>
                    h(
                        'li',
                        {},
                        h('b', {}, name),
                        h(
                            'div',
                            {
                                class: 'bar',
                                role: 'img',
                                'aria-label': `${name}: growth stage not set`
                            },
                            h('span', { style: 'width:0' })
                        ),
                        h('span', { class: 'pct' }, '–')
                    )
                )
            )
            : emptyNote('No crops are recorded for this farm yet.')
    );
}


export async function render(root, ctx) {
    const holder = h('div');
    const filters = h('div');

    const name = ctx?.staff?.full_name?.split(' ')[0] ?? '';

    root.append(
        pageHead(
            'Dashboard',
            name ? `Welcome back, ${name}.` : 'Welcome back.',
            filters
        ),
        holder
    );

    let selectedId = null;

    const load = async () => {
        holder.replaceChildren(
            h('p', { class: 'muted' }, 'Loading dashboard...')
        );

        try {
            const [municipality, farms, totalFarmers] =
                await Promise.all([
                    loadAssignedMunicipality(),
                    loadFarms(),
                    loadTotalFarmers()
                ]);

            if (!farms.length) {
                filters.replaceChildren();
                holder.replaceChildren(
                    summary(farms, municipality, totalFarmers)
                );
                return;
            }

            if (!farms.some((farm) => farm.id === selectedId)) {
                selectedId = farms[0].id;
            }

            const draw = () => {
                const farm = farms.find(
                    (item) => item.id === selectedId
                );

                holder.replaceChildren(
                    h(
                        'div',
                        { class: 'fm-stack' },
                        summary(farms, municipality, totalFarmers),
                        h(
                            'div',
                            { class: 'grid-top' },
                            farmCard(farm, load)
                        )
                    )
                );
            };

            filters.replaceChildren(
                farms.length > 1
                    ? select(
                        farms.map((farm) => [
                            farm.id,
                            `${farm.farmerName} – ${farm.farm_name}`
                        ]),
                        selectedId,
                        (value) => {
                            selectedId = value;
                            draw();
                        },
                        'Choose farm'
                    )
                    : ''
            );

            draw();
        } catch (err) {
            console.error('Failed to load dashboard:', err);

            holder.replaceChildren(
                h(
                    'p',
                    { class: 'msg error' },
                    'Could not load the dashboard.'
                ),
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
