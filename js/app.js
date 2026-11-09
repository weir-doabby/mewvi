/**
 * Main Application Logic
 * Spotlight Search, Hamburger Drawer, Date Sorting & Apple-Inspired Minimalist Cards
 */

let allSeries = [];
let currentFilter = 'all';
let currentSort = 'date_desc';
let searchQuery = '';

// DOM Elements
const cardsGrid = document.getElementById('cardsGrid');
const searchInput = document.getElementById('searchInput');
const searchBox = document.getElementById('searchBox');
const searchClearBtn = document.getElementById('searchClearBtn');
const sortSelect = document.getElementById('sortSelect');
const resultsCount = document.getElementById('resultsCount');
const filterPills = document.querySelectorAll('.pill-btn');

// Hamburger & Drawer Elements
const hamburgerBtn = document.getElementById('hamburgerBtn');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const drawerCloseBtn = document.getElementById('drawerCloseBtn');
const drawerTotalCount = document.getElementById('drawerTotalCount');
const drawerLatestDate = document.getElementById('drawerLatestDate');

// Modal Elements
const modalBackdrop = document.getElementById('modalBackdrop');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalPoster = document.getElementById('modalPoster');
const modalTitle = document.getElementById('modalTitle');
const modalDate = document.getElementById('modalDate');
const modalQuality = document.getElementById('modalQuality');
const modalDesc = document.getElementById('modalDesc');
const modalEpisodes = document.getElementById('modalEpisodes');
const modalWatchDirect = document.getElementById('modalWatchDirect');

/**
 * Initialize Application
 */
async function initApp() {
  await loadSeriesData();
  setupEventListeners();
  applyFiltersAndRender();
  updateDrawerStats();
}

/**
 * Load Data from JSON and LocalStorage
 */
async function loadSeriesData() {
  try {
    const res = await fetch('data/series.json');
    if (res.ok) {
      allSeries = await res.json();
    }
  } catch (err) {
    console.warn('Could not fetch series.json, using fallback data', err);
    allSeries = [];
  }

  // Merge any user-added items from localStorage
  const savedCustom = localStorage.getItem('termitoon_series');
  if (savedCustom) {
    try {
      const parsed = JSON.parse(savedCustom);
      if (Array.isArray(parsed)) {
        parsed.forEach(customItem => {
          // Avoid duplicate slugs
          const existingIdx = allSeries.findIndex(s => s.slug === customItem.slug);
          if (existingIdx !== -1) {
            allSeries[existingIdx] = customItem;
          } else {
            allSeries.unshift(customItem);
          }
        });
      }
    } catch (e) {
      console.error('Error parsing local storage series', e);
    }
  }

  // Ensure default dates for items missing date_added
  const todayIso = new Date().toISOString().split('T')[0];
  allSeries.forEach((item, idx) => {
    if (!item.date_added) {
      item.date_added = todayIso;
    }
    if (!item.date_display) {
      item.date_display = formatDateDisplay(item.date_added);
    }
  });
}

/**
 * Format date nicely for human display
 */
function formatDateDisplay(isoDateStr) {
  if (!isoDateStr) return 'به‌تازگی';
  const today = new Date();
  const itemDate = new Date(isoDateStr);
  
  const diffTime = Math.abs(today - itemDate);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'امروز';
  if (diffDays === 1) return 'دیروز';
  if (diffDays < 7) return `${diffDays} روز پیش`;
  
  return isoDateStr.replace(/-/g, '/');
}

/**
 * Filter and Sort logic
 */
