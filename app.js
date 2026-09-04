// ===== FIREBASE CONFIG =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, orderBy, query, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDA0fPx7lwIz4rL-24KAsYYO7wPWiF9njA",
  authDomain: "com-urbanbites-app.firebaseapp.com",
  projectId: "com-urbanbites-app",
  storageBucket: "com-urbanbites-app.firebasestorage.app",
  messagingSenderId: "390893606557",
  appId: "1:390893606557:web:2528654191efc0ead32674",
  measurementId: "G-EP9SH21K4N"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ===== STATE =====
let currentPage = 'dashboard';
let allOrders = [];
let allMenuItems = [];
let allUsers = [];
let editingItemId = null;
let deletingItemId = null;
let unsubOrders = null;
let unsubMenu = null;

// ===== UTILS =====
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fmt = (paise) => '₹' + (paise / 100).toFixed(2);
const fmtDate = (ts) => ts?.toDate ? ts.toDate().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const statusColors = {
  PLACED: '#1d4ed8', CONFIRMED: '#4338ca', PREPARING: '#b45309',
  OUT_FOR_DELIVERY: '#047857', DELIVERED: '#166534', CANCELLED: '#b91c1c'
};
const statusNext = {
  PLACED:'CONFIRMED', CONFIRMED:'PREPARING', PREPARING:'OUT_FOR_DELIVERY', OUT_FOR_DELIVERY:'DELIVERED'
};
const statusLabel = {
  PLACED:'Order Placed', CONFIRMED:'Confirmed', PREPARING:'Preparing',
  OUT_FOR_DELIVERY:'Out for Delivery', DELIVERED:'Delivered', CANCELLED:'Cancelled'
};

function statusBadge(s) {
  return `<span class="status-badge status-${escapeHtml(s)}">${escapeHtml(statusLabel[s] || s)}</span>`;
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

// ===== AUTH =====
document.getElementById('login-btn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const pass  = document.getElementById('password').value;
  const errEl = document.getElementById('login-error');
  const lbl   = document.getElementById('login-label');
  const spin  = document.getElementById('login-spinner');
  errEl.classList.add('hidden');
  lbl.style.display = 'none'; spin.classList.remove('hidden');
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
    if (userDoc.exists() && userDoc.data().role !== 'admin') {
      await signOut(auth);
      throw new Error('Access denied. Admin accounts only.');
    }
  } catch(e) {
    errEl.textContent = e.message.replace('Firebase: ', '').replace(/\(auth.*\)/, '').trim();
    errEl.classList.remove('hidden');
  } finally {
    lbl.style.display = ''; spin.classList.add('hidden');
  }
});
document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-btn').click(); });

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    const data = userDoc.exists() ? userDoc.data() : {};
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('admin-name').textContent = data.name || user.displayName || 'Admin';
    document.getElementById('admin-email').textContent = user.email || '';
    document.getElementById('admin-avatar').textContent = (data.name || 'A')[0].toUpperCase();
    const dateEl = document.getElementById('header-date');
    dateEl.textContent = new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    initListeners();
    loadPage('dashboard');
  } else {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    if (unsubOrders) unsubOrders();
    if (unsubMenu) unsubMenu();
  }
});

// ===== NAVIGATION & EVENT HANDLING =====
let listenersInitialized = false;

function initListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      loadPage(item.dataset.page);
    });
  });
  document.querySelectorAll('.btn-link[data-page]').forEach(btn => {
    btn.addEventListener('click', () => loadPage(btn.dataset.page));
  });
  document.getElementById('order-status-filter')?.addEventListener('change', renderOrders);
  document.getElementById('menu-search')?.addEventListener('input', filterMenu);
  document.getElementById('menu-category-filter')?.addEventListener('change', filterMenu);
  document.getElementById('add-item-btn')?.addEventListener('click', () => openMenuModal());

  // modal close buttons
  document.getElementById('order-backdrop')?.addEventListener('click', closeOrderModal);
  document.getElementById('close-order-modal')?.addEventListener('click', closeOrderModal);
  document.getElementById('close-order-btn')?.addEventListener('click', closeOrderModal);
  document.getElementById('menu-backdrop')?.addEventListener('click', closeMenuModal);
  document.getElementById('close-menu-modal')?.addEventListener('click', closeMenuModal);
  document.getElementById('cancel-menu-btn')?.addEventListener('click', closeMenuModal);
  document.getElementById('delete-backdrop')?.addEventListener('click', closeDeleteModal);
  document.getElementById('close-delete-modal')?.addEventListener('click', closeDeleteModal);
  document.getElementById('cancel-delete-btn')?.addEventListener('click', closeDeleteModal);
  document.getElementById('confirm-delete-btn')?.addEventListener('click', confirmDelete);
  document.getElementById('menu-form')?.addEventListener('submit', saveMenuItem);

  // Global event delegation for all [data-action] buttons
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    if (!action) return;

    if (action === 'view-order') {
      const orderId = button.dataset.orderId;
      if (orderId) viewOrder(orderId);
      return;
    }

    if (action === 'advance-order') {
      const orderId = button.dataset.orderId;
      if (!orderId || button.disabled) return;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Updating…';
      try {
        await advanceOrder(orderId, button.dataset.currentStatus);
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
      return;
    }

    if (action === 'cancel-order') {
      const orderId = button.dataset.orderId;
      if (!orderId || button.disabled) return;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Cancelling…';
      try {
        await cancelOrder(orderId);
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
      return;
    }

    if (action === 'modal-advance') {
      const orderId = button.dataset.orderId;
      if (!orderId || button.disabled) return;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Updating…';
      try {
        await advanceOrder(orderId, button.dataset.currentStatus);
        closeOrderModal();
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
      return;
    }

    if (action === 'modal-cancel') {
      const orderId = button.dataset.orderId;
      if (!orderId || button.disabled) return;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Cancelling…';
      try {
        await cancelOrder(orderId);
        closeOrderModal();
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
      return;
    }

    if (action === 'toggle-availability') {
      const id = button.dataset.id;
      if (!id || button.dataset.busy === 'true') return;
      button.dataset.busy = 'true';
      try {
        await toggleAvailable(id, button.dataset.current === 'true');
      } finally {
        button.dataset.busy = 'false';
      }
      return;
    }

    if (action === 'edit-item') {
      const id = button.dataset.id;
      if (id) editItem(id);
      return;
    }

    if (action === 'delete-item') {
      const id = button.dataset.id;
      if (id) openDeleteModal(id, button.dataset.name || '');
      return;
    }

    if (action === 'set-admin') {
      const userId = button.dataset.userId;
      if (!userId || button.disabled) return;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Updating…';
      try {
        await setAdmin(userId, button.dataset.makeAdmin === 'true');
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
      return;
    }
  });
}

function loadPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'orders') loadOrders();
  if (page === 'menu') loadMenu();
  if (page === 'users') loadUsers();
}

// ===== DASHBOARD =====
function loadDashboard() {
  subscribeOrders();
  subscribeMenu();
}

function subscribeOrders() {
  if (unsubOrders) return;
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  unsubOrders = onSnapshot(q, snap => {
    allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateOrderStats();
    renderRecentOrders();
    renderStatusChart();
    if (currentPage === 'orders') renderOrders();
    // update badge
    const active = allOrders.filter(o => !['DELIVERED','CANCELLED'].includes(o.orderStatus)).length;
    const badge = document.getElementById('active-badge');
    badge.textContent = active;
    if (active > 0) badge.classList.remove('hidden'); else badge.classList.add('hidden');
  });
}

function subscribeMenu() {
  if (unsubMenu) return;
  const q = query(collection(db, 'menuItems'));
  unsubMenu = onSnapshot(q, snap => {
    allMenuItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateMenuStats();
    if (currentPage === 'menu') renderMenu();
    populateCategoryFilter();
  });
}

function updateOrderStats() {
  const total = allOrders.reduce((s, o) => s + (o.total || 0), 0);
  const active = allOrders.filter(o => !['DELIVERED','CANCELLED'].includes(o.orderStatus)).length;
  document.getElementById('kpi-revenue').textContent = fmt(total);
  document.getElementById('kpi-orders').textContent = allOrders.length;
  document.getElementById('kpi-active').textContent = active;
}

