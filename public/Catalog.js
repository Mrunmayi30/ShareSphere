// public/js/catalog.js
// Drop this script into your index.html to power the category filters and item cards.

const BASE = 'http://localhost:5000';

// ── State ─────────────────────────────────────────────────────────────────────
let currentCategory = null;
let allItems = [];

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check if a category was passed via URL ?category=
  const urlParams = new URLSearchParams(window.location.search);
  const cat = urlParams.get('category');

  initCategoryFilters(cat);
  fetchItems(cat);
});

// ── Fetch categories and render filter buttons ────────────────────────────────
async function initCategoryFilters(activeCategory) {
  try {
    const res = await fetch(`${BASE}/api/items/categories`);
    const data = await res.json();
    renderCategoryFilters(data.categories, activeCategory);
  } catch (err) {
    console.error('Failed to load categories:', err);
  }
}

function renderCategoryFilters(categories, activeCategory) {
  const container = document.getElementById('category-filters');
  if (!container) return;

  // "All" button
  const allBtn = createFilterBtn('All', null, !activeCategory);
  container.appendChild(allBtn);

  categories.forEach(({ category, count }) => {
    const slug = slugify(category);
    const btn = createFilterBtn(`${category} (${count})`, slug, slug === activeCategory);
    container.appendChild(btn);
  });
}

function createFilterBtn(label, categorySlug, isActive) {
  const btn = document.createElement('button');
  btn.className = 'filter-btn' + (isActive ? ' active' : '');
  btn.textContent = label;
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = categorySlug;

    // Update URL without reload
    const url = new URL(window.location);
    if (categorySlug) url.searchParams.set('category', categorySlug);
    else url.searchParams.delete('category');
    window.history.pushState({}, '', url);

    fetchItems(categorySlug);
  });
  return btn;
}

// ── Fetch items ───────────────────────────────────────────────────────────────
async function fetchItems(category) {
  const grid = document.getElementById('items-grid');
  if (!grid) return;

  grid.innerHTML = '<div class="items-loading"><div class="spinner"></div></div>';

  try {
    const url = category
      ? `${BASE}/api/items?category=${encodeURIComponent(category)}`
      : `${BASE}/api/items`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('Request failed');
    const data = await res.json();

    allItems = data.items;
    renderItemGrid(allItems);
  } catch (err) {
    console.error('fetchItems error:', err);
    grid.innerHTML = `<p class="items-error">Failed to load items. Please try again.</p>`;
  }
}

// ── Render item cards ─────────────────────────────────────────────────────────
function renderItemGrid(items) {
  const grid = document.getElementById('items-grid');
  if (!grid) return;

  if (!items.length) {
    grid.innerHTML = `<p class="items-empty">No items listed in this category yet.</p>`;
    return;
  }

  grid.innerHTML = '';
  items.forEach(item => {
    const card = buildItemCard(item);
    grid.appendChild(card);
  });
}

function buildItemCard(item) {
  const card = document.createElement('div');
  card.className = 'item-card';
  card.setAttribute('data-id', item.id);

  // First image thumbnail
  const images = Array.isArray(item.image_paths) ? item.image_paths : [];
  const thumb = images.length ? `${BASE}/${images[0]}` : null;

  const imgHTML = thumb
    ? `<img src="${thumb}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-img\\'>No Image</div>'">`
    : `<div class="no-img">No Image</div>`;

  const conditionClass = {
    'New': 'cond-new',
    'Like New': 'cond-likenew',
    'Good': 'cond-good',
    'Fair': 'cond-fair',
  }[item.condition] || 'cond-good';

  card.innerHTML = `
    <div class="card-thumb">${imgHTML}</div>
    <div class="card-body">
      <div class="card-category">${escapeHtml(item.category)}</div>
      <h3 class="card-title">${escapeHtml(item.title)}</h3>
      <p class="card-desc">${escapeHtml(truncate(item.description, 80))}</p>
      <div class="card-footer">
        <div class="card-price">
          <span class="price-amount">₹${Number(item.price_per_day).toLocaleString('en-IN')}</span>
          <span class="price-unit">/day</span>
        </div>
        <span class="card-condition ${conditionClass}">${escapeHtml(item.condition)}</span>
      </div>
    </div>
  `;

  card.addEventListener('click', () => {
    window.location.href = `/item-details.html?id=${item.id}`;
  });

  return card;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}