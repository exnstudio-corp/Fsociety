/**
 * learn.js — F-Society Learn Section
 * EXN STUDIO
 * Loads articles from JSONBin, supports live search by title/tag/phrase,
 * renders cards, opens article reader modal.
 */

(function () {
  'use strict';

  let allArticles = [];
  let activeTag   = null;

  /* ── INIT ────────────────────────────────────────────────── */
  async function init() {
    renderSkeleton();
    await loadArticles();
    bindSearch();
    bindTagFilter();
  }

  /* ── LOAD VIA NETLIFY PROXY ──────────────────────────────── */
  // Articles are fetched through /.netlify/functions/articles so
  // the JSONBin API key never appears in client-side code or requests.
  async function loadArticles() {
    try {
      const res = await fetch('/.netlify/functions/articles', {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) throw new Error(`Articles proxy responded ${res.status}`);

      const data = await res.json();

      if (data.error) throw new Error(data.error);

      // Support both { articles: [] } and direct array
      const raw = Array.isArray(data) ? data : (data.articles || data.record || []);

      // Sort newest first
      allArticles = [...raw].sort((a, b) => {
        const da = new Date(a.date || 0);
        const db = new Date(b.date || 0);
        return db - da;
      });

      renderArticles(allArticles);
      renderTagCloud(allArticles);

    } catch (err) {
      console.error('[Learn] Load failed:', err);
      renderError('Failed to load articles. Please try again later.');
    }
  }

  /* ── RENDER SKELETON ─────────────────────────────────────── */
  function renderSkeleton() {
    const grid = document.getElementById('articles-grid');
    if (!grid) return;
    grid.innerHTML = Array(4).fill(0).map(() => `
      <div class="article-card" aria-busy="true" aria-label="Loading article">
        <div class="article-meta">
          <div style="height:12px;width:80px;background:var(--bg-elevated);border-radius:2px;"></div>
          <div style="height:12px;width:60px;background:var(--bg-elevated);border-radius:2px;"></div>
        </div>
        <div style="height:18px;width:65%;background:var(--bg-elevated);border-radius:2px;margin-bottom:8px;"></div>
        <div style="height:12px;width:90%;background:var(--bg-elevated);border-radius:2px;margin-bottom:4px;"></div>
        <div style="height:12px;width:75%;background:var(--bg-elevated);border-radius:2px;"></div>
      </div>
    `).join('');
  }

  /* ── RENDER ARTICLES ─────────────────────────────────────── */
  function renderArticles(articles) {
    const grid = document.getElementById('articles-grid');
    if (!grid) return;

    if (!articles.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <ion-icon name="document-outline" aria-hidden="true"></ion-icon>
          <p>No articles found.</p>
        </div>`;
      return;
    }

    grid.innerHTML = articles.map(article => `
      <article
        class="article-card"
        tabindex="0"
        role="button"
        aria-label="Read article: ${_escHtml(article.title)}"
        data-id="${_escHtml(article.id || '')}"
        onclick="Learn.openArticle('${_escHtml(article.id || '')}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){Learn.openArticle('${_escHtml(article.id || '')}')}"
      >
        <div class="article-meta">
          <span class="article-date">${_formatDate(article.date)}</span>
          ${article.author ? `<span class="article-author">by ${_escHtml(article.author)}</span>` : ''}
        </div>
        <h3 class="article-title">${_escHtml(article.title || 'Untitled')}</h3>
        <p class="article-desc">${_escHtml(article.description || '')}</p>
        <div class="article-tags" aria-label="Tags">
          ${(article.tags || []).map(t => `<span class="article-tag">${_escHtml(t)}</span>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" aria-label="Read: ${_escHtml(article.title)}">
          <ion-icon name="arrow-forward-outline" aria-hidden="true"></ion-icon>
          Read
        </button>
      </article>
    `).join('');
  }

  /* ── TAG CLOUD ───────────────────────────────────────────── */
  function renderTagCloud(articles) {
    const wrap = document.getElementById('tag-cloud');
    if (!wrap) return;

    const tagSet = new Set();
    articles.forEach(a => (a.tags || []).forEach(t => tagSet.add(t)));
    const tags = [...tagSet].sort();

    wrap.innerHTML = tags.map(t => `
      <button
        class="tag-chip${activeTag === t ? ' active' : ''}"
        data-tag="${_escHtml(t)}"
        aria-pressed="${activeTag === t}"
        onclick="Learn.filterTag('${_escHtml(t)}')"
      >${_escHtml(t)}</button>
    `).join('') || '';
  }

  /* ── SEARCH ──────────────────────────────────────────────── */
  function bindSearch() {
    const input = document.getElementById('search-input');
    if (!input) return;

    input.addEventListener('input', () => {
      applyFilters(input.value.trim());
    });

    // Keyboard clear on Escape
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        applyFilters('');
      }
    });
  }

  function bindTagFilter() {
    // Tags are rendered dynamically, binding is done via inline onclick
  }

  function filterTag(tag) {
    activeTag = activeTag === tag ? null : tag;
    renderTagCloud(allArticles);

    // Sync with search
    const input = document.getElementById('search-input');
    applyFilters(input ? input.value.trim() : '');
  }

  function applyFilters(query) {
    const q = query.toLowerCase();

    const filtered = allArticles.filter(article => {
      // Tag filter
      if (activeTag && !(article.tags || []).map(t => t.toLowerCase()).includes(activeTag.toLowerCase())) {
        return false;
      }

      // Search filter: title, description, content, tags
      if (!q) return true;
      const haystack = [
        article.title,
        article.description,
        article.content,
        ...(article.tags || []),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });

    renderArticles(filtered);
  }

  /* ── ARTICLE READER ──────────────────────────────────────── */
  function openArticle(id) {
    const article = allArticles.find(a => a.id === id || a.id === Number(id));
    if (!article) {
      Toast.error('Article not found.');
      return;
    }

    const modal = document.getElementById('article-modal');
    if (!modal) return;

    document.getElementById('modal-title').textContent         = article.title || 'Untitled';
    document.getElementById('modal-meta').textContent          =
      `${_formatDate(article.date)} ${article.author ? '· by ' + article.author : ''}`;
    document.getElementById('modal-content-body').textContent  = article.content || '';
    document.getElementById('modal-tags').innerHTML            =
      (article.tags || []).map(t => `<span class="article-tag">${_escHtml(t)}</span>`).join('');

    modal.classList.remove('hidden');
    modal.removeAttribute('aria-hidden');

    // Focus close button for accessibility
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) closeBtn.focus();

    // Close on overlay click
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };
  }

  function closeModal() {
    const modal = document.getElementById('article-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  /* ── ERROR STATE ─────────────────────────────────────────── */
  function renderError(msg) {
    const grid = document.getElementById('articles-grid');
    if (!grid) return;
    grid.innerHTML = `
      <div class="empty-state">
        <ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>
        <p>${_escHtml(msg)}</p>
      </div>`;
  }

  /* ── HELPERS ─────────────────────────────────────────────── */
  function _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('en-ZM', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch { return dateStr; }
  }

  function _escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── KEYBOARD SHORTCUTS ──────────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  /* ── EXPORTS ─────────────────────────────────────────────── */
  window.Learn = { init, openArticle, closeModal, filterTag };

})();
