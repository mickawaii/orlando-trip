// Supabase Configuration
const SUPABASE_URL = 'https://cznbsgilnxwanzcixnvq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UpQY7XuEBbRDr_7zDdJFwg_eXaNqBTV';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const data = {
    costs: {
        airbnbTotal: 460.10,
        carRentalTotal: 168.64,
        parkingTotal: 67.00,
        disneyTicket: 190.00,
        universalTicket: 142.00
    },
    people: {
        Jackie: { headcount: 1, isAdult: true },
        Alex: { headcount: 1, isAdult: true },
        Crystal: { headcount: 1, isAdult: true },
        Erica: { headcount: 4, isAdult: true, includesKids: true, kidsNames: ['Allyson', 'Caroline', 'Mackenzie'] }
    },
    custom: { Jackie: [], Alex: [], Crystal: [], Erica: [] },
    payments: {},
    itinerary: []
};

let currentActivePerson = 'Jackie';
let itineraryEditMode = false;
let isMagicMode = false;
let tinkClicks = 0;
let tinkTimer = null;

window.initApp = async function () {
    initMagicTrigger();
    restoreAdminMode();
    try {
        await ensureRoteiroData();
        renderHomeToday();
    } catch (e) {
        console.warn('home today', e);
    }
};

function restoreAdminMode() {
    if (localStorage.getItem('disney_admin_mode') === 'true') {
        isMagicMode = true;
        document.body.classList.add('admin-active');
        const indicator = document.getElementById('admin-indicator');
        if (indicator) indicator.style.display = 'block';
    }
}

function initMagicTrigger() {
    const brand = document.querySelector('.app-header h1');
    if (!brand) return;
    brand.addEventListener('click', () => {
        tinkClicks++;
        clearTimeout(tinkTimer);
        if (tinkClicks === 5) {
            const password = prompt('Senha admin');
            if (password === '1004') {
                isMagicMode = true;
                localStorage.setItem('disney_admin_mode', 'true');
                document.body.classList.add('admin-active');
                const indicator = document.getElementById('admin-indicator');
                if (indicator) indicator.style.display = 'block';
            }
            tinkClicks = 0;
        }
        tinkTimer = setTimeout(() => { tinkClicks = 0; }, 2000);
    });
}

// --- IDENTITY LOGIC (Disabled for Global Access) ---
/*
function checkIdentity() {
    // 1. Check URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const userParam = urlParams.get('user');

    if (userParam && data.people[userParam]) {
        saveUser(userParam);
        return;
    }

    // 2. Check localStorage
    // Updated key to v2 to force a reset for everyone
    const savedUser = localStorage.getItem('disney_user_v2');
    if (savedUser && data.people[savedUser]) {
        currentActivePerson = savedUser;
        // User is locked in, nothing else needed
        return;
    }

    // 3. No user found, show overlay
    showIdentityOverlay();
}

window.showIdentityOverlay = function () {
    const overlay = document.getElementById('identity-overlay');
    if (overlay) overlay.style.display = 'flex';
};

window.selectUser = function (name) {
    const confirmation = confirm(`Are you sure you are ${name}? ✨\n\nYou won't be able to change this later.`);
    if (confirmation) {
        saveUser(name);
        const overlay = document.getElementById('identity-overlay');
        if (overlay) overlay.style.display = 'none';
    }
};

function saveUser(name) {
    localStorage.setItem('disney_user_v2', name);
    currentActivePerson = name;
    if (typeof showBreakdown === 'function') showBreakdown(name);
}
*/

// --- EXPENSES LOGIC ---
async function fetchExpenses() {
    const { data: expenses, error } = await _supabase.from('disney_expenses').select('*');
    if (error) console.error('Error fetching expenses:', error);
    else {
        Object.keys(data.custom).forEach(key => data.custom[key] = []);
        expenses.forEach(exp => {
            if (data.custom[exp.person_name]) {
                data.custom[exp.person_name].push(exp);
            }
        });
        showBreakdown(currentActivePerson);
    }
}

window.addCustomExpense = async function () {
    const nameInput = document.getElementById('item-name');
    const priceInput = document.getElementById('item-price');
    const name = nameInput.value.trim();
    const price = parseFloat(priceInput.value);

    if (name && !isNaN(price)) {
        const { error } = await _supabase.from('disney_expenses').insert([
            { person_name: currentActivePerson, item_name: name, price: price }
        ]);
        if (error) alert("Error saving to database!");
        nameInput.value = '';
        priceInput.value = '';
    }
};

window.deleteExpense = async function (id) {
    if (!confirm("Remove this purchase? This cannot be undone.")) return;
    const { error } = await _supabase.from('disney_expenses').delete().eq('id', id);
    if (error) console.error('Error deleting expense:', error);
};

// --- PAYMENTS LOGIC ---
async function fetchPayments() {
    const { data: payments, error } = await _supabase.from('disney_payments').select('*');
    if (error) console.error('Error fetching payments:', error);
    else {
        data.payments = {};
        payments.forEach(p => {
            if (!data.payments[p.person_name]) data.payments[p.person_name] = {};
            data.payments[p.person_name][p.category] = p.is_paid;
        });
        showBreakdown(currentActivePerson);
    }
}

window.togglePayment = async function (category) {
    // 1. Optimistic Update (Immediate visual feedback)
    const isPaidNow = !(data.payments[currentActivePerson] && data.payments[currentActivePerson][category]);

    // Update local state immediately
    if (!data.payments[currentActivePerson]) data.payments[currentActivePerson] = {};
    data.payments[currentActivePerson][category] = isPaidNow;

    // Re-render immediately to show the change
    showBreakdown(currentActivePerson);

    // 2. Perform Network Request
    try {
        const { error } = await _supabase.from('disney_payments').upsert({
            person_name: currentActivePerson,
            category: category,
            is_paid: isPaidNow,
            updated_at: new Date().toISOString()
        }, { onConflict: 'person_name,category' });

        if (error) throw error;

        // Success feedback (optional, maybe a small toast? For now, silence is golden if it worked)
        console.log(`Payment for ${category} updated to ${isPaidNow}`);

    } catch (err) {
        // Revert local state on error
        console.error('Error toggling payment:', err);
        data.payments[currentActivePerson][category] = !isPaidNow;
        showBreakdown(currentActivePerson);
        alert("❌ Failed to save payment status! The database table might be missing. Please run the setup SQL in Supabase.");
    }
};

