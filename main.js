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
    const tink = document.getElementById('tinkerbell-header');
    if (!tink) return;

    tink.style.cursor = 'pointer'; // Hint it's interactive
    tink.addEventListener('click', () => {
        tinkClicks++;
        clearTimeout(tinkTimer);

        if (tinkClicks === 3) {
            const password = prompt("Enter Magic Password ✨");
            if (password === '1004') {
                alert("Access Granted! Magic Unlocked. 🏰");
                isMagicMode = true;
                localStorage.setItem('disney_admin_mode', 'true'); // Persist admin status

                // Toggle UI state for CSS override
                document.body.classList.add('admin-active');

                // Show Indicator
                const indicator = document.getElementById('admin-indicator');
                if (indicator) indicator.style.display = 'block';

                showBreakdown(currentActivePerson); // Refresh to show admin toggles
            } else {
                alert("Incorrect Password. Try again if you have the magic! ✨");
            }
            tinkClicks = 0;
        }

        tinkTimer = setTimeout(() => {
            tinkClicks = 0;
        }, 2000);
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

window.closeRoteiroModal = function () {
    const modal = document.getElementById('roteiro-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll');
    }
};

window.openAirbnbModal = function () {
    const modal = document.getElementById('airbnb-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.classList.add('no-scroll');
    }
};

window.closeAirbnbModal = function () {
    const modal = document.getElementById('airbnb-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('no-scroll');
    }
};

window.openLightbox = function (src) {
    const modal = document.getElementById('lightbox-modal');
    const img = document.getElementById('lightbox-img');
    if (modal && img) {
        img.src = src;
        modal.style.display = 'flex';
        document.body.classList.add('no-scroll');
    }
};

window.closeLightbox = function () {
    const modal = document.getElementById('lightbox-modal');
    if (modal) {
        modal.style.display = 'none';
        // Only remove no-scroll if no other modal is open
        const airbnb = document.getElementById('airbnb-modal');
        const crowds = document.getElementById('crowds-modal');
        const helios = document.getElementById('helios-modal');
        const roteiro = document.getElementById('roteiro-modal');
        const anyOpen = [airbnb, crowds, helios, roteiro].some(el => el && el.style.display === 'flex');
        if (!anyOpen) {
            document.body.classList.remove('no-scroll');
        }
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
const flightTime = new Date('January 11, 2026 10:11:00').getTime();

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
        if (el) el.innerHTML = "<h3>It's Disney Time! ✨✈️✨</h3>";
    }
}

const countdownTimer = setInterval(updateCountdown, 1000);
updateCountdown();

// Pixie Dust Animation
const canvas = document.getElementById('pixie-dust');
if (canvas) {
    const ctx = canvas.getContext('2d');
    let particles = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    window.addEventListener('resize', resize);
    resize();

    class Particle {
        constructor() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2 + 0.5;
            this.speedX = Math.random() * 0.5 - 0.25;
            this.speedY = Math.random() * 0.5 - 0.25;
            this.opacity = Math.random();
            this.opacityChange = Math.random() * 0.02 + 0.01;
        }

        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            this.opacity += this.opacityChange;
            if (this.opacity > 1 || this.opacity < 0) this.opacityChange *= -1;

            if (this.x > canvas.width) this.x = 0;
            if (this.x < 0) this.x = canvas.width;
            if (this.y > canvas.height) this.y = 0;
            if (this.y < 0) this.y = canvas.height;
        }

        draw() {
            ctx.fillStyle = `rgba(251, 191, 36, ${Math.max(0, this.opacity * 0.6)})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function init() {
        for (let i = 0; i < 80; i++) {
            particles.push(new Particle());
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.update();
            p.draw();
        });
        requestAnimationFrame(animate);
    }

    init();
    animate();
}

// --- PARK CROWD CALENDAR ---
const CROWD_PARKS = [
    { slug: 'magic-kingdom', name: 'Magic Kingdom', short: 'MK' },
    { slug: 'epcot', name: 'EPCOT', short: 'EPCOT' },
    { slug: 'hollywood-studios', name: "Hollywood Studios", short: 'DHS' },
    { slug: 'animal-kingdom', name: 'Animal Kingdom', short: 'AK' },
    { slug: 'epic-universe', name: 'Epic Universe', short: 'Epic' },
    { slug: 'islands-of-adventure', name: 'Islands of Adventure', short: 'IoA' }
];

const CROWD_LEVEL_ORDER = { Light: 1, Moderate: 2, Busy: 3, Packed: 4 };
const CROWD_LEVEL_FROM_SCORE = (score) => {
    if (score <= 2.4) return 'Light';
    if (score <= 3.3) return 'Moderate';
    if (score <= 4.2) return 'Busy';
    return 'Packed';
};

let crowdState = {
    parkSlug: 'magic-kingdom',
    year: new Date().getFullYear(),
    month: new Date().getMonth(), // 0-indexed
    observed: {}, // slug -> { 'YYYY-MM-DD': { level, avgWait, samples } }
    loaded: false
};

const PARK_WEEKDAY_BIAS = {
    'magic-kingdom': [2.6, 2.2, 2.4, 2.5, 2.8, 3.6, 3.8],
    'epcot': [2.8, 2.5, 2.6, 2.7, 2.9, 3.4, 3.5],
    'hollywood-studios': [3.2, 3.0, 3.1, 3.2, 3.4, 3.8, 3.9],
    'animal-kingdom': [2.4, 2.1, 2.2, 2.3, 2.5, 3.1, 3.2],
    'epic-universe': [3.8, 3.6, 3.7, 3.7, 3.9, 4.3, 4.4],
    'islands-of-adventure': [2.9, 2.6, 2.7, 2.8, 3.0, 3.5, 3.6]
};

function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function parseCrowdCsv(text) {
    const map = {};
    const lines = text.trim().split(/\r?\n/).slice(1);
    for (const line of lines) {
        if (!line.trim()) continue;
        const [date, level, avg, samples] = line.split(',');
        if (!date || !level) continue;
        map[date] = {
            level: level.trim(),
            avgWait: avg ? Number(avg) : null,
            samples: samples ? Number(samples) : null,
            source: 'observed'
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
    const wait = info.avgWait != null ? ` · avg wait ~${Math.round(info.avgWait)} min` : '';
    const src = info.source === 'observed' ? 'Observed' : 'Estimate';
    detail.innerHTML = `<strong>${dateStr}</strong> · ${park.name}<br>${info.level}${wait} <span class="crowd-source">(${src})</span>`;
};

function renderCrowdCalendar() {
    const cal = document.getElementById('crowd-calendar');
    const label = document.getElementById('crowd-month-label');
    if (!cal || !label) return;

    const y = crowdState.year;
    const m = crowdState.month;
    const monthName = new Date(y, m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    label.textContent = monthName;

    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayStr = isoDate(new Date());

    let html = `<div class="crowd-dow">${['S','M','T','W','T','F','S'].map(d => `<span>${d}</span>`).join('')}</div><div class="crowd-grid">`;

    for (let i = 0; i < firstDow; i++) {
        html += `<div class="crowd-cell empty"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const info = getCrowdForDay(crowdState.parkSlug, dateStr);
        const levelClass = info.level.toLowerCase();
        const isToday = dateStr === todayStr ? ' today' : '';
        const estimated = info.source === 'estimate' ? ' estimated' : '';
        html += `<button type="button" class="crowd-cell ${levelClass}${isToday}${estimated}" onclick="selectCrowdDay('${dateStr}')" title="${info.level}">
            <span class="crowd-day-num">${day}</span>
            <span class="crowd-level-dot"></span>
        </button>`;
    }

    html += '</div>';
    cal.innerHTML = html;
}

