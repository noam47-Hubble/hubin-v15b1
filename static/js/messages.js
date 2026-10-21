/* HUBBLE v15 — my private messages (tabs: contacts / groups) */
H.routes.messages = async (p, root) => {
  const esc = H.esc;
  const w = H.el('<div class="screen"></div>'); root.appendChild(w);
  const tbar = H.topbar({ title: H.pillsNav('messages') }); w.appendChild(tbar); H.wirePills(tbar);
  const grid = H.el(`<div class="two-col" id="mGrid">
    <div class="glass" id="pList"><div class="tabsr"><div class="pills2" style="justify-content:flex-start"><button class="chip2 on" data-mt="contacts">אנשי קשר<span class="badge hidden" id="mbC">0</span></button><button class="chip2" data-mt="groups">קבוצות<span class="badge hidden" id="mbG">0</span></button></div><span class="sp"></span><button class="t-icon-btn" id="mVg" title="ריבועים">${H.ic('grid', 18)}</button><button class="t-icon-btn" id="mVl" title="שורות">${H.ic('list', 18)}</button></div>
      <input class="search" id="mQ" type="text" placeholder="חיפוש לפי שם, שם האב, מספר האב או מלל חופשי"><div class="list" id="mRows"></div><div class="ext-msg"><button class="linkbtn" id="mExt" title="שליחת הודעה בווטסאפ או באפליקציה אחרת">שלח הודעה חיצונית</button></div></div>
    <div class="glass" id="pConv"><div class="empty" id="mEmpty">בחר שיחה מהרשימה</div></div>
    <div class="glass cardcol hidden" id="pCard"></div></div>`);
  w.appendChild(grid);
  H.suppressPmToast = true;

  let tab = 'contacts', grows = [], gcur = null, gcurRow = null, gmsgs = [], lastPrivate = null;
  let rows = [], cur = null, msgs = [], hasMore = false, other = null, att = '', q = '';
  const stateLabel = r => !r.open ? '' : r.state === 'hub' ? 'בהאב: ' + r.now_hub : r.state === 'home' ? 'פעיל' : 'כבוי';

  async function loadRows() {
    const res = await H.get('/api/messages?q=' + encodeURIComponent(q));
    rows = res.conversations; H.setUnread(res.unread);
    try { grows = await H.get('/api/messages/groups'); } catch (e) { grows = []; }
    const uc = rows.reduce((a, r) => a + (r.unread || 0), 0), ug = grows.reduce((a, r) => a + (r.unread || 0), 0);
    [['#mbC', uc], ['#mbG', ug]].forEach(([s, n]) => { const b = H.$(s, grid); b.textContent = n; b.classList.toggle('hidden', !n); });
    const box = H.$('#mRows', grid); box.innerHTML = '';
    const isG = H.pref('messages_view') === 'grid';
    H.$('#mVg', grid).classList.toggle('on', isG); H.$('#mVl', grid).classList.toggle('on', !isG);
    box.className = 'list' + (isG ? ' cgrid4' : ''); box.style.display = isG ? 'grid' : ''; box.style.alignContent = 'start';
    if (tab === 'groups') {
      const ql = q.toLowerCase();
      const list = grows.filter(r => !ql || (r.group_name + ' ' + r.last_text).toLowerCase().includes(ql));
      list.sort((a, b) => (b.key === gcur) - (a.key === gcur));   // the open group first
      list.forEach(r => {
        const pic = r.image ? 'background-image:url(\'' + esc(r.image) + '\');background-size:cover' : 'background:#8e5bd8';
        const el = isG ? H.el(`<div class="ctile ${gcur === r.key ? 'act' : ''}" style="position:relative;${gcur === r.key ? 'font-weight:700' : ''}">${r.image ? '<div class="av" style="margin:0 auto 6px;width:54px;height:54px;border-radius:12px;background-image:url(\'' + esc(r.image) + '\');background-size:cover"></div>' : '<span class="av" style="background:#8e5bd8;border-radius:12px;margin:0 auto 6px;width:54px;height:54px">' + H.ic('users', 22) + '</span>'}<b>${esc(r.group_name)}</b>${r.unread ? '<span class="badge" style="position:absolute;top:4px;inset-inline-start:4px">' + r.unread + '</span>' : ''}</div>`) : H.el(`<div class="r ${r.unread ? 'unread' : ''} ${gcur === r.key ? 'act' : ''}" style="${gcur === r.key ? 'font-weight:700' : ''}"><span class="av" style="${pic};border-radius:12px">${r.image ? '' : H.ic('users', 18)}</span><div class="info"><div class="n">${esc(r.group_name)}</div><div class="l">${r.last_sender ? esc(r.last_sender) + ': ' : ''}${esc(r.last_text)}</div></div><div class="ind">${r.unread ? '<span class="badge">' + r.unread + '</span>' : ''}</div></div>`);
        el.onclick = () => openGroup(r); box.appendChild(el);
      });
      if (!grows.length) box.innerHTML = '<div class="empty">אין עדיין קבוצות. פתח קבוצה באנשי הקשר</div>';
      return;
    }
    rows.forEach(r => {
      const label = r.last_text;
      const el = isG ? H.el(`<div class="ctile ${cur === r.user_id ? 'act' : ''}" data-id="${r.user_id}" style="position:relative">${H.avatar(r.photo, r.name, r.user_id)}<b>${esc(r.name)}</b><span class="stt ${r.open && r.state !== 'off' ? 'on' : ''}"><i></i>${esc(stateLabel(r) || (r.open ? '' : 'סגור'))}</span>${r.unread ? '<span class="badge" style="position:absolute;top:4px;inset-inline-start:4px">' + r.unread + '</span>' : ''}</div>`) : H.el(`<div class="r ${r.unread ? 'unread' : ''} ${cur === r.user_id ? 'act' : ''}" data-id="${r.user_id}">${H.avatar(r.photo, r.name, r.user_id)}
        <div class="info"><div class="n">${esc(r.name)}</div><div class="l">${esc(label)}</div></div>
        <div class="ind"><span class="stt ${r.open && r.state !== 'off' ? 'on' : ''}"><i></i>${esc(stateLabel(r) || (r.open ? '' : 'סגור'))}</span>${r.unread ? '<span class="badge">' + r.unread + '</span>' : ''}</div></div>`);
      el.onclick = () => openConv(r.user_id);
      box.appendChild(el);
    });
    if (q && res.contacts && res.contacts.length) {
      box.appendChild(H.el('<div class="sec-h"><span>אנשי קשר תואמים</span></div>'));
      res.contacts.forEach(c => {
        const el = H.el(`<div class="r">${H.avatar(c.photo, c.name, c.user_id)}<div class="info"><div class="n">${esc(c.name)}</div><div class="l">${esc(c.company || c.desc)}</div></div><div class="ind"><span class="dot ${c.open ? 'g' : 'rd'}"></span></div></div>`);
        el.onclick = () => openConv(c.user_id); box.appendChild(el);
      });
    }
    if (!rows.length && !(res.contacts || []).length) box.innerHTML = '<div class="empty">' + (q ? 'לא נמצאו הודעות' : 'אין עדיין הודעות פרטיות') + '</div>';
  }

  const bubble = m => {
    const cls = m.kind === 'system' ? 'sys' : m.mine ? 'out' : 'in';
    const label = m.kind === 'group' ? '<span class="gl">קבוצה: ' + esc(m.group_name) + (m.mine ? '' : ' · ' + esc(m.sender_name)) + '</span>' : '';
    const hubLink = m.hub_link_id ? '<br><a class="hublink" data-hub="' + m.hub_link_id + '">כניסה להאב ' + esc(m.hub_name) + '</a>' : (m.hub_name && m.kind !== 'system' ? '<small>' + esc(m.hub_name) + '</small>' : '');
    return `<div class="bub ${cls}" data-id="${m.id}">${label}${esc(m.text)}${m.image ? '<img src="' + esc(m.image) + '">' : ''}${m.file_name ? '<br><a class="fileln" href="/api/messages/' + m.id + '/file" download>📄 ' + esc(m.file_name) + '</a>' : ''}${hubLink}<small>${H.fmt(m.ts)}${m.mine ? ' · <a class="mdel" style="cursor:pointer">מחק</a>' : ''}</small></div>`;
  };

  function renderConv() {
    const box = H.$('#pConv', grid);
    const name = other ? other.name : '';
    const canMsg = other && other.can_message;
    box.innerHTML = `<button class="back" id="mBack">→ חזרה לרשימה</button>
      <div class="r" style="cursor:default;flex-wrap:nowrap" id="cvHead">${H.avatar(other && other.card && other.card.photo_url, name, cur)}<div class="info"><div class="n">${esc(name)}</div><div class="l">${other && other.open ? esc(stateLabel({ open: other.open, state: other.state, now_hub: other.hub_name })) : 'סגור לתקשורת'}</div></div></div>
      <div class="chat" id="cvChat">${hasMore ? '<button class="more" id="cvMore">הצג הודעות קודמות</button>' : ''}${msgs.map(bubble).join('') || '<div class="empty">אין עדיין הודעות בשיחה זו</div>'}</div>
      <div id="cvAtt" class="${att ? '' : 'hidden'}" style="font-size:12px">${att ? '<img src="' + esc(att) + '" style="max-height:44px;border-radius:6px"> <a id="cvAttRm" style="cursor:pointer;color:#ff9a9d">×</a>' : ''}</div>
      <div class="comp"><label class="cb" title="צרף תמונה">${H.ic('img', 20)}<input type="file" id="cvImg" accept="image/*" hidden></label><input type="text" id="cvIn" placeholder="${canMsg ? 'כתוב הודעה...' : ''}" ${canMsg ? '' : 'disabled'}><button class="btn primary sm" id="cvSend" ${canMsg ? '' : 'disabled'}>שלח</button></div>
      ${canMsg ? '' : '<div class="notice">' + (other && other.i_am_viewer ? 'הכרטיס שלך סגור לתקשורת — אתה במצב צפייה בלבד' : 'איש הקשר סגור לתקשורת — אי אפשר לשלוח הודעה') + '</div>'}`;
    H.$('#mBack', box).onclick = () => {
      if (p.from && p.open_user === cur) { const f = p.from, fp = p.fromParams; return H.go(f, fp || {}); }
      cur = null; grid.classList.remove('conv'); H.$('#pCard', grid).classList.add('hidden'); H.$('#pConv', grid).innerHTML = '<div class="empty">בחר שיחה מהרשימה</div>'; };
    if (p.from && p.open_user === cur) { const bb = H.$('#mBack', box); bb.style.display = 'block'; bb.textContent = '→ חזרה למסך הקודם'; }
    const chat = H.$('#cvChat', box); chat.scrollTop = chat.scrollHeight;
    const more = H.$('#cvMore', box);
    if (more) more.onclick = async () => { const r = await H.get('/api/messages/thread/' + cur + '?limit=5&before=' + msgs[0].ts); msgs = r.messages.concat(msgs); hasMore = r.has_more; renderConv(); };
    H.$$('.hublink', box).forEach(a => a.onclick = () => H.go('hub', { hub_id: a.dataset.hub }));
    H.$$('.mdel', box).forEach(a => a.onclick = async () => { const id = a.closest('.bub').dataset.id; await H.del('/api/messages/' + id); msgs = msgs.filter(m => m.id !== id); renderConv(); loadRows(); });
    const inp = H.$('#cvIn', box);
    const send = async () => {
      const text = inp.value.trim(); if (!text && !att) return;
      try { const m = await H.post('/api/messages/send', { to_user_id: cur, text, image: att }); if (!msgs.find(x => x.id === m.id)) msgs.push(m); H.sound('send'); att = ''; renderConv(); loadRows(); H.$('#cvIn', grid).focus(); } catch (e) { H.toast(e.message); }
    };
    H.$('#cvSend', box).onclick = send; inp.onkeydown = e => { if (e.key === 'Enter') send(); };
    H.$('#cvImg', box).onchange = async e => { att = await H.readImage(e.target.files[0], 900); e.target.value = ''; const v = inp.value; renderConv(); H.$('#cvIn', grid).value = v; };
    const ar = H.$('#cvAttRm', box); if (ar) ar.onclick = () => { att = ''; const v = inp.value; renderConv(); H.$('#cvIn', grid).value = v; };
    renderCard();
  }
  function renderCard() {
    const box = H.$('#pCard', grid); box.classList.remove('hidden');
    const c = other.card || {};
    let h = H.cardHtml({ ...c, id: cur, display_name: other.name, photo_url: c.photo_url });
    h += '<div class="cv-row"><span>זמינות</span><span>' + (other.open ? 'פתוח לתקשורת' : 'סגור לתקשורת') + '</span></div>';
    if (other.is_contact) h += '<div class="cv-note">✓ באנשי הקשר שלך' + (other.groups.length ? ' · ' + esc(other.groups.map(g => g.name).join(', ')) : '') + '</div>';
    else h += '<div class="btn-row center" style="margin-top:12px"><button class="btn sm primary" id="cdSave" ' + (other.open ? '' : 'disabled') + '>שמור באנשי הקשר</button></div>';
    box.innerHTML = h;
    const sv = H.$('#cdSave', box); if (sv) sv.onclick = async () => { try { await H.post('/api/contacts', { user_id: cur }); H.toast('נשמר באנשי הקשר'); const r = await H.get('/api/messages/thread/' + cur + '?limit=5'); other = r.other; renderCard(); } catch (e) { H.toast(e.message); } };
  }
  async function openGroup(row) {
    const key = row.key || row; gcur = key; cur = null; tab = 'groups'; syncTabs();
    let r;
    try { r = await H.get('/api/messages/group-thread?' + (row.group_id ? 'id=' + encodeURIComponent(row.group_id) : 'name=' + encodeURIComponent(row.group_name))); gmsgs = r.messages; } catch (e) { return H.toast(e.message); }
    gcurRow = { ...row, can_send: r.can_send, group_name: r.group_name || row.group_name };
    grid.classList.add('conv');
    const box = H.$('#pConv', grid); H.$('#pCard', grid).classList.add('hidden');
    const can = !!r.can_send;
    box.innerHTML = `<button class="back" id="gBack">→ חזרה לרשימה</button><div class="r" style="cursor:default"><span class="av" style="background:#8e5bd8;border-radius:12px">${H.ic('users', 18)}</span><div class="info"><div class="n">${esc(gcurRow.group_name)}</div><div class="l">קבוצה · לחיצה על שם השולח פותחת הודעה פרטית</div></div></div>
      <div class="chat" id="gChat">${gmsgs.map(m => `<div class="bub ${m.mine ? 'out' : 'in'}" data-id="${m.id}">${m.mine ? '' : '<span class="gl" style="cursor:pointer;text-decoration:underline" data-uid="' + m.from_user_id + '">' + esc(m.sender_name) + '</span>'}${esc(m.text)}${m.image ? '<img src="' + esc(m.image) + '">' : ''}<small>${H.fmt(m.ts)}</small></div>`).join('') || '<div class="empty">אין הודעות. כתוב הודעה ראשונה לקבוצה</div>'}</div>
      <div id="gAtt" class="hidden" style="font-size:12px"></div>
      <div class="comp"><label class="cb" title="צרף תמונה">${H.ic('img', 20)}<input type="file" id="gImg" accept="image/*" hidden></label><input type="text" id="gIn" placeholder="${can ? 'כתוב לכל הקבוצה...' : 'אין אפשרות לכתוב בקבוצה זו'}" ${can ? '' : 'disabled'}><button class="btn primary sm" id="gSend" ${can ? '' : 'disabled'}>שלח</button></div>`;
    H.$('#gBack', box).onclick = () => { gcur = null; grid.classList.remove('conv'); box.innerHTML = '<div class="empty">בחר שיחה מהרשימה</div>'; loadRows(); };
    H.$$('[data-uid]', box).forEach(a => a.onclick = () => { tab = 'contacts'; syncTabs(); openConv(a.dataset.uid); });
    const ch = H.$('#gChat', box); ch.scrollTop = ch.scrollHeight;
    let gatt = '';
    const sendG = async () => {
      const inp = H.$('#gIn', box), text = inp.value.trim(); if (!text && !gatt) return;
      try { await H.post('/api/messages/group-send', { group_id: gcurRow.group_id, text, image: gatt }); } catch (e) { return H.toast(e.message); }
      H.sound('send'); gatt = ''; openGroup(gcurRow);
    };
    H.$('#gSend', box).onclick = sendG; H.$('#gIn', box).onkeydown = e => { if (e.key === 'Enter') sendG(); };
    H.$('#gImg', box).onchange = async e => { gatt = await H.readImage(e.target.files[0], 900); e.target.value = ''; const a = H.$('#gAtt', box); a.classList.remove('hidden'); a.innerHTML = '<img src="' + esc(gatt) + '" style="max-height:44px;border-radius:6px"> מצורפת תמונה'; };
    loadRows(); H.sockGlobal.unread_changed.forEach(f => f());
  }
  function syncTabs() { H.$$('[data-mt]', grid).forEach(b => b.classList.toggle('on', b.dataset.mt === tab)); }
  H.$$('[data-mt]', grid).forEach(b => b.onclick = () => {
    const was = tab; tab = b.dataset.mt; syncTabs();
    if (tab === 'contacts' && was === 'groups') { gcur = null; if (lastPrivate) openConv(lastPrivate); else { cur = null; grid.classList.remove('conv'); H.$('#pCard', grid).classList.add('hidden'); H.$('#pConv', grid).innerHTML = '<div class="empty">בחר שיחה מהרשימה</div>'; } }
    if (tab === 'groups' && was === 'contacts') { cur = null; if (gcurRow) openGroup(gcurRow); else { grid.classList.remove('conv'); H.$('#pCard', grid).classList.add('hidden'); H.$('#pConv', grid).innerHTML = '<div class="empty">בחר קבוצה מהרשימה</div>'; } }
    loadRows(); });
  async function openConv(uid) {
    cur = uid; lastPrivate = uid; gcur = null; att = '';
    try { const r = await H.get('/api/messages/thread/' + uid + '?limit=5'); msgs = r.messages; hasMore = r.has_more; other = r.other; }
    catch (e) { return H.toast(e.message); }
    grid.classList.add('conv'); renderConv(); loadRows(); H.sockGlobal.unread_changed.forEach(f => f());
  }
  H.$('#mExt', grid).onclick = () => { const c = (other && other.card) || {}; H.externalMessage(cur && other ? { name: other.name, phone: c.phone || '' } : {}); };
  H.$('#mVg', grid).onclick = () => { H.setPref('messages_view', 'grid'); loadRows(); };
  H.$('#mVl', grid).onclick = () => { H.setPref('messages_view', 'list'); loadRows(); };
  H.$('#tbLogo', tbar).onclick = () => { const r = H.returnTo; if (r && r.name && H.routes[r.name]) H.go(r.name, r.params || {}); else H.go('home'); };
  let tq;
  H.$('#mQ', grid).oninput = e => { q = e.target.value.trim(); clearTimeout(tq); tq = setTimeout(loadRows, 250); };
  H.onSock('private_message', async m => {
    if (m.kind === 'group' && gcurRow && (gcurRow.group_id ? gcurRow.group_id === m.group_id : gcurRow.group_name === m.group_name) && gcur) openGroup(gcurRow);
    if (cur && m.other_user_id === cur) {
      if (!msgs.find(x => x.id === m.id)) msgs.push(m);
      if (!m.mine) { const r = await H.get('/api/messages/thread/' + cur + '?limit=5'); other = r.other; }
      renderConv();
    }
    loadRows();
  });
  H.onSock('private_message_deleted', d => { if (cur && d.other_user_id === cur) { msgs = msgs.filter(x => x.id !== d.id); renderConv(); } loadRows(); });
  await loadRows();
  if (p.open_user) openConv(p.open_user);
  if (p.open_group) { tab = 'groups'; syncTabs(); await loadRows(); const gr = grows.find(x => x.group_id === p.open_group); if (gr) openGroup(gr); }
};