// --- ITINERARY LOGIC ---
const INITIAL_ITINERARY = [
    { day_index: 0, day_name: 'Sunday, Jan 11: Arrival & Travel Day', time: '7:00 AM', activity: 'Wake up.' },
    { day_index: 0, day_name: 'Sunday, Jan 11: Arrival & Travel Day', time: '7:30 AM', activity: 'Hit the road for McAllen International Airport (MFE) (20-30 min drive).' },
    { day_index: 0, day_name: 'Sunday, Jan 11: Arrival & Travel Day', time: '8:00 AM', activity: 'Arrive at MFE (2 hours before flight).' },
    { day_index: 0, day_name: 'Sunday, Jan 11: Arrival & Travel Day', time: '10:11 AM', activity: 'Flight departs for Sanford (SFB).' },
    { day_index: 0, day_name: 'Sunday, Jan 11: Arrival & Travel Day', time: '1:41 PM', activity: 'Arrive at SFB Airport.' },
    { day_index: 0, day_name: 'Sunday, Jan 11: Arrival & Travel Day', time: '2:30 PM', activity: 'Pick up rental car.' },
    { day_index: 0, day_name: 'Sunday, Jan 11: Arrival & Travel Day', time: '3:30 PM', activity: 'Arrive at Airbnb area. (Explore/Grocery run for 30-60 mins).' },
    { day_index: 0, day_name: 'Sunday, Jan 11: Arrival & Travel Day', time: '4:00 PM - 4:30 PM', activity: 'Check into Airbnb.' },
    { day_index: 1, day_name: 'Monday, Jan 12: Disney World (Magic Kingdom)', time: '6:20 AM', activity: 'Wake up.' },
    { day_index: 1, day_name: 'Monday, Jan 12: Disney World (Magic Kingdom)', time: '6:20 AM - 7:40 AM', activity: 'Get ready and eat breakfast at the Airbnb.' },
    { day_index: 1, day_name: 'Monday, Jan 12: Disney World (Magic Kingdom)', time: '7:40 AM', activity: 'Out the door.' },
    { day_index: 1, day_name: 'Monday, Jan 12: Disney World (Magic Kingdom)', time: '8:00 AM', activity: 'Arrive at Disney World Parking (Updated).' },
    { day_index: 1, day_name: 'Monday, Jan 12: Disney World (Magic Kingdom)', time: '9:00 AM - 11:00 PM', activity: 'All day at Magic Kingdom.' },
    { day_index: 1, day_name: 'Monday, Jan 12: Disney World (Magic Kingdom)', time: '11:30 PM', activity: 'Arrive back at Airbnb.' },
    { day_index: 1, day_name: 'Monday, Jan 12: Disney World (Magic Kingdom)', time: 'Midnight', activity: 'Late dinner at the Airbnb and sleep.' },
    { day_index: 2, day_name: 'Tuesday, Jan 13: Explore & Recovery Day', time: 'Wake up', activity: 'TBD (Sleep in!).' },
    { day_index: 2, day_name: 'Tuesday, Jan 13: Explore & Recovery Day', time: 'Daytime', activity: 'Relax at the Airbnb pool or explore Disney Springs (free entry/parking).' },
    { day_index: 2, day_name: 'Tuesday, Jan 13: Explore & Recovery Day', time: 'Evening', activity: 'Relax and have dinner at the Airbnb to prep for Universal.' },
    { day_index: 3, day_name: 'Wednesday, Jan 14: Universal Orlando', time: '7:40 AM', activity: 'Wake up (2 hours before leaving).' },
    { day_index: 3, day_name: 'Wednesday, Jan 14: Universal Orlando', time: '7:40 AM - 9:20 AM', activity: 'Get ready and eat breakfast.' },
    { day_index: 3, day_name: 'Wednesday, Jan 14: Universal Orlando', time: '9:20 AM', activity: 'Out the door (30 min drive + walking).' },
    { day_index: 3, day_name: 'Wednesday, Jan 14: Universal Orlando', time: '10:00 AM - 9:00 PM', activity: 'Universal Studios.' },
    { day_index: 3, day_name: 'Wednesday, Jan 14: Universal Orlando', time: '9:30 PM', activity: 'Head back to Airbnb.' },
    { day_index: 3, day_name: 'Wednesday, Jan 14: Universal Orlando', time: '10:00 PM', activity: 'Dinner at Airbnb and pack bags for the early flight.' },
    { day_index: 4, day_name: 'Thursday, Jan 15: Departure Day', time: '3:00 AM', activity: 'Wake up.' },
    { day_index: 4, day_name: 'Thursday, Jan 15: Departure Day', time: '3:45 AM', activity: 'Hit the road (Check-out of Airbnb).' },
    { day_index: 4, day_name: 'Thursday, Jan 15: Departure Day', time: '4:45 AM', activity: 'Arrive at Sanford Airport (SFB).' },
    { day_index: 4, day_name: 'Thursday, Jan 15: Departure Day', time: '5:00 AM', activity: 'Drop off rental car.' },
    { day_index: 4, day_name: 'Thursday, Jan 15: Departure Day', time: '5:15 AM', activity: 'Inside terminal / Security.' },
    { day_index: 4, day_name: 'Thursday, Jan 15: Departure Day', time: '6:25 AM', activity: 'Boarding.' },
    { day_index: 4, day_name: 'Thursday, Jan 15: Departure Day', time: '7:00 AM', activity: 'Flight departs home.' }
];

async function fetchItinerary() {
    const { data: items, error } = await _supabase.from('disney_itinerary').select('*').order('day_index', { ascending: true }).order('created_at', { ascending: true });
    if (error) console.error('Error fetching itinerary:', error);
    else {
        const grouped = [];
        items.forEach(item => {
            let dayObj = grouped.find(d => d.day === item.day_name);
            if (!dayObj) {
                dayObj = { day: item.day_name, items: [], index: item.day_index };
                grouped.push(dayObj);
            }
            dayObj.items.push(item);
        });
        data.itinerary = grouped.sort((a, b) => a.index - b.index);
        renderItinerary();
    }
}

window.restoreInitialItinerary = async function () {
    if (!confirm("This will overwrite your current itinerary with the original plan. Continue? ✨")) return;

    // Delete all current items
    await _supabase.from('disney_itinerary').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    // Insert initials
    const { error } = await _supabase.from('disney_itinerary').insert(INITIAL_ITINERARY);
    if (!error) {
        alert("Magic restored! 🏰✨");
        closePlanner();
    } else {
        alert("Error restoring data. Please check connection.");
    }
};

let activePlannerDay = null;

window.toggleItineraryEdit = function () {
    // Password removed as button is only visible in Admin Mode
    openDaySelector();
};

function openDaySelector() {
    const modal = document.getElementById('planner-modal');
    const body = document.getElementById('planner-body');
    const title = document.getElementById('planner-title');
    const footer = document.getElementById('planner-footer');

    title.innerText = "Select a Day to Plan ⚙️";
    footer.style.display = "none";
    modal.style.display = "flex";

    body.innerHTML = `
        <div class="planner-day-select-screen">
            ${data.itinerary.map((day, idx) => `
                <div class="planner-day-card" onclick="openDayPlanner(${idx})">
                    <span class="planner-day-name">${day.day}</span>
                    <span>Edit ➜</span>
                </div>
            `).join('')}
            <button class="add-btn" style="margin-top:20px; background:rgba(239,68,68,0.2); color:#f87171;" onclick="restoreInitialItinerary()">
                ⚠️ Restore Original Itinerary
            </button>
        </div>
    `;
}

window.openDayPlanner = function (dayIndex) {
    activePlannerDay = dayIndex;
    const body = document.getElementById('planner-body');
    const title = document.getElementById('planner-title');
    const footer = document.getElementById('planner-footer');
    const day = data.itinerary[dayIndex];

    title.innerText = `Planning: ${day.day}`;
    footer.style.display = "flex";

    // Helper to convert time string to minutes from midnight
    const toMin = (t) => {
        try {
            let [time, period] = t.split(' ');
            let [h, m] = time.split(':');
            h = parseInt(h); m = parseInt(m || 0);
            if (period === 'PM' && h !== 12) h += 12;
            if (period === 'AM' && h === 12) h = 0;
            return h * 60 + m;
        } catch (e) { return 9999; }
    };

    // 1. Standard hours to fill gaps
    const standardHours = ["7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM"];

    // 2. Combine existing with standards
    let plannerItems = [...day.items];
    standardHours.forEach(h => {
        const standardMin = toMin(h);
        // Check if this hour is already "represented" by any item in the same hour block
        const hourFilled = plannerItems.some(item => {
            const itemMin = toMin(item.time);
            return itemMin >= standardMin && itemMin < standardMin + 60;
        });
        if (!hourFilled) plannerItems.push({ time: h, activity: "", isPlaceholder: true });
    });

    // Sort by time
    plannerItems.sort((a, b) => toMin(a.time) - toMin(b.time));

    body.innerHTML = `
        <div id="planner-rows-container">
            ${plannerItems.map(item => `
                <div class="planner-row">
                    <input type="text" class="planner-time" value="${item.time}" placeholder="Time">
                    <input type="text" class="planner-task" value="${item.activity}" placeholder="What's happening?">
                    <button class="delete-btn" onclick="this.parentElement.remove()">✕</button>
                </div>
            `).join('')}
        </div>
        <button class="add-row-btn" onclick="addBlankRow()">+ Add Specific Time Slot</button>
    `;
};

