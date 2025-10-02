// Firebase imports
import { db } from './firebase-config.js';
import { 
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  onSnapshot 
} from 'firebase/firestore';

// Collections
const COLLECTIONS = {
  SELLERS: 'sellers',
  PURCHASES: 'purchases',
  BILLS: 'bills'
};

// Utility functions
const todayISO = () => new Date().toISOString().slice(0,10);
const parseRs = (n) => Math.round(Number(n || 0));
const formatRs = (n) => `₹${parseRs(n).toLocaleString('en-IN')}`;
const weekStart = (d) => {
  const nd = new Date(d);
  const day = nd.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  nd.setDate(nd.getDate() + diff);
  return nd.toISOString().slice(0,10);
};
const weekEnd = (d) => {
  const ws = new Date(weekStart(d));
  ws.setDate(ws.getDate() + 6);
  return ws.toISOString().slice(0,10);
};

// Format file size helper
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Firebase functions
const getData = async (collectionName) => {
  try {
    const querySnapshot = await getDocs(collection(db, collectionName));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting ', error);
    return [];
  }
};

const setData = async (collectionName, data) => {
  try {
    const cleanData = sanitizeForFirestore(data);
    const docRef = await addDoc(collection(db, collectionName), cleanData);
    console.log('Document written with ID: ', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Error adding ', error);
    throw error;
  }
};

const updateData = async (collectionName, docId, data) => {
  try {
    const cleanData = sanitizeForFirestore(data);
    await updateDoc(doc(db, collectionName, docId), cleanData);
  } catch (error) {
    console.error('Error updating ', error);
    throw error;
  }
};

const deleteData = async (collectionName, docId) => {
  try {
    await deleteDoc(doc(db, collectionName, docId));
  } catch (error) {
    console.error('Error deleting ', error);
    throw error;
  }
};

// Sanitize data for Firestore
function sanitizeForFirestore(obj) {
  if (obj === null || obj === undefined) return null;
  
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }
  
  if (typeof obj === 'object') {
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'id') continue; // Skip id field
      clean[key] = sanitizeForFirestore(value);
    }
    return clean;
  }
  
  return obj;
}

// Auto-resizing photo processing
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    
    // Create canvas for resizing
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      // Calculate new dimensions (max width/height: 400px)
      const maxSize = 400;
      let { width, height } = img;
      
      if (width > height) {
        if (width > maxSize) {
          height = (height * maxSize) / width;
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
      }
      
      // Resize image
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to base64 with quality compression
      const resizedDataURL = canvas.toDataURL('image/jpeg', 0.7); // 70% quality
      
      console.log('Photo processed:', file.name, 'Original:', formatFileSize(file.size), 'Compressed:', formatFileSize(resizedDataURL.length));
      resolve(resizedDataURL);
    };
    
    img.onerror = (error) => {
      console.error('Image load error:', error);
      reject(new Error('Failed to process image. Please try a different photo.'));
    };
    
    // Load image
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target.result;
    };
    reader.onerror = (error) => {
      console.error('File read error:', error);
      reject(new Error('Failed to read image file.'));
    };
    reader.readAsDataURL(file);
  });
}

// State
let selectedSellerId = null;
let pendingCart = {};
let lastGeneratedBillIds = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const purchaseDateEl = document.getElementById('purchaseDate');
  purchaseDateEl.value = todayISO();
  
  setupEventListeners();
  await seedExampleData();
  await renderSellers();
  await renderPurchaseTab();
  await renderBillsTab();
  await renderAnalytics();
  await updateHeaderStats();
});

// Event Listeners Setup
function setupEventListeners() {
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      
      if (btn.dataset.tab === 'purchase') await renderPurchaseTab();
      if (btn.dataset.tab === 'sellers') await renderSellers();
      if (btn.dataset.tab === 'bills') await renderBillsTab();
      if (btn.dataset.tab === 'analytics') await renderAnalytics();
    });
  });

  // Add seller button
  document.getElementById('addSellerBtn').addEventListener('click', () => openSellerModal());

  // Modal close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Seller form
  document.getElementById('sellerForm').addEventListener('submit', handleSellerSubmit);

  // Add item row
  document.getElementById('addItemRow').addEventListener('click', () => addItemRow());

  // Bill period change
  document.getElementById('billPeriod').addEventListener('change', (e) => {
    const custom = e.target.value === 'custom';
    document.getElementById('fromDate').classList.toggle('hidden', !custom);
    document.getElementById('toDate').classList.toggle('hidden', !custom);
  });

  // Generate bill
  document.getElementById('generateBillBtn').addEventListener('click', generateBill);

  // Bill actions
  document.getElementById('downloadPdfBtn').addEventListener('click', downloadBill);
  document.getElementById('markBilledBtn').addEventListener('click', markAsBilled);
}