// --- HELIOS HOTEL RATES (scraped Flexible Rate) ---
let heliosRows = [];
let heliosMonthFilter = 'all';
let heliosLoaded = false;

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
        heliosLoaded = true;
    } catch (e) {
        console.error('Helios rates load failed', e);
        heliosRows = [];
    }
}

window.filterHeliosMonth = function (monthKey) {
    heliosMonthFilter = monthKey;
    const labels = {
        all: 'All',
        '2026-08': 'Aug',
        '2026-09': 'Sep',
        '2026-10': 'Oct',
        '2026-11': 'Nov',
        '2026-12': 'Dec'
    };
    document.querySelectorAll('#helios-month-chips .park-chip').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim() === labels[monthKey]);
    });
    renderHeliosRates();
};

function renderHeliosRates() {
    const tbody = document.getElementById('helios-tbody');
    const summary = document.getElementById('helios-summary');
    if (!tbody || !summary) return;

    const rows = heliosRows.filter(r =>
        heliosMonthFilter === 'all' || r.date.startsWith(heliosMonthFilter)
    );

    if (!rows.length) {
        summary.textContent = 'No rate data loaded.';
        tbody.innerHTML = '';
        return;
    }

    const priced = rows.filter(r => !Number.isNaN(r.nightly_rate) && r.nightly_rate > 0);
    if (!priced.length) {
        summary.innerHTML = `<div class="helios-stat"><span class="label">Days</span><span class="value">${rows.length}</span></div>`;
        tbody.innerHTML = rows.map(r => `<tr>
            <td>${r.date}</td>
            <td>${(r.dow || '').slice(0, 3)}</td>
            <td colspan="3">${r.status || 'unavailable'}</td>
        </tr>`).join('');
        return;
    }

    const rates = priced.map(r => r.nightly_rate);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;

    summary.innerHTML = `
        <div class="helios-stat"><span class="label">Cheapest</span><span class="value">$${min.toFixed(0)}</span></div>
        <div class="helios-stat"><span class="label">Average</span><span class="value">$${avg.toFixed(0)}</span></div>
        <div class="helios-stat"><span class="label">Highest</span><span class="value">$${max.toFixed(0)}</span></div>
    `;

    const lowCut = min + (max - min) * 0.25;
    const highCut = min + (max - min) * 0.75;

    tbody.innerHTML = rows.map(r => {
        const hasPrice = !Number.isNaN(r.nightly_rate) && r.nightly_rate > 0;
        const weekend = r.dow === 'Friday' || r.dow === 'Saturday' || r.dow === 'Sunday';
        if (!hasPrice) {
            return `<tr class="${weekend ? 'weekend' : ''}">
                <td>${r.date}</td>
                <td>${(r.dow || '').slice(0, 3)}</td>
                <td colspan="3" style="color:var(--text-dim)">Unavailable</td>
            </tr>`;
        }
        const tier = r.nightly_rate <= lowCut ? 'cheap' : (r.nightly_rate >= highCut ? 'pricey' : '');
        const mark = r.nightly_rate === min ? ' ★' : '';
        return `<tr class="${tier} ${weekend ? 'weekend' : ''}">
            <td>${r.date}</td>
            <td>${r.dow.slice(0, 3)}</td>
            <td>$${r.nightly_rate.toFixed(0)}${mark}</td>
            <td>$${(r.taxes || 0).toFixed(0)}</td>
            <td>$${(r.total || 0).toFixed(0)}</td>
        </tr>`;
    }).join('');
}