window.addBlankRow = function () {
    const container = document.getElementById('planner-rows-container');
    const div = document.createElement('div');
    div.className = 'planner-row';
    div.innerHTML = `
        <input type="text" class="planner-time" value="" placeholder="e.g. 7:15 AM">
        <input type="text" class="planner-task" value="" placeholder="Activity...">
        <button class="delete-btn" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);
};

window.saveDay = async function () {
    const rows = document.querySelectorAll('.planner-row');
    const day = data.itinerary[activePlannerDay];
    const newItems = [];
    const saveBtn = document.querySelector('.planner-footer button');

    // UI Loading State
    if (saveBtn) {
        saveBtn.innerText = "Saving... ⏳";
        saveBtn.disabled = true;
    }

    rows.forEach(row => {
        const time = row.querySelector('.planner-time').value.trim();
        const activity = row.querySelector('.planner-task').value.trim();
        if (time && activity) { // Only save rows with BOTH time AND activity
            newItems.push({
                day_index: day.index,
                day_name: day.day,
                time: time,
                activity: activity
            });
        }
    });

    try {
        // Batch update: Delete old, Insert new
        const { error: delError } = await _supabase.from('disney_itinerary').delete().eq('day_name', day.day);
        if (delError) throw delError;

        if (newItems.length > 0) {
            const { error: insError } = await _supabase.from('disney_itinerary').insert(newItems);
            if (insError) throw insError;
        }

        // FORCE REFRESH LOCAL DATA
        await fetchItinerary(); // Re-fetch absolute truth
        renderItinerary(); // Re-draw UI

        // Also explicitly update the day view if it's currently showing
        const activeTabIdx = document.querySelector('.day-tab-btn.active')?.id?.split('-')[1];
        if (activeTabIdx) selectDay(parseInt(activeTabIdx));

        alert("Schedule Updated! ✅");
        closePlanner();
    } catch (e) {
        console.error(e);
        alert("❌ Save failed! Please check your internet connection.");
    } finally {
        if (saveBtn) {
            saveBtn.innerText = "Save Changes ✨";
            saveBtn.disabled = false;
        }
    }
};

window.closePlanner = function () {
    const modal = document.getElementById('planner-modal');
    if (modal) modal.style.display = 'none';
};

window.openCrowdsModal = async function () {
    const modal = document.getElementById('crowds-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.classList.add('no-scroll');
        await ensureCrowdData();
        renderParkChips();
        renderCrowdCalendar();
    }
};

window.closeCrowdsModal = function () {
    const modal = document.getElementById('crowds-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll');
    }
};

window.openHeliosModal = async function () {
    const modal = document.getElementById('helios-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.classList.add('no-scroll');
        await ensureHeliosData();
        renderHeliosRates();
    }
};

window.closeHeliosModal = function () {
    const modal = document.getElementById('helios-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll');
    }
};

window.openRoteiroModal = async function () {
    const modal = document.getElementById('roteiro-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.classList.add('no-scroll');
        await ensureRoteiroData();
        renderRoteiro();
    }
};

window.openGastosModal = async function () {
    const modal = document.getElementById('gastos-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.classList.add('no-scroll');
        await Promise.all([ensureRoteiroData(), ensureHeliosData()]);
        renderGastos();
    }
};

window.closeGastosModal = function () {
    const modal = document.getElementById('gastos-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll');
    }
};

window.closeRoteiroModal = function () {
    const modal = document.getElementById('roteiro-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll');
    }
};





function setupSubscriptions() {
    _supabase.channel('cloud-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'disney_expenses' }, payload => {
            fetchExpenses();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'disney_itinerary' }, payload => {
            fetchItinerary();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'disney_payments' }, payload => {
            fetchPayments();
        })
        .subscribe();
}

// --- UI RENDERING ---
function renderItinerary() {
    const container = document.getElementById('itinerary-container');

    // Safety check
    if (!data.itinerary || data.itinerary.length === 0) {
        container.innerHTML = `
            <div style='text-align: center; color: var(--text-dim); padding: 40px;'>
                <p>Your itinerary is currently empty. ✨</p>
                <button class="add-btn" style="margin-top: 15px;" onclick="restoreInitialItinerary()">Restore Original Itinerary +</button>
            </div>
        `;
        return;
    }

    // 1. Create Tabs HTML
    const tabsHtml = `
        <div class="day-tabs-container">
            ${data.itinerary.map((day, idx) => {
        // Short Day Name (e.g. "Sunday, Jan 11..." -> "Sun 11")
        // Parsing depends on format. Assuming "Sunday, Jan 11: ..."
        const shortName = day.day.split(':')[0].split(',')[0].substr(0, 3) + ' ' + day.day.split(' ')[2];
        return `<button class="day-tab-btn" onclick="selectDay(${idx})" id="tab-${idx}">${shortName}</button>`;
    }).join('')}
        </div>
        <div id="active-day-view" class="day-active-view">
            <!-- Content Injected Here -->
        </div>
    `;

    container.innerHTML = tabsHtml;

    // 2. Select Current Day Default
    selectCurrentDay();
}

window.selectDay = function (index) {
    const view = document.getElementById('active-day-view');
    const day = data.itinerary[index];

    // Update Active Tab State
    document.querySelectorAll('.day-tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`tab-${index}`);
    if (activeBtn) activeBtn.classList.add('active');

    if (!day) return;

    // Helper to convert time string to minutes from midnight for sorting
    const toMin = (t) => {
        try {
            // Handle special cases like "Midnight", "Wake up", "Daytime", etc.
            if (!t || t.toLowerCase().includes('wake') || t.toLowerCase().includes('daytime') || t.toLowerCase().includes('evening')) return 9999;
            if (t.toLowerCase() === 'midnight') return 1440;

            let [time, period] = t.split(' ');
            if (!period) return 9999;
            let [h, m] = time.split(':');
            h = parseInt(h); m = parseInt(m || 0);
            if (period.toUpperCase() === 'PM' && h !== 12) h += 12;
            if (period.toUpperCase() === 'AM' && h === 12) h = 0;
            return h * 60 + m;
        } catch (e) { return 9999; }
    };

    // Sort items by time
    const sortedItems = [...day.items].sort((a, b) => toMin(a.time) - toMin(b.time));

    // Find next day's wake up time
    const nextDay = data.itinerary[index + 1];
    let nextWakeUp = null;
    if (nextDay) {
        const wakeUpItem = nextDay.items.find(item => item.activity.toLowerCase().includes('wake up'));
        if (wakeUpItem) nextWakeUp = wakeUpItem.time;
    }

    // Render the sorted list
    view.innerHTML = `
        <div style="background: rgba(255, 255, 255, 0.03); border-radius: 24px; padding: 25px; border: 1px solid var(--glass-border);">
            <div class="day-title" style="font-size: 1.3rem; margin-bottom: 20px;">${day.day}</div>
            
            <ul class="highlight-list">
                ${sortedItems.map(item => `
                    <li class="highlight-item">
                        <span class="highlight-time">${item.time}</span>
                        <span class="highlight-activity">${item.activity}</span>
                    </li>
                `).join('')}
            </ul>

            ${nextWakeUp ? `
                <div class="next-day-preview" style="margin-top: 25px;">
                    Tomorrow's Wake Up: ${nextWakeUp}
                </div>
            ` : ''}
        </div>
    `;
};

function selectCurrentDay() {
    const today = new Date();
    // Trip Dates (Hardcoded matching existing logic): Jan 11 = Index 0
    const tripStart = new Date('2026-01-11T00:00:00');
    const diffTime = today.getTime() - tripStart.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let targetIndex = 0;
    if (diffDays >= 0 && diffDays < data.itinerary.length) {
        targetIndex = diffDays;
    } else if (diffDays >= data.itinerary.length) {
        targetIndex = data.itinerary.length - 1;
    }

    selectDay(targetIndex);
}

function initSortable() {
    const el = document.getElementById('itinerary-container');
    if (!el) return;

    // Destroy previous instance if it exists
    if (window.itinerarySortable) window.itinerarySortable.destroy();

    window.itinerarySortable = new Sortable(el, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        onEnd: async function (evt) {
            const cards = Array.from(el.children);
            const updates = [];

            for (let i = 0; i < cards.length; i++) {
                const dayName = cards[i].querySelector('.day-title').innerText;

                // Update day_index for all items with this day_name
                const { data: dayItems } = await _supabase
                    .from('disney_itinerary')
                    .select('id')
                    .eq('day_name', dayName);

                if (dayItems) {
                    dayItems.forEach(item => {
                        updates.push(_supabase.from('disney_itinerary').update({ day_index: i }).eq('id', item.id));
                    });
                }
            }

            await Promise.all(updates);
        }
    });
}

window.showBreakdown = function (name) {
    currentActivePerson = name;
    document.querySelectorAll('.person-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.includes(name));
    });

    const person = data.people[name];
    const content = document.getElementById('breakdown-content');
    const selector = document.querySelector('.person-selector');
    const payments = data.payments[name] || {};

    // Preserve details visibility state before re-render
    const existingDetails = document.getElementById('expense-details');
    const wasDetailsVisible = existingDetails && existingDetails.style.display !== 'none';

    if (selector) selector.style.display = 'flex';

    // Helper for Admin Toggles
    const getAdminBtn = (category) => {
        if (!isMagicMode) return '';
        const isPaid = !!payments[category];
        return `<button class="admin-toggle-btn ${isPaid ? 'paid' : ''}" onclick="event.stopPropagation(); togglePayment('${category}')">${isPaid ? '✓ Paid' : 'Mark Paid'}</button>`;
    };

    // Calculate portions
    // Erica has a special Airbnb amount (partial payment made)
    let airbnbShareOrig = (data.costs.airbnbTotal / 7) * person.headcount;
    if (name === 'Erica') {
        airbnbShareOrig = 221.82; // Erica's remaining Airbnb balance
    }
    const carShare = person.isAdult ? (data.costs.carRentalTotal / 4) : 0;
    const parkingShare = person.isAdult ? (data.costs.parkingTotal / 4) : 0;

    // Check paid states
    const airbnbPaid = !!payments['AirBnB'];
    const carPaid = !!payments['Car Rental'];
    const parkingPaid = !!payments['Parking'];
    const disneyPaid = !!payments['Disney'];
    const universalPaid = !!payments['Universal'];

    // Disney Tickets Logic (Covered by Erica check)
    const coveredByErica = ['Jackie', 'Alex', 'Crystal'];
    let finalDisneyTotal = data.costs.disneyTicket * person.headcount;
    let isCovered = coveredByErica.includes(name);

    let disneyRowContent = `
        <td class="${disneyPaid ? 'is-paid' : ''}">Magic Kingdom Ticket (x${person.headcount}) ${getAdminBtn('Disney')}</td>
        <td style="text-align: right" class="${disneyPaid ? 'is-paid' : ''}">$${finalDisneyTotal.toFixed(2)}</td>`;

    if (isCovered) {
        finalDisneyTotal = 0;
        disneyRowContent = `
            <td>Magic Kingdom Ticket (x${person.headcount})</td>
            <td style="text-align: right; color: var(--text-dim);">
                <span style="text-decoration: line-through;">$${(data.costs.disneyTicket * person.headcount).toFixed(2)}</span>
                <br><span style="font-size: 0.8em; color: var(--accent);">Paid by Erica ✨</span>
            </td>`;
    } else if (name === 'Erica') {
        const extraTicketsCost = data.costs.disneyTicket * 3;
        finalDisneyTotal += extraTicketsCost;
        disneyRowContent = `
            <td class="${disneyPaid ? 'is-paid' : ''}">Magic Kingdom (x${person.headcount} + 3 others) ${getAdminBtn('Disney')}</td>
            <td style="text-align: right" class="${disneyPaid ? 'is-paid' : ''}">$${finalDisneyTotal.toFixed(2)}</td>`;
    }

    const universalTicketsTotal = data.costs.universalTicket * person.headcount;
    const customItems = data.custom[name] || [];
    const customTotal = customItems.reduce((sum, item) => sum + item.price, 0);

    // Calculate Owed Total (Only items NOT paid)
    let totalOwed = 0;
    if (!airbnbPaid) totalOwed += airbnbShareOrig;
    if (!carPaid) totalOwed += carShare;
    if (!parkingPaid) totalOwed += parkingShare;
    if (!isCovered && !disneyPaid) totalOwed += finalDisneyTotal;
    if (!universalPaid) totalOwed += universalTicketsTotal;
    totalOwed += customTotal;

    let customRows = customItems.map((item) => `
        <tr>
            <td>Purchase</td>
            <td>${item.item_name} ${isMagicMode ? `<button class="delete-btn" onclick="deleteExpense('${item.id}')">🗑️</button>` : ''}</td>
            <td style="text-align: right">$${parseFloat(item.price).toFixed(2)}</td>
        </tr>
    `).join('');

    content.innerHTML = `
        <div style="animation: fadeInDown 0.4s ease-out">
            <h3 style="text-align:center; margin-bottom:10px;">${name}'s Contribution</h3>
            
            <div class="expense-summary-card">
                <div class="summary-label">Total Amount ${totalOwed <= 0 ? 'Settled ✨' : 'Owed'}</div>
                <div class="summary-amount">$${totalOwed.toFixed(2)}</div>
                ${person.includesKids ? `<div style="font-size:0.8rem; color:var(--text-dim);">Includes ${person.kidsNames.join(', ')}</div>` : ''}
                
                <div class="quick-links-container" style="margin-top: 15px;">
                    <div class="icon-btn-wrapper">
                        <button class="icon-btn btn-details" onclick="toggleDetails()">🧾</button>
                        <span class="icon-label" id="details-label">View Details</span>
                    </div>
                </div>
            </div>

            <div id="expense-details" style="display: none;">
                <table class="breakdown-table">
                    <thead>
                        <tr><th>Category</th><th>Details</th><th style="text-align: right">Amount</th></tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="${airbnbPaid ? 'is-paid' : ''}">AirBnB ${getAdminBtn('AirBnB')}</td>
                            <td class="${airbnbPaid ? 'is-paid' : ''}">$460.10 split 7 ways (x${person.headcount})</td>
                            <td style="text-align: right" class="${airbnbPaid ? 'is-paid' : ''}">$${airbnbShareOrig.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td class="${carPaid ? 'is-paid' : ''}">Car Rental ${getAdminBtn('Car Rental')}</td>
                            <td class="${carPaid ? 'is-paid' : ''}">$168.64 split 4 adults</td>
                            <td style="text-align: right" class="${carPaid ? 'is-paid' : ''}">$${carShare.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td class="${parkingPaid ? 'is-paid' : ''}">Parking ${getAdminBtn('Parking')}</td>
                            <td class="${parkingPaid ? 'is-paid' : ''}">Theme parks total split 4 adults</td>
                            <td style="text-align: right" class="${parkingPaid ? 'is-paid' : ''}">$${parkingShare.toFixed(2)}</td>
                        </tr>
                        <tr>
                            <td>Disney World</td>
                            ${disneyRowContent}
                        </tr>
                        <tr>
                            <td class="${universalPaid ? 'is-paid' : ''}">Universal ${getAdminBtn('Universal')}</td>
                            <td class="${universalPaid ? 'is-paid' : ''}">Studios Ticket (x${person.headcount})</td>
                            <td style="text-align: right" class="${universalPaid ? 'is-paid' : ''}">$${universalTicketsTotal.toFixed(2)}</td>
                        </tr>
                        ${customRows}
                    </tbody>
                </table>

                <div class="payment-info-box" style="margin-top: 20px;">
                    <div class="payment-title">Payment Options 💸</div>
                    <div class="payment-subtitle">Please send payments to Jackie</div>
                    <div class="payment-methods">
                        <div class="payment-method">
                            <span class="method-label">Cash App</span>
                            <span class="method-value">$Jackyjacx14</span>
                        </div>
                        <div class="payment-method">
                            <span class="method-label">Zelle</span>
                            <span class="method-value">956-246-3634</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Restore details visibility if it was open before re-render
    if (wasDetailsVisible) {
        const newDetails = document.getElementById('expense-details');
        const newLabel = document.getElementById('details-label');
        if (newDetails) newDetails.style.display = 'block';
        if (newLabel) newLabel.innerText = 'Hide Details';
    }
};

window.toggleDetails = function () {
    const el = document.getElementById('expense-details');
    const label = document.getElementById('details-label');
    const form = document.getElementById('expense-form-container');

    if (el.style.display === 'none') {
        el.style.display = 'block';
        if (form) form.classList.add('visible'); // Show form
        if (label) label.innerText = 'Hide Details';
    } else {
        el.style.display = 'none';
        if (form) form.classList.remove('visible'); // Hide form
        if (label) label.innerText = 'View Details';
    }
};

// Countdown Logic
const flightTime = new Date('November 29, 2026 08:00:00').getTime();

function updateCountdown() {
    const now = new Date().getTime();
    const distance = flightTime - now;

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    const dEl = document.getElementById('days');
    const hEl = document.getElementById('hours');
    const mEl = document.getElementById('minutes');
    const sEl = document.getElementById('seconds');

    if (dEl) dEl.innerText = String(days).padStart(2, '0');
    if (hEl) hEl.innerText = String(hours).padStart(2, '0');
    if (mEl) mEl.innerText = String(minutes).padStart(2, '0');
    if (sEl) sEl.innerText = String(seconds).padStart(2, '0');

    if (distance < 0) {
        clearInterval(countdownTimer);
        const el = document.getElementById('flight-countdown');
        if (el) el.innerHTML = "<h3>Viagem em andamento</h3>";
    }
}

const countdownTimer = setInterval(updateCountdown, 1000);
updateCountdown();

// --- PARK CROWD CALENDAR ---
const CROWD_PARKS = [
    { slug: 'magic-kingdom', name: 'Magic Kingdom', short: 'MK' },
    { slug: 'epcot', name: 'EPCOT', short: 'EPCOT' },
    { slug: 'hollywood-studios', name: 'Hollywood Studios', short: 'DHS' },
    { slug: 'animal-kingdom', name: 'Animal Kingdom', short: 'AK' },
    { slug: 'epic-universe', name: 'Epic Universe', short: 'Epic' },
    { slug: 'universal-studios', name: 'Universal Studios', short: 'USF' },
    { slug: 'islands-of-adventure', name: 'Islands of Adventure', short: 'IoA' },
    { slug: 'seaworld', name: 'SeaWorld', short: 'SW' },
    { slug: 'busch-gardens', name: 'Busch Gardens', short: 'Busch' }
];

const CROWD_LEVEL_ORDER = { Light: 1, Moderate: 2, Busy: 3, Packed: 4 };
const CROWD_LEVEL_FROM_SCORE = (score) => {
    if (score <= 2.4) return 'Light';
    if (score <= 3.3) return 'Moderate';
    if (score <= 4.2) return 'Busy';
    return 'Packed';
};

let crowdState = {
    parkSlug: 'epic-universe',
    year: 2026,
    month: 10, // November (0-indexed) — janela da viagem
    observed: {}, // slug -> { 'YYYY-MM-DD': { level, avgWait, samples, source, pct, predicted } }
    loaded: false
};

const PARK_WEEKDAY_BIAS = {
    'magic-kingdom': [2.6, 2.2, 2.4, 2.5, 2.8, 3.6, 3.8],
    'epcot': [2.8, 2.5, 2.6, 2.7, 2.9, 3.4, 3.5],
    'hollywood-studios': [3.2, 3.0, 3.1, 3.2, 3.4, 3.8, 3.9],
    'animal-kingdom': [2.4, 2.1, 2.2, 2.3, 2.5, 3.1, 3.2],
    'epic-universe': [3.8, 3.6, 3.7, 3.7, 3.9, 4.3, 4.4],
    'islands-of-adventure': [2.9, 2.6, 2.7, 2.8, 3.0, 3.5, 3.6],
    'universal-studios': [2.9, 2.6, 2.7, 2.8, 3.0, 3.5, 3.6],
    'seaworld': [2.7, 2.4, 2.5, 2.6, 2.8, 3.3, 3.4],
    'busch-gardens': [2.8, 2.5, 2.6, 2.7, 2.9, 3.4, 3.5]
};

function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseCrowdCsv(text) {
    const map = {};
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return map;
    const headers = lines[0].split(',').map(h => h.trim());
    for (const line of lines.slice(1)) {
        if (!line.trim()) continue;
        const cols = line.split(',');
        const row = {};
        headers.forEach((h, i) => { row[h] = cols[i]; });
        const date = row.date;
        const level = row.crowd_level;
        if (!date || !level) continue;
        const predicted = row.predicted === '1' || String(row.source || '').startsWith('forecast');
        const sourceName = row.source || (predicted ? 'forecast' : 'queue-times');
        map[date] = {
            level: level.trim(),
            avgWait: row.average_wait_min ? Number(row.average_wait_min) : null,
            samples: row.samples ? Number(row.samples) : null,
            pct: row.crowd_pct ? Number(row.crowd_pct) : null,
            predicted,
            source: predicted ? 'forecast' : 'observed',
            sourceName
        };
    }
    return map;
}

async function fetchParkCrowd(slug) {
    const urls = [`/api/crowd/${slug}`, `data/${slug}.csv`];
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const text = await res.text();
            if (!text.includes('crowd_level')) continue;
            return parseCrowdCsv(text);
        } catch (_) { /* try next */ }
    }
    return {};
}

