/* HUBBLE v15 — my contacts and groups (rows / squares, group card, who is near) */
H.pillsNav = active => {
  const un = (H.me && H.me.unread) || 0;
  /* the pill of the current screen is always first = on the right (RTL); the other one, to jump to, is on the left */
  const pc = '<button class="chip2 ' + (active === 'contacts' ? 'on' : '') + '" data-nav="contacts">אנשי הקשר שלי</button>';
  const pm = '<button class="chip2 ' + (active === 'messages' ? 'on' : '') + '" data-nav="messages">הודעות פרטיות<span class="badge ' + (un ? '' : 'hidden') + '" data-unread>' + un + '</span></button>';
  return '<div class="pills2">' + (active === 'messages' ? pm + pc : pc + pm) + '</div>';
};
H.wirePills = root => H.$$('[data-nav]', root).forEach(b => b.onclick = () => { if (b.dataset.nav !== H.screen) H.go(b.dataset.nav); });

H.routes.contacts = async (p, root) => {
  const esc = H.esc;
  await H.refreshMe();
  const w = H.el('<div class="screen"></div>'); root.appendChild(w);
  const bar = H.topbar({ title: H.pillsNav('contacts') }); w.appendChild(bar); H.wirePills(bar);
  const grid = H.el(`<div class="two-col cts" id="cGrid">
    <div class="glass" id="pList">
      <div class="tabsr"><div class="pills2" style="justify-content:flex-start"><button class="chip2 on" data-t="contacts">אנשי קשר</button><button class="chip2" data-t="groups">קבוצות</button></div><span class="sp"></span>
        <button class="t-icon-btn" id="cVg" title="ריבועים">${H.ic('grid', 18)}</button><button class="t-icon-btn" id="cVl" title="שורות">${H.ic('list', 18)}</button>
        <button class="fab" id="cNewGrp" title="קבוצה חדשה" style="width:42px;height:42px">${H.ic('plus', 22)}</button></div>
      <input class="search" id="cQ" type="text" placeholder="חיפוש לפי שם, חברה, האב, קבוצה או מלל חופשי">
      <div class="fbar" id="cSort" style="margin:0 0 8px"><span class="pill active" data-s="all">הכל</span><span class="pill" data-s="active">פעילים עכשיו</span><span class="pill" data-s="near">קרובים</span></div>
      <div class="list" id="cRows"></div></div>
    <div class="glass" id="pDet"><button class="back" id="cBack">→ חזרה לרשימה</button><div id="cDet"><div class="empty">בחר איש קשר או קבוצה</div></div></div></div>`);
  w.appendChild(grid);
  let tab = 'contacts', q = '', contacts = [], groups = [], sel = null, sort = 'all', pos = null;
  let hideMembers = false, nearState = null;   // nearState: {range, members} after "מי לידי"
  const viewKey = () => tab === 'groups' ? 'groups_view' : 'contacts_view';
  const isGrid = () => H.pref(viewKey()) === 'grid';
  const stateOf = c => !c.open ? { t: 'לא ניתן לאתר', on: false } : c.state === 'hub' ? { t: 'בהאב: ' + c.now_hub, on: true } : c.state === 'home' ? { t: 'פעיל', on: true } : { t: 'כבוי', on: false };
  const stt = c => { const s = stateOf(c); return '<span class="stt ' + (s.on ? 'on' : '') + '"><i></i>' + esc(s.t) + '</span>'; };
  const zoomAv = (photo, name, id, cls) => photo ? '<div class="av ' + (cls || '') + ' zoomable" data-zoom="' + esc(photo) + '" style="background-image:url(\'' + esc(photo) + '\')"></div>' : H.avatar('', name, id, cls);

  async function load() {
    const qs = pos && sort === 'near' ? '?lat=' + pos.lat + '&lng=' + pos.lng : '';
    [contacts, groups] = await Promise.all([H.get('/api/contacts' + qs), H.get('/api/contact-groups')]);
    renderList(); if (sel) renderDet();
  }
  function syncToggle() {
    H.$('#cVg', grid).classList.toggle('on', isGrid()); H.$('#cVl', grid).classList.toggle('on', !isGrid());
    grid.classList.toggle('wide', isGrid());
    H.$('#cSort', grid).classList.toggle('hidden', tab !== 'contacts');
  }
  function sortedContacts(list) {
    const l = list.slice();
    if (sort === 'active') return l.filter(c => c.open && c.state !== 'off').sort((a, b) => (b.state === 'hub') - (a.state === 'hub'));
    if (sort === 'near') return l.filter(c => c.dist != null).sort((a, b) => a.dist - b.dist);
    return l;
  }
  function renderList() {
    syncToggle();
    const box = H.$('#cRows', grid); box.innerHTML = ''; const ql = q.toLowerCase();
    box.className = 'list' + (isGrid() ? ' cgrid4' : ''); box.style.display = isGrid() ? 'grid' : ''; box.style.alignContent = 'start';
    if (tab === 'contacts') {
      const list = sortedContacts(contacts.filter(c => !ql || (c.name + ' ' + c.company + ' ' + c.desc + ' ' + c.hub_name + ' ' + c.groups.map(g => g.name).join(' ')).toLowerCase().includes(ql)));
      list.forEach(c => {
        const act = sel && sel.type === 'c' && sel.id === c.id;
        const el = H.el(isGrid()
          ? `<div class="ctile ${act ? 'act' : ''}">${H.avatar(c.photo, c.name, c.user_id)}<b>${esc(c.name)}</b>${stt(c)}</div>`
          : `<div class="r ${act ? 'act' : ''}">${H.avatar(c.photo, c.name, c.user_id)}<div class="info"><div class="n">${esc(c.name)}</div><div class="l">${esc(c.desc || c.company)}</div></div><div class="ind">${stt(c)}${c.dist != null ? '<span class="st">' + (c.dist < 1000 ? c.dist + ' מ\'' : (c.dist / 1000).toFixed(1) + ' ק"מ') + '</span>' : ''}</div></div>`);
        el.onclick = () => { sel = { type: 'c', id: c.id }; grid.classList.add('det'); renderList(); renderDet(); };
        box.appendChild(el);
      });
      if (!list.length) { box.style.display = ''; box.innerHTML = '<div class="empty">' + (sort === 'near' && !pos ? 'כדי לראות מי קרוב יש לאשר גישה למיקום' : sort === 'near' ? 'אין אנשי קשר קרובים כרגע (המידע זמין רק למי שהאפליקציה פתוחה אצלו)' : q || sort !== 'all' ? 'לא נמצאו אנשי קשר' : 'אין לך אנשי קשר. שמור אנשים מתוך האב') + '</div>'; }
    } else {
      const list = groups.filter(g => !ql || g.name.toLowerCase().includes(ql));
      list.forEach(g => {
        const act = sel && sel.type === 'g' && sel.id === g.id;
        const live = g.contact_ids.map(id => contacts.find(c => c.id === id)).filter(c => c && c.open && c.state !== 'off').length;
        const icon = g.image ? '<div class="av" style="border-radius:12px;background-image:url(\'' + esc(g.image) + '\')"></div>' : '<span class="av" style="background:#8e5bd8;border-radius:12px">' + H.ic('users', 18) + '</span>';
        const el = H.el(isGrid()
          ? `<div class="ctile ${act ? 'act' : ''}">${g.image ? '<div class="av gtile-av" style="margin:0 auto 6px;width:54px;height:54px;border-radius:12px;background-image:url(\'' + esc(g.image) + '\')"></div>' : '<span class="av" style="background:#8e5bd8;border-radius:12px;margin:0 auto 6px;width:54px;height:54px">' + H.ic('users', 22) + '</span>'}<b>${esc(g.name)}</b><span class="stt ${live ? 'on' : ''}"><i></i>${live} פעילים</span></div>`
          : `<div class="r ${act ? 'act' : ''}">${icon}<div class="info"><div class="n">${esc(g.name)}</div><div class="l">${esc(g.description || g.contact_ids.length + ' אנשי קשר')}</div></div><span class="stt ${live ? 'on' : ''}"><i></i>${live} פעילים</span></div>`);
        el.onclick = () => { sel = { type: 'g', id: g.id }; nearState = null; hideMembers = false; grid.classList.add('det'); renderList(); renderDet(); };
        box.appendChild(el);
      });
      if (!list.length) { box.style.display = ''; box.innerHTML = '<div class="empty">אין קבוצות. לחץ על ה-+ ליצירת קבוצה</div>'; }
    }
  }

  function memberHtml(list, extra) {
    if (!list.length) return '<div class="empty">אין חברים להצגה</div>';
    return isGrid() && tab === 'groups'
      ? '<div class="cgrid4">' + list.map(m => `<div class="ctile" data-id="${m.id}">${H.avatar(m.photo, m.name, m.user_id)}<b>${esc(m.name)}</b>${stt(m)}</div>`).join('') + '</div>'
      : list.map(m => `<div class="r" data-id="${m.id}" style="cursor:default">${H.avatar(m.photo, m.name, m.user_id, 'sm')}<div class="info"><div class="n">${esc(m.name)}</div></div>${stt(m)}${extra ? extra(m) : ''}</div>`).join('');
  }

  async function renderDet() {
    const box = H.$('#cDet', grid);
    if (!sel) { box.innerHTML = '<div class="empty">בחר איש קשר או קבוצה</div>'; return; }
    if (sel.type === 'c') {
      const c = contacts.find(x => x.id === sel.id); if (!c) { sel = null; return renderDet(); }
      let h = H.cardHtml({ ...(c.card || {}), id: c.user_id, display_name: c.name, photo_url: c.photo });
      h += '<div class="cv-row"><span>סטטוס כעת</span><span>' + esc(stateOf(c).t) + '</span></div>';
      if (c.hub_name) h += '<div class="cv-note">נשמר מההאב: ' + esc(c.hub_name) + '</div>';
      h += '<div class="grp">קבוצות</div>' + (groups.length ? groups.map(g => '<label class="r" style="cursor:pointer"><input type="checkbox" data-g="' + g.id + '" ' + (g.contact_ids.includes(c.id) ? 'checked' : '') + '><span class="n">' + esc(g.name) + '</span></label>').join('') : '<div class="note info">אין קבוצות עדיין</div>');
      h += '<div class="btn-row center" style="margin-top:14px"><button class="btn primary sm" id="dMsg" ' + (c.open ? '' : 'disabled') + '>שלח הודעה פרטית</button><button class="btn danger sm" id="dDel">הסר מאנשי הקשר</button></div>';
      box.innerHTML = h;
      H.$$('[data-g]', box).forEach(cb => cb.onchange = async () => { if (cb.checked) await H.post('/api/contact-groups/' + cb.dataset.g + '/members', { contact_ids: [c.id] }); else await H.del('/api/contact-groups/' + cb.dataset.g + '/members/' + c.id); load(); });
      H.$('#dMsg', box).onclick = () => H.go('messages', { open_user: c.user_id, from: 'contacts' });
      H.$('#dDel', box).onclick = async () => { if (await H.confirm('להסיר את ' + esc(c.name) + ' מאנשי הקשר?', 'הסרה', true)) { await H.del('/api/contacts/' + c.id); sel = null; grid.classList.remove('det'); load(); } };
    } else {
      const g = groups.find(x => x.id === sel.id); if (!g) { sel = null; return renderDet(); }
      const members = g.contact_ids.map(id => contacts.find(c => c.id === id)).filter(Boolean);
      const live = members.filter(m => m.open && m.state !== 'off').length;
      const icon = g.image ? '<div class="av zoomable" data-zoom="' + esc(g.image) + '" style="background-image:url(\'' + esc(g.image) + '\')"></div>' : '<span class="av" style="background:#8e5bd8">' + H.ic('users', 26) + '</span>';
      let h = `<div class="ghead">${icon}<div style="flex:1;min-width:0"><h3>${esc(g.name)}</h3>${g.description ? '<p>' + esc(g.description) + '</p>' : ''}</div>
        <button class="nav2" id="gHide">${H.ic(hideMembers ? 'eye' : 'eyeoff', 14)}<span>${hideMembers ? 'הצג אנשי הקבוצה' : 'הסתר אנשי הקבוצה'}</span></button></div>
        <p class="gstat">${members.length} חברים · ${live} פעילים עכשיו</p>
        <div class="btn-row"><button class="btn primary sm" id="gSendBtn">${H.ic('send', 14)} שלח הודעה לקבוצה</button><button class="btn sm" id="gWhere">${H.ic('pinloc', 14)} איפה הם עכשיו</button><button class="btn sm" id="gNear">${H.ic('walk', 14)} מי לידי</button></div>
        <div id="gExtra"></div>`;
      if (!hideMembers) {
        h += `<div class="tabsr" style="margin:10px 0 6px"><span class="sp"></span><button class="t-icon-btn ${isGrid() ? '' : 'on'}" id="gVl">${H.ic('list', 16)}</button><button class="t-icon-btn ${isGrid() ? 'on' : ''}" id="gVg">${H.ic('grid', 16)}</button></div>
        <div class="members">${memberHtml(members, m => '<button class="btn sm danger" data-rm="' + m.id + '">הסר</button>')}</div>`;
      }
      h += `<div class="btn-row center" style="margin-top:12px"><button class="btn sm" id="gEdit">עריכת קבוצה</button><button class="btn danger sm" id="gDel">מחק קבוצה</button></div>`;
      box.innerHTML = h;
      const ex = H.$('#gExtra', box);
      if (nearState) {
        ex.innerHTML = '<div class="range-row"><span class="hint" style="margin:0">טווח:</span>' + [[100, "100 מ'"], [500, "500 מ'"], [1000, '1 ק"מ'], [2000, '2 ק"מ']].map(r => '<button class="chip2 ' + (nearState.range === r[0] ? 'on' : '') + '" data-rg="' + r[0] + '">' + r[1] + '</button>').join('') +
          '</div><div class="warnnote">מידע המיקום מוגבל, לא תמיד מדויק ותלוי בהגדרות המכשיר ובכך שהאפליקציה פתוחה אצל המשתמשים.</div>' +
          (nearState.members.length ? nearState.members.map(m => '<div class="r" style="cursor:default">' + H.avatar(m.photo, m.name, m.user_id, 'sm') + '<div class="info"><div class="n">' + esc(m.name) + '</div><div class="l">' + (m.state === 'hub' ? 'בהאב: ' + esc(m.hub_name) + ' · ' : '') + (m.dist < 1000 ? m.dist + ' מ\'' : (m.dist / 1000).toFixed(1) + ' ק"מ') + '</div></div></div>').join('') : '<div class="empty">אף אחד מהקבוצה לא בטווח כרגע</div>');
        H.$$('[data-rg]', ex).forEach(b => b.onclick = () => near(+b.dataset.rg));
      }
      H.$$('[data-rm]', box).forEach(b => b.onclick = async () => { await H.del('/api/contact-groups/' + g.id + '/members/' + b.dataset.rm); load(); });
      H.$('#gHide', box).onclick = () => { hideMembers = !hideMembers; renderDet(); };
      const vg = H.$('#gVg', box), vl = H.$('#gVl', box);
      if (vg) { vg.onclick = () => { H.setPref('groups_view', 'grid'); tab === 'groups' && renderList(); renderDet(); }; vl.onclick = () => { H.setPref('groups_view', 'list'); tab === 'groups' && renderList(); renderDet(); }; }
      H.$('#gSendBtn', box).onclick = () => groupMsg(g);
      H.$('#gWhere', box).onclick = async () => { nearState = null; const r = await H.get('/api/contact-groups/' + g.id + '/where'); ex.innerHTML = '<div class="where">' + (r.map(x => '<div><b>' + esc(x.name) + ':</b> ' + esc(x.label) + '</div>').join('') || '<div>אין חברים</div>') + '</div>'; };
      H.$('#gNear', box).onclick = () => near(nearState ? nearState.range : 500);
      H.$('#gEdit', box).onclick = () => groupDialog(g);
      H.$('#gDel', box).onclick = async () => { if (await H.confirm('למחוק את הקבוצה "' + esc(g.name) + '"? אנשי הקשר יישארו.', 'מחיקה', true)) { await H.del('/api/contact-groups/' + g.id); sel = null; grid.classList.remove('det'); load(); } };
    }
  }

  async function near(range) {
    const g = groups.find(x => x.id === sel.id); if (!g) return;
    const here = await H.reportLocation(true);
    if (!here) return H.toast('לא הצלחנו לאתר אותך. אשר גישה למיקום בדפדפן ונסה שוב');
    try { const r = await H.get('/api/contact-groups/' + g.id + '/near?lat=' + here.lat + '&lng=' + here.lng + '&range=' + range); nearState = r; renderDet(); } catch (e) { H.toast(e.message); }
  }

  function groupMsg(g) {
    return H.go('messages', { open_group: g.id });
    let att = '';
    const body = H.el('<div><textarea class="field-in" id="gmText" placeholder="כתוב הודעה לכל חברי הקבוצה (כל אחד יקבל אותה בהודעה פרטית, בשם הקבוצה)..." style="min-height:90px"></textarea>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:8px"><label class="btn sm">' + H.ic('clip', 14) + ' צרף תמונה<input type="file" id="gmImg" accept="image/*" hidden></label><span id="gmAtt" class="small"></span></div></div>');
    H.$('#gmImg', body).onchange = async e => { att = await H.readImage(e.target.files[0], 900); e.target.value = ''; H.$('#gmAtt', body).innerHTML = att ? '<img src="' + esc(att) + '" style="max-height:40px;border-radius:6px;vertical-align:middle"> מצורפת' : ''; };
    H.modal({
      title: 'הודעה לקבוצה "' + esc(g.name) + '"', body, actions: [{ label: 'ביטול' }, {
        label: 'שלח', cls: 'primary', onClick: async () => {
          const text = H.$('#gmText', body).value.trim(); if (!text && !att) { H.toast('נא להזין הודעה'); return false; }
          try { const r = await H.post('/api/contact-groups/' + g.id + '/message', { text, image: att }); H.toast('נשלח ל-' + r.sent + ' אנשים' + (r.skipped ? ' (' + r.skipped + ' דולגו — סגורים לתקשורת)' : '')); } catch (e) { H.toast(e.message); return false; }
        }
      }]
    });
  }

  /* create / edit a group: name required, description + picture optional */
  function groupDialog(g) {
    let img = g ? g.image : '';
    const body = H.el('<div><input class="field-in" id="gdName" type="text" placeholder="שם הקבוצה (חובה)" style="margin-bottom:8px"><input class="field-in" id="gdDesc" type="text" placeholder="תיאור (לא חובה)" style="margin-bottom:8px">' +
      '<div style="display:flex;gap:10px;align-items:center"><label class="btn sm">' + H.ic('img', 14) + ' תמונה (לא חובה)<input type="file" id="gdImg" accept="image/*" hidden></label><span id="gdPrev"></span></div><div class="err" id="gdErr"></div></div>');
    H.$('#gdName', body).value = g ? g.name : ''; H.$('#gdDesc', body).value = g ? g.description : '';
    const prev = () => { H.$('#gdPrev', body).innerHTML = img ? '<img src="' + esc(img) + '" style="height:42px;border-radius:8px;vertical-align:middle">' : ''; }; prev();
    H.$('#gdImg', body).onchange = async e => { img = await H.readImage(e.target.files[0], 500); e.target.value = ''; prev(); };
    H.modal({
      title: g ? 'עריכת קבוצה' : 'קבוצה חדשה', body, actions: [{ label: 'ביטול' }, {
        label: g ? 'שמור' : 'צור קבוצה', cls: 'primary', onClick: async () => {
          const name = H.$('#gdName', body).value.trim(); if (!name) { H.$('#gdErr', body).textContent = 'שם הקבוצה הוא שדה חובה'; return false; }
          const d = { name, description: H.$('#gdDesc', body).value.trim(), image: img };
          try {
            if (g) { await H.put('/api/contact-groups/' + g.id, d); await load(); }
            else { const ng = await H.post('/api/contact-groups', d); tab = 'groups'; H.$$('[data-t]', grid).forEach(x => x.classList.toggle('on', x.dataset.t === 'groups')); sel = { type: 'g', id: ng.id }; nearState = null; grid.classList.add('det'); await load(); }
          } catch (e) { H.$('#gdErr', body).textContent = e.message; return false; }
        }
      }]
    });
  }

  H.$$('[data-t]', grid).forEach(pl => pl.onclick = () => { tab = pl.dataset.t; sel = null; grid.classList.remove('det'); H.$$('[data-t]', grid).forEach(x => x.classList.toggle('on', x === pl)); H.$('#cDet', grid).innerHTML = '<div class="empty">בחר איש קשר או קבוצה</div>'; renderList(); });
  H.$$('#cSort .pill', grid).forEach(pl => pl.onclick = async () => {
    sort = pl.dataset.s; H.$$('#cSort .pill', grid).forEach(x => x.classList.toggle('active', x === pl));
    if (sort === 'near') pos = await H.reportLocation(true);
    await load();
  });
  H.$('#cVg', grid).onclick = () => { H.setPref(viewKey(), 'grid'); renderList(); };
  H.$('#cVl', grid).onclick = () => { H.setPref(viewKey(), 'list'); renderList(); };
  H.$('#cQ', grid).oninput = e => { q = e.target.value.trim(); renderList(); };
  H.$('#cBack', grid).onclick = () => grid.classList.remove('det');
  H.$('#cNewGrp', grid).onclick = () => groupDialog(null);
  H.onSock('private_message', () => load());
  await load();
};