function updateMenuStats() {
  const avail = allMenuItems.filter(m => m.isAvailable).length;
  document.getElementById('kpi-menu').textContent = avail;
}

function renderRecentOrders() {
  const tbody = document.getElementById('recent-orders-body');
  const recent = allOrders.slice(0, 8);
  if (!recent.length) { tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No orders yet</td></tr>'; return; }
  tbody.innerHTML = recent.map(o => `
    <tr>
      <td><code style="font-size:0.8rem">#${escapeHtml((o.id || '').slice(0,8).toUpperCase())}</code></td>
      <td>${escapeHtml(o.userName || '—')}</td>
      <td>${fmt(o.total || 0)}</td>
      <td>${statusBadge(o.orderStatus)}</td>
    </tr>`).join('');
}

function renderStatusChart() {
  const counts = {};
  Object.keys(statusLabel).forEach(k => counts[k] = 0);
  allOrders.forEach(o => { if (counts[o.orderStatus] !== undefined) counts[o.orderStatus]++; });
  const total = allOrders.length || 1;
  const chart = document.getElementById('status-chart');
  chart.innerHTML = Object.entries(counts).map(([k, v]) => `
    <div class="status-bar-item">
      <div class="status-bar-label"><span>${escapeHtml(statusLabel[k])}</span><span>${v}</span></div>
      <div class="status-bar-track">
        <div class="status-bar-fill" style="width:${(v/total*100).toFixed(1)}%;background:${statusColors[k]}"></div>
      </div>
    </div>`).join('');
}

// ===== ORDERS PAGE =====
function loadOrders() { subscribeOrders(); renderOrders(); }

function renderOrders() {
  const filter = document.getElementById('order-status-filter')?.value || '';
  const filtered = filter ? allOrders.filter(o => (o.orderStatus || '').toUpperCase() === filter.toUpperCase()) : allOrders;
  const tbody = document.getElementById('orders-body');
  if (!tbody) return;
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No orders found</td></tr>'; return; }
  tbody.innerHTML = filtered.map(o => {
    const rawStatus = (o.orderStatus || '').toUpperCase();
    const canAdvance = statusNext[rawStatus] || statusNext[o.orderStatus];
    return `<tr>
      <td><code style="font-size:0.8rem">#${escapeHtml((o.id||'').slice(0,8).toUpperCase())}</code></td>
      <td><div style="font-weight:600">${escapeHtml(o.userName||'—')}</div><div style="font-size:0.78rem;color:#888">${escapeHtml(o.userPhone||'')}</div></td>
      <td>${(o.items||[]).length} item${(o.items||[]).length !== 1 ? 's' : ''}</td>
      <td style="font-weight:700">${fmt(o.total||0)}</td>
      <td><span style="font-size:0.8rem">${escapeHtml((o.paymentMethod||'').replace('_',' '))}</span></td>
      <td>${statusBadge(rawStatus || o.orderStatus)}</td>
      <td style="font-size:0.8rem;color:#888">${fmtDate(o.createdAt)}</td>
      <td><div class="actions-cell">
        <button type="button" class="action-btn action-view" data-action="view-order" data-order-id="${escapeHtml(o.id)}">View</button>
        ${canAdvance ? `<button type="button" class="action-btn action-advance" data-action="advance-order" data-order-id="${escapeHtml(o.id)}" data-current-status="${escapeHtml(rawStatus || o.orderStatus)}">→ ${escapeHtml(statusLabel[canAdvance] || canAdvance)}</button>` : ''}
        ${rawStatus !== 'CANCELLED' && rawStatus !== 'DELIVERED' ? `<button type="button" class="action-btn action-delete" data-action="cancel-order" data-order-id="${escapeHtml(o.id)}">Cancel</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');
}

function viewOrder(id) {
  const o = allOrders.find(x => String(x.id) === String(id));
  if (!o) return;
  document.getElementById('modal-order-title').textContent = `Order #${id.slice(0,8).toUpperCase()}`;
  const itemsHtml = (o.items || []).map(i => `
    <tr>
      <td>${escapeHtml(i.name || '')}</td>
      <td style="text-align:center">${escapeHtml(i.quantity != null ? i.quantity : 1)}</td>
      <td style="text-align:right">${fmt(i.subtotal||0)}</td>
    </tr>`).join('');
  document.getElementById('modal-order-content').innerHTML = `
    <div class="order-detail-body">
      <div class="order-meta-grid">
        <div class="order-meta-item"><label>Customer</label><span>${escapeHtml(o.userName||'—')}</span></div>
        <div class="order-meta-item"><label>Phone</label><span>${escapeHtml(o.userPhone||'—')}</span></div>
        <div class="order-meta-item"><label>Status</label><span>${statusBadge((o.orderStatus||'').toUpperCase() || o.orderStatus)}</span></div>
        <div class="order-meta-item"><label>Payment</label><span>${escapeHtml((o.paymentMethod||'').replace('_',' '))} — ${escapeHtml(o.paymentStatus||'')}</span></div>
        <div class="order-meta-item"><label>Address</label><span>${escapeHtml(o.deliveryAddress||'—')}</span></div>
        <div class="order-meta-item"><label>Ordered</label><span>${fmtDate(o.createdAt)}</span></div>
      </div>
      <table class="order-items-table">
        <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Subtotal</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="margin-top:1rem;display:flex;flex-direction:column;gap:0.25rem;font-size:0.875rem">
        <div style="display:flex;justify-content:space-between"><span style="color:#888">Subtotal</span><span>${fmt(o.subtotal||0)}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:#888">Delivery Fee</span><span>${fmt(o.deliveryFee||0)}</span></div>
        ${o.discount ? `<div style="display:flex;justify-content:space-between"><span style="color:#888">Discount</span><span>-${fmt(o.discount)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1rem;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #f0f1f2"><span>Total</span><span>${fmt(o.total||0)}</span></div>
      </div>
    </div>`;
  const actions = document.getElementById('modal-status-actions');
  const rawStatus = (o.orderStatus || '').toUpperCase();
  const canAdv = statusNext[rawStatus] || statusNext[o.orderStatus];
  actions.innerHTML = `
    ${canAdv ? `<button type="button" class="btn-primary" data-action="modal-advance" data-order-id="${escapeHtml(o.id)}" data-current-status="${escapeHtml(rawStatus || o.orderStatus)}">→ Mark as ${escapeHtml(statusLabel[canAdv] || canAdv)}</button>` : ''}
    ${rawStatus !== 'CANCELLED' && rawStatus !== 'DELIVERED' ? `<button type="button" class="btn-danger" data-action="modal-cancel" data-order-id="${escapeHtml(o.id)}">Cancel Order</button>` : ''}`;
  document.getElementById('order-modal').classList.remove('hidden');
}

function closeOrderModal() { document.getElementById('order-modal').classList.add('hidden'); }

async function advanceOrder(id, currentStatus) {
  const norm = (currentStatus || '').toUpperCase();
  const next = statusNext[norm] || statusNext[currentStatus];
  if (!next) return;
  try {
    await updateDoc(doc(db, 'orders', id), { orderStatus: next, updatedAt: serverTimestamp() });
    showToast(`Order moved to ${statusLabel[next] || next}`, 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

async function cancelOrder(id) {
  try {
    await updateDoc(doc(db, 'orders', id), { orderStatus: 'CANCELLED', updatedAt: serverTimestamp() });
    showToast('Order cancelled', 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

// ===== MENU PAGE =====
function loadMenu() { subscribeMenu(); }

function populateCategoryFilter() {
  const cats = [...new Set(allMenuItems.map(m => m.categoryName).filter(Boolean))].sort();
  const sel = document.getElementById('menu-category-filter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = cur;
  // datalist
  const dl = document.getElementById('category-list');
  if (dl) dl.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

function filterMenu() {
  const search = document.getElementById('menu-search').value.toLowerCase();
  const cat = document.getElementById('menu-category-filter').value;
  const filtered = allMenuItems.filter(m =>
    (!search || m.name.toLowerCase().includes(search) || m.description?.toLowerCase().includes(search)) &&
    (!cat || m.categoryName === cat)
  );
  renderMenuTable(filtered);
}

function renderMenu() { renderMenuTable(allMenuItems); populateCategoryFilter(); }

function renderMenuTable(items) {
  const tbody = document.getElementById('menu-body');
  if (!items.length) { tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No menu items found</td></tr>'; return; }
  tbody.innerHTML = items.map(m => `
    <tr>
      <td>${m.imageUrl ? `<img class="food-thumb" src="${escapeHtml(m.imageUrl)}" alt="${escapeHtml(m.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="food-thumb-placeholder" style="display:none">🍽️</div>` : '<div class="food-thumb-placeholder">🍽️</div>'}</td>
      <td><div style="font-weight:600">${escapeHtml(m.name)}</div><div style="font-size:0.78rem;color:#888;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.description||'')}</div></td>
      <td><span style="font-size:0.8rem;background:#f0f1f2;padding:0.2rem 0.6rem;border-radius:50px">${escapeHtml(m.categoryName||'—')}</span></td>
      <td>
        <div style="font-weight:700">${fmt(m.discountPrice && m.discountPrice < m.price ? m.discountPrice : m.price)}</div>
        ${m.discountPrice && m.discountPrice < m.price ? `<div style="font-size:0.75rem;color:#888;text-decoration:line-through">${fmt(m.price)}</div>` : ''}
      </td>
      <td><span class="toggle-available" role="button" tabindex="0" data-action="toggle-availability" data-id="${escapeHtml(m.id)}" data-current="${m.isAvailable ? 'true' : 'false'}" title="Toggle availability">${m.isAvailable ? '✅' : '❌'}</span></td>
      <td>${m.isFeatured ? '⭐' : '—'}</td>
      <td><div class="actions-cell">
        <button type="button" class="action-btn action-edit" data-action="edit-item" data-id="${escapeHtml(m.id)}">Edit</button>
        <button type="button" class="action-btn action-delete" data-action="delete-item" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">Delete</button>
      </div></td>
    </tr>`).join('');
}

async function toggleAvailable(id, current) {
  try {
    await updateDoc(doc(db, 'menuItems', id), { isAvailable: !current, updatedAt: serverTimestamp() });
    showToast(!current ? 'Item marked available' : 'Item marked unavailable', 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

function openMenuModal(item) {
  editingItemId = item ? item.id : null;
  document.getElementById('menu-modal-title').textContent = item ? 'Edit Menu Item' : 'Add Menu Item';
  document.getElementById('item-name').value = item?.name || '';
  document.getElementById('item-category-name').value = item?.categoryName || '';
  document.getElementById('item-description').value = item?.description || '';
  document.getElementById('item-price').value = item?.price || '';
  document.getElementById('item-discount').value = item?.discountPrice || 0;
  document.getElementById('item-delivery-time').value = item?.deliveryTime || 30;
  document.getElementById('item-image-url').value = item?.imageUrl || '';
  document.getElementById('item-available').checked = item ? item.isAvailable : true;
  document.getElementById('item-featured').checked = item?.isFeatured || false;
  document.getElementById('item-vegetarian').checked = item?.isVegetarian || false;
  document.getElementById('menu-form-error').classList.add('hidden');
  document.getElementById('menu-modal').classList.remove('hidden');
}

function editItem(id) {
  const item = allMenuItems.find(m => m.id === id);
  if (item) openMenuModal(item);
}

function closeMenuModal() { document.getElementById('menu-modal').classList.add('hidden'); editingItemId = null; }

async function saveMenuItem(e) {
  e.preventDefault();
  const errEl = document.getElementById('menu-form-error');
  const saveBtn = document.getElementById('menu-save-btn');
  errEl.classList.add('hidden');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  const data = {
    name: document.getElementById('item-name').value.trim(),
    categoryName: document.getElementById('item-category-name').value.trim(),
    description: document.getElementById('item-description').value.trim(),
    price: parseInt(document.getElementById('item-price').value) || 0,
    discountPrice: parseInt(document.getElementById('item-discount').value) || 0,
    deliveryTime: parseInt(document.getElementById('item-delivery-time').value) || 30,
    imageUrl: document.getElementById('item-image-url').value.trim(),
    isAvailable: document.getElementById('item-available').checked,
    isFeatured: document.getElementById('item-featured').checked,
    isVegetarian: document.getElementById('item-vegetarian').checked,
    updatedAt: serverTimestamp()
  };
  try {
    if (editingItemId) {
      await updateDoc(doc(db, 'menuItems', editingItemId), data);
      showToast('Menu item updated!', 'success');
    } else {
      data.createdAt = serverTimestamp();
      data.rating = 0; data.reviewCount = 0;
      await addDoc(collection(db, 'menuItems'), data);
      showToast('Menu item added!', 'success');
    }
    closeMenuModal();
  } catch(err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Item';
  }
}

function openDeleteModal(id, name) {
  deletingItemId = id;
  document.getElementById('delete-item-name').textContent = name;
  document.getElementById('delete-modal').classList.remove('hidden');
}
function closeDeleteModal() { document.getElementById('delete-modal').classList.add('hidden'); deletingItemId = null; }

let isDeletingItem = false;
async function confirmDelete() {
  if (!deletingItemId || isDeletingItem) return;
  isDeletingItem = true;
  const btn = document.getElementById('confirm-delete-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    await deleteDoc(doc(db, 'menuItems', deletingItemId));
    showToast('Item deleted', 'success');
    closeDeleteModal();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
  finally {
    isDeletingItem = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
  }
}

// ===== USERS PAGE =====
async function loadUsers() {
  const tbody = document.getElementById('users-body');
  tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Loading…</td></tr>';
  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')));
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!allUsers.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No users found</td></tr>'; return; }
    tbody.innerHTML = allUsers.map(u => `
      <tr>
        <td><div style="font-weight:600">${escapeHtml(u.name||'—')}</div></td>
        <td>${escapeHtml(u.email||'—')}</td>
        <td>${escapeHtml(u.phone||'—')}</td>
        <td><span class="role-badge role-${escapeHtml(u.role||'customer')}">${escapeHtml(u.role||'customer')}</span></td>
        <td style="font-size:0.8rem;color:#888">${fmtDate(u.createdAt)}</td>
        <td><div class="actions-cell">
          ${u.role !== 'admin' ? `<button type="button" class="action-btn action-edit" data-action="set-admin" data-user-id="${escapeHtml(u.id)}" data-make-admin="true">Make Admin</button>` : `<button type="button" class="action-btn action-delete" data-action="set-admin" data-user-id="${escapeHtml(u.id)}" data-make-admin="false">Revoke Admin</button>`}
        </div></td>
      </tr>`).join('');
  } catch(e) { tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Error: ${escapeHtml(e.message)}</td></tr>`; }
}

async function setAdmin(uid, makeAdmin) {
  try {
    await updateDoc(doc(db, 'users', uid), { role: makeAdmin ? 'admin' : 'customer', updatedAt: serverTimestamp() });
    showToast(makeAdmin ? 'User promoted to admin' : 'Admin revoked', 'success');
    loadUsers();
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
}

// ===== EXPORT FOR COMPATIBILITY & DIRECT INVOCATION =====
window.viewOrder = viewOrder;
window.advanceOrder = advanceOrder;
window.cancelOrder = cancelOrder;
window.editItem = editItem;
window.openDeleteModal = openDeleteModal;
window.confirmDelete = confirmDelete;
window.closeDeleteModal = closeDeleteModal;
window.closeOrderModal = closeOrderModal;
window.closeMenuModal = closeMenuModal;
window.openMenuModal = openMenuModal;
window.toggleAvailable = toggleAvailable;
window.setAdmin = setAdmin;
window.loadPage = loadPage;
window.saveMenuItem = saveMenuItem;

// Initialize listeners immediately as well as on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initListeners);
} else {
  initListeners();
}