async function ensureCrowdData() {
    if (crowdState.loaded) return;
    const results = await Promise.all(CROWD_PARKS.map(p => fetchParkCrowd(p.slug)));
    CROWD_PARKS.forEach((p, i) => {
        crowdState.observed[p.slug] = results[i];
    });
    crowdState.loaded = true;
}

function holidayBoost(d) {
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const md = m * 100 + day;
    // US holiday / peak travel spikes (approximate)
    const spikes = [
        [101, 105],   // New Year
        [115, 120],   // MLK weekend window
        [212, 217],   // Presidents Day
        [310, 331],   // Spring break stretch
        [401, 415],   // Easter window (approx)
        [522, 531],   // Memorial Day
        [628, 707],   // July 4 week
        [829, 907],   // Labor Day
        [1120, 1130], // Thanksgiving
        [1218, 1231]  // Christmas / NY
    ];
    for (const [a, b] of spikes) {
        if (md >= a && md <= b) return 1.1;
    }
    // Summer boost
    if (m === 6 || m === 7 || (m === 8 && day <= 15)) return 0.55;
    // Early Sep / mid Jan quieter
    if ((m === 9 && day >= 8 && day <= 25) || (m === 1 && day >= 6 && day <= 14)) return -0.55;
    return 0;
}

function estimateCrowd(slug, d) {
    const bias = PARK_WEEKDAY_BIAS[slug] || PARK_WEEKDAY_BIAS['magic-kingdom'];
    let score = bias[d.getDay()] + holidayBoost(d);
    // Cap
    score = Math.max(1.2, Math.min(4.8, score));
    return {
        level: CROWD_LEVEL_FROM_SCORE(score),
        avgWait: null,
        samples: null,
        source: 'estimate',
        score
    };
}

