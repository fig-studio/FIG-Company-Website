/*
 * Email links ("Work With Us", "Start the Conversation", the address itself).
 *
 * A mailto: link opens the reader's mail app -- when they have one set up.
 * Many don't (they use webmail), and for them the click does nothing at all,
 * which reads as a broken button. So every mailto: click also copies the
 * address and says so. The link itself is left alone: whoever has a mail app
 * still gets it.
 *
 * Styled on its own, not with the page's tokens, so it looks the same on
 * every page that loads it.
 */
(function () {
  var toast, timer;

  function say(text) {
    if (!toast) {
      toast = document.createElement('div');
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:24px', 'z-index:9999',
        'max-width:calc(100vw - 32px)', 'padding:12px 18px',
        'background:#241f1a', 'color:#faf9f4', 'border-radius:10px',
        'box-shadow:0 12px 32px rgba(36,31,26,.25)',
        'font:500 15px/1.4 Inter,system-ui,-apple-system,sans-serif',
        'text-align:center', 'pointer-events:none',
        'opacity:0', 'transform:translate(-50%,8px)',
        'transition:opacity .18s ease-out,transform .18s ease-out'
      ].join(';');
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
      toast.style.transform = 'translate(-50%,0)';
    });
    clearTimeout(timer);
    timer = setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%,8px)';
    }, 3200);
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t);
      t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(t);
      ok ? resolve() : reject();
    });
  }

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="mailto:"]');
    if (!a) return;
    // The address alone, without ?subject= or any other part of the link.
    var address = decodeURIComponent(a.getAttribute('href').slice(7).split('?')[0]);
    if (!address) return;
    copy(address).then(
      function () { say(address + ' copied. Paste it into your email.'); },
      function () { say('Email us at ' + address); }
    );
  });
})();