function getFilteredAndSortedList() {
  const today = new Date();
  const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const todayStr = today.toISOString().split('T')[0];

  let list = allSeries.filter(item => {
    // 1. Filter Pills
    if (currentFilter === 'today') {
      if (item.date_added !== todayStr && !item.date_display?.includes('امروز')) {
        return false;
      }
    } else if (currentFilter === 'week') {
      const itemDate = new Date(item.date_added);
      if (isNaN(itemDate) || itemDate < oneWeekAgo) {
        return false;
      }
    } else if (currentFilter === 'series') {
      if (item.season === 'سینمایی' || item.category?.includes('سینمایی')) {
        return false;
      }
    } else if (currentFilter === 'movies') {
      if (item.season !== 'سینمایی' && !item.category?.includes('سینمایی')) {
        return false;
      }
    }

    // 2. Search Query
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const matchTitleFa = (item.title_fa || '').toLowerCase().includes(q);
      const matchTitleEn = (item.title_en || '').toLowerCase().includes(q);
      const matchDesc = (item.description || '').toLowerCase().includes(q);
      const matchCategory = (item.category || '').toLowerCase().includes(q);
      const matchDate = (item.date_display || '').toLowerCase().includes(q) || (item.date_added || '').includes(q);
      return matchTitleFa || matchTitleEn || matchDesc || matchCategory || matchDate;
    }

    return true;
  });

  // Sort
  list.sort((a, b) => {
    if (currentSort === 'date_desc') {
      return (b.date_added || '').localeCompare(a.date_added || '');
    } else if (currentSort === 'date_asc') {
      return (a.date_added || '').localeCompare(b.date_added || '');
    } else if (currentSort === 'rating') {
      return parseFloat(b.rating || '0') - parseFloat(a.rating || '0');
    } else if (currentSort === 'title') {
      return (a.title_fa || '').localeCompare(b.title_fa || '', 'fa');
    }
    return 0;
  });

  return list;
}

/**
 * Render Cards in Minimalist Apple Style
 */
function applyFiltersAndRender() {
  const filtered = getFilteredAndSortedList();
  resultsCount.textContent = `نمایش ${filtered.length} انیمیشن`;

  cardsGrid.innerHTML = '';

  if (filtered.length === 0) {
    cardsGrid.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <p style="font-size: 16px; font-weight: 600; margin-bottom: 6px;">انیمیشنی یافت نشد</p>
        <p style="font-size: 13px; color: var(--text-tertiary);">عبارت دیگری را جستجو کنید یا فیلترها را تغییر دهید.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('article');
    card.className = 'anim-card';

    const epCount = (item.episodes && item.episodes.length) ? item.episodes.length : 1;
    const seasonLabel = item.season === 'سینمایی' ? 'سینمایی' : `فصل ${item.season || 1}`;
    const dateLabel = item.date_display || formatDateDisplay(item.date_added);
    const poster = item.poster || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1200';
    const quality = item.quality || 'Full HD';
    const rating = item.rating || '8.5';
    const category = item.category || 'انیمیشن';

    card.innerHTML = `
      <div class="card-media">
        <img src="${poster}" alt="${item.title_fa}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800'">
        
        <!-- Date Added Badge (Top-Right) -->
        <div class="card-badge card-badge-date" title="تاریخ افزوده‌شده">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <span>${dateLabel}</span>
        </div>

        <!-- Quality Badge (Top-Left) -->
        <div class="card-badge card-badge-quality">${quality}</div>

        <!-- Season / Episode count (Bottom-Right) -->
        <div class="card-badge card-badge-season">${seasonLabel} • ${epCount} قسمت</div>

        <!-- Rating (Bottom-Left) -->
        <div class="card-badge card-badge-rating">${rating}</div>
      </div>

      <div class="card-body">
        <div class="card-meta-row">
          <span>${category}</span>
          <span>•</span>
          <span>${item.year || '2026'}</span>
        </div>

        <h2 class="card-title">${item.title_fa}</h2>
        <p class="card-desc">${item.description || 'تماشای آنلاین با بالاترین کیفیت در محیطی آرام و بدون تبلیغات.'}</p>

        <div class="card-actions">
          <a href="watch.html?series=${encodeURIComponent(item.slug)}" class="btn-apple-primary">
            <svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
            تماشا
          </a>
          <button type="button" class="btn-apple-secondary" onclick="openPreviewModal('${item.slug}')">
            جزئیات
          </button>
        </div>
      </div>
    `;

    cardsGrid.appendChild(card);
  });
}