function getCrowdForDay(slug, dateStr) {
    const observed = crowdState.observed[slug] && crowdState.observed[slug][dateStr];
    if (observed) return observed;
    const [y, m, day] = dateStr.split('-').map(Number);
    return estimateCrowd(slug, new Date(y, m - 1, day));
}

function renderParkChips() {
    const row = document.getElementById('park-chip-row');
    if (!row) return;
    row.innerHTML = CROWD_PARKS.map(p => `
        <button type="button" class="park-chip ${p.slug === crowdState.parkSlug ? 'active' : ''}"
            onclick="selectCrowdPark('${p.slug}')">${p.short}</button>
    `).join('');
}

window.selectCrowdPark = function (slug) {
    crowdState.parkSlug = slug;
    renderParkChips();
    renderCrowdCalendar();
    const detail = document.getElementById('crowd-day-detail');
    if (detail) detail.textContent = '';
};

window.shiftCrowdMonth = function (delta) {
    let m = crowdState.month + delta;
    let y = crowdState.year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    crowdState.month = m;
    crowdState.year = y;
    renderCrowdCalendar();
};

window.selectCrowdDay = function (dateStr) {
    const info = getCrowdForDay(crowdState.parkSlug, dateStr);
    const park = CROWD_PARKS.find(p => p.slug === crowdState.parkSlug);
    const detail = document.getElementById('crowd-day-detail');
    if (!detail) return;
    const pct = info.pct != null ? ` · índice ${Math.round(info.pct)}%` : '';
    const wait = info.avgWait != null ? ` · espera méd. ~${Math.round(info.avgWait)} min` : '';
    let src = 'Estimativa local';
    if (info.sourceName === 'queue-times') src = info.predicted ? 'Queue-Times (previsto)' : 'Queue-Times';
    else if (String(info.sourceName || '').startsWith('forecast')) src = 'Previsão (QT ano anterior + Theme Parks Guide)';
    else if (info.source === 'observed') src = 'Observado';
    else if (info.source === 'forecast') src = 'Previsão';
    detail.innerHTML = `<strong>${dateStr}</strong> · ${park.name}<br>${info.level}${pct}${wait}<br><span class="crowd-source">${src}</span>`;
};

