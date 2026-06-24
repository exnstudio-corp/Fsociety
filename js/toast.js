/**
 * toast.js — F-Society Toast Notification System
 * EXN STUDIO
 * Provides success, error, warning, info toasts with auto-dismiss.
 * Never uses alert(), confirm(), or prompt().
 */

(function () {
  'use strict';

  const ICONS = {
    success: 'checkmark-circle-outline',
    error:   'alert-circle-outline',
    warning: 'warning-outline',
    info:    'information-circle-outline',
  };

  /**
   * Show a toast notification.
   * @param {string} message  - Text to display
   * @param {'success'|'error'|'warning'|'info'} type
   * @param {number} duration - Auto-dismiss ms (default 4000)
   */
  function showToast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <ion-icon name="${ICONS[type] || ICONS.info}" aria-hidden="true"></ion-icon>
      <span>${_escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    const dismiss = () => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
      // Fallback in case animation doesn't fire
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
    };

    const timer = setTimeout(dismiss, duration);

    // Allow manual dismiss on click
    toast.addEventListener('click', () => {
      clearTimeout(timer);
      dismiss();
    });
  }

  function _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Expose globally
  window.Toast = {
    success: (msg, dur) => showToast(msg, 'success', dur),
    error:   (msg, dur) => showToast(msg, 'error',   dur),
    warning: (msg, dur) => showToast(msg, 'warning',  dur),
    info:    (msg, dur) => showToast(msg, 'info',    dur),
  };
})();
