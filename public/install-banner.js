// "Add to Home Screen" banner, shown from the bottom after a fresh sign-in
// (and once on a device that has never seen it). Tells each device the way
// it actually installs a web app:
//   Android, desktop Chrome/Edge: a real Install button (beforeinstallprompt)
//   iPhone/iPad Safari: Share, then Add to Home Screen (iOS 26: ••• first)
//   Chrome/Firefox/Edge on iOS: Share in the address bar
//   In-app browsers (Instagram, Facebook, ...): open in Safari/Chrome first
//   Safari on Mac: File, then Add to Dock
// Never shows when the app is already running from the Home Screen.
//
//   InstallBanner.offer({ name, icon, above, fresh, theme })
//     above: selector of a bottom bar the banner should sit on top of
//     fresh: true right after a sign-in; false shows only if never seen
//   InstallBanner.markFresh(): before a sign-in that reloads the page
//     theme: { bg, ink, muted, line, accent, onAccent } CSS values
(function (root) {
  'use strict';
  const KEY = 'install-banner';
  const store = {
    get(k) { try { return localStorage.getItem(`${KEY}:${k}`); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(`${KEY}:${k}`, v); } catch {} },
  };
  let deferred = null, cur = null, el = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (cur) draw(); });
  addEventListener('appinstalled', () => { deferred = null; store.set('installed', '1'); if (cur) done(); });

  const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  function platform() {
    const ua = navigator.userAgent;
    const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ipad || /iPhone|iPod/.test(ua)) {
      if (/FBAN|FBAV|Instagram|LinkedInApp|Line\/|Twitter|MicroMessenger|Snapchat|GSA\//.test(ua)) return 'ios-inapp';
      if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 'ios-other';
      return ipad ? 'ipad' : 'iphone';
    }
    if (/Android/.test(ua)) {
      if (/; wv\)|FBAN|FBAV|Instagram|Line\//.test(ua)) return 'android-inapp';
      if (/SamsungBrowser/.test(ua)) return 'samsung';
      if (/Firefox/.test(ua)) return 'android-firefox';
      return 'android';
    }
    if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox|OPR/.test(ua)) return 'mac-safari';
    return 'desktop';
  }
  // Safari 26 tucks Share under the ••• button in the bottom bar.
  const safariMajor = () => Number((navigator.userAgent.match(/Version\/(\d+)/) || [])[1] || 0);

  const svg = (d, w = 16) => `<svg class="ib-i" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    share: svg('<path d="M8 8.5 12 4.5l4 4"/><path d="M12 4.5V15"/><path d="M8.5 10.5H7a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-1.5"/>'),
    add: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>'),
    more: svg('<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>'),
    kebab: svg('<circle cx="12" cy="6" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="18" r="1.2" fill="currentColor"/>'),
    menu: svg('<path d="M5 7h14M5 12h14M5 17h14"/>'),
    down: svg('<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>', 18),
    x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 18),
    check: svg('<path d="M5 12.5 10 17.5 19 7"/>', 18),
  };
  const b = (s) => `<b>${s}</b>`;

  /** What to say on this device, or null when it cannot be installed. */
  function copy(p, name) {
    const install = { title: `Install ${name}`, text: 'Opens full screen from your home screen, like an app.', button: true };
    switch (p) {
      case 'iphone': return safariMajor() >= 26
        ? { title: `Add ${name} to your Home Screen`, text: `Tap ${IC.more} below, then ${IC.share} ${b('Share')}, then ${IC.add} ${b('Add to Home Screen')}.`, arrow: 'right' }
        : { title: `Add ${name} to your Home Screen`, text: `Tap ${IC.share} ${b('Share')} below, then ${IC.add} ${b('Add to Home Screen')}.`, arrow: 'center' };
      case 'ipad': return { title: `Add ${name} to your Home Screen`, text: `Tap ${IC.share} ${b('Share')} at the top right, then ${IC.add} ${b('Add to Home Screen')}.` };
      case 'ios-other': return { title: `Add ${name} to your Home Screen`, text: `Tap ${IC.share} ${b('Share')} in the address bar, then ${IC.add} ${b('Add to Home Screen')}.` };
      case 'ios-inapp': return { title: `Get ${name} on your Home Screen`, text: `Open this page in ${b('Safari')} first (${IC.more} then Open in browser), then ${IC.share} Share, ${b('Add to Home Screen')}.` };
      case 'android-inapp': return { title: `Get ${name} on your home screen`, text: `Open this page in ${b('Chrome')} first (${IC.kebab} then Open in browser), then tap ${b('Install')}.` };
      case 'samsung': return deferred ? install : { title: `Add ${name} to your home screen`, text: `Tap ${IC.menu} at the bottom, then ${b('Add page to')} and ${b('Home screen')}.` };
      case 'android-firefox': return { title: `Add ${name} to your home screen`, text: `Tap ${IC.kebab} in the corner, then ${b('Add app to Home screen')}.` };
      case 'android': return deferred ? install : { title: `Add ${name} to your home screen`, text: `Tap ${IC.kebab} at the top right, then ${b('Install app')} or ${b('Add to Home screen')}.` };
      case 'mac-safari': return safariMajor() >= 17 ? { title: `Keep ${name} in your Dock`, text: `In the menu bar choose ${b('File')}, then ${b('Add to Dock')}.` } : null;
      default: return deferred ? { ...install, text: 'Opens in its own window, with an icon in your dock or taskbar.' } : null;
    }
  }

  const CSS = `