function renderCrowdCalendar() {
    const cal = document.getElementById('crowd-calendar');
    const label = document.getElementById('crowd-month-label');
    if (!cal || !label) return;

    const y = crowdState.year;
    const m = crowdState.month;
    const monthName = new Date(y, m, 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    label.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStr = isoDate(new Date());

    let html = `<div class="crowd-dow">${['D','S','T','Q','Q','S','S'].map(d => `<span>${d}</span>`).join('')}</div><div class="crowd-grid">`;

    for (let i = 0; i < firstDow; i++) {
        html += `<div class="crowd-cell empty"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const info = getCrowdForDay(crowdState.parkSlug, dateStr);
        const levelClass = (info.level || 'Moderate').toLowerCase();
        const isToday = dateStr === todayStr ? ' today' : '';
        const estimated = (info.source === 'estimate' || info.predicted || info.source === 'forecast') ? ' estimated' : '';
        const title = info.pct != null ? `${info.level} · ${Math.round(info.pct)}%` : info.level;
        html += `<button type="button" class="crowd-cell ${levelClass}${isToday}${estimated}" onclick="selectCrowdDay('${dateStr}')" title="${title}">
            <span class="crowd-day-num">${day}</span>
            <span class="crowd-level-dot"></span>
        </button>`;
    }

    html += '</div>';
    cal.innerHTML = html;
}

// --- HELIOS HOTEL RATES (scraped Flexible Rate) ---
let heliosRows = [];
let heliosByDate = {};
let heliosMonthFilter = 'all';
let heliosLoaded = false;
let heliosSelectedDate = null;

const HELIOS_MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
const HELIOS_MONTH_LABELS = {
    '2026-08': 'Agosto 2026',
    '2026-09': 'Setembro 2026',
    '2026-10': 'Outubro 2026',
    '2026-11': 'Novembro 2026',
    '2026-12': 'Dezembro 2026'
};

function parseHeliosCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',');
    // Simple CSV parser handling quoted fields
    const parseLine = (line) => {
        const out = [];
        let cur = '';
        let q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { q = !q; continue; }
            if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
            cur += c;
        }
        out.push(cur);
        return out;
    };
    return lines.slice(1).map(line => {
        const cols = parseLine(line);
        const obj = {};
        headers.forEach((h, i) => obj[h] = cols[i]);
        obj.nightly_rate = obj.nightly_rate === '' ? NaN : parseFloat(obj.nightly_rate);
        obj.taxes = obj.taxes === '' ? NaN : parseFloat(obj.taxes);
        obj.total = obj.total === '' ? NaN : parseFloat(obj.total);
        return obj;
    }).filter(r => r.date);
}

async function ensureHeliosData() {
    if (heliosLoaded) return;
    try {
        const res = await fetch('data/helios-aug-dec-2026.csv');
        if (!res.ok) throw new Error('CSV missing');
        heliosRows = parseHeliosCsv(await res.text());
        heliosByDate = {};
        heliosRows.forEach(r => { heliosByDate[r.date] = r; });
        heliosLoaded = true;
    } catch (e) {
        console.error('Helios rates load failed', e);
        heliosRows = [];
        heliosByDate = {};
    }
}

function heliosPriceTier(rate, min, max) {
    if (Number.isNaN(rate) || rate <= 0) return 'none';
    if (max <= min) return 'mid';
    const t = (rate - min) / (max - min);
    if (t <= 0.25) return 'cheap';
    if (t <= 0.5) return 'mid';
    if (t <= 0.75) return 'high';
    return 'peak';
}

window.filterHeliosMonth = function (monthKey) {
    heliosMonthFilter = monthKey;
    document.querySelectorAll('#helios-month-chips .park-chip').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-helios-month') === monthKey);
    });
    heliosSelectedDate = null;
    const detail = document.getElementById('helios-day-detail');
    if (detail) detail.textContent = '';
    renderHeliosRates();
};

window.selectHeliosDay = function (dateStr) {
    heliosSelectedDate = dateStr;
    const detail = document.getElementById('helios-day-detail');
    const row = heliosByDate[dateStr];
    if (!detail) return;
    if (!row) {
        detail.textContent = `${dateStr} · sem dados`;
        return;
    }
    const hasPrice = !Number.isNaN(row.nightly_rate) && row.nightly_rate > 0;
    if (!hasPrice) {
        detail.innerHTML = `<strong>${dateStr}</strong> · ${(row.dow || '')}<br>Indisponível <span class="crowd-source">(${row.status || 'n/a'})</span>`;
        return;
    }
    detail.innerHTML = `<strong>${dateStr}</strong> · ${row.dow || ''}
        <br>Diária <strong>$${row.nightly_rate.toFixed(0)}</strong>
        · impostos $${(row.taxes || 0).toFixed(0)}
        · total <strong>$${(row.total || 0).toFixed(0)}</strong>
        <span class="crowd-source">(Flexible Rate)</span>`;
    // refresh selection ring
    document.querySelectorAll('.helios-day.selected').forEach(el => el.classList.remove('selected'));
    const cell = document.querySelector(`.helios-day[data-date="${dateStr}"]`);
    if (cell) cell.classList.add('selected');
};

function renderHeliosMonthCalendar(monthKey, min, max) {
    const [yStr, mStr] = monthKey.split('-');
    const y = Number(yStr);
    const m = Number(mStr) - 1; // 0-indexed
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const title = HELIOS_MONTH_LABELS[monthKey] || monthKey;

    let html = `<section class="helios-month-card">
        <h3 class="helios-month-title">${title}</h3>
        <div class="crowd-dow">${['D','S','T','Q','Q','S','S'].map(d => `<span>${d}</span>`).join('')}</div>
        <div class="helios-grid">`;

    for (let i = 0; i < firstDow; i++) {
        html += `<div class="helios-day empty"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
        const row = heliosByDate[dateStr];
        const hasPrice = row && !Number.isNaN(row.nightly_rate) && row.nightly_rate > 0;
        const tier = hasPrice ? heliosPriceTier(row.nightly_rate, min, max) : (row ? 'none' : 'empty-data');
        const selected = heliosSelectedDate === dateStr ? ' selected' : '';
        const cheapest = hasPrice && row.nightly_rate === min ? ' cheapest' : '';
        const priceLabel = hasPrice ? `$${Math.round(row.nightly_rate)}` : '—';
        const titleAttr = hasPrice
            ? `${dateStr}: $${row.nightly_rate.toFixed(0)} / noite`
            : `${dateStr}: sem preço`;
        html += `<button type="button" class="helios-day ${tier}${selected}${cheapest}" data-date="${dateStr}"
            onclick="selectHeliosDay('${dateStr}')" title="${titleAttr}">
            <span class="helios-day-num">${day}</span>
            <span class="helios-day-price">${priceLabel}</span>
        </button>`;
    }

    html += `</div></section>`;
    return html;
}

function renderHeliosRates() {
    const host = document.getElementById('helios-calendars');
    const summary = document.getElementById('helios-summary');
    if (!host || !summary) return;

    if (!heliosRows.length) {
        summary.textContent = 'Nenhum preço carregado.';
        host.innerHTML = '';
        return;
    }

    const months = heliosMonthFilter === 'all'
        ? HELIOS_MONTHS
        : HELIOS_MONTHS.filter(m => m === heliosMonthFilter);

    const viewRows = heliosRows.filter(r =>
        months.some(m => r.date.startsWith(m)) && !Number.isNaN(r.nightly_rate) && r.nightly_rate > 0
    );
    // Color scale against all loaded rates so months stay comparable
    const allPriced = heliosRows.filter(r => !Number.isNaN(r.nightly_rate) && r.nightly_rate > 0);
    const rates = allPriced.map(r => r.nightly_rate);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const viewRates = viewRows.map(r => r.nightly_rate);
    const viewMin = viewRates.length ? Math.min(...viewRates) : min;
    const viewMax = viewRates.length ? Math.max(...viewRates) : max;
    const viewAvg = viewRates.length
        ? viewRates.reduce((a, b) => a + b, 0) / viewRates.length
        : 0;

    summary.innerHTML = `
        <div class="helios-stat"><span class="label">Mais barato</span><span class="value">$${viewMin.toFixed(0)}</span></div>
        <div class="helios-stat"><span class="label">Média</span><span class="value">$${viewAvg.toFixed(0)}</span></div>
        <div class="helios-stat"><span class="label">Mais caro</span><span class="value">$${viewMax.toFixed(0)}</span></div>
    `;

    host.innerHTML = months.map(m => renderHeliosMonthCalendar(m, min, max)).join('');
}

// --- ROTEIRO INTERATIVO (companheiro de parque) ---
let roteiroData = null;
let roteiroDayIndex = 0;
const ROTEIRO_CHECK_KEY = 'orlando_park_checklist_v1';

function loadChecklist() {
    try { return JSON.parse(localStorage.getItem(ROTEIRO_CHECK_KEY) || '{}'); }
    catch { return {}; }
}
function saveChecklist(map) {
    localStorage.setItem(ROTEIRO_CHECK_KEY, JSON.stringify(map));
}
function checkKey(date, id) { return `${date}::${id}`; }

async function ensureRoteiroData() {
    if (roteiroData) return;
    try {
        const res = await fetch('data/roteiro-nov-dez-2026.json');
        if (!res.ok) throw new Error('roteiro missing');
        roteiroData = await res.json();
        // Default to "today" if within trip, else first park day
        const today = new Date().toISOString().slice(0, 10);
        const idx = roteiroData.days.findIndex(d => d.date === today);
        roteiroDayIndex = idx >= 0 ? idx : 0;
    } catch (e) {
        console.error('Roteiro load failed', e);
        roteiroData = null;
    }
}


function renderHomeToday() {
    const body = document.getElementById('home-today-body');
    if (!body || !roteiroData) return;
    const today = isoDate(new Date());
    const days = roteiroData.days || [];
    let day = days.find(d => d.date === today);
    if (!day) {
        // nearest upcoming
        day = days.find(d => d.date >= today) || days[days.length - 1];
    }
    if (!day) {
        body.textContent = 'Roteiro indisponível.';
        return;
    }
    const label = day.date === today ? 'Hoje' : formatDateBR(day.date);
    body.innerHTML = `<strong>${label} · ${day.dow}</strong><br>${day.title}<br><span class="home-today-focus">${day.strategy || ''}</span>`;
    const idx = days.indexOf(day);
    if (idx >= 0) roteiroDayIndex = idx;
}

window.selectRoteiroDay = function (idx) {
    roteiroDayIndex = idx;
    renderRoteiro();
    const body = document.getElementById('roteiro-body');
    if (body) body.scrollTop = 0;
};

window.toggleRoteiroAttr = function (date, id) {
    const map = loadChecklist();
    const k = checkKey(date, id);
    map[k] = !map[k];
    saveChecklist(map);
    renderRoteiroDayDetail();
    renderRoteiroNextBar();
};

window.resetRoteiroDayChecks = function (date) {
    if (!confirm('Limpar checklist deste dia?')) return;
    const map = loadChecklist();
    Object.keys(map).forEach(k => {
        if (k.startsWith(date + '::')) delete map[k];
    });
    saveChecklist(map);
    renderRoteiro();
};

function formatMoneyUSD(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatMoneyUSDExact(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateBR(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}`;
}

function computeRoteiroHotelStay() {
    const hotel = (roteiroData && roteiroData.hotel) || {};
    const checkin = hotel.checkin;
    const checkout = hotel.checkout;
    if (!checkin || !checkout) return null;

    const byDate = {};
    heliosRows.forEach(r => { byDate[r.date] = r; });

    const nights = [];
    const start = new Date(checkin + 'T12:00:00');
    const end = new Date(checkout + 'T12:00:00');
    for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
        const d = new Date(t);
        const iso = isoDate(d);
        const row = byDate[iso];
        nights.push({
            date: iso,
            dow: row?.dow || d.toLocaleDateString('en-US', { weekday: 'short' }),
            nightly: row && !Number.isNaN(row.nightly_rate) ? row.nightly_rate : null,
            taxes: row && !Number.isNaN(row.taxes) ? row.taxes : null,
            total: row && !Number.isNaN(row.total) ? row.total : null
        });
    }

    const priced = nights.filter(n => n.total != null);
    const roomTotal = priced.reduce((s, n) => s + (n.nightly || 0), 0);
    const taxesTotal = priced.reduce((s, n) => s + (n.taxes || 0), 0);
    const total = priced.reduce((s, n) => s + (n.total || 0), 0);
    const fromCsv = priced.length === nights.length && nights.length > 0;

    return {
        name: hotel.name || 'Helios',
        checkin,
        checkout,
        nights,
        nightsCount: nights.length,
        roomTotal: fromCsv ? roomTotal : (hotel.room_total ?? hotel.nightly_total),
        taxesTotal: fromCsv ? taxesTotal : (hotel.taxes_total ?? null),
        total: fromCsv ? total : (hotel.total_with_tax ?? hotel.nightly_total),
        avg: fromCsv && nights.length ? total / nights.length : (hotel.nightly_avg ?? null),
        fromCsv,
        rateNote: hotel.rate_note || 'Flexible Rate · com impostos'
    };
}

function renderGastos() {
    const body = document.getElementById('gastos-body');
    if (!body) return;

    const stay = computeRoteiroHotelStay();
    if (!stay) {
        body.innerHTML = `<p class="gastos-empty">Sem dados de hotel no roteiro.</p>`;
        return;
    }

    const rows = stay.nights.map(n => {
        const price = n.total != null ? formatMoneyUSDExact(n.total) : '—';
        const room = n.nightly != null ? formatMoneyUSD(n.nightly) : '—';
        return `<li class="gastos-night">
            <span class="gastos-night-date">${formatDateBR(n.date)}</span>
            <span class="gastos-night-dow">${(n.dow || '').slice(0, 3)}</span>
            <span class="gastos-night-room">${room}</span>
            <strong class="gastos-night-total">${price}</strong>
        </li>`;
    }).join('');

    const hotelShort = (stay.name || 'Helios').replace(', a Loews Hotel', '');

    body.innerHTML = `
        <p class="gastos-intro">Estimativa com base nas noites do roteiro e nas diárias Flexible Rate do Helios.</p>

        <section class="gastos-card">
            <div class="gastos-card-top">
                <div>
                    <p class="gastos-eyebrow">Hotel</p>
                    <h3>${hotelShort}</h3>
                    <p class="gastos-meta">${formatDateBR(stay.checkin)} → ${formatDateBR(stay.checkout)} · ${stay.nightsCount} noites</p>
                </div>
                <div class="gastos-hero-total">
                    <span>Total</span>
                    <strong>${formatMoneyUSDExact(stay.total)}</strong>
                </div>
            </div>

            <dl class="gastos-stats">
                <div>
                    <dt>Diárias</dt>
                    <dd>${formatMoneyUSDExact(stay.roomTotal)}</dd>
                </div>
                <div>
                    <dt>Impostos</dt>
                    <dd>${stay.taxesTotal != null ? formatMoneyUSDExact(stay.taxesTotal) : '—'}</dd>
                </div>
                <div>
                    <dt>Média / noite</dt>
                    <dd>${stay.avg != null ? formatMoneyUSD(stay.avg) : '—'}</dd>
                </div>
            </dl>

            <details class="gastos-breakdown">
                <summary>Diária por noite</summary>
                <ul class="gastos-nights">${rows}</ul>
                <p class="gastos-note">${stay.rateNote}${stay.fromCsv ? '' : ' · valores do roteiro'}</p>
            </details>

            <button type="button" class="gastos-link-btn" onclick="closeGastosModal(); openHeliosModal();">
                Ver calendário de diárias
            </button>
        </section>
    `;
}

function renderRoteiro() {
    const body = document.getElementById('roteiro-body');
    if (!body) return;
    if (!roteiroData) {
        body.innerHTML = '<p class="roteiro-loading">Não foi possível carregar o roteiro.</p>';
        return;
    }

    const days = roteiroData.days;
    const chips = days.map((d, i) => {
        const active = i === roteiroDayIndex ? 'active' : '';
        const done = dayProgress(d);
        const pct = done.total ? Math.round(100 * done.done / done.total) : 0;
        return `<button type="button" class="roteiro-chip ${active}" onclick="selectRoteiroDay(${i})">
            <span class="roteiro-chip-short">${d.short || d.dow.slice(0, 3)}</span>
            <span class="roteiro-chip-date">${formatDateBR(d.date)}</span>
            <span class="roteiro-chip-bar"><i style="width:${pct}%"></i></span>
        </button>`;
    }).join('');

    body.innerHTML = `
        <div class="roteiro-companion-top">
            <div class="roteiro-chip-row" id="roteiro-chip-row">${chips}</div>
        </div>
        <div id="roteiro-day-detail"></div>
    `;
    renderRoteiroDayDetail();
    renderRoteiroNextBar();
}

function dayProgress(day) {
    const map = loadChecklist();
    const items = [...(day.order || []), ...(day.afterMain || [])];
    // unique by id
    const seen = new Set();
    const uniq = [];
    items.forEach(a => {
        if (!a?.id || seen.has(a.id)) return;
        seen.add(a.id);
        uniq.push(a);
    });
    const done = uniq.filter(a => map[checkKey(day.date, a.id)]).length;
    return { done, total: uniq.length, items: uniq };
}

function renderRoteiroDayDetail() {
    const host = document.getElementById('roteiro-day-detail');
    if (!host || !roteiroData) return;
    const d = roteiroData.days[roteiroDayIndex];
    const p = d.parkInfo || {};
    const map = loadChecklist();
    const prog = dayProgress(d);
    const color = p.color || '#fbbf24';

    const hours = (p.opens && p.closes)
        ? `<div class="roteiro-hours">
            <div class="roteiro-hour-block"><span>Abre</span><strong>${p.opens}</strong></div>
            <div class="roteiro-hour-sep">→</div>
            <div class="roteiro-hour-block"><span>Fecha</span><strong>${p.closes}</strong></div>
           </div>
           <p class="roteiro-hours-note">Horário: ${p.hoursSource || 'confirmar no app'}</p>`
        : '';

    const address = p.address
        ? `<a class="roteiro-address" href="${p.mapsUrl || '#'}" target="_blank" rel="noopener">
            <span>${p.address}</span>
            <span class="roteiro-maps-cta">Mapa</span>
           </a>`
        : '';

    const orderList = (d.order || []).map((a, i) => {
        const checked = map[checkKey(d.date, a.id)] ? 'checked' : '';
        const first = a.first ? 'first' : '';
        return `<button type="button" class="roteiro-attr ${checked} ${first}" onclick="toggleRoteiroAttr('${d.date}','${a.id}')">
            <span class="roteiro-attr-num">${i + 1}</span>
            <span class="roteiro-attr-body">
                <strong>${a.name}</strong>
                ${a.land ? `<em>${a.land}</em>` : ''}
                ${a.tip ? `<small>${a.tip}</small>` : ''}
            </span>
            <span class="roteiro-attr-check">${checked ? '✓' : ''}</span>
        </button>`;
    }).join('');

    // afterMain = extras after finishing order (never duplicates of principais)
    const orderIds = new Set((d.order || []).map(a => a.id));
    const afterMain = (d.afterMain || []).filter(a => a?.id && !orderIds.has(a.id));
    const afterDone = afterMain.filter(a => map[checkKey(d.date, a.id)]).length;
    const afterList = afterMain.map(a => {
        const checked = map[checkKey(d.date, a.id)] ? 'checked' : '';
        return `<label class="roteiro-check-item ${checked}">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleRoteiroAttr('${d.date}','${a.id}')" />
            <span>
                <strong>${a.name}</strong>${a.land ? ` · ${a.land}` : ''}
                ${a.tip ? `<small class="roteiro-after-tip">${a.tip}</small>` : ''}
            </span>
        </label>`;
    }).join('');

    const meals = d.meals || {};
    const mealCard = (key, label) => {
        const m = meals[key];
        if (!m) return '';
        return `<div class="roteiro-meal">
            <div class="roteiro-meal-top"><span>${label}</span><strong>${m.when || ''}</strong></div>
            <div class="roteiro-meal-where">${m.where || ''}</div>
            <div class="roteiro-meal-what">${m.what || ''}</div>
        </div>`;
    };

    const tips = (d.tips || []).map(t => `<li>${t}</li>`).join('');

    host.innerHTML = `
        <section class="roteiro-day-panel" style="--park:${color}">
            <div class="roteiro-day-hero">
                <div class="roteiro-day-hero-text">
                    <span class="roteiro-day-when">${d.dow} · ${formatDateBR(d.date)}</span>
                    <h3>${d.title}</h3>
                    <p>${d.strategy || ''}</p>
                </div>
                <div class="roteiro-progress" aria-label="Progresso">
                    <strong>${prog.done}/${prog.total || 0}</strong>
                    <span>feitos</span>
                </div>
            </div>
            ${hours}
            ${address}
            <div class="roteiro-section">
                <div class="roteiro-section-head">
                    <h4>Ordem do dia</h4>
                    <button type="button" class="roteiro-linkish" onclick="resetRoteiroDayChecks('${d.date}')">Reset</button>
                </div>
                <div class="roteiro-order">${orderList || '<p class="roteiro-empty">Sem ordem definida</p>'}</div>
            </div>
            <div class="roteiro-section">
                <div class="roteiro-section-head">
                    <h4>Depois das principais</h4>
                    <span class="roteiro-section-progress">${afterDone}/${afterMain.length}</span>
                </div>
                <div class="roteiro-checklist">${afterList || '<p class="roteiro-empty">Sem extras para este dia.</p>'}</div>
            </div>
            <div class="roteiro-section">
                <h4>Comer</h4>
                <div class="roteiro-meals">
                    ${mealCard('lunch', 'Almoço')}
                    ${mealCard('snack', 'Lanche')}
                    ${mealCard('dinner', 'Jantar')}
                </div>
            </div>
            ${tips ? `<div class="roteiro-section"><h4>Dicas</h4><ul class="roteiro-tips">${tips}</ul></div>` : ''}
        </section>
    `;
}

function renderRoteiroNextBar() {
    const bar = document.getElementById('roteiro-next-bar');
    if (!bar || !roteiroData) return;
    const d = roteiroData.days[roteiroDayIndex];
    const map = loadChecklist();
    const nextMain = (d.order || []).find(a => a?.id && !map[checkKey(d.date, a.id)]);
    if (nextMain) {
        bar.style.display = 'flex';
        bar.innerHTML = `<span class="roteiro-next-label">Próxima</span><strong>${nextMain.name}</strong>${nextMain.land ? `<em>${nextMain.land}</em>` : ''}`;
        return;
    }
    const orderIds = new Set((d.order || []).map(a => a.id));
    const nextAfter = (d.afterMain || []).find(a => a?.id && !orderIds.has(a.id) && !map[checkKey(d.date, a.id)]);
    if (nextAfter) {
        bar.style.display = 'flex';
        bar.innerHTML = `<span class="roteiro-next-label">Depois</span><strong>${nextAfter.name}</strong>${nextAfter.land ? `<em>${nextAfter.land}</em>` : ''}`;
        return;
    }
    bar.style.display = 'flex';
    bar.innerHTML = `<span>Dia completo — principais e extras feitos.</span>`;
}

// Global start
window.initApp();