/**
 * Quick Preview Modal
 */
window.openPreviewModal = function(slug) {
  const item = allSeries.find(s => s.slug === slug);
  if (!item) return;

  modalPoster.src = item.poster || '';
  modalTitle.textContent = item.title_fa;
  modalDate.textContent = `تاریخ افزوده‌شده: ${item.date_display || item.date_added}`;
  modalQuality.textContent = `${item.quality || '1080p'} • امتیاز: ${item.rating || '8.5'} • ${item.season === 'سینمایی' ? 'سینمایی' : 'فصل ' + item.season}`;
  modalDesc.textContent = item.description || '';
  modalWatchDirect.href = `watch.html?series=${encodeURIComponent(item.slug)}`;

  modalEpisodes.innerHTML = '';
  const episodes = item.episodes || [];
  episodes.forEach((ep, idx) => {
    const row = document.createElement('a');
    row.href = `watch.html?series=${encodeURIComponent(item.slug)}&ep=${idx}`;
    row.className = 'modal-episode-row';
    row.innerHTML = `
      <span style="font-weight: 500;">${ep.title || 'قسمت ' + (idx + 1)}</span>
      <span style="font-size: 12px; color: var(--text-secondary);">${ep.duration || 'تماشا'}</span>
    `;
    modalEpisodes.appendChild(row);
  });

  modalBackdrop.classList.add('open');
};

function closePreviewModal() {
  modalBackdrop.classList.remove('open');
}

/**
 * Top-Right Hamburger Flyout Drawer
 */
function openDrawer() {
  hamburgerBtn.classList.add('active');
  drawerBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  hamburgerBtn.classList.remove('active');
  drawerBackdrop.classList.remove('open');
  document.body.style.overflow = '';
}

function updateDrawerStats() {
  if (drawerTotalCount) {
    drawerTotalCount.textContent = `${allSeries.length} عنوان`;
  }
  if (drawerLatestDate && allSeries.length > 0) {
    drawerLatestDate.textContent = allSeries[0].date_display || allSeries[0].date_added;
  }
}

/**
 * Event Listeners
 */
function setupEventListeners() {
  // Search input live typing
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    if (searchQuery.trim().length > 0) {
      searchBox.classList.add('has-text');
    } else {
      searchBox.classList.remove('has-text');
    }
    applyFiltersAndRender();
  });

  // Clear search
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchBox.classList.remove('has-text');
    searchInput.focus();
    applyFiltersAndRender();
  });

  // Global Keyboard Shortcut: Cmd+K or Ctrl+K for Search
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    } else if (e.key === 'Escape') {
      if (modalBackdrop.classList.contains('open')) {
        closePreviewModal();
      } else if (drawerBackdrop.classList.contains('open')) {
        closeDrawer();
      } else if (document.activeElement === searchInput) {
        searchInput.blur();
      }
    }
  });

  // Sort change
  sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    applyFiltersAndRender();
  });

  // Filter pills
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.getAttribute('data-filter');
      applyFiltersAndRender();
    });
  });

  // Hamburger toggles
  hamburgerBtn.addEventListener('click', () => {
    if (drawerBackdrop.classList.contains('open')) {
      closeDrawer();
    } else {
      openDrawer();
    }
  });

  drawerCloseBtn.addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', (e) => {
    if (e.target === drawerBackdrop) {
      closeDrawer();
    }
  });

  // Drawer filter links
  document.querySelectorAll('[data-drawer-filter]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const filterVal = link.getAttribute('data-drawer-filter');
      currentFilter = filterVal;
      
      filterPills.forEach(p => {
        p.classList.toggle('active', p.getAttribute('data-filter') === filterVal);
      });
      
      closeDrawer();
      applyFiltersAndRender();
    });
  });

  // Modal close handlers
  modalCloseBtn.addEventListener('click', closePreviewModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      closePreviewModal();
    }
  });
}

// Kick off app
document.addEventListener('DOMContentLoaded', initApp);
