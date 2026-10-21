/* HUBBLE v15 — home: hub list, search, filters, create menu, share, enter */
H.routes.home = async (p, root) => {
  await H.refreshMe();
  const me = H.me;
  const w = H.el('<div class="screen"></div>');
  w.appendChild(H.topbar({ home: true }));
  const noCard = !me.active_card;
  const lay = H.el(`<div class="main-layout">
    <div class="content">
      <div class="search-cluster">
        <button class="fab" id="hmNew" title="פתיחת האב חדש">${H.ic('plus', 28)}</button>
        <div class="sbox">
          <input class="search" id="hmQ" type="text" placeholder="חיפוש האב לפי שם, מספר או בעל ההאב">
          <div class="fbar" id="hmFilters" style="margin:10px 0 0">
            <span class="pill active" data-f="all">הכל</span><span class="pill" data-f="favorites">מועדפים</span>
            <span class="pill" data-f="near">קרובים</span><span class="pill" data-f="mine">שלי</span><span class="sp"></span>
            <button class="t-icon-btn" id="hmVg" title="ריבועים">${H.ic('grid', 18)}</button><button class="t-icon-btn" id="hmVl" title="שורות">${H.ic('list', 18)}</button>
          </div>
        </div>
      </div>
      <div id="hmList"></div>
    </div>
    <div class="sidebar">
      <div class="nav-item ${noCard ? 'blink' : ''}" id="nvCards"><span class="nl">${H.ic('cards', 20)}<span>הכרטיסים שלי</span></span></div>
      ${noCard ? '<div class="note" style="margin:0 4px">אנא הגדר כרטיס אישי</div>' : ''}
      <div class="nav-item" id="nvMsgs"><span class="nl">${H.ic('mail', 20)}<span>הודעות פרטיות שלי</span></span><span class="badge ${me.unread ? '' : 'hidden'}" data-unread>${me.unread || 0}</span></div>
      <div class="nav-item" id="nvCts"><span class="nl">${H.ic('book', 20)}<span>אנשי הקשר שלי</span></span></div>
    </div>
  </div>`);
  w.appendChild(lay);
  root.appendChild(w);

  H.$('#nvCards', w).onclick = () => H.go('cards');
  H.$('#nvMsgs', w).onclick = () => H.go('messages');
  H.$('#nvCts', w).onclick = () => H.go('contacts');

  /* + menu */
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  H.$('#hmNew', w).onclick = e => {
    e.stopPropagation();
    if (menu) return closeMenu();
    menu = H.el(`<div class="newmenu"><button class="btn" data-t="social">חברתי</button><button class="btn" data-t="business">עסקי</button><button class="btn" data-t="professional">מקצועי</button></div>`);
    H.$('.search-cluster', w).appendChild(menu);
    H.$$('button', menu).forEach(b => b.onclick = () => {
      closeMenu();
      if (!H.me.cards_count) { H.toast('נא ליצור כרטיס אישי לפני פתיחת האב'); return H.go('cards'); }
      H.go('setup', { type: b.dataset.t });
    });
  };
  const docClick = () => closeMenu();
  document.addEventListener('click', docClick);

  /* list */
  let filter = 'all', q = '', pos = null, rows = [], timer = null, poll = null, nearRange = 1000;
  const actIcon = r => {
    if (r.is_published === false) return '<span class="draft-tag">טיוטה</span>';
    const n = r.level === 0 ? 1 : r.level === 1 ? 2 : 3;
    return '<span class="activity" title="' + (r.level === 0 ? 'פעילות קלה' : r.level === 1 ? 'פעילות בינונית' : 'פעילות גבוהה') + '">' +
      Array.from({ length: n }, () => '<span class="walker ' + (r.level === 2 ? 'fast' : '') + '" style="color:#8fd0ff;display:inline-flex">' + H.ic('walk', 17) + '</span>').join('') +
      '<span class="st">' + r.live_count + '</span></span>';
  };
  const GRAD = { professional: 'linear-gradient(135deg,#7864e6,#c4a9f0)', business: 'linear-gradient(135deg,#e8a33d,#f4d29a)', social: 'linear-gradient(135deg,#2fb36b,#7fd8b0)' };
  const picStyle = r => {
    const img = r.background_image_url || (r.logo_visible && r.logo_url) || '';
    return img ? 'background-image:url(\'' + H.esc(img) + '\')' : 'background:' + (GRAD[r.hub_type] || GRAD.social);
  };
  const view = () => H.pref('hubs_view') === 'grid' ? 'grid' : 'list';
  const syncToggle = () => { H.$('#hmVg', w).classList.toggle('on', view() === 'grid'); H.$('#hmVl', w).classList.toggle('on', view() === 'list'); };
  const render = () => {
    const box = H.$('#hmList', w);
    syncToggle();
    if (!rows.length) { box.innerHTML = '<div class="empty">' + (q || filter !== 'all' ? 'לא נמצאו האבים' : 'עדיין אין האבים. לחץ על ה-+ כדי לפתוח את הראשון') + '</div>'; return; }
    const grid = view() === 'grid';
    box.innerHTML = ''; box.className = grid ? 'hubs-grid' : 'hubs-list';
    rows.forEach(r => {
      const sub = [r.tagline && r.tagline_visible ? r.tagline : '', '#' + r.serial].filter(Boolean).join(' · ');
      const star = '<button class="star-mini" title="מועדף">' + H.starSvg(r.is_favorite) + '</button>';
      const more = r.is_mine ? '<button class="more-btn" title="ניהול ההאב">⋯</button>' : '';
      const el = H.el(grid
        ? `<div class="htile" data-id="${r.hub_id}"><h4>${H.esc(r.name)}</h4><div class="pic" style="${picStyle(r)}"><div class="shade"></div><div class="bot">${actIcon(r)}<span class="badge-type ${r.hub_type}">${H.typeLabel(r.hub_type)}</span></div></div>${more ? '<div style="text-align:center">' + more + '</div>' : ''}</div>`
        : `<div class="hrow" data-id="${r.hub_id}">${star}<div class="nm"><h4>${H.esc(r.name)}</h4><p>${H.esc(sub)}</p></div><div class="pic" style="${picStyle(r)}"></div><div class="ty"><span class="badge-type ${r.hub_type}">${H.typeLabel(r.hub_type)}</span><div>${r.is_published === false ? '<span class="draft-tag">טיוטה</span>' : actIcon(r)}</div></div>${more}</div>`);
      el.onclick = () => { if (r.is_published === false) return H.go('setup', { hub_id: r.hub_id, type: r.hub_type }); H.go('hub', { hub_id: r.hub_id }); };
      const sm = H.$('.star-mini', el); if (sm) sm.onclick = async e => { e.stopPropagation(); const res = await H.post('/api/hubs/' + r.hub_id + '/favorite'); r.is_favorite = res.is_favorite; if (filter === 'favorites') load(); else sm.innerHTML = H.starSvg(r.is_favorite); };
      const mb = H.$('.more-btn', el); if (mb) mb.onclick = e => { e.stopPropagation(); ownerMenu(r); };
      box.appendChild(el);
    });
  };
  const ownerMenu = r => {
    const body = H.el('<div class="btn-row center" style="flex-direction:column;align-items:stretch"></div>');
    body.innerHTML = '<button class="btn" data-a="manage">ניהול</button><button class="btn" data-a="edit">עריכה</button><button class="btn" data-a="share">שיתוף</button><button class="btn danger" data-a="close">סגירה</button>';
    const m = H.modal({ title: H.esc(r.name), body, actions: [{ label: 'סגור' }] });
    H.$$('[data-a]', body).forEach(b => b.onclick = () => { m.close(); act(b.dataset.a, r); });
  };
  const load = async () => {
    const qs = new URLSearchParams({ filter, q });
    if (pos) { qs.set('lat', pos.lat); qs.set('lng', pos.lng); }
    if (filter === 'near') qs.set('range', nearRange);
    try { rows = await H.get('/api/hubs?' + qs); render(); } catch (e) { H.toast(e.message); }
  };
  const act = async (a, r) => {
    if (a === 'enter') return H.go('hub', { hub_id: r.hub_id });
    if (a === 'manage') return H.go('manage', { hub_id: r.hub_id });
    if (a === 'edit') return H.go('setup', { hub_id: r.hub_id, type: r.hub_type });
    if (a === 'close') {
      if (await H.confirm('לסגור את ההאב "' + H.esc(r.name) + '"? כל הנוכחים יוצאו ממנו.', 'סגירת האב', true)) { await H.post('/api/hubs/' + r.hub_id + '/close'); load(); }
      return;
    }
    if (a === 'share') return H.shareFlow({ hub: { hub_id: r.hub_id, name: r.name, serial: r.serial } });
  };
  async function shareDialog(r) {
    const [cts, grs] = await Promise.all([H.get('/api/contacts'), H.get('/api/contact-groups')]);
    if (!cts.length) return H.toast('אין לך אנשי קשר');
    let h = '<p>בחר למי לשלוח הזמנה בהודעה פרטית:</p><div class="picker">';
    if (grs.length) h += '<div class="grp">קבוצות</div>' + grs.map(g => '<label class="r"><input type="checkbox" data-g="' + g.id + '"><span class="n">' + H.esc(g.name) + ' (' + g.contact_ids.length + ')</span></label>').join('');
    h += '<div class="grp">אנשי קשר</div>' + cts.map(c => '<label class="r"><input type="checkbox" data-c="' + c.id + '">' + H.avatar(c.photo, c.name, c.id, 'sm') + '<span class="n">' + H.esc(c.name) + '</span><span class="dot ' + (c.open ? 'g' : 'rd') + '"></span></label>').join('') + '</div>';
    H.modal({
      title: 'שיתוף ההאב "' + H.esc(r.name) + '"', body: h, actions: [{ label: 'ביטול' },
        {
          label: 'שלח הזמנה', cls: 'primary', onClick: async (close, box) => {
            const contact_ids = H.$$('[data-c]:checked', box).map(x => x.dataset.c), group_ids = H.$$('[data-g]:checked', box).map(x => x.dataset.g);
            if (!contact_ids.length && !group_ids.length) { H.toast('לא נבחרו נמענים'); return false; }
            try { const res = await H.post('/api/hubs/' + r.hub_id + '/share', { contact_ids, group_ids }); H.toast('ההזמנה נשלחה ל-' + res.sent + ' אנשים'); } catch (e) { H.toast(e.message); return false; }
          }
        }]
    });
  }
  H.$('#hmQ', w).oninput = e => { q = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(load, 250); };
  /* "קרובים": choose a search radius; the list depends on hub settings and the user's own location settings */
  async function nearMenu() {
    const body = H.el('<div><p style="margin:0 0 8px">בחר טווח חיפוש להאבים קרובים:</p><div class="range-row" id="nrChips"></div><div class="warnnote" style="margin-top:10px">הרשימה אינה מדויקת ותלויה בהגדרות ההאבים (רק האבים שהוגדר בהם מיקום) ובהגדרות המיקום של המשתמש עצמו.</div></div>');
    const chips = H.$('#nrChips', body);
    [[200, "200 מ'"], [1000, '1 ק"מ'], [2000, '2 ק"מ']].forEach(([v, l]) => { const c = H.el('<button class="chip2 ' + (v === nearRange ? 'on' : '') + '" data-r="' + v + '">' + l + '</button>'); c.onclick = () => { nearRange = v; H.$$('#nrChips .chip2', body).forEach(x => x.classList.toggle('on', x === c)); }; chips.appendChild(c); });
    return new Promise(res => H.modal({ title: 'האבים קרובים', body, onClose: () => res(false), actions: [{ label: 'ביטול', onClick: () => res(false) }, { label: 'הצג', cls: 'primary', onClick: () => res(true) }] }));
  }
  H.$$('#hmFilters .pill', w).forEach(pl => pl.onclick = async () => {
    const f = pl.dataset.f;
    if (f === 'near') {
      if (!(await nearMenu())) return;
      pos = await H.getPosition(8000);
      if (!pos) { H.toast('כדי לראות האבים קרובים יש לאשר גישה למיקום בדפדפן', 5000); if (!(await H.confirm('לא הצלחנו לאתר אותך. לנסות שוב ולאשר גישה למיקום?', 'נסה שוב'))) return; pos = await H.getPosition(10000); if (!pos) return H.toast('המיקום אינו זמין. בדוק את הגדרות המיקום של המכשיר'); }
    }
    filter = f;
    H.$$('#hmFilters .pill', w).forEach(x => x.classList.toggle('active', x === pl));
    load();
  });
  H.$('#hmVg', w).onclick = () => { H.setPref('hubs_view', 'grid'); render(); };
  H.$('#hmVl', w).onclick = () => { H.setPref('hubs_view', 'list'); render(); };
  H.onSock('hub_closed', load);
  H.onSock('private_message', () => { });
  load();
  poll = setInterval(load, 20000);
  H.cleanup = () => { clearInterval(poll); clearTimeout(timer); document.removeEventListener('click', docClick); };
};