.ib{position:fixed;left:12px;right:12px;z-index:60;max-width:440px;margin:0 auto;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:start;padding:14px 12px 14px 14px;border-radius:18px;background:var(--ib-bg);color:var(--ib-ink);border:1px solid var(--ib-line);box-shadow:0 18px 40px -18px rgba(0,0,0,.45),0 2px 6px -2px rgba(0,0,0,.12);transform:translateY(calc(100% + 40px));opacity:0;transition:transform .42s cubic-bezier(.2,.8,.2,1),opacity .3s ease}
.ib.in{transform:none;opacity:1}
.ib img{width:44px;height:44px;border-radius:11px;display:block}
.ib h2{font-family:inherit;font-size:15px;line-height:1.25;font-weight:650;letter-spacing:-.01em;margin:1px 0 0}
.ib p{font-size:13.5px;line-height:1.45;color:var(--ib-muted);margin:4px 0 0}
.ib p b{color:var(--ib-ink);font-weight:600}
.ib .ib-i{display:inline-block;width:16px;height:16px;vertical-align:-3px;color:var(--ib-ink);flex:none}
.ib-x .ib-i,.ib-arrow .ib-i,.ib>.ib-i{width:18px;height:18px}
.ib-row{display:flex;gap:14px;align-items:center;margin-top:10px}
.ib-go{font:inherit;font-size:14px;font-weight:600;padding:8px 16px;border-radius:10px;border:0;background:var(--ib-accent);color:var(--ib-on-accent);cursor:pointer}
.ib-go:active{transform:scale(.98)}
.ib-never{font:inherit;font-size:12.5px;background:none;border:0;padding:4px 0;color:var(--ib-muted);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.ib-x{display:grid;place-items:center;width:32px;height:32px;margin:-6px -4px 0 0;border-radius:9px;border:0;background:none;color:var(--ib-muted);cursor:pointer}
.ib-x:hover{color:var(--ib-ink);background:var(--ib-line)}
.ib-arrow{position:absolute;bottom:-34px;color:var(--ib-accent);animation:ib-bob 1.4s ease-in-out infinite}
.ib-arrow.center{left:50%;margin-left:-9px}.ib-arrow.right{right:22px}
@keyframes ib-bob{50%{transform:translateY(5px)}}
@media (prefers-reduced-motion:reduce){.ib{transition:opacity .2s}.ib-arrow{animation:none}}`;

  function place() {
    if (!el) return;
    const bar = cur.above && document.querySelector(cur.above);
    const r = bar && bar.getBoundingClientRect();
    const gap = r && r.height ? innerHeight - r.top + 10 : 0;
    el.style.bottom = gap ? `${gap}px` : `calc(14px + env(safe-area-inset-bottom))`;
  }
  function draw() {
    const c = copy(platform(), cur.name);
    if (!c) return hide();
    if (!el) {
      if (!document.getElementById('ib-css')) { const s = document.createElement('style'); s.id = 'ib-css'; s.textContent = CSS; document.head.appendChild(s); }
      el = document.createElement('section');
      el.className = 'ib';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Install the app');
      const t = { bg: 'Canvas', ink: 'CanvasText', muted: 'GrayText', line: 'rgba(127,127,127,.22)', accent: '#2563eb', onAccent: '#fff', ...(cur.theme || {}) };
      for (const [k, v] of Object.entries(t)) el.style.setProperty(`--ib-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, v);
      el.addEventListener('click', onClick);
      document.body.appendChild(el);
      addEventListener('resize', place);
      requestAnimationFrame(() => requestAnimationFrame(() => el && el.classList.add('in')));
    }
    el.innerHTML = `${cur.icon ? `<img src="${cur.icon}" alt="">` : '<span></span>'}
      <div><h2>${c.title}</h2><p>${c.text}</p>
        <div class="ib-row">${c.button ? '<button type="button" class="ib-go" data-ib="go">Install</button>' : ''}<button type="button" class="ib-never" data-ib="never">Don't show again</button></div></div>
      <button type="button" class="ib-x" data-ib="close" aria-label="Not now">${IC.x}</button>
      ${c.arrow && !(cur.above && document.querySelector(cur.above)) ? `<span class="ib-arrow ${c.arrow}">${IC.down}</span>` : ''}`;
    place();
  }
  function hide() {
    if (!el) { cur = null; return; }
    const e = el; el = null; cur = null;
    removeEventListener('resize', place);
    e.classList.remove('in');
    setTimeout(() => e.remove(), 450);
  }
  function done() {
    if (!el) return;
    el.innerHTML = `<span class="ib-i" style="color:var(--ib-accent)">${IC.check}</span><div><h2>Installed</h2><p>Open it from your home screen from now on.</p></div><span></span>`;
    setTimeout(hide, 2600);
  }
  async function onClick(e) {
    const a = e.target.closest('[data-ib]'); if (!a) return;
    const act = a.dataset.ib;
    if (act === 'close') hide();
    else if (act === 'never') { store.set('never', '1'); hide(); }
    else if (act === 'go' && deferred) {
      const p = deferred; deferred = null;
      try { await p.prompt(); const r = await p.userChoice; if (r && r.outcome === 'accepted') return done(); } catch {}
      deferred = p;
    }
  }

  /** Call right after a sign-in when the page reloads before offer() runs. */
  function markFresh() { try { sessionStorage.setItem(`${KEY}:fresh`, '1'); } catch {} }
  function takeFresh() { try { const v = sessionStorage.getItem(`${KEY}:fresh`); sessionStorage.removeItem(`${KEY}:fresh`); return !!v; } catch { return false; } }

  function offer(opts) {
    opts = { ...opts, fresh: takeFresh() || !!opts.fresh };
    if (standalone() || store.get('never') || store.get('installed') || cur) return;
    if (!opts.fresh && store.get('seen')) return;
    const p = platform();
    // Chrome fires its install event a moment after load; give it a few seconds.
    const wait = (p === 'android' || p === 'samsung' || p === 'desktop') && !deferred ? 3500 : 1200;
    cur = opts;
    setTimeout(() => {
      if (cur !== opts || standalone()) return;
      if (!copy(p, opts.name)) { cur = null; return; }
      store.set('seen', String(Date.now()));
      draw();
    }, wait);
  }

  root.InstallBanner = { offer, hide, markFresh, platform };
})(window);
