/* HUBBLE v15ב — hub setup (create / edit) for the 3 hub types: drafts, background image, address/map/radius, business card */
(function () {
  const esc = H.esc;
  const TEMPLATES = [
    { id: 'corporate_classic', name: 'קלאסי-כחול', a: '#185FA5', b: '#D6E7F8' },
    { id: 'community_dynamic', name: 'טבעי-ירוק', a: '#0F6E56', b: '#CDEBDD' },
    { id: 'creator_purple', name: 'יצירתי-סגול', a: '#534AB7', b: '#DAD6F7' },
    { id: 'minimalist_dark', name: 'תפעולי-כהה', a: '#E24B4A', b: '#12141F' },
    { id: 'logistics_red', name: 'חם-אדום', a: '#A32D2D', b: '#F6D3D1' },
  ];
  const PRESETS = {
    professional: ['לוח הודעות', 'לוח זמנים', 'רשימת דוברים', 'רשימת מציגים', 'רשימת נותני החסות', 'מפה', 'לינק לאתר האירוע', 'צור קשר'],
    business: ['לוח הודעות', 'מוצרים ושירותים', 'שעות פעילות', 'מבצעים', 'מפה', 'לינק לאתר', 'צור קשר'],
    social: ['לוח הודעות', 'תוכנית האירוע', 'מפה', 'לינק לקבוצה', 'צור קשר'],
  };
  /* per-type wording (spec section 22 a / b / c) */
  const CFG = {
    professional: { title: 'הגדרת האב מקצועי', namePh: '(שם האירוע – שדה חובה)', subPh: '(תיאור האירוע)', locPh: '', dates: true, logoLbl: 'לוגו', orgLbl: 'שמות המארגנים', orgOptional: false },
    business: { title: 'הגדרת האב עסקי', namePh: '(שם העסק – שדה חובה)', subPh: '(תיאור העסק)', locPh: '', dates: false, logoLbl: 'לוגו', orgLbl: 'שמות בעלי העסק', orgOptional: true },
    social: { title: 'הגדרת האב חברתי', namePh: '(שם ההאב – שדה חובה)', subPh: '(תיאור)', locPh: '(במידה ויש)', dates: false, logoLbl: 'תמונת האירוע לכותרת', orgLbl: 'שמות המארגנים', orgOptional: true },
  };
  const RADII = [100, 500, 1000, 2000];

  H.routes.setup = async (p, root) => {
    const editing = !!p.hub_id;
    let type = p.type || 'social';
    const w = H.el('<div class="screen"></div>'); root.appendChild(w);

    await H.refreshMe();
    /* gate: professional hub needs a business card */
    if (type === 'professional' && !H.me.has_business_card) {
      w.appendChild(H.topbar({ title: CFG.professional.title }));
      w.appendChild(H.el('<div class="gate-box">נא ליצור לעצמך <b id="gBiz">כרטיס עסקי</b> לפני הגדרת האב מקצועי</div>'));
      H.$('#gBiz', w).onclick = () => H.go('cards', { newType: 'business', back: 'setup', backParams: { type: 'professional' } });
      return;
    }

    const st = {
      name: '', tagline: '', tagline_visible: true, location: '', location_visible: true, event_dates: '', event_dates_visible: true,
      logo_url: '', logo_visible: true, organizer_names: '', organizer_names_visible: true,
      template_id: 'corporate_classic', background_image_url: '', bg_in_hub: true, glow: false, auto_approve: true, send_approval_msg: true,
      presence_mode: 'none', loc_lat: null, loc_lng: null, loc_radius: 150, loc_address: '', blocks: [], presence_code: '',
      card_enabled: false, card_bg_url: '', card_bg_kind: 'image', card_use_hub_bg: true, card_song_url: '', card_message: '',
      is_published: false,
    };
    let hubId = p.hub_id || null;
    if (editing) {
      try {
        const f = await H.get('/api/hubs/' + hubId + '/full');
        Object.assign(st, f.hub, { blocks: f.blocks, presence_code: f.presence_code });
        type = f.hub.hub_type;
      } catch (e) { w.appendChild(H.topbar({ title: 'עריכת האב' })); w.appendChild(H.el('<div class="gate-box">' + esc(e.message) + '</div>')); return; }
    }
    const C = CFG[type];
    const snap = () => JSON.stringify(st);
    let saved = snap(), done = false;
    const dirty = () => !done && snap() !== saved;
    const published = () => st.is_published === true;

    w.appendChild(H.topbar({ title: editing && published() ? 'עריכת ' + C.title.replace('הגדרת ', '') : C.title }));
    const pg = H.el('<div class="page"></div>'); w.appendChild(pg);

    const row = (icon, label, inner, cls) => `<div class="row ${cls || ''}"><span class="ico">${H.ic(icon, 20)}</span><span class="lbl">${label}</span>${inner}</div>`;
    const thumbRow = (icon, label, id, urlKey, accept) => row(icon, label, '<span class="grow"><img id="' + id + 'Thumb" class="thumb ' + (st[urlKey] ? '' : 'hidden') + '" src="' + esc(st[urlKey]) + '"></span><label class="btn sm">העלאת קובץ<input type="file" id="' + id + '" accept="' + accept + '" hidden></label>' + (st[urlKey] ? '<button class="btn sm danger" id="' + id + 'Rm">הסר</button>' : ''));

    const render = () => {
      const orgRow = row('users', C.orgLbl, '<input type="text" data-k="organizer_names" placeholder="יוצג בתחתית ההאב" value="' + esc(st.organizer_names) + '">');
      pg.innerHTML = `
        <h1 class="title">${editing ? (published() ? 'עריכת ההאב' : 'המשך עריכת טיוטה') : 'ברוכים הבאים ל' + C.title}</h1>
        <p class="lead">${editing && published() ? 'עדכן את הגדרות ההאב ושמור' : 'הגדר את ההאב שלך. אפשר לשמור נתונים כטיוטה ולהמשיך מאוחר יותר'}</p>
        ${row('cal', 'כותרת', '<input type="text" data-k="name" placeholder="' + esc(C.namePh) + '" value="' + esc(st.name) + '">')}
        <p class="grp">שדות רשות בכותרת ההאב</p>
        ${row('lines', 'כותרת משנה', '<input type="text" data-k="tagline" placeholder="' + esc(C.subPh) + '" value="' + esc(st.tagline) + '">')}
        ${C.dates ? row('clock', 'תאריכים / שעות', '<input type="text" data-k="event_dates" value="' + esc(st.event_dates) + '">') : ''}
        ${row('pinloc', 'מיקום', '<input type="text" data-k="location" placeholder="' + esc(C.locPh) + '" value="' + esc(st.location) + '">')}
        ${thumbRow('img', C.logoLbl, 'stLogo', 'logo_url', 'image/*')}
        ${C.orgOptional ? '' : orgRow}
        <p class="grp">שדות רשות כלליים (חלונות מידע בהאב)</p>
        ${C.orgOptional ? orgRow : ''}
        <div id="stBlocks"></div>
        <div class="row clickable" id="stAdd"><span class="ico">${H.ic('list', 20)}</span><span class="grow" id="stAddLbl"></span></div>
        <p class="grp">עיצוב</p>
        ${row('palette', 'תבנית', '<div class="sw-box" id="tplBox" style="display:flex;gap:10px;flex:1"></div><span class="small" id="tplName"></span>')}
        ${thumbRow('img', 'תמונת רקע', 'stBg', 'background_image_url', 'image/*')}
        <div class="row sub"><label class="chk"><input type="checkbox" id="stBgIn" ${st.bg_in_hub ? 'checked' : ''}> השתמש בתמונה גם כרקע בתוך ההאב</label><span class="small grow">התמונה תופיע גם בשורת ההאב או בריבוע ההאב ברשימת ההאבים.</span></div>
        ${type === 'social' ? '<div class="row"><span class="ico">' + H.ic('palette', 20) + '</span><label class="chk grow"><input type="checkbox" id="stGlow" ' + (st.glow ? 'checked' : '') + '> מסגרות זוהרות — הזוהר נע לאורך המסגרות והקווים, ושם ההאב מוצג ישר על הרקע</label></div>' : ''}
        <p class="grp">כרטיס ביקור</p>
        <div class="row clickable" id="stCard"><span class="ico">${H.ic('board', 20)}</span><span class="grow"><b>${st.card_enabled ? 'עריכת כרטיס הביקור' : 'הוספת כרטיס ביקור'}</b><div class="small">כרטיס זה יפתח לפני כניסה להאב${st.card_enabled ? ' · מוגדר ✓' : ''}</div></span></div>
        <p class="grp">הרשמה</p>
        <div class="row"><span class="ico">${H.ic('users', 20)}</span><span class="lbl" style="width:auto">אישור נרשמים אוטומטי</span><span class="grow small">(כל נרשם יאושר אוטומטית)</span><label class="sw"><input type="checkbox" id="stAuto" ${st.auto_approve ? 'checked' : ''}><span></span></label></div>
        <p class="grp">אימות נוכחות פיזית בהאב</p>
        ${row('pinloc', 'שיטת אימות', `<select data-k="presence_mode"><option value="none">ללא — זיהוי לפי רשת האינטרנט שלי</option><option value="location">לפי מיקום ורדיוס</option><option value="code">לפי קוד / QR</option><option value="both">מיקום או קוד</option></select>`)}
        <div id="stPresence"></div>
        <div class="err" id="stErr"></div>
        <div class="btn-row center wrap"><button class="btn" id="stCancel">בטל</button><button class="btn" id="stDraft">שמור נתונים</button><button class="btn" id="stView">צפיה בהאב</button><button class="btn primary" id="stSave">${editing && published() ? 'שמור שינויים' : 'צור האב'}</button></div>`;
      H.$('[data-k=presence_mode]', pg).value = st.presence_mode;
      H.$$('input[data-k]', pg).forEach(i => i.oninput = () => { st[i.dataset.k] = i.value; });
      H.$('[data-k=presence_mode]', pg).onchange = e => { st.presence_mode = e.target.value; renderPresence(); };
      const fileWire = (id, key, dim, q) => {
        const inp = H.$('#' + id, pg); if (inp) inp.onchange = async e => { if (!e.target.files[0]) return; st[key] = await H.readImage(e.target.files[0], dim, q); render(); };
        const rm = H.$('#' + id + 'Rm', pg); if (rm) rm.onclick = () => { st[key] = ''; render(); };
      };
      fileWire('stLogo', 'logo_url', 400); fileWire('stBg', 'background_image_url', 1600, .78);
      H.$('#stBgIn', pg).onchange = e => { st.bg_in_hub = e.target.checked; };
      const gl = H.$('#stGlow', pg); if (gl) gl.onchange = e => { st.glow = e.target.checked; };
      H.$('#stAuto', pg).onchange = e => { st.auto_approve = e.target.checked; if (!e.target.checked) H.toast('אישור משתמשים יתבצע בעמוד ניהול ההאב'); };
      H.$('#stAdd', pg).onclick = () => blockModal();
      H.$('#stCard', pg).onclick = () => H.hubCardEditor(st, null, () => render());
      H.$('#stView', pg).onclick = preview;
      H.$('#stCancel', pg).onclick = () => H.go('home');
      H.$('#stDraft', pg).onclick = () => saveDraft();
      H.$('#stSave', pg).onclick = () => publish();
      renderBlocks(); renderTpl(); renderPresence();
    };

    function renderTpl() {
      const box = H.$('#tplBox', pg); box.innerHTML = '';
      TEMPLATES.forEach(t => {
        const b = H.el('<button type="button" class="swatch ' + (st.template_id === t.id ? 'sel' : '') + '" title="' + t.name + '" style="background:linear-gradient(135deg,' + t.a + ' 50%,' + t.b + ' 50%)"></button>');
        b.onclick = () => { st.template_id = t.id; renderTpl(); }; box.appendChild(b);
      });
      H.$('#tplName', pg).textContent = (TEMPLATES.find(t => t.id === st.template_id) || TEMPLATES[0]).name;
    }

    /* info windows ("שדות רשות"): one permanent-display window is optional (none = all windows closed on entry) */
    function renderBlocks() {
      if (st.blocks.filter(b => b.is_default).length > 1) { let seen = false; st.blocks.forEach(b => { if (b.is_default && seen) b.is_default = false; seen = seen || b.is_default; }); }
      const box = H.$('#stBlocks', pg); box.innerHTML = '';
      st.blocks.forEach(b => {
        const r = H.el(`<div class="row field-row"><span class="ico">${H.ic(H.iconForBlock(b), 20)}</span><span class="grow" style="font-weight:600">${esc(b.title)}</span>
          ${b.category === 'open' ? '<span class="tag">פתוח למשתמשים</span>' : ''}
          <label class="chk" title="חלון אחד שמוצג תמיד לכל המשתמשים ואי אפשר לסגור אותו (לא חובה)"><input type="checkbox" data-def ${b.is_default ? 'checked' : ''}> תצוגה קבועה</label>
          <label class="chk" title="הסתר/הצג את הכפתור בהאב"><input type="checkbox" data-vis ${b.is_visible !== false ? 'checked' : ''} ${b.is_default ? 'disabled' : ''}> מוצג</label>
          <button class="btn sm" data-a="edit">ערוך</button><button class="btn sm danger" data-a="del">מחק</button></div>`);
        H.$('[data-a=edit]', r).onclick = () => blockModal(b);
        H.$('[data-a=del]', r).onclick = () => { st.blocks = st.blocks.filter(x => x !== b); renderBlocks(); };
        H.$('[data-def]', r).onchange = e => { st.blocks.forEach(x => x.is_default = false); b.is_default = e.target.checked; if (b.is_default) b.is_visible = true; renderBlocks(); };
        H.$('[data-vis]', r).onchange = e => { b.is_visible = e.target.checked; };
        box.appendChild(r);
      });
      H.$('#stAddLbl', pg).textContent = st.blocks.length ? 'הוספת שדה רשות נוסף' : 'הוספת שדה רשות (ניתן לבחור מרשימה)';
    }

    /* ---- presence section: method, location (address / map / current + radius), code ---- */
    let map = null, marker = null, circle = null;
    function destroyMap() { if (map) { map.remove(); map = null; marker = circle = null; } }
    function setLoc(lat, lng, opts = {}) {
      st.loc_lat = lat; st.loc_lng = lng;
      const t = H.$('#locTxt', pg); if (t) t.textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
      if (map) {
        if (!marker) { marker = L.marker([lat, lng], { draggable: true }).addTo(map); marker.on('dragend', () => { const q = marker.getLatLng(); setLoc(q.lat, q.lng, { keepView: true }); }); }
        marker.setLatLng([lat, lng]);
        if (!circle) circle = L.circle([lat, lng], { radius: st.loc_radius || 150, color: '#3f86e0', fillOpacity: .2 }).addTo(map);
        circle.setLatLng([lat, lng]); circle.setRadius(st.loc_radius || 150);
        if (!opts.keepView) map.setView([lat, lng], 16);
      }
    }
    function initMap() {
      const el = H.$('#locMap', pg); if (!el) return;
      if (typeof L === 'undefined') { el.innerHTML = '<div class="note info">המפה לא נטענה. אפשר להזין כתובת או להשתמש במיקום הנוכחי.</div>'; return; }
      destroyMap();
      const c = st.loc_lat != null ? [st.loc_lat, st.loc_lng] : [32.0853, 34.7818];
      map = L.map(el).setView(c, st.loc_lat != null ? 16 : 11);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      map.on('click', e => setLoc(e.latlng.lat, e.latlng.lng, { keepView: true }));
      if (st.loc_lat != null) setLoc(st.loc_lat, st.loc_lng);
      setTimeout(() => map && map.invalidateSize(), 150);
    }
    async function geocode(q) {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=he&q=' + encodeURIComponent(q), { headers: { 'Accept': 'application/json' } });
      const j = await r.json(); return j && j[0] ? { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), name: j[0].display_name } : null;
    }
    function renderPresence() {
      destroyMap();
      const box = H.$('#stPresence', pg); const m = st.presence_mode; let h = '';
      if (m === 'none') h = '<div class="note info">ללא הגדרה: נחשב "נוכח פיזית" מי שמחובר מאותה רשת אינטרנט (כתובת IP ציבורית) כמוך בעת פתיחת ההאב. שיטה זו פחות מדויקת — מומלץ מיקום או QR.</div>';
      if (m === 'location' || m === 'both') {
        const isPreset = RADII.includes(st.loc_radius);
        h += `<div class="row"><span class="ico">${H.ic('pinloc', 20)}</span><span class="lbl">כתובת</span><input type="text" id="locAddr" placeholder="רחוב, עיר או שם מקום" value="${esc(st.loc_address)}"><button class="btn sm" id="locFind">חפש</button><button class="btn sm" id="locHere">המיקום הנוכחי שלי</button></div>
          <div class="small" style="margin:0 6px 6px">אפשר גם ללחוץ על המפה או לגרור את הסמן. המיקום: <b id="locTxt">${st.loc_lat != null ? st.loc_lat.toFixed(5) + ', ' + st.loc_lng.toFixed(5) : 'לא הוגדר'}</b></div>
          <div id="locMap" class="locmap"></div>
          <div class="row"><span class="ico">${H.ic('walk', 20)}</span><span class="lbl">רדיוס</span><span class="chips" id="radChips">${RADII.map(r => '<button type="button" class="chip3 ' + (st.loc_radius === r ? 'on' : '') + '" data-r="' + r + '">' + (r >= 1000 ? r / 1000 + ' ק״מ' : r + ' מ׳') + '</button>').join('')}<span class="manual">ידני <input type="number" min="20" max="5000" id="locRad" value="${isPreset ? '' : (st.loc_radius || 150)}" placeholder="מ׳"></span></span></div>
          <div class="note info">כשמשתמש נכנס להאב נבקש ממנו לאמת מיקום. אפשר להיכנס גם בלי אימות (כניסה מרחוק). מי שאומת נשאר "נוכח" שעתיים.</div>`;
      }
      if (m === 'code' || m === 'both') {
        const link = location.origin + '/?hub=' + (hubId || '') + '&code=' + (st.presence_code || '');
        h += hubId ? `<div class="row" style="flex-direction:column;align-items:center"><div class="code-big">${esc(st.presence_code)}</div><div class="qrbox" id="stQr"></div><div class="small" style="direction:ltr;word-break:break-all;text-align:center">${esc(link)}</div></div>`
          : '<div class="note info">קוד ו-QR ייווצרו עם שמירת הנתונים או יצירת ההאב, ויוצגו כאן ובמסך ניהול ההאב.</div>';
      }
      box.innerHTML = h;
      if (m === 'location' || m === 'both') {
        initMap();
        const rad = n => { st.loc_radius = n; if (circle) circle.setRadius(n); H.$$('#radChips .chip3', box).forEach(x => x.classList.toggle('on', parseInt(x.dataset.r) === n)); };
        H.$$('#radChips .chip3', box).forEach(b => b.onclick = () => { rad(parseInt(b.dataset.r)); H.$('#locRad', box).value = ''; });
        H.$('#locRad', box).oninput = e => { const n = parseInt(e.target.value); if (n) rad(Math.max(20, Math.min(5000, n))); };
        H.$('#locAddr', box).oninput = e => { st.loc_address = e.target.value; };
        const find = async () => {
          const q = st.loc_address.trim(); if (!q) return H.toast('הזן כתובת לחיפוש');
          try { const r = await geocode(q); if (!r) return H.toast('הכתובת לא נמצאה. נסה לדייק או לסמן על המפה'); setLoc(r.lat, r.lng); H.toast('המיקום נמצא — אפשר לדייק בגרירת הסמן'); }
          catch (e) { H.toast('חיפוש הכתובת נכשל. סמן את המיקום על המפה'); }
        };
        H.$('#locFind', box).onclick = find; H.$('#locAddr', box).onkeydown = e => { if (e.key === 'Enter') find(); };
        const hb = H.$('#locHere', box);
        hb.onclick = async () => { hb.disabled = true; const pos = await H.getPosition(10000); hb.disabled = false; if (!pos) return H.toast('לא התקבל מיקום — אשר גישה למיקום בדפדפן'); setLoc(pos.lat, pos.lng); H.toast('המיקום נשמר (דיוק ~' + Math.round(pos.acc) + 'מ׳)'); };
      }
      const qb = H.$('#stQr', box); if (qb) { const q = qrcode(0, 'M'); q.addData(location.origin + '/?hub=' + hubId + '&code=' + st.presence_code); q.make(); qb.innerHTML = q.createSvgTag(4, 0); }
    }

    /* ---- block modal ---- */
    const sidePanel = H.el('<div class="side-panel"><div style="display:flex;justify-content:space-between;color:var(--gl-muted);font-size:13px;margin-bottom:12px"><span>תצוגה מקדימה של התכולה</span><button id="spClose" style="background:none;border:none;color:#fff;font-size:20px">×</button></div><div id="spBody"></div></div>');
    w.appendChild(sidePanel);
    H.$('#spClose', sidePanel).onclick = () => closeSide();
    let curOv = null;
    const closeSide = () => { sidePanel.classList.remove('open'); if (curOv) curOv.style.paddingLeft = ''; };
    const blockHtml = d => {
      let h = '<h3 class="c-title">' + esc(d.title || '(ללא שם)') + '</h3>';
      if (d.content) h += '<div class="c-text">' + esc(d.content) + '</div>';
      if (d.image_url) h += '<img class="c-img" src="' + esc(d.image_url) + '" alt="">';
      if (d.video_url) h += '<a href="' + esc(d.video_url) + '" target="_blank" rel="noopener">▶ וידאו: ' + esc(d.video_url) + '</a><br>';
      if (d.link_url) h += '<a href="' + esc(d.link_url) + '" target="_blank" rel="noopener">' + esc(d.link_url) + '</a>';
      if (!d.content && !d.image_url && !d.video_url && !d.link_url) h += '<p class="empty">עדיין אין תוכן.</p>';
      if (d.category === 'open') h += '<p style="color:#8fc0ff;font-size:13px">✎ פתוח להעלאת תוכן על ידי משתמשים</p>';
      return h;
    };
    function blockModal(b) {
      const cur = b ? { ...b } : { id: 'n' + Date.now(), category: 'info', title: '', content: '', image_url: '', video_url: '', link_url: '', is_default: false, is_visible: true };
      const body = `<div style="position:relative;display:flex;gap:8px;margin-bottom:12px"><input class="field-in" id="bName" placeholder="שם התכולה (למשל: ${PRESETS[type][2] || 'רשימת דוברים'})" value="${esc(cur.title)}"><button type="button" class="btn sm" id="bPick">בחר מרשימה ▾</button><div class="pick-list hidden" id="bPickList"></div></div>
        <textarea class="field-in" id="bText" placeholder="כתוב כאן את התכולה...">${esc(cur.content)}</textarea>
        <div class="tools"><label class="btn sm">העלאת קובץ טקסט<input type="file" id="bTxtFile" accept=".txt,text/plain" hidden></label><label class="btn sm">העלאת תמונה<input type="file" id="bImg" accept="image/*" hidden></label></div>
        <div id="bImgWrap" class="${cur.image_url ? '' : 'hidden'}" style="position:relative;display:inline-block;margin-bottom:10px"><img src="${esc(cur.image_url)}" id="bImgPrev" style="max-height:110px;border-radius:10px"><button type="button" id="bRmImg" style="position:absolute;top:-8px;right:-8px;width:22px;height:22px;border-radius:50%;border:none;background:#e5484d;color:#fff">×</button></div>
        <input class="field-in" id="bVid" placeholder="לינק לווידאו (YouTube / Vimeo)" value="${esc(cur.video_url)}" style="margin-bottom:8px">
        <input class="field-in" id="bLink" placeholder="לינק לאתר (רשות)" value="${esc(cur.link_url)}">
        <label class="chk" style="margin:10px 2px"><input type="checkbox" id="bOpen" ${cur.category === 'open' ? 'checked' : ''}> פתוח להעלאת תוכן על ידי משתמשים (כיתוב, תמונה או וידאו)</label>
        <div class="err" id="bErr" style="text-align:right"></div>`;
      const m = H.modal({
        title: b ? 'עריכת שדה רשות' : 'הוספת שדה רשות', body, dismiss: false, onClose: closeSide,
        actions: [
          { label: 'צפיה מוקדמת', close: false, onClick: (c, box) => { H.$('#spBody', sidePanel).innerHTML = blockHtml(read(box)); sidePanel.classList.add('open'); curOv.style.paddingLeft = 'calc(33.33vw + 20px)'; } },
          { label: 'חזור' },
          { label: 'אשר', cls: 'primary', onClick: (c, box) => {
            const d = read(box); if (!d.title) { H.$('#bErr', box).textContent = 'יש להזין שם לתכולה או לבחור מהרשימה'; return false; }
            if (b) Object.assign(b, d); else st.blocks.push(d);
            renderBlocks();
          } }]
      });
      curOv = m.ov;
      const box = m.el;
      const read = bx => ({ ...cur, title: H.$('#bName', bx).value.trim(), content: H.$('#bText', bx).value.trim(), video_url: H.$('#bVid', bx).value.trim(), link_url: H.$('#bLink', bx).value.trim(), category: H.$('#bOpen', bx).checked ? 'open' : 'info' });
      const pl = H.$('#bPickList', box);
      PRESETS[type].forEach(t => { const x = H.el('<button type="button">' + esc(t) + '</button>'); x.onclick = () => { H.$('#bName', box).value = t; pl.classList.add('hidden'); }; pl.appendChild(x); });
      H.$('#bPick', box).onclick = e => { e.stopPropagation(); pl.classList.toggle('hidden'); };
      box.addEventListener('click', () => pl.classList.add('hidden'));
      H.$('#bTxtFile', box).onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { const t = H.$('#bText', box); t.value = (t.value ? t.value + '\n' : '') + r.result; }; r.readAsText(f); e.target.value = ''; };
      const syncImg = () => { H.$('#bImgWrap', box).classList.toggle('hidden', !cur.image_url); H.$('#bImgPrev', box).src = cur.image_url; };
      H.$('#bImg', box).onchange = async e => { cur.image_url = await H.readImage(e.target.files[0], 900); syncImg(); e.target.value = ''; };
      H.$('#bRmImg', box).onclick = () => { cur.image_url = ''; syncImg(); };
    }

    /* ---- preview ("how users will see it") ---- */
    function preview() {
      if (!st.name.trim()) { H.$('#stErr', pg).textContent = 'יש להזין כותרת להאב (שדה חובה)'; return; }
      const me = H.me.active_card; const mine = me ? me.display_name : 'אני';
      const hubObj = { ...st, hub_id: 'preview', hub_type: type, is_mine: true };
      const ov = H.el('<div class="pv-ov"><div class="hubscr" style="height:100dvh"></div></div>');
      const scr = H.$('.hubscr', ov);
      scr.innerHTML = '<div class="pv-note">כך ההאב ייראה למשתמשים (תבנית: ' + esc((TEMPLATES.find(t => t.id === st.template_id) || {}).name) + ')</div><div class="hubview"></div><div class="pv-actions"><button class="btn lg" id="pvBack">חזור להגדרת ההאב</button></div>';
      w.appendChild(ov);
      const prevScreenRoot = H.screenRoot; H.screenRoot = scr;
      const people = [
        { user_id: 'me', display_name: mine, status: 'green', is_live: true, is_physical: true, is_owner: true, joined_at: 1, card: { company: me && me.company || '', title: me && me.title || '', nickname: me && me.nickname || '', bio: me && me.bio || '' } },
        { user_id: 'p2', display_name: 'שירה לוי', status: 'green', is_live: true, is_physical: true, is_owner: false, joined_at: 2, card: { company: 'חברה לדוגמה', title: 'מנהלת מוצר', nickname: 'שירי', bio: 'מחפשת שיתופי פעולה' } },
        { user_id: 'p3', display_name: 'דן כהן', status: 'red', is_live: true, is_physical: false, is_owner: false, joined_at: 3, card: {} },
      ];
      const board = [{ id: 'b1', sender_user_id: 'p2', sender_name: 'שירה לוי', sender_photo: '', is_owner: false, text: 'ברוכים הבאים! מישהו כבר פה?', image: '', ts: Date.now() / 1000 - 600, pinned_until: 0 }];
      const view = H.hubView(H.$('.hubview', scr), {
        hub: hubObj, blocks: st.blocks.filter(b => b.is_visible !== false).map((b, i) => ({ ...b, id: b.id || 'x' + i })), posts: {}, people, board, myId: 'me', isOwner: true, readonly: true, pm: null,
      });
      const close = () => { view.destroy(); ov.remove(); H.screenRoot = prevScreenRoot; };
      H.$('#pvBack', scr).onclick = close;
    }

    function validatePublish() {
      const err = H.$('#stErr', pg); err.textContent = '';
      if (!st.name.trim()) { err.textContent = 'יש להזין כותרת להאב (שדה חובה)'; H.$('[data-k=name]', pg).focus(); return false; }
      if ((st.presence_mode === 'location' || st.presence_mode === 'both') && (st.loc_lat == null)) { err.textContent = 'בחרת אימות לפי מיקום — יש להגדיר את מיקום ההאב (כתובת, מפה או מיקום נוכחי)'; return false; }
      return true;
    }
    const bodyOf = (draft) => ({ ...st, hub_type: type, draft });
    /* save without publishing (private to me); published hubs keep their state and stay in the editor */
    async function saveDraft(silent) {
      const err = H.$('#stErr', pg); if (err) err.textContent = '';
      try {
        const draft = hubId ? !published() : true;
        if (hubId) { await H.put('/api/hubs/' + hubId, bodyOf(draft)); }
        else { const res = await H.post('/api/hubs', bodyOf(true)); hubId = res.hub_id; st.presence_code = res.presence_code || st.presence_code; st.is_published = false; }
        saved = snap();
        if (!silent) H.toast(published() ? 'הנתונים נשמרו' : 'הנתונים נשמרו כטיוטה. רק את/ה רואה אותה ברשימת ההאבים');
        if (!silent && (st.presence_mode === 'code' || st.presence_mode === 'both')) renderPresence();
        return true;
      } catch (e) { if (err) err.textContent = e.message; if (e.data && e.data.code === 'need_card') { H.toast(e.message); H.go('cards'); } return false; }
    }
    async function publish() {
      if (!validatePublish()) return false;
      const err = H.$('#stErr', pg);
      try {
        let res;
        if (hubId) res = await H.put('/api/hubs/' + hubId, bodyOf(false)); else { res = await H.post('/api/hubs', bodyOf(false)); hubId = res.hub_id; }
        done = true; H.beforeLeave = null;
        H.toast(editing && published() ? 'ההאב עודכן' : 'ההאב נוצר בהצלחה');
        if (!st.auto_approve) H.toast('אישור משתמשים יתבצע בעמוד ניהול ההאב');
        if (!editing && (st.presence_mode === 'code' || st.presence_mode === 'both')) return H.go('manage', { hub_id: hubId });
        H.go('hub', { hub_id: hubId, nocard: 1 });
        return true;
      } catch (e) {
        if (e.data && e.data.code === 'need_card') { H.toast(e.message); H.go('cards'); }
        else if (e.data && e.data.code === 'need_business_card') { H.go('setup', { type: 'professional' }); }
        else err.textContent = e.message;
        return false;
      }
    }

    H.beforeLeave = () => new Promise(res => {
      if (!dirty()) return res(true);
      H.modal({
        title: 'לצאת מהגדרת ההאב?', body: '<p>יש שינויים שעוד לא נשמרו. אפשר לשמור את הנתונים (כטיוטה) ולחזור אליהם מאוחר יותר.</p>', dismiss: false,
        actions: [{ label: 'הישאר', onClick: () => res(false) }, { label: 'צא בלי לשמור', onClick: () => res(true) },
          { label: 'שמור נתונים וצא', cls: 'primary', close: false, onClick: async (close) => { const ok = await saveDraft(true); if (ok) { done = true; close(); res(true); } } }]
      });
    });
    H.cleanup = () => { H.beforeLeave = null; destroyMap(); };
    render();
  };
})();
