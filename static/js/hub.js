/* HUBBLE v14 — hub screen: the view (shared by live hub and setup preview) + the live route */
(function () {
  const esc = H.esc;
  const MIN = 60;
  const nowS = () => Date.now() / 1000;

  H.iconForBlock = b => {
    const t = (b.title || '') + ' ' + (b.category || '');
    if (b.category === 'open') return 'board';
    if (/זמנים|תוכנית|לו"ז|לוז|אג'נדה/.test(t)) return 'cal';
    if (/דובר|מרצ/.test(t)) return 'mic';
    if (/חסות|מציג|שות/.test(t)) return 'hand';
    if (/מפה|הגעה|כתובת/.test(t)) return 'map';
    if (/קשר|טלפון|מייל/.test(t)) return 'mail';
    if (/לינק|אתר|עמוד|קבוצה/.test(t)) return 'link';
    if (/הודעות|לוח/.test(t)) return 'board';
    return 'info';
  };

  /* name / sub-line of a person row, depending on hub type */
  const pName = (hub, e) => {
    const c = e.card || {};
    if (hub.hub_type === 'social' && c.nickname) return c.nickname;
    return e.display_name;
  };
  const pSub = (hub, e) => {
    const c = e.card || {};
    if (hub.hub_type === 'social') return c.bio || '';
    if (hub.hub_type === 'business') return [c.title, c.company].filter(Boolean).join(' · ');
    return c.company || c.title || '';
  };

  H.hubView = function (host, cfg) {
    const S = {
      hub: cfg.hub, blocks: cfg.blocks || [], posts: cfg.posts || {}, people: cfg.people || [], board: cfg.board || [],
      ptab: 'present', pq: '', msgTab: 'general', mq: '', thread: null, att: '', pinNext: false,
      peopleOpen: false, msgsOpen: false, openIds: null, full: null, newMsgs: 0, newPosts: {}, isFav: !!cfg.isFav,
      timer: null, myId: cfg.myId, myStatus: cfg.myStatus || 'green',
      pmRows: [], pmMsgs: [], pmHasMore: false, pmOther: null, contactIds: new Set(),
    };
    const ro = !!cfg.readonly;
    const $ = (s) => H.$(s, host) || (cfg.bandHost && H.$(s, cfg.bandHost));
    const defId = () => { const b = S.blocks.find(x => x.is_default); return b ? b.id : null; };
    const blockBy = id => S.blocks.find(x => x.id === id);
    const me = () => S.people.find(p => p.user_id === S.myId);
    const iAmClosed = () => { const m = me(); return (m ? m.status === 'red' : S.myStatus === 'red'); };

    const bandHtml = `<div class="band" id="band"><button class="bfav hidden" id="bFav" title="מועדף"></button><div class="btxt"><h1 id="bName"></h1><p class="sub" id="bSub"></p><p class="meta" id="bMeta"></p></div><img class="blogo hidden" id="bLogo" alt=""><button class="bshare hidden" id="bShare" title="שתף">${H.ic('share', 20)}</button></div>`;
    if (cfg.bandHost) cfg.bandHost.innerHTML = bandHtml;
    host.innerHTML = `
      <div class="hubwrap" id="hubwrap">
      ${cfg.bandHost ? '' : bandHtml}
      <div class="vnote-host" id="vnote"></div>
      <div class="stage" id="stage">
        <section class="col people" id="colP"><div class="inner">
          <div class="ch"><h2 data-x="people">רשימת האנשים</h2><div class="ch-tools"><button class="vt" id="pvList" title="שורות">${H.ic('list', 16)}</button><button class="vt" id="pvGrid" title="ריבועים">${H.ic('grid', 16)}</button><button class="expand" data-full="people" title="הגדל / צמצם">${H.ic('expand', 16)}</button></div><div class="seg" id="pSeg"><button data-v="registered">רשומים להאב</button><button data-v="present" class="on">נוכחים בהאב</button></div></div>
          <div class="sbar"><input type="text" id="pq" placeholder="חיפוש לפי שם, חברה, תפקיד או מלל חופשי"></div>
          <div class="pact hidden" id="pact"></div>
          <div class="plist" id="plist"></div>
        </div></section>
        <section class="col msgs" id="colM">
          <div class="ch"><h2 data-x="msgs">הודעות</h2><div class="ch-tools"><button class="expand" data-full="msgs" title="הגדל / צמצם">${H.ic('expand', 16)}</button></div><div class="seg" id="mSeg"><button data-v="general" class="on">כללית</button><button data-v="private">פרטית <span class="badge hidden" id="pmBadge" style="height:16px;min-width:16px;font-size:10px"></span></button></div></div>
          <div class="sbar"><input type="text" id="mq" placeholder="חיפוש הודעות לפי שם או מלל חופשי"></div>
          <div class="thead hidden" id="thead"></div>
          <div class="mlist" id="mlist"></div>
          <div class="composer">
            <div class="recipient hidden" id="recRow"></div>
            <div class="attrow hidden" id="attRow"></div>
            <div class="pinck hidden" id="pinRow"><label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="pinNext"> הצמד הודעה זו למעלה ל-30 דקות</label></div>
            <div class="cbar">
              <label class="cb" title="צרף תמונה">${H.ic('img', 20)}<input type="file" id="imgIn" accept="image/*" hidden></label>
              <input type="text" id="msgIn" placeholder="כתוב הודעה...">
              <button class="send" id="sendBtn" title="שלח">${H.ic('send', 18)}</button>
            </div>
          </div>
        </section>
        <section class="info-area" id="infoArea"><div class="windows n1" id="windows"></div></section>
        <div class="stage-hint hidden" id="stageHint">בחר חלון מהכפתורים שבתחתית המסך</div>
      </div>
      <div class="btnbar2" id="btnbar"></div>
      <div class="hubfoot2" id="hubFoot"></div>
      </div>`;

    /* ---------------- band / background ---------------- */
    function renderBand() {
      const h = S.hub;
      $('#bName').textContent = h.name || '';
      const sub = h.tagline_visible !== false ? h.tagline : '';
      $('#bSub').textContent = sub || ''; $('#bSub').classList.toggle('hidden', !sub);
      const meta = [h.location_visible !== false && h.location ? 'מיקום: ' + h.location : '', h.event_dates_visible !== false && h.event_dates ? 'תאריכים: ' + h.event_dates : ''].filter(Boolean).join(' | ');
      $('#bMeta').textContent = meta; $('#bMeta').classList.toggle('hidden', !meta);
      const lg = $('#bLogo'); const show = h.logo_visible !== false && h.logo_url;
      lg.classList.toggle('hidden', !show); if (show) lg.src = h.logo_url;
      const fv = $('#bFav'), sh = $('#bShare');
      fv.classList.toggle('hidden', ro); sh.classList.toggle('hidden', ro);
      fv.innerHTML = H.starSvg(S.isFav); fv.onclick = async () => { if (cfg.onFav) { S.isFav = await cfg.onFav(); fv.innerHTML = H.starSvg(S.isFav); } };
      sh.onclick = () => cfg.onShare && cfg.onShare();
      const bl = $('#bLogo'); bl.onclick = () => { if (S.full) { S.full = null; update(); } };
      renderFoot();
      const sc = host.closest('.hubscr');
      if (sc) { sc.setAttribute('data-theme', h.template_id || 'corporate_classic'); sc.classList.toggle('glow', !!h.glow); sc.classList.toggle('cool', h.hub_type === 'social' && !!h.glow); }
    }

    /* ---------------- people ---------------- */
    const matchP = (p, q) => {
      q = q.trim().toLowerCase(); if (!q) return true;
      const c = p.card || {};
      return [p.display_name, c.nickname, c.company, c.title, c.bio, c.name].some(v => (v || '').toLowerCase().includes(q));
    };
    const visiblePeople = () => S.people.filter(p => (S.ptab === 'registered' || p.is_physical) && matchP(p, S.pq));
    function renderPeople() {
      const list = visiblePeople(), box = $('#plist');
      const grid = H.pref('hub_people_view') === 'grid';
      $('#pvList').classList.toggle('on', !grid); $('#pvGrid').classList.toggle('on', grid);
      box.className = 'plist' + (grid ? ' pgrid' : '');
      box.innerHTML = list.length ? '' : '<div class="empty">' + (S.ptab === 'present' && !S.pq ? 'אין כרגע נוכחים פיזית בהאב' : 'לא נמצאו אנשים') + '</div>';
      list.forEach(p => {
        const isMe = p.user_id === S.myId;
        const inC = S.contactIds.has(p.user_id);
        const el = H.el(grid ? `<div class="ptile" data-id="${p.user_id}">
          ${H.avatar((p.card || {}).photo_url, pName(S.hub, p), p.user_id)}
          <div class="pname">${esc(pName(S.hub, p))}${p.is_owner ? '<span class="tag">מארגן</span>' : ''}</div><div class="pco">${esc(pSub(S.hub, p))}</div>
          <div class="pind"><span class="pres ${p.is_physical ? 'on' : ''}"></span><span class="dot ${p.status === 'green' ? 'g' : 'rd'} ${isMe && !ro ? 'click' : ''}"></span></div></div>` : `<div class="prow" data-id="${p.user_id}">
          ${H.avatar((p.card || {}).photo_url, pName(S.hub, p), p.user_id)}
          <div class="pinfo"><div class="pname">${esc(pName(S.hub, p))}${p.is_owner ? '<span class="tag">מארגן</span>' : ''}${isMe ? ' <span class="meTag">(אני)</span>' : ''}</div><div class="pco">${esc(pSub(S.hub, p))}</div></div>
          ${inC ? '<span class="relic c" title="באנשי הקשר שלי">' + H.ic('book', 12) + '</span>' : ''}
          <span class="pres ${p.is_physical ? 'on' : ''}" title="${p.is_physical ? 'נוכח פיזית בהאב' : 'לא נוכח פיזית'}"></span>
          <span class="dot ${p.status === 'green' ? 'g' : 'rd'} ${isMe && !ro ? 'click' : ''}" title="${p.status === 'green' ? 'פתוח לתקשורת' : 'סגור לתקשורת'}${isMe && !ro ? ' — לחץ להחלפה' : ''}"></span></div>`);
        el.onclick = () => openCard(p);
        const dot = H.$('.dot', el);
        if (isMe && !ro) dot.onclick = e => { e.stopPropagation(); cfg.onToggleStatus && cfg.onToggleStatus(S.myStatus === 'green' ? 'red' : 'green'); };
        box.appendChild(el);
      });
      renderPact(list);
      renderCounts();
    }
    function renderPact(list) {
      const bar = $('#pact'), q = S.pq.trim();
      const targets = list.filter(p => p.user_id !== S.myId && p.status === 'green');
      if (ro || !q || !targets.length) { bar.classList.add('hidden'); return; }
      bar.classList.remove('hidden');
      S.grpTargets = targets.map(p => p.user_id);
      if (targets.length === 1) {
        const has = S.contactIds.has(targets[0].user_id);
        bar.innerHTML = '<span>נמצא 1</span><button id="paAdd"' + (has ? ' disabled' : '') + '>' + (has ? 'כבר באנשי הקשר' : 'הוסף לאנשי הקשר') + '</button>';
      } else {
        bar.innerHTML = '<span>נמצאו ' + targets.length + '</span><button id="paAdd">הוסף את כולם לאנשי הקשר</button><button class="sec" id="paGrp">קבוצה…</button>';
        $('#paGrp').onclick = () => groupDialog(S.grpTargets);
      }
      $('#paAdd').onclick = async () => { const n = await saveContacts(S.grpTargets); if (n) H.toast('נוספו ' + n.length + ' אנשים לאנשי הקשר, עם ההערה: מההאב ' + S.hub.name); };
    }
    async function saveContacts(uids) {
      const ids = [];
      for (const u of uids) {
        try { const r = await H.post('/api/contacts', { user_id: u, hub_id: S.hub.hub_id }); ids.push(r.id); S.contactIds.add(u); } catch (e) { /* closed contact */ }
      }
      renderPeople(); return ids.length ? ids : 0;
    }
    async function groupDialog(uids) {
      const groups = await H.get('/api/contact-groups');
      let h = '<div class="picker">' + groups.map((g, i) => '<label class="gopt"><input type="radio" name="gsel" value="' + g.id + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(g.name) + '</label>').join('') + '</div><input class="field-in" id="grpNew" type="text" placeholder="או שם קבוצה חדשה" style="margin-top:8px">';
      H.modal({
        title: 'הוספה לקבוצה', body: h, actions: [{ label: 'ביטול' }, {
          label: 'הוסף', cls: 'primary', onClick: async (close, box) => {
            const nn = H.$('#grpNew', box).value.trim(), sel = H.$('input[name=gsel]:checked', box);
            let gid = nn ? null : (sel ? sel.value : null);
            if (!nn && !gid) { H.toast('בחר קבוצה או הקלד שם חדש'); return false; }
            const cids = await saveContacts(uids); if (!cids) { H.toast('אי אפשר לשמור — אנשי הקשר סגורים לתקשורת'); return false; }
            if (nn) { const g = await H.post('/api/contact-groups', { name: nn }); gid = g.id; }
            await H.post('/api/contact-groups/' + gid + '/members', { contact_ids: cids });
            H.toast('נוספו ' + cids.length + ' אנשים לקבוצה');
          }
        }]
      });
    }
    $('#pq').oninput = e => { S.pq = e.target.value; renderPeople(); };
    $('#pvList').onclick = () => { H.setPref('hub_people_view', 'list'); renderPeople(); };
    $('#pvGrid').onclick = () => { H.setPref('hub_people_view', 'grid'); renderPeople(); };
    H.$$('#pSeg button', host).forEach(b => b.onclick = () => { S.ptab = b.dataset.v; H.$$('#pSeg button', host).forEach(x => x.classList.toggle('on', x === b)); renderPeople(); });

    /* ---------------- person card ---------------- */
    async function openCard(p) {
      const isMe = p.user_id === S.myId, c = p.card || {};
      const closed = p.status === 'red';
      let body = H.cardHtml({ ...c, id: p.user_id, display_name: pName(S.hub, p), type: c.type, photo_url: c.photo_url }, { tag: (p.is_owner ? '<span class="tag">מארגן</span>' : '') });
      body += '<div class="cv-row"><span>זמינות</span><span>' + (closed ? 'סגור לתקשורת' : 'פתוח לתקשורת') + '</span></div>';
      if (S.contactIds.has(p.user_id)) body += '<div class="cv-note">✓ באנשי הקשר שלך</div>';
      const actions = [];
      if (!isMe && !ro) {
        actions.push({ label: S.contactIds.has(p.user_id) ? 'שמור ✓' : 'שמור באנשי הקשר שלי', onClick: async () => {
          if (S.contactIds.has(p.user_id)) return false;
          try { await H.post('/api/contacts', { user_id: p.user_id, hub_id: S.hub.hub_id }); S.contactIds.add(p.user_id); renderPeople(); H.toast('נשמר באנשי הקשר, עם ההערה: מההאב ' + S.hub.name); } catch (e) { H.toast(e.message); return false; }
        } });
        actions.push({ label: 'שלח הודעה פרטית', cls: 'primary', onClick: () => { if (closed || iAmClosed()) { H.toast(closed ? 'איש הקשר סגור לתקשורת' : 'הכרטיס שלך סגור לתקשורת'); return false; } openThread(p.user_id); } });
      }
      actions.push({ label: 'סגור' });
      H.modal({ body, actions });
    }

    /* ---------------- messages ---------------- */
    const canPostNow = () => !ro && !iAmClosed();
    function setMsgTab(v) {
      S.msgTab = v; if (v === 'general') { S.thread = null; }
      H.$$('#mSeg button', host).forEach(x => x.classList.toggle('on', x.dataset.v === v));
      if (v === 'private') loadPmRows(); else renderMsgs();
    }
    H.$$('#mSeg button', host).forEach(b => b.onclick = () => { S.thread = null; setMsgTab(b.dataset.v); });
    $('#mq').oninput = e => { S.mq = e.target.value; if (S.msgTab === 'private' && !S.thread) loadPmRows(); else renderMsgs(); };

    async function loadPmRows() {
      if (cfg.pm) { try { S.pmRows = (await cfg.pm.list(S.mq.trim())).conversations || []; } catch (e) { S.pmRows = []; } }
      renderMsgs();
    }
    async function openThread(uid) {
      S.msgTab = 'private'; S.thread = uid;
      H.$$('#mSeg button', host).forEach(x => x.classList.toggle('on', x.dataset.v === 'private'));
      S.pmMsgs = []; S.pmOther = null;
      if (cfg.pm) { const r = await cfg.pm.thread(uid); S.pmMsgs = r.messages; S.pmHasMore = r.has_more; S.pmOther = r.other; cfg.onUnreadChange && cfg.onUnreadChange(); }
      renderMsgs();
    }
    const nameOfPerson = uid => { const p = S.people.find(x => x.user_id === uid); return p ? pName(S.hub, p) : (S.pmOther && S.pmOther.user_id === uid ? S.pmOther.name : 'משתמש'); };

    function boardRow(m) {
      const mine = m.sender_user_id === S.myId, owner = !!cfg.isOwner;
      const pinned = m.pinned_until && m.pinned_until > nowS();
      const canDel = !ro && (mine || owner), canPin = !ro && owner && mine;
      const p = S.people.find(x => x.user_id === m.sender_user_id);
      const nm = p ? pName(S.hub, p) : m.sender_name;
      const el = H.el(`<div class="mrow2 ${m.is_owner ? 'adm' : ''}" data-id="${m.id}"><div class="mhead">${H.avatar(m.sender_photo, nm, m.sender_user_id, 'sm')}
        <span class="mname">${esc(nm)}${mine ? ' <span class="meTag">(אני)</span>' : ''}</span>
        ${pinned ? '<span class="pinb">' + H.ic('pin', 11) + ' מוצמד · עוד ' + Math.ceil((m.pinned_until - nowS()) / MIN) + ' דק\'</span>' : ''}
        <span class="mtime">${H.fmt(m.ts)}</span><span class="macts">
        ${canPin ? '<button class="pinbtn" title="' + (pinned ? 'בטל הצמדה' : 'השאר למעלה ל-30 דקות') + '">' + H.ic('pin', 15) + '</button>' : ''}
        ${canDel ? '<button class="del" title="מחק הודעה">' + H.ic('trash', 15) + '</button>' : ''}</span></div>
        <div class="mtext">${esc(m.text)}${m.image ? '<img class="matt" src="' + esc(m.image) + '" alt="">' : ''}</div></div>`);
      H.$('.mname', el).onclick = () => { if (p) openCard(p); };
      const d = H.$('.del', el); if (d) d.onclick = () => cfg.onDeleteBoard && cfg.onDeleteBoard(m.id);
      const pb = H.$('.pinbtn', el); if (pb) pb.onclick = () => cfg.onPin && cfg.onPin(m.id, !pinned);
      return el;
    }
    function pmRowEl(m) {
      const mine = m.mine;
      const nm = mine ? 'אני' : (m.kind === 'group' ? (m.group_name + ' · ' + m.sender_name) : (m.sender_name || nameOfPerson(S.thread)));
      const el = H.el(`<div class="mrow2 ${m.kind === 'system' ? 'adm' : ''}"><div class="mhead"><span class="mname" style="cursor:default">${esc(nm)}</span>
        <span class="mtime">${H.fmt(m.ts)}</span><span class="macts">${mine && !ro ? '<button class="del" title="מחק">' + H.ic('trash', 15) + '</button>' : ''}</span></div>
        <div class="mtext" style="padding-inline-start:0">${esc(m.text)}${m.image ? '<img class="matt" src="' + esc(m.image) + '" alt="">' : ''}</div></div>`);
      const d = H.$('.del', el); if (d) d.onclick = async () => { if (cfg.pm) { await cfg.pm.remove(m.id); S.pmMsgs = S.pmMsgs.filter(x => x.id !== m.id); renderMsgs(); } };
      return el;
    }
    function renderMsgs() {
      const priv = S.msgTab === 'private', inThread = priv && !!S.thread, box = $('#mlist'), th = $('#thead');
      const q = S.mq.trim().toLowerCase();
      if (inThread) {
        const o = S.pmOther; const nm = nameOfPerson(S.thread);
        th.classList.remove('hidden');
        th.innerHTML = '<button class="tback" id="thBack">→ כל ההודעות הפרטיות</button><span class="thname" id="thName">' + H.avatar(o && o.card && o.card.photo_url, nm, S.thread, 'sm') + '<b>' + esc(nm) + '</b></span>';
        $('#thBack').onclick = () => { S.thread = null; loadPmRows(); };
        $('#thName').onclick = () => { const p = S.people.find(x => x.user_id === S.thread); if (p) openCard(p); };
      } else th.classList.add('hidden');
      box.innerHTML = '';
      if (!priv) {
        const now = nowS();
        let list = S.board.slice().sort((a, b) => a.ts - b.ts);
        if (q) list = list.filter(m => (m.sender_name + ' ' + m.text).toLowerCase().includes(q));
        const pinned = list.filter(m => m.pinned_until && m.pinned_until > now), rest = list.filter(m => !pinned.includes(m));
        pinned.concat(rest).forEach(m => box.appendChild(boardRow(m)));
        if (!list.length) box.innerHTML = '<div class="empty">אין הודעות</div>';
      } else if (inThread) {
        if (S.pmHasMore) { const mb = H.el('<div style="text-align:center;padding:4px"><button class="pact-more outline" style="width:auto;padding:4px 14px">הצג הודעות קודמות</button></div>'); H.$('button', mb).onclick = async () => { const r = await cfg.pm.thread(S.thread, S.pmMsgs[0].ts); S.pmMsgs = r.messages.concat(S.pmMsgs); S.pmHasMore = r.has_more; renderMsgs(); }; box.appendChild(mb); }
        S.pmMsgs.forEach(m => box.appendChild(pmRowEl(m)));
        if (!S.pmMsgs.length) box.innerHTML = '<div class="empty">אין עדיין הודעות בשיחה זו</div>';
      } else {
        S.pmRows.forEach(r => {
          const el = H.el(`<div class="mrow2" style="cursor:pointer"><div class="mhead">${H.avatar(r.photo, r.name, r.user_id, 'sm')}<span class="mname">${esc(r.name)}</span>${r.unread ? '<span class="badge">' + r.unread + '</span>' : ''}<span class="mtime">${H.fmt(r.ts)}</span></div><div class="mtext">${esc(r.last_text)}</div></div>`);
          el.onclick = () => openThread(r.user_id);
          box.appendChild(el);
        });
        if (!S.pmRows.length) box.innerHTML = '<div class="empty">אין הודעות פרטיות בהאב זה</div>';
      }
      // composer state
      const dis = !canPostNow() || (priv && !inThread);
      $('#msgIn').disabled = dis; $('#sendBtn').disabled = dis;
      H.$$('.composer .cb', host).forEach(l => l.classList.toggle('dis', dis));
      $('#msgIn').placeholder = ro ? 'תצוגה מקדימה' : iAmClosed() ? 'הכרטיס שלך סגור לתקשורת — צפייה בלבד' : (priv && !inThread) ? 'פתח/י שיחה כדי להשיב' : (inThread ? 'השב ל' + nameOfPerson(S.thread) + '...' : 'כתוב הודעה...');
      const rr = $('#recRow');
      if (inThread) { rr.classList.remove('hidden'); rr.innerHTML = 'משיב רק אל: <b>' + esc(nameOfPerson(S.thread)) + '</b>'; } else rr.classList.add('hidden');
      $('#pinRow').classList.toggle('hidden', !(cfg.isOwner && !priv && !ro));
      renderAtt();
      box.scrollTop = box.scrollHeight;
    }
    function renderAtt() {
      const r = $('#attRow'); if (!S.att) { r.classList.add('hidden'); return; }
      r.classList.remove('hidden'); r.innerHTML = '<img class="matt" style="max-height:44px;margin:0" src="' + esc(S.att) + '"> <button title="הסר">×</button>';
      H.$('button', r).onclick = () => { S.att = ''; renderAtt(); };
    }
    $('#imgIn').onchange = async e => { S.att = await H.readImage(e.target.files[0], 900); e.target.value = ''; renderAtt(); };
    async function sendMsg() {
      const text = $('#msgIn').value.trim(); if (!text && !S.att) return;
      if (!canPostNow()) return;
      if (S.msgTab === 'private') {
        if (!S.thread) return;
        try { const m = await cfg.pm.send(S.thread, text, S.att); if (!S.pmMsgs.find(x => x.id === m.id)) S.pmMsgs.push(m); } catch (e) { return H.toast(e.message); }
      } else cfg.onSendBoard && cfg.onSendBoard({ text, image: S.att, pin: cfg.isOwner && $('#pinNext').checked });
      H.sound('send'); $('#msgIn').value = ''; S.att = ''; $('#pinNext').checked = false; renderMsgs();
    }
    $('#sendBtn').onclick = sendMsg;
    $('#msgIn').onkeydown = e => { if (e.key === 'Enter') sendMsg(); };

    /* ---------------- info windows ("חלונות רשות") + layout ---------------- */
    const MAXWIN = 4;
    const wideMq = window.matchMedia('(max-width: 900px)');
    const vkey = () => 'hubin_view_' + (S.hub.hub_id || '');
    const pinnedId = () => { const b = S.blocks.find(x => x.is_default && x.is_visible !== false); return b ? b.id : null; };
    const loadView = () => {
      if (S.viewLoaded) return; S.viewLoaded = true;
      if (ro) { S.peopleOpen = true; S.msgsOpen = true; return; }   // setup preview: show everything
      try { const d = JSON.parse(localStorage.getItem(vkey()) || 'null'); if (d) { S.peopleOpen = !!d.p; S.msgsOpen = !!d.m; S.openIds = Array.isArray(d.w) ? d.w : null; } } catch (e) { }
    };
    const saveView = () => { if (ro) return; try { localStorage.setItem(vkey(), JSON.stringify({ p: S.peopleOpen, m: S.msgsOpen, w: S.openIds || [] })); } catch (e) { } };
    const currentIds = () => {
      loadView();
      const pin = pinnedId(); let ids = (S.openIds || []).filter(id => blockBy(id) && blockBy(id).is_visible !== false && id !== pin);
      ids = ids.slice(0, MAXWIN - (pin ? 1 : 0)); S.openIds = ids;
      return pin ? [pin].concat(ids) : ids;
    };
    function applyLayout() {
      const st = $('#stage'), ids = currentIds(), mobile = wideMq.matches;
      if (S.full === 'people' && !S.peopleOpen) S.full = null;
      if (S.full === 'msgs' && !S.msgsOpen) S.full = null;
      if (S.full && S.full.startsWith('win:') && !ids.includes(S.full.slice(4))) S.full = null;
      const nm = (S.peopleOpen ? 1 : 0) + (S.msgsOpen ? 1 : 0);
      st.classList.remove('m0', 'm1', 'm2'); st.classList.add('m' + nm);
      st.classList.toggle('both', nm === 2);
      $('#colP').classList.toggle('hidden', !S.peopleOpen);
      $('#colM').classList.toggle('hidden', !S.msgsOpen);
      $('#infoArea').classList.toggle('hidden', !ids.length);
      $('#stageHint').classList.toggle('hidden', !!(ids.length || nm) || mobile);
      /* a people-only layout puts people in the right column; with both open, people right, messages middle */
      $('#colP').classList.toggle('xf', S.full === 'people'); $('#colM').classList.toggle('xf', S.full === 'msgs');
      H.$$('.win', host).forEach(w => w.classList.toggle('xf', S.full === 'win:' + w.dataset.id));
      st.classList.toggle('hasfull', !!S.full);
      st.classList.toggle('hasbg', !!S.hub.background_image_url && S.hub.bg_in_hub !== false);
      const hw = $('#hubwrap'); hw.classList.toggle('isfull', !!S.full);
      host.dataset.full = S.full || '';
      const bd_ = $('#band'); if (bd_) $('#hubwrap').style.setProperty('--xtop', Math.round(bd_.getBoundingClientRect().bottom + 6) + 'px');
    }
    function winHtml(b, plain) {
      let html = '<h3' + (plain ? '' : ' data-x="win:' + b.id + '"') + '><span>' + esc(b.title) + '</span>' + (plain ? '' : '<button class="wexp expand" data-full="win:' + b.id + '" title="הגדל / צמצם">' + H.ic('expand', 15) + '</button>') + '</h3><div class="wbody">';
      if (b.content) html += '<p>' + esc(b.content) + '</p>';
      if (b.image_url) html += '<img class="zoomable" src="' + esc(b.image_url) + '" alt="">';
      if (b.video_url) html += '<p><a href="' + esc(b.video_url) + '" target="_blank" rel="noopener">▶ וידאו</a></p>';
      if (b.link_url) html += '<p><a href="' + esc(b.link_url) + '" target="_blank" rel="noopener">' + esc(b.link_url) + '</a></p>';
      if (b.category === 'open') html += '<div class="open-posts">' + (S.posts[b.id] || []).map(po => postHtml(po)).join('') + '</div>';
      else if (!b.content && !b.image_url && !b.video_url && !b.link_url) html += '<p class="empty">אין עדיין תוכן.</p>';
      return html + '</div>';
    }
    function renderInfo() {
      const ids = currentIds(), st = $('#stage'), h = S.hub, pin = pinnedId();
      const bg = h.background_image_url && h.bg_in_hub !== false ? h.background_image_url : '';
      st.style.backgroundImage = bg ? 'url(' + bg + ')' : '';
      const w = $('#windows'); w.className = 'windows n' + Math.max(1, Math.min(4, ids.length)); w.innerHTML = '';
      ids.forEach(id => {
        const b = blockBy(id);
        const win = H.el('<div class="win" data-id="' + id + '"></div>');
        let html = winHtml(b);
        if (b.category === 'open') html += `<div class="upl"><input type="text" class="uText" placeholder="כתוב כאן הודעה לכולם..." ${canPostNow() ? '' : 'disabled'}><input type="text" class="uVid" placeholder="לינק לווידאו (רשות)" ${canPostNow() ? '' : 'disabled'}>
          <div class="urow"><label>העלאת תמונה<input type="file" class="uImg" accept="image/*" hidden></label><span class="uImgName" style="font-size:12px;color:var(--muted);align-self:center"></span><button class="go" ${canPostNow() ? '' : 'disabled'}>פרסם</button></div></div>`;
        win.innerHTML = html; w.appendChild(win);
        if (b.category === 'open') { wireOpen(win, b); S.newPosts[id] = 0; }
        H.$$('.pdel', win).forEach(x => x.onclick = () => cfg.onDeleteOpen && cfg.onDeleteOpen(x.dataset.id));
      });
      renderBar();
      wireExpand();
      applyLayout();
    }
    function renderBar() {
      const ids = currentIds(), on = new Set(ids), pin = pinnedId();
      const reg = S.people.length, pres = S.people.filter(p => p.is_physical).length;
      const nn = S.newMsgs > 20 ? '20+' : S.newMsgs;
      let bar = '<button class="ibtn2 ' + (S.peopleOpen ? 'on' : '') + '" id="bbP"><span class="ic">' + H.ic('users', 17) + '</span><span class="lbxx"><span class="lb">רשימת האנשים</span><span class="bcnt" id="bbPc"><i>ר׳</i> <b>' + reg + '</b> <i>נ׳</i> <b>' + pres + '</b></span></span></button>' +
        '<button class="ibtn2 ' + (S.msgsOpen ? 'on' : '') + '" id="bbM"><span class="ic">' + H.ic('chat', 17) + '</span><span class="lbxx"><span class="lb">הודעות</span>' + (S.newMsgs > 0 && !S.msgsOpen ? '<span class="bcnt"><span class="nb">' + nn + '</span></span>' : '') + '</span></button><span class="bb-sp"></span>';
      bar += S.blocks.filter(b => b.id !== pin && b.is_visible !== false).map(b => {
        const np = b.category === 'open' && !on.has(b.id) ? (S.newPosts[b.id] || 0) : 0;
        return '<button class="ibtn2 cm ' + (on.has(b.id) ? 'on' : '') + '" data-id="' + b.id + '"><span class="ic">' + H.ic(H.iconForBlock(b), 17) + '</span><span class="lbxx"><span class="lb">' + esc(b.title) + '</span>' + (np ? '<span class="bcnt"><span class="nb">' + (np > 20 ? '20+' : np) + '</span></span>' : '') + '</span></button>';
      }).join('');
      $('#btnbar').innerHTML = bar;
      $('#bbP').onclick = () => { S.peopleOpen = !S.peopleOpen; if (!S.peopleOpen && S.full === 'people') S.full = null; saveView(); update(); if (S.peopleOpen && wideMq.matches) scrollTo('#colP'); };
      $('#bbM').onclick = () => { S.msgsOpen = !S.msgsOpen; if (S.msgsOpen) S.newMsgs = 0; if (!S.msgsOpen && S.full === 'msgs') S.full = null; saveView(); update(); if (S.msgsOpen && wideMq.matches) scrollTo('#colM'); };
      H.$$('#btnbar .ibtn2[data-id]', host).forEach(x => x.onclick = () => pickField(x.dataset.id));
    }
    function renderCounts() { const c = $('#bbPc'); if (!c) return; const reg = S.people.length, pres = S.people.filter(p => p.is_physical).length; c.innerHTML = '<i>ר׳</i> <b>' + reg + '</b> <i>נ׳</i> <b>' + pres + '</b>'; }
    const scrollTo = sel => setTimeout(() => { const e = $(sel); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    function toggleFull(key) { S.full = S.full === key ? null : key; update(); }
    function wireExpand() {
      H.$$('.expand', host).forEach(b => b.onclick = e => { e.stopPropagation(); toggleFull(b.dataset.full); });
      H.$$('[data-x]', host).forEach(h => h.onclick = e => { if (e.target.closest('button')) return; toggleFull(h.dataset.x); });
    }
    const update = () => { renderInfo(); renderPeople(); renderMsgs(); };
    wireExpand();
    wideMq.addEventListener && wideMq.addEventListener('change', () => { S.full = null; update(); });
    function postHtml(po) {
      const canDel = !ro && (po.user_id === S.myId || cfg.isOwner);
      return '<div class="board-post"><small>' + esc(po.name) + ' · ' + H.fmt(po.ts) + (canDel ? ' <a class="pdel" data-id="' + po.id + '" style="cursor:pointer;color:var(--red)">מחק</a>' : '') + '</small>' + esc(po.text) +
        (po.image ? '<img class="matt" src="' + esc(po.image) + '" alt="">' : '') + (po.video ? '<div><a href="' + esc(po.video) + '" target="_blank" rel="noopener">▶ וידאו</a></div>' : '') + '</div>';
    }
    function wireOpen(win, b) {
      let img = '';
      H.$('.uImg', win).onchange = async e => { const f = e.target.files[0]; if (!f) return; img = await H.readImage(f, 900); H.$('.uImgName', win).textContent = f.name; };
      H.$('.go', win).onclick = () => {
        const text = H.$('.uText', win).value.trim(), video = H.$('.uVid', win).value.trim();
        if (!text && !img && !video) return H.toast('כתוב טקסט, הוסף תמונה או לינק לווידאו');
        cfg.onPostOpen && cfg.onPostOpen({ block_id: b.id, text, image: img, video });
      };
    }
    function pickField(id) {
      currentIds(); const i = S.openIds.indexOf(id);
      if (i >= 0) { S.openIds.splice(i, 1); if (S.full === 'win:' + id) S.full = null; }
      else {
        if (currentIds().length >= MAXWIN) return H.toast('ניתן לפתוח עד ארבעה חלונות רשות בו זמנית. סגור חלון אחר כדי לפתוח חלון נוסף.', 4500);
        S.openIds.push(id);
      }
      saveView(); renderInfo();
      if (i < 0 && wideMq.matches) scrollTo('#infoArea');
    }

    /* ---------------- footer: organizers, report, pass-through-card option ---------------- */
    function renderFoot() {
      const h = S.hub, f = $('#hubFoot');
      const org = h.organizer_names_visible !== false && h.organizer_names ? '<span class="org">' + (h.hub_type === 'business' ? 'בעלי העסק: ' : 'מארגנים: ') + esc(h.organizer_names) + '</span>' : '';
      const showCardRow = h.has_card && !ro && cfg.cardRow && cfg.cardRow() !== null;
      f.innerHTML = org + '<span class="fsp"></span>' +
        (ro ? '' : '<button class="fbtn" id="ftReport">' + H.ic('chart', 15) + ' דו"ח</button>') +
        (showCardRow ? '<label class="fchk"><input type="checkbox" id="ftCard" ' + (cfg.cardRow() ? 'checked' : '') + '><span class="cbx"></span>עבור דרך כרטיס הביקור בכניסה להאב</label>' : '');
      const rp = $('#ftReport'); if (rp) rp.onclick = () => cfg.onReport && cfg.onReport();
      const cc = $('#ftCard'); if (cc) cc.onchange = () => cfg.onCardRow && cfg.onCardRow(cc.checked);
    }

    /* ---------------- notices (location / code verification) ---------------- */
    let noteTimers = [];
    const clearNote = () => { noteTimers.forEach(clearTimeout); noteTimers = []; $('#vnote').innerHTML = ''; };
    function notice(o) {
      clearNote();
      const host_ = $('#vnote');
      const el = H.el('<div class="vnote ' + (o.blink ? 'blink' : '') + '"><div class="vt-msg">' + o.html + '</div>' + (o.input ? '<input class="field-in vn-in" type="text" placeholder="' + esc(o.input) + '">' : '') + '<div class="vn-err"></div>' + (o.timer ? '<div class="vtm" style="animation-duration:' + o.timer + 's"></div>' : '') + (o.buttons ? '<div class="opts"></div>' : '') + (o.note ? '<small>' + o.note + '</small>' : '') + '</div>');
      if (o.buttons) o.buttons.forEach(b => { const x = H.el('<button class="btn ' + (b.pri ? 'primary' : '') + '">' + esc(b.label) + '</button>'); x.onclick = () => { const inp = H.$('.vn-in', el); const r = b.onClick && b.onClick(inp ? inp.value.trim() : '', msg => { H.$('.vn-err', el).textContent = msg; }); if (r !== false) clearNote(); }; H.$('.opts', el).appendChild(x); });
      host_.appendChild(el);
      const bd = $('#band'), hw = $('#hubwrap'); if (bd && hw) host_.style.top = Math.max(4, bd.getBoundingClientRect().bottom - hw.getBoundingClientRect().top + 6) + 'px';
      if (o.blinkFor) noteTimers.push(setTimeout(() => el.classList.remove('blink'), o.blinkFor * 1000));
      if (o.ttl) noteTimers.push(setTimeout(() => { clearNote(); o.onExpire && o.onExpire(); }, o.ttl * 1000));
      return el;
    }

    const pinTimer = setInterval(() => { if (S.msgTab === 'general' && S.board.some(m => m.pinned_until > nowS() - 60)) renderMsgs(); }, 30000);

    /* ---------------- controller ---------------- */
    const v = {
      S, host,
      setHub(h) { S.hub = h; renderBand(); renderInfo(); renderPeople(); },
      setBlocks(blocks, posts) { S.blocks = blocks || []; if (posts) S.posts = posts; renderInfo(); },
      winHtml, blocks: () => S.blocks.filter(b => b.is_visible !== false),
      isFull: () => !!S.full, collapse() { S.full = null; update(); },
      setSeen(ts) { const me_ = S.myId; S.newMsgs = S.board.filter(m => m.ts > ts && m.sender_user_id !== me_).length; Object.keys(S.posts).forEach(k => { S.newPosts[k] = (S.posts[k] || []).filter(x => x.ts > ts && x.user_id !== me_).length; }); renderBar(); },
      setPeople(list) { S.people = list; const m = list.find(p => p.user_id === S.myId); if (m) S.myStatus = m.status; renderPeople(); renderMsgs(); renderInfo(); },
      setBoard(list) { S.board = list; renderMsgs(); },
      addBoard(m) { if (!S.board.find(x => x.id === m.id)) { S.board.push(m); if (!S.msgsOpen && m.sender_user_id !== S.myId) { S.newMsgs++; renderBar(); } } renderMsgs(); },
      removeBoard(id) { S.board = S.board.filter(x => x.id !== id); renderMsgs(); },
      updateBoard(m) { S.board = S.board.map(x => x.id === m.id ? m : x); renderMsgs(); },
      addPost(po) { (S.posts[po.block_id] = S.posts[po.block_id] || []).push(po); if (!currentIds().includes(po.block_id) && po.user_id !== S.myId) S.newPosts[po.block_id] = (S.newPosts[po.block_id] || 0) + 1; renderInfo(); },
      removePost(id, bid) { S.posts[bid] = (S.posts[bid] || []).filter(x => x.id !== id); renderInfo(); },
      setContacts(uids) { S.contactIds = new Set(uids); renderPeople(); },
      pmIncoming(m) {
        // a private message arrived; refresh whatever is on screen
        if (S.msgTab === 'private') {
          if (S.thread && (m.other_user_id === S.thread)) { if (!S.pmMsgs.find(x => x.id === m.id)) S.pmMsgs.push(m); if (!m.mine) cfg.pm && cfg.pm.thread(S.thread).then(() => cfg.onUnreadChange && cfg.onUnreadChange()); renderMsgs(); }
          else if (!S.thread) loadPmRows();
        } else if (!m.mine && m.hub_id === S.hub.hub_id) { const b = $('#pmBadge'); b.classList.remove('hidden'); b.textContent = (parseInt(b.textContent) || 0) + 1; }
      },
      pmRemoved(id) { S.pmMsgs = S.pmMsgs.filter(x => x.id !== id); if (S.msgTab === 'private') renderMsgs(); },
      openThread, openCard, notice, clearNote,
      destroy() { clearInterval(pinTimer); clearTimeout(S.timer); clearNote(); },
      refreshFoot: renderFoot,
      renderAll() { renderBand(); renderPeople(); renderMsgs(); renderInfo(); },
    };
    v.renderAll();
    return v;
  };
})();

/* ======================================================================
   Live hub route
   ====================================================================== */
(function () {
  const esc = H.esc;

  H.setSkipCard = async (hubId, skip) => {
    try { await H.post('/api/hubs/' + hubId + '/card-pref', { skip }); } catch (e) { }
    const pr = (H.me && H.me.prefs) || {}; const l = (pr.skip_cards || []).filter(x => x !== hubId); if (skip) l.push(hubId); pr.skip_cards = l;
  };
  /* simple sharing (full sharing flow arrives in 15ג): native share sheet, else copy the link */
  H.shareHubLink = async (hubId, name) => {
    const url = location.origin + '/?hub=' + hubId;
    try { if (navigator.share) { await navigator.share({ title: 'HUBIN — ' + name, text: 'הוזמנת להאב "' + name + '"', url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); H.toast('הקישור להאב הועתק'); } catch (e) { H.toast(url, 6000); }
  };

  H.routes.hub = async (p, root) => {
    await H.refreshMe();
    const hubId = p.hub_id;
    const scr = H.el('<div class="screen hubscr"></div>');
    root.appendChild(scr); H.screenRoot = scr;
    H.suppressPmToast = false;
    const hub0fav = false;
    const bar = H.topbar({
      tools: `<span class="tag hidden" id="physChip" role="button"></span><div class="tbtns" style="display:flex;gap:6px"><button class="tbtn hidden" id="btnManage">${H.ic('gear', 22)}<span class="tbl">ניהול ההאב</span> <span class="badge hidden" id="pendBadge" style="margin-inline-start:2px"></span></button></div>`
    });
    bar.classList.add('hubtop');
    const bandHost = H.el('<div class="tz tband"></div>'); bar.insertBefore(bandHost, H.$('.tc', bar)); H.$('.tc', bar).classList.add('hubword');
    scr.appendChild(bar);
    /* the app logo returns from an expanded window first; otherwise goes home */
    const tbl = H.$('#tbLogo', bar); tbl.onclick = () => { if (view && view.isFull()) view.collapse(); else H.go('home'); };
    const body = H.el('<div class="hubview" id="hubview"></div>'); scr.appendChild(body);

    let hub = null, view = null, cache = { people: [], pending: 0 }, isOwner = false, myId = H.me.user_id, ended = false;
    let lastPos = null, reverify = null, verifying = false, cardGateView = null, favState = !!hub0fav;
    let skipNow = false; const seenKey = 'hubin_seen_' + hubId;

    const gate = (html, extra) => {
      if (view) { view.destroy(); view = null; }
      body.innerHTML = '<div class="hub-gate"><div class="gbox">' + html + (extra || '') + '</div></div>';
      H.$('#btnManage', bar).classList.add('hidden');
    };
    const homeBtn = '<div style="margin-top:18px"><button class="btn" id="gHome">חזרה למסך הבית</button></div>';
    const wireHome = () => { const b = H.$('#gHome', body); if (b) b.onclick = () => H.go('home'); };

    /* 1. hub info */
    try { hub = await H.get('/api/hubs/' + hubId); favState = !!hub.is_favorite; }
    catch (e) { gate(esc(e.message), homeBtn); wireHome(); return; }
    if (hub.is_published === false && hub.is_mine && !p.preview) { H.go('setup', { hub_id: hubId, type: hub.hub_type }); return; }

    /* the personal-card gates (spec wording) are produced by the server on join; pre-check the cheap ones */
    if (!H.me.active_card) {
      gate('נא להגדיר <b id="gCards">כרטיס אישי</b> לפני הכניסה להאב', homeBtn);
      H.$('#gCards', body).onclick = () => H.go('cards'); wireHome(); return;
    }

    /* 2. business card first (unless the user chose not to see it again) */
    const skipCard = ((H.me.prefs || {}).skip_cards || []).includes(hubId);
    skipNow = skipCard; let wasSkipped = skipCard;
    if (hub.has_card && !skipCard && !p.nocard) {
      let d; try { d = await H.get('/api/hubs/' + hubId + '/card'); } catch (e) { d = null; }
      if (d && d.has_card) {
        await new Promise(res => {
          bar.classList.add('hidden');
          body.innerHTML = '<div class="bcgate"></div>';
          const h = H.$('.bcgate', body);
          cardGateView = H.hubCard(h, d, {
            onBack: () => H.go('home'),
            onEnter: () => { cardGateView.destroy(); cardGateView = null; bar.classList.remove('hidden'); body.innerHTML = ''; res(); },
            onFav: async () => { const r = await H.post('/api/hubs/' + hubId + '/favorite'); d.is_favorite = r.is_favorite; H.$('#bcFav', h).innerHTML = H.starSvg(r.is_favorite); },
            onShare: () => H.shareFlow({ hub: { hub_id: hubId, name: d.name || hub.name, serial: hub.serial } }),
            onSkip: sk => { skipNow = sk; wasSkipped = wasSkipped || sk; H.setSkipCard(hubId, sk); },
          });
          H.cleanup = () => { ended = true; if (cardGateView) cardGateView.destroy(); };
        });
        if (ended) return;
      }
    }

    /* 3. presence verification */
    const mode = hub.presence_mode || 'none';
    const usesLoc = mode === 'location' || mode === 'both', usesCode = mode === 'code' || mode === 'both';
    const join = () => {
      p.code = p.code || '';
      H.emit('join_hub', { hub_id: hubId, code: p.code });   // always allowed in (except banned); verification follows
    };
    const geoState = async () => { try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch (e) { return 'unknown'; } };

    /* verification notices: blink 10s, stay ~2 minutes; failure notice stays 10s */
    async function startVerify() {
      if (!view || mode === 'none' || verifying) return;
      verifying = true;
      try {
        if (usesLoc) {
          const gs = await geoState();
          if (gs === 'denied') return verifyFailed('הגישה למיקום חסומה בדפדפן. אפשר לאשר אותה בהגדרות האתר ולנסות שוב.');
          view.notice({ html: '<b>בודקים את המיקום שלך…</b><br>אם התבקשת — אשר/י גישה למיקום', blink: true, blinkFor: 10, timer: 10, ttl: 120 });
          const pos = await H.getPosition(10000);
          if (ended) return;
          if (pos) { lastPos = pos; H.emit('verify_presence', { code: '', ...pos }); return; }
          return verifyFailed();
        }
        if (usesCode) return codePrompt();
      } finally { verifying = false; }
    }
    function codePrompt(msg) {
      view.notice({
        html: '<b>אימות נוכחות בהאב</b><br>' + (msg || 'הזן את הקוד המוצג בהאב (או סרוק את ה-QR).'), input: 'קוד', blink: true, blinkFor: 10, ttl: 120,
        note: 'אפשר להמשיך גם בכניסה מרחוק.',
        buttons: [{ label: 'אמת', pri: true, onClick: (v, err) => { if (!v) { err('יש להזין קוד'); return false; } H.emit('verify_presence', { code: v, ...(lastPos || {}) }); } },
          { label: 'כניסה מרחוק', onClick: () => { } }],
      });
    }
    function verifyFailed(reason) {
      const buttons = [];
      if (usesLoc) buttons.push({ label: 'אני נמצא בהאב', pri: true, onClick: () => H.emit('verify_presence', { claim: true }) });
      buttons.push({ label: 'נכנס מרחוק', onClick: () => { } });
      if (usesLoc) buttons.push({ label: 'נסה שוב', onClick: () => { setTimeout(startVerify, 50); } });
      view.notice({ html: '<b>לא הצלחנו לאמת מיקום</b><br>' + (reason || 'אתה נמצא בהאב? אפשר לאשר ידנית או להיכנס מרחוק.'), buttons, ttl: 60, note: 'אם לא תבחר, תוגדר כנכנס מרחוק. הכניסה להאב מותרת בכל מקרה.',
        input: usesCode ? 'או הזן קוד כניסה' : undefined });
      if (usesCode) { /* code entry: the input above is used by an extra button */
        const o = H.$('.vnote .opts', body); if (o) { const x = H.el('<button class="btn">אמת בקוד</button>'); x.onclick = () => { const v = (H.$('.vnote .vn-in', body) || {}).value || ''; if (!v.trim()) { H.$('.vnote .vn-err', body).textContent = 'יש להזין קוד'; return; } H.emit('verify_presence', { code: v.trim(), ...(lastPos || {}) }); view.clearNote(); }; o.appendChild(x); }
      }
    }

    const buildView = (st) => {
      if (view) view.destroy();
      hub = st.hub; isOwner = !!hub.is_mine; myId = st.my_user_id;
      body.innerHTML = '';
      const pm = {
        list: q => H.get('/api/messages?hub_id=' + encodeURIComponent(hubId) + (q ? '&q=' + encodeURIComponent(q) : '')),
        thread: (uid, before) => H.get('/api/messages/thread/' + uid + '?hub_id=' + encodeURIComponent(hubId) + '&limit=5' + (before ? '&before=' + before : '')),
        send: (uid, text, image) => H.post('/api/messages/send', { to_user_id: uid, text, image, hub_id: hubId }),
        remove: id => H.del('/api/messages/' + id),
      };
      view = H.hubView(body, {
        bandHost, isFav: favState, hub, blocks: st.blocks, posts: st.open_posts, board: st.board, myId, myStatus: st.my_status, isOwner, pm,
        people: cache.people,
        onToggleStatus: s => H.emit('set_status', { status: s }),
        onSendBoard: d => H.emit('send_board_message', d),
        onDeleteBoard: id => H.emit('delete_board_message', { message_id: id }),
        onPin: (id, pin) => H.emit('pin_board_message', { message_id: id, pin }),
        onPostOpen: d => H.emit('post_open', d),
        onDeleteOpen: id => H.emit('delete_open_post', { post_id: id }),
        onVerify: () => { verifying = false; startVerify(); },
        onUnreadChange: () => H.sockGlobal.unread_changed.forEach(f => f()),
        onReport: () => reportFlow(),
        onShare: () => H.shareFlow({ hub: { hub_id: hubId, name: hub.name, serial: hub.serial }, view }),
        onFav: async () => { const r = await H.post('/api/hubs/' + hubId + '/favorite'); favState = r.is_favorite; return favState; },
        cardRow: () => wasSkipped ? !skipNow : null,
        onCardRow: on => { skipNow = !on; H.setSkipCard(hubId, !on); },
      });
      try { view.setSeen(parseFloat(localStorage.getItem(seenKey) || '0') || 0); } catch (e) { }
      H.get('/api/contacts').then(cs => view && view.setContacts(cs.map(c => c.user_id))).catch(() => { });
      H.$('#btnManage', bar).classList.toggle('hidden', !isOwner);
      updateChip(st.my_physical);
      if (mode !== 'none' && !st.my_physical && !isOwner) setTimeout(startVerify, 300);
    };
    const updateChip = phys => {
      const c = H.$('#physChip', bar);
      if (!hub || (hub.presence_mode || 'none') === 'none') { c.classList.add('hidden'); return; }
      c.classList.remove('hidden'); c.textContent = phys ? 'נוכח פיזית' : 'מרחוק — לחץ לאימות'; c.classList.toggle('btnlike', !phys); c.onclick = phys ? null : () => { verifying = false; startVerify(); };
    };

    /* sockets */
    H.onSock('hub_state', st => { if (ended) return; H.setUnread(H.me.unread); if (!view) H.sound('hub_enter'); buildView(st); if (cache.people.length) view.setPeople(cache.people); });
    H.onSock('presence_list', list => { if (cache.people.length && list.length > cache.people.length) H.sound('hub_join'); cache.people = list; if (view) { view.setPeople(list); const m = list.find(x => x.user_id === myId); if (m) updateChip(m.is_physical); } });
    H.onSock('pending_list', d => {
      if (d.hub_id !== hubId) return; cache.pending = d.pending.length;
      const b = H.$('#pendBadge', bar); b.textContent = cache.pending; b.classList.toggle('hidden', !cache.pending);
    });
    H.onSock('join_denied', d => {
      if (d.reason === 'banned') {
        gate('אינך מורשה להיכנס להאב זה', '<div style="font-size:17px;margin-top:10px">אנא פנה בהודעה פרטית ל-<b id="gOwner">' + esc(d.owner_name || 'בעל ההאב') + '</b></div>' + homeBtn);
        H.$('#gOwner', body).onclick = () => H.go('messages', { open_user: d.owner_user_id });
      } else if (d.reason === 'no_card') {
        gate('נא להגדיר <b id="gCards">כרטיס אישי</b> לפני הכניסה להאב', homeBtn); H.$('#gCards', body).onclick = () => H.go('cards');
      } else if (d.reason === 'need_business_card') {
        gate(esc(d.message), '<div style="font-size:16px;margin-top:10px">כדי להיכנס, הפוך <b id="gCards">כרטיס עסקי</b> לפעיל</div>' + homeBtn); H.$('#gCards', body).onclick = () => H.go('cards');
      } else gate(esc(d.message || 'לא ניתן להיכנס להאב'), homeBtn);
      wireHome();
    });
    H.onSock('hub_pending', d => { gate(esc(d.message || 'אנא המתן לאישור כניסה להאב'), homeBtn); wireHome(); });
    H.onSock('registration_approved', d => { if (d.hub_id === hubId) { H.toast('הרשמתך אושרה'); join(); } });
    H.onSock('registration_rejected', d => { if (d.hub_id === hubId) { gate('בקשת ההצטרפות להאב נדחתה על ידי מנהל ההאב', homeBtn); wireHome(); } });
    H.onSock('banned', d => { if (d.hub_id === hubId) { gate('אינך מורשה להיכנס להאב זה', homeBtn); wireHome(); } });
    H.onSock('hub_closed', d => { if (d.hub_id === hubId) { H.toast('ההאב נסגר על ידי המנהל'); H.go('home'); } });
    H.onSock('hub_details_updated', d => { if (view && d.hub_id === hubId) { hub = { ...hub, ...d.hub, is_mine: isOwner }; view.setHub(hub); view.setBlocks(d.blocks); } });
    H.onSock('board_message', m => { if (m.sender_user_id !== H.me.user_id) H.sound('hub_msg'); view && view.addBoard(m); });
    H.onSock('board_message_deleted', d => view && view.removeBoard(d.id));
    H.onSock('board_message_updated', m => view && view.updateBoard(m));
    H.onSock('open_post', m => view && view.addPost(m));
    H.onSock('open_post_deleted', d => view && view.removePost(d.id, d.block_id));
    H.onSock('private_message', m => { if (view) view.pmIncoming(m); });
    H.onSock('private_message_deleted', d => view && view.pmRemoved(d.id));
    H.onSock('presence_result', d => {
      if (!view || d.silent) return;
      if (d.physical) { view.notice({ html: '<b>נוכחותך בהאב אומתה ✓</b>' + (d.claimed ? '<br>סימנת שאתה נמצא בהאב' : ''), ttl: 4 }); return; }
      if (lastPos && usesLoc) { view.notice({ html: '<b>המיקום שלך מחוץ לטווח ההאב</b><br>תוגדר כנכנס מרחוק. אפשר להמשיך להשתמש בהאב כרגיל.', ttl: 10 }); return; }
      if (usesCode && !usesLoc) codePrompt('הקוד שהוזן אינו נכון. נסה שוב או המשך בכניסה מרחוק.');
      else view.notice({ html: '<b>לא הצלחנו לאמת נוכחות</b><br>תוגדר כנכנס מרחוק.', ttl: 8 });
    });
    H.onSock('error_msg', d => H.toast(d.error));
    const onRe = () => { if (!ended && H.screen === 'hub') join(); };
    H.sock.io.on('reconnect', onRe);

    if (usesLoc) reverify = setInterval(async () => { if (verifying) return; const pos = await H.getPosition(8000); if (pos) { lastPos = pos; H.emit('verify_presence', { code: p.code || '', ...pos, silent: true }); } }, 5 * 60 * 1000);

    /* toolbar buttons */
    H.$('#btnManage', bar).onclick = () => H.go('manage', { hub_id: hubId });

    /* report */
    async function reportFlow() {
      let rep; try { rep = await H.get('/api/hubs/' + hubId + '/report'); } catch (e) { return H.toast(e.message); }
      const opt = (id, label) => '<label class="gopt"><input type="checkbox" id="' + id + '" checked> ' + label + '</label>';
      let b = '<p style="margin:0 0 6px;font-size:13.5px">בחר אילו שדות לכלול בדו"ח:</p><label class="gopt"><input type="checkbox" checked disabled> שם ההאב (תמיד)</label>' +
        opt('rSub', 'כותרת משנה') + opt('rLoc', 'מיקום') + opt('rDates', 'תאריכים') + opt('rLogo', 'לוגו') + opt('rInfo', 'מידע על ההאב') + opt('rReg', 'רשימת הרשומים להאב') + opt('rCon', 'אנשי הקשר שלי מההאב הזה (בודדים וקבוצות)');
      if (rep.photos.length) b += '<p style="margin:10px 0 2px;font-size:13.5px">תמונות מההאב לשמירה בדו"ח (סמן את הרצויות):</p><div class="opt-photos">' + rep.photos.map(ph => '<label title="' + esc(ph.by) + '"><input type="checkbox" data-ph="' + ph.id + '"><img src="' + esc(ph.url) + '" alt=""></label>').join('') + '</div>';
      H.modal({
        title: 'יצירת דו"ח', body: b, actions: [{ label: 'ביטול' }, {
          label: 'הפק דו"ח', cls: 'primary', onClick: (close, box) => {
            const ck = id => { const e = H.$('#' + id, box); return e && e.checked; };
            const chosen = new Set(H.$$('[data-ph]:checked', box).map(x => x.dataset.ph));
            showReport(rep, { sub: ck('rSub'), loc: ck('rLoc'), dates: ck('rDates'), logo: ck('rLogo'), info: ck('rInfo'), reg: ck('rReg'), con: ck('rCon'), photos: rep.photos.filter(x => chosen.has(x.id)) });
          }
        }]
      });
    }
    function showReport(rep, o) {
      const h = rep.hub; let html = '<div class="bar noprint"><button class="pri" id="repPrint">הדפס / שמור כ-PDF</button><button id="repShare">שתף</button><button id="repClose">סגור</button></div>';
      if (o.logo && h.logo_url && h.logo_visible) html += '<img class="rlogo" src="' + esc(h.logo_url) + '" alt="">';
      html += '<h1>' + esc(h.name) + '</h1>';
      if (o.sub && h.tagline) html += '<div>' + esc(h.tagline) + '</div>';
      if (o.loc && h.location) html += '<div>מיקום: ' + esc(h.location) + '</div>';
      if (o.dates && h.event_dates) html += '<div>תאריכים: ' + esc(h.event_dates) + '</div>';
      html += '<div class="kv">הופק ב-' + H.fmt(rep.generated_at) + '</div>';
      if (o.info) html += '<h2>מידע על ההאב</h2>' + (rep.info.length ? '<ul>' + rep.info.map(b => '<li><b>' + esc(b.title) + ':</b> ' + esc([b.content, b.link_url, b.video_url].filter(Boolean).join(' | ')) + '</li>').join('') + '</ul>' : '<p>אין מידע.</p>');
      if (o.reg) html += '<h2>רשימת הרשומים להאב (' + rep.directory.length + ')</h2><ul>' + rep.directory.map(e => { const c = e.card || {}; return '<li>' + esc(e.display_name) + (c.company || c.title ? ' — ' + esc([c.company, c.title].filter(Boolean).join(', ')) : '') + '</li>'; }).join('') + '</ul>';
      if (o.con) {
        html += '<h2>אנשי הקשר שלי מההאב הזה (' + rep.contacts.length + ')</h2>';
        html += rep.contacts.length ? '<ul>' + rep.contacts.map(c => '<li>' + esc(c.name) + (c.company ? ' — ' + esc(c.company) : '') + (c.groups.length ? ' (קבוצות: ' + esc(c.groups.map(g => g.name).join(', ')) + ')' : '') + '</li>').join('') + '</ul>' : '<p>עדיין לא שמרת אנשי קשר מההאב.</p>';
        if (rep.groups.length) html += '<h3>קבוצות</h3><ul>' + rep.groups.map(g => '<li><b>' + esc(g.name) + ':</b> ' + g.contact_ids.map(id => esc((rep.contacts.find(c => c.id === id) || {}).name || '')).join(', ') + '</li>').join('') + '</ul>';
      }
      if (o.photos.length) html += '<h2>תמונות מההאב</h2><div class="rphotos">' + o.photos.map(ph => '<img src="' + esc(ph.url) + '" alt="" title="' + esc(ph.by) + '">').join('') + '</div>';
      const ov = H.el('<div class="rep-ov"><div class="rep">' + html + '</div></div>');
      document.body.appendChild(ov);
      H.$('#repClose', ov).onclick = () => ov.remove();
      H.$('#repPrint', ov).onclick = () => window.print();
      H.$('#repShare', ov).onclick = () => H.shareReport({ hub: { hub_id: hubId, name: h.name, serial: h.serial }, el: H.$('.rep', ov) });
    }

    H.cleanup = () => {
      ended = true; clearInterval(reverify);
      try { localStorage.setItem(seenKey, String(Date.now() / 1000)); } catch (e) { }
      if (view) view.destroy();
      if (H.sock) H.sock.io.off('reconnect', onRe);
      H.emit('leave_hub');
      H.$$('.rep-ov').forEach(x => x.remove());
    };
    join();
  };
})();
