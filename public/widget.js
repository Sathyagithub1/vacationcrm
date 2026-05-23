(function() {
  'use strict';
  var script = document.currentScript;
  var tenant = script.getAttribute('data-tenant');
  var dept = script.getAttribute('data-dept');
  var theme = script.getAttribute('data-theme') || 'auto';
  if (!tenant || !dept) return;

  var baseUrl = script.src.replace('/widget.js', '');
  var isOpen = false;
  var iframe = null;
  var unread = 0;

  // Create floating button
  var btn = document.createElement('div');
  btn.id = 'hd-widget-btn';
  btn.setAttribute('role', 'button');
  btn.setAttribute('tabindex', '0');
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="white" aria-hidden="true"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;background:#FF6B35;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:999998;transition:transform 0.2s;';
  btn.onmouseenter = function() { btn.style.transform = 'scale(1.1)'; };
  btn.onmouseleave = function() { btn.style.transform = 'scale(1)'; };

  // Unread badge
  var badge = document.createElement('div');
  badge.setAttribute('aria-live', 'polite');
  badge.setAttribute('aria-label', 'Unread messages');
  badge.style.cssText = 'position:absolute;top:-2px;right:-2px;width:20px;height:20px;border-radius:50%;background:#e53935;color:white;font-size:12px;display:none;align-items:center;justify-content:center;font-family:sans-serif;';
  btn.appendChild(badge);

  btn.onclick = function() {
    if (isOpen) { closeWidget(); } else { openWidget(); }
  };

  btn.onkeydown = function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      btn.onclick();
    }
  };

  document.body.appendChild(btn);

  function openWidget() {
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.src = baseUrl + '/widget/chat?tenant=' + encodeURIComponent(tenant) + '&dept=' + encodeURIComponent(dept) + '&theme=' + encodeURIComponent(theme);
      iframe.style.cssText = 'position:fixed;bottom:90px;right:20px;width:380px;height:560px;border:none;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);z-index:999999;transition:opacity 0.2s;';
      iframe.allow = 'clipboard-read; clipboard-write';
      iframe.setAttribute('title', 'Holiday Delight Chat');
      document.body.appendChild(iframe);
      checkMobile();
    }
    iframe.style.display = 'block';
    isOpen = true;
    unread = 0;
    badge.style.display = 'none';
    badge.textContent = '';
    btn.setAttribute('aria-label', 'Close chat');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="white" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    btn.appendChild(badge);
  }

  function closeWidget() {
    if (iframe) iframe.style.display = 'none';
    isOpen = false;
    btn.setAttribute('aria-label', 'Open chat');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="white" aria-hidden="true"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';
    btn.appendChild(badge);
  }

  // Listen for messages from iframe
  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'hd-widget-close') closeWidget();
    if (e.data.type === 'hd-widget-unread') {
      if (!isOpen) {
        unread++;
        badge.textContent = unread > 9 ? '9+' : String(unread);
        badge.style.display = 'flex';
      }
    }
    if (e.data.type === 'hd-widget-theme' && e.data.color) {
      btn.style.background = e.data.color;
    }
  });

  // Auto-open support
  var autoDelay = parseInt(script.getAttribute('data-auto-open') || '0', 10);
  if (autoDelay > 0) {
    setTimeout(openWidget, autoDelay);
  }

  // Mobile responsive: full screen on small viewports
  function checkMobile() {
    if (!iframe) return;
    if (window.innerWidth <= 480) {
      iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:none;border-radius:0;z-index:999999;';
    } else {
      iframe.style.cssText = 'position:fixed;bottom:90px;right:20px;width:380px;height:560px;border:none;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.15);z-index:999999;';
    }
  }
  window.addEventListener('resize', checkMobile);
})();
