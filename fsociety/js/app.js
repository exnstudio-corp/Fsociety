/**
 * app.js — F-Society Main Application Orchestrator
 * EXN STUDIO
 * Handles session checks, routing between sections,
 * terminal loader animation, and navigation state.
 */

(function () {
  'use strict';

  const SECTIONS = ['learn', 'chat', 'account'];
  let currentSection = 'learn';
  let appUser = null;

  /* ── BOOT ────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', async () => {
    // Inject env from server-side rendered block (populated by Netlify function or meta tags)
    loadEnvFromMeta();

    await boot();
  });

  async function boot() {
    showTerminalLoader([
      { text: 'Initializing F-Society...', delay: 0 },
      { text: 'Loading security protocols...', delay: 350 },
      { text: 'Connecting to Supabase...', delay: 700 },
      { text: 'Verifying session...', delay: 1000 },
    ]);

    // Check session
    const user = await Auth.checkSession();

    await simulateLoader(1600);

    if (!user) {
      window.location.href = 'login.html';
      return;
    }

    appUser = user;

    hideTerminalLoader();
    document.getElementById('app').classList.add('visible');

    // Populate sidebar username
    const sbUsername = document.getElementById('sidebar-username');
    const sbAvatar   = document.getElementById('sidebar-avatar');
    const username   = localStorage.getItem('fsoc_username') || user.user_metadata?.username || 'user';
    if (sbUsername) sbUsername.textContent = username;
    if (sbAvatar)   sbAvatar.textContent   = username.substring(0, 2).toUpperCase();

    // Init subsystems
    await Learn.init();
    await Chat.init(Auth.sb, user);
    await Account.init(Auth.sb, user);

    // Default section
    navigateTo('learn');

    // Bind nav
    bindNavigation();

    // Logout buttons
    document.querySelectorAll('[data-action="logout"]').forEach(btn => {
      btn.addEventListener('click', () => Auth.logout());
    });
  }

  /* ── TERMINAL LOADER ─────────────────────────────────────── */
  function showTerminalLoader(lines) {
    const loader = document.getElementById('terminal-loader');
    const body   = document.getElementById('term-body');
    if (!loader || !body) return;

    loader.classList.remove('hidden');
    body.innerHTML = '';

    lines.forEach(({ text, delay }) => {
      setTimeout(() => {
        const line = document.createElement('div');
        line.className = 'term-line active';
        line.innerHTML = `<span class="term-prompt">$</span><span>${_escHtml(text)}</span>`;
        body.appendChild(line);
        // After a tick, mark previous as 'ok'
        setTimeout(() => {
          body.querySelectorAll('.term-line.active:not(:last-child)').forEach(l => {
            l.classList.remove('active');
            l.classList.add('ok');
          });
        }, 80);
      }, delay);
    });
  }

  function hideTerminalLoader() {
    const loader = document.getElementById('terminal-loader');
    if (loader) loader.classList.add('hidden');
  }

  function simulateLoader(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  /* ── NAVIGATION ──────────────────────────────────────────── */
  function bindNavigation() {
    // Desktop sidebar items
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
      item.addEventListener('click', () => navigateTo(item.dataset.section));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigateTo(item.dataset.section);
        }
      });
    });

    // Mobile nav items
    document.querySelectorAll('.mobile-nav-item[data-section]').forEach(item => {
      item.addEventListener('click', () => navigateTo(item.dataset.section));
    });
  }

  function navigateTo(section) {
    if (!SECTIONS.includes(section)) return;
    currentSection = section;

    // Update panels
    SECTIONS.forEach(s => {
      const panel = document.getElementById(`${s}-panel`);
      if (panel) panel.classList.toggle('active', s === section);
    });

    // Update sidebar nav items
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
      item.classList.toggle('active', item.dataset.section === section);
      item.setAttribute('aria-current', item.dataset.section === section ? 'page' : 'false');
    });

    // Update mobile nav items
    document.querySelectorAll('.mobile-nav-item[data-section]').forEach(item => {
      item.classList.toggle('active', item.dataset.section === section);
    });

    // Update page title
    const titles = {
      learn:   'F-Society — Learn',
      chat:    'F-Society — Chat',
      account: 'F-Society — Account',
    };
    document.title = titles[section] || 'F-Society';
  }

  /* ── ENV FROM META TAGS ──────────────────────────────────── */
  function loadEnvFromMeta() {
    // Netlify injects env vars into meta tags via a serverless function at build time
    // Or they can be passed via window.__ENV__ set by a server-side rendered script
    if (window.__ENV__) return;

    window.__ENV__ = {
      SUPABASE_URL:     getMeta('supabase-url'),
      SUPABASE_ANON_KEY:getMeta('supabase-anon-key'),
      JSONBIN_BIN_ID:   getMeta('jsonbin-bin-id'),
      JSONBIN_API_KEY:  getMeta('jsonbin-api-key'),
    };
  }

  function getMeta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.getAttribute('content') : '';
  }

  function _escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── KEYBOARD TRAP FOR MODALS (focus management) ─────────── */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const openModal = document.querySelector('.modal-overlay:not(.hidden)');
      if (!openModal) return;
      const focusable = openModal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first?.focus();
      }
    }
  });

  window.App = { navigateTo };

})();