// --- ROTEIRO NOV/DEZ (cheapest Helios window) ---
let roteiroData = null;

async function ensureRoteiroData() {
    if (roteiroData) return;
    try {
        const res = await fetch('data/roteiro-nov-dez-2026.json');
        if (!res.ok) throw new Error('roteiro missing');
        roteiroData = await res.json();
    } catch (e) {
        console.error('Roteiro load failed', e);
        roteiroData = null;
    }
}

function renderRoteiro() {
    const body = document.getElementById('roteiro-body');
    if (!body) return;
    if (!roteiroData) {
        body.innerHTML = '<p class="roteiro-loading">Could not load itinerary.</p>';
        return;
    }

    const r = roteiroData;
    const h = r.hotel;
    const t = r.tickets;

    const ticketBlock = (key, label) => {
        const x = t[key];
        const note = x.note ? `<br><em style="color:var(--text-dim)">${x.note}</em>` : '';
        return `<div class="roteiro-ticket-item">
            <strong>${label}</strong> — ${x.product}<br>
            Uso: ${x.first_use} → ${x.last_use} (${x.span_days} dias / máx ${x.window_days})
            <span class="roteiro-pill-ok">${x.ok ? '✓ OK' : '✗ Fora'}</span>${note}
        </div>`;
    };

    const dayHtml = r.days.map(d => {
        const rate = d.hotel_rate != null ? `$${d.hotel_rate}` : 'Checkout';
        let sections = '';
        if (d.blocks?.length) {
            sections += `<span class="roteiro-label">Plano</span><ul>${d.blocks.map(i => `<li>${i}</li>`).join('')}</ul>`;
        }
        if (d.priorities?.length) {
            sections += `<span class="roteiro-label">Prioridades</span><ul>${d.priorities.map(i => `<li>${i}</li>`).join('')}</ul>`;
        }
        if (d.extras?.length) {
            sections += `<span class="roteiro-label">Extras</span><ul>${d.extras.map(i => `<li>${i}</li>`).join('')}</ul>`;
        }
        if (d.dining?.length) {
            sections += `<span class="roteiro-label">Dining</span><ul>${d.dining.map(i => `<li>${i}</li>`).join('')}</ul>`;
        }
        if (d.sweets?.length) {
            sections += `<span class="roteiro-label">Doces</span><ul>${d.sweets.map(i => `<li>${i}</li>`).join('')}</ul>`;
        }
        const note = d.notes ? `<p class="roteiro-note">${d.notes}</p>` : '';
        return `<article class="roteiro-day">
            <div class="roteiro-day-header">
                <span class="roteiro-day-date">${d.dow} · ${d.date}</span>
                <span class="roteiro-day-rate">${rate}</span>
            </div>
            <h4>${d.title}</h4>
            ${sections}
            ${note}
        </article>`;
    }).join('');

    body.innerHTML = `
        <div class="roteiro-hero">
            <h3>${r.title}</h3>
            <p class="roteiro-meta">
                🏨 ${h.name}<br>
                📅 ${h.checkin} → ${h.checkout} · ${h.nights} noites<br>
                ✈️ ${r.flights.outbound}<br>
                ✈️ ${r.flights.return}<br>
                ${r.flights.vacation_days}
            </p>
            <div class="roteiro-stat-row">
                <div class="helios-stat"><span class="label">Hospedagem</span><span class="value">$${h.nightly_total.toLocaleString('en-US')}</span></div>
                <div class="helios-stat"><span class="label">Média/noite</span><span class="value">$${h.nightly_avg}</span></div>
                <div class="helios-stat"><span class="label">Noites</span><span class="value">${h.nights}</span></div>
            </div>
            <p class="roteiro-meta">${h.note}</p>
        </div>
        <div class="roteiro-tickets">
            <h4>🎟️ Ingressos (janelas)</h4>
            ${ticketBlock('universal', 'Universal')}
            ${ticketBlock('disney', 'Disney')}
            ${ticketBlock('seaworld_busch', 'SeaWorld + Busch')}
        </div>
        ${dayHtml}
    `;
}

// Global start
window.initApp();
