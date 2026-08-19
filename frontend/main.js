/**
 * Athenaeum / GT Library — Frontend Core & API Client
 * Includes:
 *  - Theme switching (dark / light mode)
 *  - Toast notification system
 *  - API client (window.api)
 *  - Auth state helpers (checkAuth, requireAuth, updateNavbar)
 *  - Utilities (escapeHtml, timeAgo, starRatingHtml)
 *  - Interactive UI components (password toggle, form validation, star rating, etc.)
 */
const configuredApiBaseUrl = typeof window !== 'undefined' ? window.GT_LIBRARY_API_URL : '';
const isS3HostedFrontend = typeof window !== 'undefined' && (
  window.location.hostname.includes('.s3-website-') ||
  window.location.hostname.includes('.s3.') ||
  window.location.hostname.endsWith('.amazonaws.com')
);
const API_BASE_URL = (configuredApiBaseUrl || (isS3HostedFrontend
  ? 'http://13.60.13.49:3000/api'
  : `${window.location.origin}/api`)).replace(/\/$/, '');
(function () {
  'use strict';

  // =========================================================================
  // 1. Utilities & Security Helpers
  // =========================================================================

  /**
   * Escape HTML special characters to prevent XSS in dynamic content rendering.
   * @param {any} str 
   * @returns {string}
   */
  window.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  /**
   * Relative time formatter matching backend behavior.
   * @param {string|number|Date} dateStr 
   * @returns {string} e.g. "just now", "5 min ago", "2 hr ago", "3 day(s) ago", "15 Aug 2026"
   */
  window.timeAgo = function (dateStr) {
    if (!dateStr) return 'just now';
    const date = (dateStr instanceof Date) ? dateStr : new Date(dateStr);
    if (isNaN(date.getTime())) return 'just now';

    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
    if (diff < 604800) return Math.floor(diff / 86400) + ' day(s) ago';

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = String(date.getDate()).padStart(2, '0');
    const m = months[date.getMonth()];
    const y = date.getFullYear();
    return `${d} ${m} ${y}`;
  };

  /**
   * Render star rating icons with optional review count.
   * @param {number} rating - Average rating score (0 to 5)
   * @param {number|null} count - Total review count
   * @param {number} max - Max stars (default: 5)
   * @returns {string} HTML string of stars
   */
  window.starRatingHtml = function (rating, count, max = 5) {
    const rounded = Math.round(Number(rating) || 0);
    let html = '';
    for (let i = 1; i <= max; i++) {
      html += i <= rounded ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';
    }
    if (count !== undefined && count !== null && !isNaN(Number(count))) {
      const cnt = parseInt(count, 10);
      html += ` <span class="text-muted">(${cnt} review${cnt === 1 ? '' : 's'})</span>`;
    }
    return html;
  };

  // =========================================================================
  // 2. Fetch API Client (window.api)
  // =========================================================================

  async function handleApiResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    let data = null;

    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    } else {
      data = await response.text().catch(() => null);
    }

    if (!response.ok) {
      const errorMsg = (data && (data.error || data.message)) ||
                       (typeof data === 'string' && data.length > 0 && data) ||
                       `Request failed with status ${response.status} (${response.statusText})`;
      const error = new Error(errorMsg);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  function normalizeApiUrl(url) {
    if (!url || /^https?:\/\//i.test(url)) {
      return url;
    }

    const baseUrl = API_BASE_URL.replace(/\/api$/, '');
    const requestPath = url.startsWith('/') ? url : `/${url}`;
    return new URL(requestPath, `${baseUrl}/`).toString();
  }

  function getStorageStore(type = 'session') {
    try {
      const storage = type === 'session' ? window.sessionStorage : window.localStorage;
      if (!storage) return null;
      return storage;
    } catch (_) {
      return null;
    }
  }

  function readAuthState(key) {
    const stores = [getStorageStore('session'), getStorageStore('local')];
    for (const store of stores) {
      if (!store) continue;
      try {
        const value = store.getItem(key);
        if (value !== null && value !== undefined && value !== '') return value;
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  function writeAuthState(key, value) {
    const sessionStore = getStorageStore('session');
    if (!sessionStore) return;
    try {
      if (value === null || value === undefined) {
        sessionStore.removeItem(key);
      } else {
        sessionStore.setItem(key, value);
      }
    } catch (_) { /* ignore */ }
    if (window.localStorage) {
      try { window.localStorage.removeItem(key); } catch (_) {}
    }
  }

  function clearAuthState() {
    writeAuthState('auth_token', null);
    writeAuthState('current_user', null);
    if (window.localStorage) {
      try { window.localStorage.removeItem('auth_token'); window.localStorage.removeItem('current_user'); } catch (_) {}
    }
    if (window.sessionStorage) {
      try { window.sessionStorage.removeItem('auth_token'); window.sessionStorage.removeItem('current_user'); } catch (_) {}
    }
  }

  function getStoredAuthToken() {
    try {
      return readAuthState('auth_token') || '';
    } catch (_) {
      return '';
    }
  }

  function buildAuthHeaders(headers = {}) {
    const token = getStoredAuthToken();
    const nextHeaders = { ...headers };

    if (token && !nextHeaders.Authorization) {
      nextHeaders.Authorization = `Bearer ${token}`;
    }

    return nextHeaders;
  }

  window.api = {
    /**
     * Perform a GET request
     * @param {string} url 
     * @param {HeadersInit} [headers={}] 
     */
    async get(url, headers = {}) {
      const res = await fetch(normalizeApiUrl(url), {
        method: 'GET',
        credentials: 'include',
        headers: buildAuthHeaders({
          'Accept': 'application/json',
          ...headers
        })
      });
      return handleApiResponse(res);
    },

    /**
     * Perform a POST request with JSON body
     * @param {string} url 
     * @param {object} [data={}] 
     * @param {HeadersInit} [headers={}] 
     */
    async post(url, data = {}, headers = {}) {
      const res = await fetch(normalizeApiUrl(url), {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...headers
        }),
        body: JSON.stringify(data)
      });
      return handleApiResponse(res);
    },

    /**
     * Perform a PUT request with JSON body
     * @param {string} url 
     * @param {object} [data={}] 
     * @param {HeadersInit} [headers={}] 
     */
    async put(url, data = {}, headers = {}) {
      const res = await fetch(normalizeApiUrl(url), {
        method: 'PUT',
        credentials: 'include',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...headers
        }),
        body: JSON.stringify(data)
      });
      return handleApiResponse(res);
    },

    /**
     * Perform a DELETE request
     * @param {string} url 
     * @param {HeadersInit} [headers={}] 
     */
    async del(url, headers = {}) {
      const res = await fetch(normalizeApiUrl(url), {
        method: 'DELETE',
        credentials: 'include',
        headers: buildAuthHeaders({
          'Accept': 'application/json',
          ...headers
        })
      });
      return handleApiResponse(res);
    },

    /**
     * Perform a POST request with FormData (multipart/form-data)
     * @param {string} url 
     * @param {FormData} formData 
     * @param {HeadersInit} [headers={}] 
     */
    async postForm(url, formData, headers = {}) {
      const res = await fetch(normalizeApiUrl(url), {
        method: 'POST',
        credentials: 'include',
        headers: buildAuthHeaders({
          'Accept': 'application/json',
          ...headers
        }),
        body: formData
      });
      return handleApiResponse(res);
    },

    /**
     * Perform a PUT request with FormData (multipart/form-data)
     * @param {string} url 
     * @param {FormData} formData 
     * @param {HeadersInit} [headers={}] 
     */
    async putForm(url, formData, headers = {}) {
      const res = await fetch(normalizeApiUrl(url), {
        method: 'PUT',
        credentials: 'include',
        headers: buildAuthHeaders({
          'Accept': 'application/json',
          ...headers
        }),
        body: formData
      });
      return handleApiResponse(res);
    }
  };

  // =========================================================================
  // 3. Authentication & Navbar State Management
  // =========================================================================

  /** Cached user state */
  window.currentUser = null;

  /**
   * Check current user authentication status via backend API.
   * @returns {Promise<object|null>} The user object or null if not logged in
   */
  let authPromise = null;
  window.checkAuth = function () {
    if (authPromise) return authPromise;
    authPromise = (async () => {
      try {
        const token = readAuthState('auth_token');
        const savedUser = (() => {
          try {
            return JSON.parse(readAuthState('current_user') || 'null');
          } catch (_) {
            return null;
          }
        })();

        if (!token && !savedUser) {
          window.currentUser = null;
          return null;
        }

        if (!token && savedUser) {
          window.currentUser = savedUser;
          return savedUser;
        }

        const response = await window.api.get(`${API_BASE_URL}/auth/me`);
        const user = response?.user || (response?.user_id ? response : null) || savedUser;
        window.currentUser = user;
        if (user) {
          writeAuthState('current_user', JSON.stringify(user));
        }
        return user;
      } catch (error) {
        const savedUser = (() => {
          try {
            return JSON.parse(readAuthState('current_user') || 'null');
          } catch (_) {
            return null;
          }
        })();

        if (error?.status === 403 && error?.message?.includes('suspended')) {
          clearAuthState();
          window.showToast('danger', 'Your account has been suspended. Please contact an administrator.');
        }

        if (savedUser) {
          window.currentUser = savedUser;
          return savedUser;
        }

        window.currentUser = null;
        return null;
      }
    })();
    return authPromise;
  };

  /**
   * Enforce page authentication and authorization.
   * Redirects to login if unauthenticated, or to 403 if role mismatch.
   * @param {string|string[]} [requiredRole] Role or array of allowed roles (e.g. 'admin', ['lecturer', 'admin'])
   * @returns {Promise<object>} Authenticated user object
   */
  window.requireAuth = async function (requiredRole) {
    const user = await window.checkAuth();
    const currentPath = encodeURIComponent(window.location.pathname + window.location.search);

    if (!user) {
      window.location.href = `login.html?redirect=${currentPath}`;
      throw new Error('Authentication required');
    }

    if (requiredRole) {
      const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      if (!roles.includes(user.role_name)) {
        window.location.href = '403.html';
        throw new Error('Access denied: insufficient permissions');
      }
    }

    return user;
  };

  /**
   * Update navbar elements dynamically according to authentication state.
   * @param {object|null} user 
   */
  function getSavedUser() {
    try {
      return JSON.parse(readAuthState('current_user') || 'null');
    } catch (_) {
      return null;
    }
  }

  window.updateNavbar = function (user) {
    const guestNav = document.getElementById('nav-guest-actions') || document.querySelector('.nav-guest-actions');
    const userNav = document.getElementById('nav-user-actions') || document.querySelector('.nav-user-actions');
    const authContainer = document.getElementById('navbar-auth') || document.getElementById('auth-nav') || document.querySelector('.navbar-auth-section');
    const resolvedUser = user || getSavedUser();

    if (guestNav && userNav) {
      if (resolvedUser) {
        guestNav.classList.add('d-none');
        userNav.classList.remove('d-none');

        const userNameEl = userNav.querySelector('.nav-user-name') || document.getElementById('nav-user-name');
        if (userNameEl) {
          userNameEl.textContent = resolvedUser.first_name || resolvedUser.email || 'Account';
        }

        const userRoleEl = userNav.querySelector('.nav-user-role') || document.getElementById('nav-user-role');
        if (userRoleEl) {
          userRoleEl.textContent = (resolvedUser.role_name || '').toUpperCase();
        }

        const dashboardLink = userNav.querySelector('.nav-dashboard-link') || document.getElementById('nav-dashboard-link');
        if (dashboardLink && resolvedUser.role_name) {
          dashboardLink.setAttribute('href', `${encodeURIComponent(resolvedUser.role_name)}-dashboard.html`);
        }
      } else {
        guestNav.classList.remove('d-none');
        userNav.classList.add('d-none');
      }
    } else if (authContainer) {
      if (resolvedUser) {
        const role = resolvedUser.role_name || 'student';
        const dashboardHref = `${role}-dashboard.html`;
        const displayName = resolvedUser.first_name || resolvedUser.email || 'Account';

        authContainer.innerHTML = `
          <div class="d-flex align-items-center gap-2">
            <a href="notifications.html" class="nav-icon-btn position-relative" title="Notifications" id="nav-notifications-btn" aria-label="Notifications">
              <i class="bi bi-bell"></i>
              <span id="nav-unread-badge" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger d-none">0</span>
            </a>

            <div class="dropdown user-profile-dropdown">
              <button class="user-menu-button dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="User menu">
                <span class="user-avatar"><i class="bi bi-person-circle"></i></span>
                <span class="user-menu-label">${window.escapeHtml(displayName)}</span>
              </button>

              <ul class="dropdown-menu dropdown-menu-end user-menu-panel">
                <li><div class="dropdown-item-text user-menu-role">${window.escapeHtml(role.toUpperCase())}</div></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="${dashboardHref}"><i class="bi bi-speedometer2 me-2"></i>Dashboard</a></li>
                <li><a class="dropdown-item" href="profile.html"><i class="bi bi-person me-2"></i>Profile</a></li>
                <li><a class="dropdown-item" href="notifications.html"><i class="bi bi-bell me-2"></i>Notifications</a></li>
                <li><hr class="dropdown-divider"></li>
                <li>
                  <button class="dropdown-item text-danger" id="nav-logout-btn" type="button">
                    <i class="bi bi-box-arrow-right me-2"></i>Log out
                  </button>
                </li>
              </ul>
            </div>
          </div>
        `;
      } else {
        authContainer.innerHTML = `
          <a href="login.html" class="btn btn-outline-primary btn-auth">Log in</a>
          <a href="register.html" class="btn btn-gold btn-auth">Register</a>
        `;
      }
    }

    // Fetch notifications unread badge if logged in
    if (user) {
      window.api.get(`${API_BASE_URL}/notifications/unread-count`).then((res) => {
        const count = res?.unreadCount ?? res?.count ?? 0;
        const badges = document.querySelectorAll('#nav-unread-badge, .nav-unread-count, .unread-badge');
        badges.forEach((b) => {
          if (count > 0) {
            b.textContent = count;
            b.classList.remove('d-none');
          } else {
            b.classList.add('d-none');
          }
        });
      }).catch(() => {});
    }
  };

  // Global logout handler
  document.addEventListener('click', async function (e) {
    const logoutBtn = e.target.closest('#nav-logout-btn, .logout-btn, [data-action="logout"]');
    if (!logoutBtn) return;
    e.preventDefault();

    try {
      await window.api.post(`${API_BASE_URL}/auth/logout`, {});
    } catch (_) {}
    window.currentUser = null;
    clearAuthState();
    window.location.href = 'login.html';
  });

  // =========================================================================
  // 4. Dark / Light Mode Theme Engine
  // =========================================================================
  const THEME_KEY = 'athenaeum-theme';
  const root = document.documentElement;

  function applyTheme(theme) {
    root.setAttribute('data-bs-theme', theme);
    document.querySelectorAll('.theme-toggle-icon').forEach((icon) => {
      icon.className = 'theme-toggle-icon bi ' + (theme === 'dark' ? 'bi-sun-fill' : 'bi-moon-stars-fill');
    });
  }

  const savedTheme = localStorage.getItem(THEME_KEY) ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(savedTheme);

  document.addEventListener('click', function (e) {
    const toggle = e.target.closest('.theme-toggle-btn');
    if (!toggle) return;
    const next = root.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });

  // =========================================================================
  // 5. Toast Notifications System — call window.showToast('success', 'Saved!')
  // =========================================================================
  window.showToast = function (type, message) {
    let container = document.getElementById('toast-stack');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-stack';
      container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      container.style.zIndex = 1080;
      document.body.appendChild(container);
    }
    const iconMap = {
      success: 'bi-check-circle-fill',
      danger: 'bi-x-circle-fill',
      warning: 'bi-exclamation-triangle-fill',
      info: 'bi-info-circle-fill'
    };
    const bgMap = {
      success: 'text-bg-success',
      danger: 'text-bg-danger',
      warning: 'text-bg-warning',
      info: 'text-bg-primary'
    };
    const el = document.createElement('div');
    el.className = 'toast align-items-center border-0 ' + (bgMap[type] || 'text-bg-primary');
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<div class="d-flex"><div class="toast-body"><i class="bi ' + (iconMap[type] || 'bi-info-circle-fill') + ' me-2"></i>' +
      message + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    container.appendChild(el);

    if (window.bootstrap && window.bootstrap.Toast) {
      const toast = new bootstrap.Toast(el, { delay: 5000 });
      toast.show();
      el.addEventListener('hidden.bs.toast', () => el.remove());
    } else {
      // Fallback if bootstrap is not loaded
      el.style.display = 'block';
      setTimeout(() => el.remove(), 5000);
    }
  };

  // Auto-show any server-rendered or HTML data flash messages
  document.querySelectorAll('[data-flash]').forEach((node) => {
    window.showToast(node.dataset.flash, node.dataset.flashMessage || node.textContent);
  });

  // =========================================================================
  // 6. Interactive Form Helpers & UI Controls
  // =========================================================================

  // Password visibility toggle — any .toggle-password button next to an input
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.toggle-password');
    if (!btn) return;
    const input = document.querySelector(btn.dataset.target);
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = 'bi ' + (showing ? 'bi-eye' : 'bi-eye-slash');
    }
  });

  // Home search form redirect handler
  document.getElementById('home-search-form')?.addEventListener('submit', function (event) {
    const input = this.querySelector('input[name="q"]');
    const value = (input?.value || '').trim();
    if (!value) {
      event.preventDefault();
      return;
    }
    const target = new URL(this.action || (window.location.origin + '/library.html'));
    target.searchParams.set('q', value);
    window.location.assign(target.toString());
    event.preventDefault();
  });

  // Bootstrap client-side validation
  document.querySelectorAll('form.needs-validation').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!form.checkValidity()) {
        event.preventDefault();
        event.stopPropagation();
      }
      form.classList.add('was-validated');
    }, false);
  });

  // Generic "confirm before action" — add data-confirm="Delete this item?" to form or button
  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (form.dataset && form.dataset.confirm) {
      if (!window.confirm(form.dataset.confirm)) {
        e.preventDefault();
      }
    }
  });

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-confirm], a[data-confirm]');
    if (btn && btn.dataset.confirm) {
      if (!window.confirm(btn.dataset.confirm)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  });

  // Star rating interactive input
  function initStarInputs() {
    document.querySelectorAll('.star-input').forEach((wrap) => {
      if (wrap.dataset.initialized) return;
      wrap.dataset.initialized = 'true';

      const hidden = wrap.querySelector('input[type="hidden"]');
      const stars = Array.from(wrap.querySelectorAll('.bi'));
      function paint(value) {
        stars.forEach((s, idx) => {
          s.className = 'bi ' + (idx < value ? 'bi-star-fill' : 'bi-star');
        });
      }
      paint(parseInt(hidden?.value || '0', 10));
      stars.forEach((star, idx) => {
        star.addEventListener('click', () => {
          if (hidden) hidden.value = String(idx + 1);
          paint(idx + 1);
        });
        star.addEventListener('mouseenter', () => paint(idx + 1));
        star.addEventListener('mouseleave', () => paint(parseInt(hidden?.value || '0', 10)));
      });
    });
  }
  initStarInputs();
  window.initStarInputs = initStarInputs;

  // Live client-side filename preview for file inputs
  document.querySelectorAll('.file-input-preview').forEach((input) => {
    input.addEventListener('change', () => {
      const label = document.querySelector(input.dataset.previewTarget);
      if (label) {
        label.textContent = input.files.length ? input.files[0].name : 'No file selected';
      }
    });
  });

  // Admin scroll helpers
  document.addEventListener('click', function (e) {
    const button = e.target.closest('[data-scroll-target][data-scroll-action]');
    if (!button) return;

    const scrollTarget = button.dataset.scrollTarget;
    const action = button.dataset.scrollAction;
    
    // Handle window scrolling for grid layouts
    if (scrollTarget === 'window') {
      const top = action === 'bottom' ? document.body.scrollHeight : 0;
      window.scrollTo({ top, behavior: 'smooth' });
      return;
    }

    // Handle element scrolling
    const target = document.querySelector(scrollTarget);
    if (!target) return;
    const top = action === 'bottom' ? target.scrollHeight : 0;
    target.scrollTo({ top, behavior: 'smooth' });
  });

  // Handle login form submission
  document.addEventListener('submit', async function (event) {
    const uploadForm = event.target.closest('form.upload-form');
    if (uploadForm) {
      if (!uploadForm.checkValidity()) {
        event.preventDefault();
        event.stopPropagation();
        uploadForm.classList.add('was-validated');
        return;
      }

      event.preventDefault();
      const formData = new FormData(uploadForm);

      try {
        const response = await window.api.postForm(`${API_BASE_URL}/books`, formData);
        window.showToast('success', response?.message || 'Resource uploaded successfully.');
        setTimeout(() => {
          window.location.href = 'lecturer-my-resources.html';
        }, 700);
      } catch (error) {
        window.showToast('danger', error.message || 'Upload failed.');
      }
      return;
    }

    const form = event.target.closest('#login-form');
    if (!form) return;

    event.preventDefault();
    const errorBox = document.getElementById('login-error');
    if (errorBox) {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
    }

    const formData = new FormData(form);
    const payload = {
      email: (formData.get('email') || '').toString().trim(),
      password: (formData.get('password') || '').toString()
    };

    try {
      const response = await window.api.post(`${API_BASE_URL}/auth/login`, payload);
      if (response?.token) {
        writeAuthState('auth_token', response.token);
      }

      const user = response?.user || null;
      window.currentUser = user;
      if (user) {
        writeAuthState('current_user', JSON.stringify(user));
      }

      const redirectParam = new URLSearchParams(window.location.search).get('redirect');
      const fallbackPage = user?.role_name === 'admin'
        ? 'admin-dashboard.html'
        : user?.role_name === 'lecturer'
          ? 'lecturer-dashboard.html'
          : 'student-dashboard.html';

      window.location.href = redirectParam ? decodeURIComponent(redirectParam) : fallbackPage;
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error.message || 'Login failed.';
        errorBox.style.display = 'block';
      } else {
        window.showToast('danger', error.message || 'Login failed.');
      }
    }
  });

  // Handle registration form submission
  document.addEventListener('submit', async function (event) {
    const form = event.target.closest('form[action="/api/auth/register"]');
    if (!form) return;

    event.preventDefault();

    const errorBox = document.getElementById('register-error');
    if (errorBox) {
      errorBox.style.display = 'none';
      errorBox.textContent = '';
    }

    const formData = new FormData(form);
    const payload = {
      first_name: (formData.get('first_name') || '').toString().trim(),
      last_name: (formData.get('last_name') || '').toString().trim(),
      email: (formData.get('email') || '').toString().trim(),
      password: (formData.get('password') || '').toString(),
      password_confirm: (formData.get('password_confirm') || '').toString(),
      role: (formData.get('role') || '').toString().trim(),
      institution_id: (formData.get('institution_id') || '').toString().trim(),
      department: (formData.get('department') || '').toString().trim()
    };

    // Client-side validation
    if (!payload.first_name || !payload.last_name || !payload.email || !payload.password || !payload.role) {
      const msg = 'All required fields must be filled.';
      if (errorBox) {
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
      } else {
        window.showToast('danger', msg);
      }
      return;
    }

    if (payload.password.length < 8) {
      const msg = 'Password must be at least 8 characters.';
      if (errorBox) {
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
      } else {
        window.showToast('danger', msg);
      }
      return;
    }

    if (payload.password !== payload.password_confirm) {
      const msg = 'Passwords do not match.';
      if (errorBox) {
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
      } else {
        window.showToast('danger', msg);
      }
      return;
    }

    try {
      const response = await window.api.post(`${API_BASE_URL}/auth/register`, payload);
      window.showToast('success', 'Registration successful! Redirecting to login...');
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 1500);
    } catch (error) {
      const msg = error.message || 'Registration failed.';
      if (errorBox) {
        errorBox.textContent = msg;
        errorBox.style.display = 'block';
      } else {
        window.showToast('danger', msg);
      }
    }
  });

  // Auto-run auth check on page load. Render from saved user immediately so the
  // profile menu appears without waiting for the API, then refresh once server data arrives.
  function initializeNavbarAuth() {
    const hasNavbar = document.getElementById('auth-nav') || document.getElementById('navbar-auth') || document.getElementById('nav-guest-actions') || document.getElementById('nav-user-actions') || document.querySelector('.navbar-athenaeum');
    if (!hasNavbar) return;

    const savedUser = getSavedUser();
    if (savedUser) {
      window.updateNavbar(savedUser);
    } else {
      window.updateNavbar(null);
    }

    const authPromise = window.checkAuth();
    const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3000));
    Promise.race([authPromise, timeout]).then(user => {
      if (user) {
        window.updateNavbar(user);
      } else if (savedUser) {
        window.updateNavbar(savedUser);
      } else {
        window.updateNavbar(null);
      }
    }).catch(() => {
      window.updateNavbar(savedUser || null);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNavbarAuth);
  } else {
    initializeNavbarAuth();
  }

  // =========================================================================
  // 7. Shared rendering helpers for catalogue/dashboard pages
  // =========================================================================

  window.RESOURCE_TYPE_LABELS = {
    book: 'Book',
    lecture_note: 'Lecture Note',
    research_paper: 'Research Paper',
    assignment: 'Assignment',
    past_question: 'Past Examination Paper'
  };

  const RESOURCE_TYPE_ICONS = {
    book: 'bi-book',
    lecture_note: 'bi-journal-text',
    research_paper: 'bi-file-earmark-text',
    assignment: 'bi-clipboard-check',
    past_question: 'bi-file-earmark-ruled'
  };

  window.resourceTypeLabel = function (type) {
    return window.RESOURCE_TYPE_LABELS[type] || (type ? type.replace(/_/g, ' ') : 'Resource');
  };

  /** Read the current page's query string into a plain object. */
  window.getQueryParams = function () {
    return Object.fromEntries(new URLSearchParams(window.location.search).entries());
  };

  /** Build a URL against the current page with the given params merged in (falsy values removed). */
  window.buildQueryUrl = function (params) {
    const merged = { ...window.getQueryParams(), ...params };
    const search = new URLSearchParams();
    Object.keys(merged).forEach((key) => {
      if (merged[key] !== undefined && merged[key] !== null && merged[key] !== '') {
        search.set(key, merged[key]);
      }
    });
    const qs = search.toString();
    return window.location.pathname + (qs ? '?' + qs : '');
  };

  /** Render a single catalogue card for a book/resource returned by the /api/books endpoints. */
  window.renderBookCard = function (book) {
    const id = book.book_id;
    const cover = book.cover_image ? window.escapeHtml(book.cover_image) : '';
    const icon = RESOURCE_TYPE_ICONS[book.resource_type] || 'bi-journal-bookmark';
    const coverHtml = cover
      ? `<img src="${cover}" alt="${window.escapeHtml(book.title)} cover">`
      : `<i class="bi ${icon} cover-fallback"></i>`;
    const authors = book.authors ? window.escapeHtml(book.authors) : 'Unknown author';
    const callNumber = book.category_slug ? book.category_slug.toUpperCase() : window.resourceTypeLabel(book.resource_type).toUpperCase();

    return `
      <div class="catalog-card">
        <span class="catalog-tab"></span>
        <a href="book-details.html?id=${id}" class="cover-wrap">${coverHtml}</a>
        <div class="p-3">
          <span class="call-number">${window.escapeHtml(callNumber)}</span>
          <h3 class="card-title-book mt-2 mb-1">
            <a href="book-details.html?id=${id}" class="text-reset text-decoration-none">${window.escapeHtml(book.title)}</a>
          </h3>
          <div class="card-meta">${authors}</div>
          <div class="small mt-1">${window.starRatingHtml(book.avg_rating, book.review_count)}</div>
        </div>
      </div>
    `;
  };

  /** Render a Bootstrap empty-state block used across catalogue/list pages. */
  window.renderEmptyState = function (icon, message) {
    return `
      <div class="col-12 text-center py-5">
        <i class="bi ${icon} display-4 text-muted"></i>
        <p class="text-muted mt-3">${message}</p>
      </div>
    `;
  };

  /**
   * Render Bootstrap pagination markup into a container element.
   * @param {HTMLElement} container - element to receive the <ul class="pagination"> markup (a wrapping <nav> is added automatically if missing)
   * @param {{page:number, pages:number}} pagination
   */
  window.renderPagination = function (container, pagination) {
    if (!container) return;
    const { page, pages } = pagination || {};
    if (!pages || pages <= 1) {
      container.innerHTML = '';
      return;
    }
    const items = [];
    items.push(`<li class="page-item ${page <= 1 ? 'disabled' : ''}"><a class="page-link" href="${window.buildQueryUrl({ page: page - 1 })}">Previous</a></li>`);
    for (let i = 1; i <= pages; i++) {
      items.push(`<li class="page-item ${i === page ? 'active' : ''}"><a class="page-link" href="${window.buildQueryUrl({ page: i })}">${i}</a></li>`);
    }
    items.push(`<li class="page-item ${page >= pages ? 'disabled' : ''}"><a class="page-link" href="${window.buildQueryUrl({ page: page + 1 })}">Next</a></li>`);
    container.innerHTML = `<ul class="pagination justify-content-center">${items.join('')}</ul>`;
  };

})();