// Seller Modal Functions
function openSellerModal(seller = null) {
  const modal = document.getElementById('sellerModal');
  modal.classList.remove('hidden');
  
  // Clear the edit ID if seller is null or invalid
  const editId = (seller && seller.id) ? seller.id : '';
  document.getElementById('sellerForm').dataset.editId = editId;
  
  document.getElementById('sellerName').value = seller?.name || '';
  document.getElementById('sellerContact').value = seller?.contact || '';
  
  const itemsList = document.getElementById('itemsList');
  itemsList.innerHTML = '';
  
  const items = seller?.items || [];
  if (items.length > 0) {
    items.forEach(it => addItemRow(it));
  } else {
    addItemRow(); // Add at least one empty row
  }
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function addItemRow(existing = null) {
  const row = document.createElement('div');
  row.className = 'item-edit-row';
  row.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 4px;">
      <input type="file" accept="image/*"/>
      <small class="photo-info" style="color: #94a3b8; font-size: 11px;">${existing?.photo ? 'Has existing photo' : ''}</small>
    </div>
    <input type="text" placeholder="Item name" value="${existing?.name || ''}" required/>
    <input type="number" placeholder="Price (₹)" value="${existing?.price || ''}" min="0"/>
    <input type="text" placeholder="SKU/Code (optional)" value="${existing?.code || ''}"/>
    <button type="button" class="btn-secondary">Remove</button>
  `;
  
  // Add file change listener to show size info
  const fileInput = row.querySelector('input[type="file"]');
  const photoInfo = row.querySelector('.photo-info');
  
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      photoInfo.textContent = `${file.name} (${formatFileSize(file.size)})`;
      if (file.size > 10000000) { // 10MB limit for original file
        photoInfo.style.color = '#ef4444';
        photoInfo.textContent += ' - Very large, processing may take time';
      } else {
        photoInfo.style.color = '#22c55e';
        photoInfo.textContent += ' - Will be auto-resized';
      }
    } else if (existing?.photo) {
      photoInfo.textContent = 'Has existing photo';
      photoInfo.style.color = '#94a3b8';
    } else {
      photoInfo.textContent = '';
    }
  });
  
  row.querySelector('button').addEventListener('click', () => row.remove());
  document.getElementById('itemsList').appendChild(row);
}

async function handleSellerSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('sellerName').value.trim();
  if (!name) return;
  
  const contact = document.getElementById('sellerContact').value.trim();
  const rows = [...document.querySelectorAll('#itemsList .item-edit-row')];
  const items = [];
  
  // Show processing message
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = 'Processing photos...';
  submitBtn.disabled = true;
  
  try {
    for (const r of rows) {
      const file = r.querySelector('input[type="file"]').files[0];
      const nameInput = r.querySelector('input[type="text"]');
      const priceInput = r.querySelector('input[type="number"]');
      const codeInput = r.querySelectorAll('input[type="text"]')[1];
      
      if (!nameInput.value.trim()) continue;
      
      let photoData = '';
      if (file) {
        try {
          photoData = await fileToDataURL(file);
        } catch (error) {
          alert(`Error processing photo "${file.name}": ${error.message}`);
          submitBtn.textContent = originalText;
          submitBtn.disabled = false;
          return;
        }
      }
      
      items.push({ 
        itemId: crypto.randomUUID(),
        name: nameInput.value.trim(), 
        price: Number(priceInput.value) || 0,
        code: codeInput.value.trim(),
        photo: photoData
      });
    }
    
    if (items.length === 0) {
      alert('Please add at least one item');
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
      return;
    }
    
    submitBtn.textContent = 'Saving to database...';
    
    const editId = e.target.dataset.editId;
    
    const sellerData = {
      name: name,
      contact: contact,
      items: items,
      updatedAt: new Date().toISOString()
    };
    
    if (editId && editId.trim() !== '') {
      // Check if document exists before updating
      const sellers = await getData(COLLECTIONS.SELLERS);
      const existingSeller = sellers.find(s => s.id === editId);
      
      if (existingSeller) {
        await updateData(COLLECTIONS.SELLERS, editId, sellerData);
        alert('Seller updated successfully!');
      } else {
        // Document doesn't exist, create new one instead
        console.log('Document not found, creating new seller instead');
        sellerData.createdAt = new Date().toISOString();
        await setData(COLLECTIONS.SELLERS, sellerData);
        alert('Seller created successfully!');
      }
    } else {
      // Creating new seller
      sellerData.createdAt = new Date().toISOString();
      await setData(COLLECTIONS.SELLERS, sellerData);
      alert('Seller created successfully!');
    }
    
    closeModal('sellerModal');
    await renderSellers();
    await renderPurchaseTab();
    
  } catch (error) {
    console.error('Error saving seller:', error);
    
    // If it's an update error, try creating a new document instead
    if (error.message.includes('No document to update')) {
      try {
        console.log('Retrying as new document...');
        const sellerData = {
          name: name,
          contact: contact,
          items: items,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await setData(COLLECTIONS.SELLERS, sellerData);
        alert('Seller saved successfully!');
        closeModal('sellerModal');
        await renderSellers();
        await renderPurchaseTab();
      } catch (retryError) {
        console.error('Retry failed:', retryError);
        alert('Error saving seller: ' + retryError.message);
      }
    } else {
      alert('Error saving seller: ' + error.message);
    }
  } finally {
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

// Render Functions
async function renderSellers() {
  const wrap = document.getElementById('sellersList');
  const sellers = await getData(COLLECTIONS.SELLERS);
  
  wrap.innerHTML = sellers.map(s => {
    const itemHtml = (s.items || []).map(it => `
      <div class="item-row">
        <img class="item-thumb" 
             src="${it.photo || 'image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiBmaWxsPSIjMGIxMjIwIi8+Cjx0ZXh0IHg9IjI0IiB5PSIyOCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzk0YTNiOCIgZm9udC1zaXplPSIxMiI+Tm8gSW1hZ2U8L3RleHQ+Cjwvc3ZnPgo='}" 
             alt="${it.name}"
             loading="lazy"/>
        <div>
          <div>${it.name}</div>
          <div class="item-meta">${it.code || ''}</div>
        </div>
        <div>${formatRs(it.price)}</div>
      </div>
    `).join('');
    
    return `
      <div class="seller-card">
        <div class="seller-header">
          <div class="seller-avatar">${(s.name[0] || '?').toUpperCase()}</div>
          <div>
            <div style="font-weight:700">${s.name}</div>
            <div class="item-meta">${s.contact || ''}</div>
          </div>
          <div style="margin-left:auto; display:flex; gap:6px;">
            <button class="btn-secondary" onclick="editSeller('${s.id}')">Edit</button>
            <button class="btn-secondary" onclick="deleteSeller('${s.id}')">Delete</button>
          </div>
        </div>
        <div class="seller-items">${itemHtml || '<div class="item-meta">No items yet</div>'}</div>
      </div>
    `;
  }).join('') || '<div class="item-meta">No sellers yet. Click + Add Seller.</div>';
}

// Global functions for onclick handlers
window.editSeller = async (id) => {
  const sellers = await getData(COLLECTIONS.SELLERS);
  const s = sellers.find(x => x.id === id);
  if (!s) {
    alert('Seller not found. Please refresh the page.');
    await renderSellers();
    return;
  }
  openSellerModal(s);
};

window.deleteSeller = async (id) => {
  if (!confirm('Delete this seller? This will also remove all associated purchases.')) return;
  
  try {
    await deleteData(COLLECTIONS.SELLERS, id);
    
    // Also delete associated purchases
    const purchases = await getData(COLLECTIONS.PURCHASES);
    const sellerPurchases = purchases.filter(p => p.sellerId === id);
    for (const purchase of sellerPurchases) {
      await deleteData(COLLECTIONS.PURCHASES, purchase.id);
    }
    
    await renderSellers();
    await renderPurchaseTab();
    await updateHeaderStats();
    alert('Seller and associated data deleted successfully.');
  } catch (error) {
    console.error('Error deleting seller:', error);
    alert('Error deleting seller: ' + error.message);
  }
};

// Purchase Tab
async function renderPurchaseTab() {
  const sellers = await getData(COLLECTIONS.SELLERS);
  const listPanel = document.getElementById('sellerListPanel');
  
  listPanel.innerHTML = sellers.map(s => `
    <div class="seller-card" style="cursor:pointer" onclick="selectSeller('${s.id}')">
      <div class="seller-header">
        <div class="seller-avatar">${(s.name[0] || '?').toUpperCase()}</div>
        <div>
          <div style="font-weight:700">${s.name}</div>
          <div class="item-meta">${(s.items || []).length} items</div>
        </div>
      </div>
    </div>
  `).join('') || '<div class="item-meta">Add sellers to begin</div>';
  
  if (selectedSellerId) await selectSeller(selectedSellerId, true);
  await updateHeaderStats();
}

window.selectSeller = async (id, keepQty = false) => {
  selectedSellerId = id;
  const sellers = await getData(COLLECTIONS.SELLERS);
  const s = sellers.find(x => x.id === id);
  
  if (!s) {
    alert('Seller not found. Please refresh the page.');
    await renderPurchaseTab();
    return;
  }
  
  document.getElementById('chatHeader').textContent = s.name;
  const chatItems = document.getElementById('chatItems');
  
  if (!keepQty) pendingCart = {};
  
  chatItems.innerHTML = (s.items || []).map(it => {
    const qty = pendingCart[it.itemId] || 0;
    return `
      <div class="chat-item">
        <img src="${it.photo || 'image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjMGIxMjIwIi8+Cjx0ZXh0IHg9IjMyIiB5PSIzNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzk0YTNiOCIgZm9udC1zaXplPSIxMCI+Tm8gSW1hZ2U8L3RleHQ+Cjwvc3ZnPgo='}" 
             alt="${it.name}"
             loading="lazy"/>
        <div>
          <div style="font-weight:700">${it.name}</div>
          <div class="item-meta">${formatRs(it.price)} ${it.code ? '• ' + it.code : ''}</div>
        </div>
        <div class="qty-controls">
          <button class="btn-secondary" onclick="changeQty('${it.itemId}', -1)">-</button>
          <input type="number" min="0" value="${qty}" onchange="setQty('${it.itemId}', this.value)"/>
          <button class="btn-secondary" onclick="changeQty('${it.itemId}', 1)">+</button>
        </div>
      </div>
    `;
  }).join('') || '<div class="item-meta" style="padding:10px">No items for this seller</div>';
  
  await renderCartFooter();
};

window.changeQty = async (itemId, delta) => {
  const v = Math.max(0, (pendingCart[itemId] || 0) + delta);
  pendingCart[itemId] = v;
  await selectSeller(selectedSellerId, true);
};

window.setQty = async (itemId, val) => {
  const v = Math.max(0, parseInt(val || 0, 10));
  pendingCart[itemId] = v;
  await renderCartFooter();
};

async function renderCartFooter() {
  const sellers = await getData(COLLECTIONS.SELLERS);
  const s = sellers.find(x => x.id === selectedSellerId);
  
  if (!s) return;
  
  let total = 0;
  Object.entries(pendingCart).forEach(([itemId, qty]) => {
    const it = (s.items || []).find(i => i.itemId === itemId);
    if (it) total += qty * Number(it.price);
  });
  
  const footer = document.getElementById('chatFooter');
  footer.innerHTML = `
    <div class="total-chip">Total: ${formatRs(total)}</div>
    <div style="display:flex; gap:8px;">
      <button class="btn-secondary" onclick="clearCart()">Clear</button>
      <button class="btn-primary" onclick="savePurchase()">Save</button>
    </div>
  `;
}

window.clearCart = async () => {
  pendingCart = {};
  await selectSeller(selectedSellerId, true);
};

window.savePurchase = async () => {
  if (!selectedSellerId) return alert('Select a seller');
  
  const date = document.getElementById('purchaseDate').value || todayISO();
  const sellers = await getData(COLLECTIONS.SELLERS);
  const s = sellers.find(x => x.id === selectedSellerId);
  
  if (!s) return alert('Seller not found. Please refresh the page.');
  
  const items = Object.entries(pendingCart)
    .filter(([_, q]) => q > 0)
    .map(([itemId, qty]) => {
      const it = (s.items || []).find(i => i.itemId === itemId);
      if (!it) return null;
      return { 
        itemId: itemId, 
        name: it.name, 
        price: Number(it.price),
        qty: Number(qty)
      };
    })
    .filter(item => item !== null);
    
  if (items.length === 0) return alert('No quantities selected');
  
  try {
    await setData(COLLECTIONS.PURCHASES, {
      sellerId: s.id,
      sellerName: s.name,
      date: date,
      items: items,
      billed: false,
      createdAt: new Date().toISOString()
    });
    
    pendingCart = {};
    await selectSeller(selectedSellerId, true);
    await updateHeaderStats();
    alert('Purchase saved successfully!');
  } catch (error) {
    console.error('Error saving purchase:', error);
    alert('Error saving purchase: ' + error.message);
  }
};

// Bills functionality
async function generateBill() {
  const period = document.getElementById('billPeriod').value;
  const today = todayISO();
  let from = weekStart(today), to = weekEnd(today);
  
  if (period === 'month') {
    const d = new Date(today);
    from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10);
    to = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10);
  } else if (period === 'custom') {
    from = document.getElementById('fromDate').value;
    to = document.getElementById('toDate').value;
    if (!from || !to) return alert('Select custom dates');
  }
  
  const all = await getData(COLLECTIONS.PURCHASES);
  const filtered = all.filter(p => !p.billed && p.date >= from && p.date <= to);
  
  if (filtered.length === 0) {
    alert('No unbilled purchases in range');
    return;
  }

  const bySeller = {};
  filtered.forEach(p => {
    bySeller[p.sellerId] = bySeller[p.sellerId] || { sellerName: p.sellerName, items: {} };
    (p.items || []).forEach(it => {
      const key = it.itemId;
      bySeller[p.sellerId].items[key] = bySeller[p.sellerId].items[key] || { name: it.name, price: it.price, lines: [] };
      bySeller[p.sellerId].items[key].lines.push({ date: p.date, qty: it.qty, amount: it.qty * it.price });
    });
  });

  lastGeneratedBillIds = filtered.map(p => p.id);
  openBillModal(renderBillHTML(bySeller, from, to));
}

function renderBillHTML(bySeller, from, to) {
  let html = `<div style="padding: 10px;"><div style="margin-bottom:12px; font-size: 16px;"><strong>Purchase Bill</strong></div><div style="margin-bottom:8px; color: #666;">Period: ${from} to ${to}</div>`;
  
  let grandTotal = 0;
  Object.entries(bySeller).forEach(([sellerId, data]) => {
    let sellerTotal = 0;
    html += `<h3 style="margin:15px 0 8px 0; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px;">${data.sellerName}</h3>`;
    html += `<table class="bill-table" style="width: 100%; border-collapse: collapse; margin: 8px 0;">
      <thead><tr style="background: #f8f9fa;"><th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Item</th><th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Date-wise Qty</th><th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Rate</th><th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Amount</th></tr></thead><tbody>`;
      
    Object.values(data.items).forEach(item => {
      const lines = item.lines
        .sort((a,b) => a.date.localeCompare(b.date))
        .map(l => `${l.date}: ${l.qty}`).join(', ');
      const amount = item.lines.reduce((s,x) => s + x.amount, 0);
      sellerTotal += amount;
      
      html += `<tr>
        <td style="border: 1px solid #ddd; padding: 8px;">${item.name}</td>
        <td style="border: 1px solid #ddd; padding: 8px;">${lines}</td>
        <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${formatRs(item.price)}</td>
        <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${formatRs(amount)}</td>
      </tr>`;
    });
    
    html += `<tr style="background: #e8f4fd; font-weight: bold;"><td colspan="3" style="border: 1px solid #ddd; padding: 8px; text-align:right;"><strong>Seller Total</strong></td><td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${formatRs(sellerTotal)}</td></tr>`;
    html += `</tbody></table>`;
    grandTotal += sellerTotal;
  });
  
  html += `<div style="margin-top: 15px; padding: 10px; background: #f0f8ff; border: 1px solid #b8daff; border-radius: 4px;"><strong>Grand Total: ${formatRs(grandTotal)}</strong></div>`;
  html += `<div style="margin-top: 10px; font-size: 12px; color: #666;">Generated on: ${new Date().toLocaleString()}</div>`;
  html += `</div>`;
  return html;
}

function openBillModal(innerHTML) {
  document.getElementById('billPreview').innerHTML = innerHTML;
  document.getElementById('billModal').classList.remove('hidden');
}

function downloadBill() {
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>Purchase Bill</title><style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
    th { background-color: #f5f5f5; font-weight: bold; }
    h3 { color: #333; margin: 20px 0 10px 0; border-bottom: 2px solid #eee; padding-bottom: 5px; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    .total-row { background-color: #e8f4fd !important; font-weight: bold; }
  </style></head><body>${document.getElementById('billPreview').innerHTML}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

async function markAsBilled() {
  if (lastGeneratedBillIds.length === 0) {
    alert('No purchases to mark as billed');
    return;
  }

  if (!confirm(`Mark ${lastGeneratedBillIds.length} purchases as billed?`)) {
    return;
  }

  try {
    for (const purchaseId of lastGeneratedBillIds) {
      await updateData(COLLECTIONS.PURCHASES, purchaseId, { 
        billed: true,
        billedAt: new Date().toISOString()
      });
    }
    
    alert('Successfully marked as billed!');
    closeModal('billModal');
    await renderBillsTab();
    await updateHeaderStats();
    await renderAnalytics();
  } catch (error) {
    console.error('Error marking as billed:', error);
    alert('Error marking as billed: ' + error.message);
  }
}

// Analytics and Stats
async function renderBillsTab() {
  const container = document.getElementById('billsContainer');
  const purchases = await getData(COLLECTIONS.PURCHASES);
  const today = todayISO();
  const ws = weekStart(today), we = weekEnd(today);
  
  const weekPurchases = purchases.filter(p => p.date >= ws && p.date <= we);
  const weekTotal = weekPurchases.reduce((s,p) => s + ((p.items || []).reduce((t,i) => t + (i.qty * i.price), 0)), 0);
  
  const unbilled = purchases.filter(p => !p.billed);
  const unbilledTotal = unbilled.reduce((s,p) => s + ((p.items || []).reduce((t,i) => t + (i.qty * i.price), 0)), 0);

  container.innerHTML = `
    <div class="seller-card">
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <div class="total-chip">Unbilled Total: ${formatRs(unbilledTotal)}</div>
        <div class="total-chip">This Week: ${formatRs(weekTotal)}</div>
        <div class="total-chip">Total Purchases: ${purchases.length}</div>
      </div>
    </div>
    ${renderPurchaseTable(purchases)}
  `;
}

function renderPurchaseTable(all) {
  const byWeek = {};
  const byMonth = {};
  
  all.forEach(p => {
    const ws = weekStart(p.date), we = weekEnd(p.date);
    const wkKey = `${ws}—${we}`;
    byWeek[wkKey] = byWeek[wkKey] || 0;
    byWeek[wkKey] += (p.items || []).reduce((s,i) => s + (i.qty * i.price), 0);

    const m = p.date.slice(0,7);
    byMonth[m] = byMonth[m] || 0;
    byMonth[m] += (p.items || []).reduce((s,i) => s + (i.qty * i.price), 0);
  });

  let html = `<div class="seller-card"><h3>Recent Weeks</h3>`;
  html += Object.entries(byWeek).sort().reverse().slice(0,5).map(([k,v]) => `<div class="item-meta">${k}: ${formatRs(v)}</div>`).join('') || '<div class="item-meta">No data</div>';
  html += `</div>`;
  
  html += `<div class="seller-card"><h3>Recent Months</h3>`;
  html += Object.entries(byMonth).sort().reverse().slice(0,6).map(([k,v]) => `<div class="item-meta">${k}: ${formatRs(v)}</div>`).join('') || '<div class="item-meta">No data</div>';
  html += `</div>`;
  
  return html;
}

async function renderAnalytics() {
  const purchases = await getData(COLLECTIONS.PURCHASES);
  const sellers = await getData(COLLECTIONS.SELLERS);
  const today = todayISO();
  const ws = weekStart(today), we = weekEnd(today);
  const weekPurchases = purchases.filter(p => p.date >= ws && p.date <= we);

  const totalWeek = weekPurchases.reduce((s,p) => s + ((p.items || []).reduce((t,i) => t + (i.qty * i.price), 0)), 0);
  document.getElementById('weeklySummary').innerHTML = `<div class="total-chip">This Week: ${formatRs(totalWeek)}</div><div class="item-meta">Active Sellers: ${sellers.length}</div>`;

  const bySeller = {};
  purchases.forEach(p => {
    bySeller[p.sellerName] = bySeller[p.sellerName] || 0;
    bySeller[p.sellerName] += (p.items || []).reduce((s,i) => s + (i.qty * i.price), 0);
  });
  
  document.getElementById('topSellers').innerHTML = Object.entries(bySeller)
    .sort((a,b) => b[1]-a[1])
    .slice(0,5)
    .map(([name,total]) => `<div class="item-meta">${name}: ${formatRs(total)}</div>`)
    .join('') || '<div class="item-meta">No purchase data</div>';

  const unbilled = purchases.filter(p => !p.billed);
  const unbilledBy = {};
  unbilled.forEach(p => {
    unbilledBy[p.sellerName] = unbilledBy[p.sellerName] || 0;
    unbilledBy[p.sellerName] += (p.items || []).reduce((s,i) => s + (i.qty * i.price), 0);
  });
  
  document.getElementById('unbilledBySeller').innerHTML = Object.entries(unbilledBy)
    .sort((a,b) => b[1]-a[1])
    .map(([name,total]) => `<div class="item-meta">${name}: ${formatRs(total)}</div>`)
    .join('') || '<div class="item-meta">All purchases billed</div>';
}

async function updateHeaderStats() {
  const purchases = await getData(COLLECTIONS.PURCHASES);
  const today = todayISO();
  const ws = weekStart(today), we = weekEnd(today);
  const m = today.slice(0,7);

  const weekPurchases = purchases.filter(p => p.date >= ws && p.date <= we);
  const weekTotal = weekPurchases.reduce((s,p) => s + ((p.items || []).reduce((t,i) => t + (i.qty * i.price), 0)), 0);
  
  const monthPurchases = purchases.filter(p => p.date.startsWith(m));
  const monthTotal = monthPurchases.reduce((s,p) => s + ((p.items || []).reduce((t,i) => t + (i.qty * i.price), 0)), 0);
  
  const unbilled = purchases.filter(p => !p.billed);
  const unbilledTotal = unbilled.reduce((s,p) => s + ((p.items || []).reduce((t,i) => t + (i.qty * i.price), 0)), 0);

  document.getElementById('weekTotal').textContent = formatRs(weekTotal);
  document.getElementById('monthTotal').textContent = formatRs(monthTotal);
  document.getElementById('unbilledTotal').textContent = formatRs(unbilledTotal);
}

// Seed example data
async function seedExampleData() {
  const existingSellers = await getData(COLLECTIONS.SELLERS);
  if (existingSellers.length > 0) return;

  try {
    await setData(COLLECTIONS.SELLERS, {
      name: 'Seller A',
      contact: '',
      items: [
        { itemId: crypto.randomUUID(), name: 'Item 1', price: 110, code: 'A-1', photo: '' },
        { itemId: crypto.randomUUID(), name: 'Item 2', price: 135, code: 'A-2', photo: '' }
      ],
      createdAt: new Date().toISOString()
    });
    
    await setData(COLLECTIONS.SELLERS, {
      name: 'Seller B',
      contact: '',
      items: [
        { itemId: crypto.randomUUID(), name: 'Item 1', price: 220, code: 'B-1', photo: '' },
        { itemId: crypto.randomUUID(), name: 'Item 2', price: 330, code: 'B-2', photo: '' }
      ],
      createdAt: new Date().toISOString()
    });
    
    console.log('Example data seeded successfully');
  } catch (error) {
    console.error('Error seeding ', error);
  }
}

// Debug helper function
window.debugFirestore = async () => {
  console.log('=== Firestore Debug Info ===');
  const sellers = await getData(COLLECTIONS.SELLERS);
  const purchases = await getData(COLLECTIONS.PURCHASES);
  console.log('Sellers:', sellers.length);
  sellers.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name} (ID: ${s.id}) - ${s.items?.length || 0} items`);
  });
  console.log('Purchases:', purchases.length);
  console.log('Selected Seller ID:', selectedSellerId);
  console.log('Pending Cart:', pendingCart);
};
