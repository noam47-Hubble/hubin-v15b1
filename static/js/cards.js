/* HUBBLE v15 — my cards: list + editor + card view */
(function () {
  const LABELS = { name: 'שם', nickname: 'כינוי', title: 'תפקיד', company: 'חברה', phone: 'טלפון', email: 'מייל', website: 'אתר', linkedin: 'לינקדאין',
    instagram: 'אינסטגרם', tiktok: 'טיקטוק', other_social: 'רשת חברתית אחרת', bio: 'משפט מפתח', card_image: 'כרטיס ביקור (תמונה)' };
  const FIELDS = {
    business: ['name', 'nickname', 'title', 'company', 'phone', 'email', 'website', 'bio'],
    social: ['name', 'nickname', 'bio', 'phone', 'email'],
  };
  const LEGACY_NET = ['linkedin', 'instagram', 'tiktok', 'other_social'];
  const NET_TYPES = [['instagram', 'אינסטגרם'], ['tiktok', 'טיקטוק'], ['facebook', 'פייסבוק'], ['linkedin', 'לינקדאין'], ['x', 'X (טוויטר)'],
    ['youtube', 'יוטיוב'], ['telegram', 'טלגרם'], ['whatsapp', 'וואטסאפ'], ['other', 'אחר']];
  const MOODS = ['😀', '😎', '🥳', '🤔', '😴', '💪', '🎯', '☕', '🎧', '🚀'];
  const netName = n => (NET_TYPES.find(x => x[0] === n.type) || ['', n.type])[1];
  const netLink = n => {
    const v = n.value || ''; if (/^https?:/i.test(v)) return v;
    const h = v.replace(/^@/, '');
    return { instagram: 'https://instagram.com/' + h, tiktok: 'https://tiktok.com/@' + h, facebook: 'https://facebook.com/' + h, linkedin: 'https://linkedin.com/in/' + h,
      x: 'https://x.com/' + h, youtube: 'https://youtube.com/@' + h, telegram: 'https://t.me/' + h, whatsapp: 'https://wa.me/' + h.replace(/\D/g, '') }[n.type] || null;
  };
  H.CARD_LABELS = LABELS;

  /* a card as others see it (public dict) -> HTML for a modal / preview */
  H.cardHtml = (c, opts = {}) => {
    if (!c || !Object.keys(c).length) return '<p class="empty">אין פרטי כרטיס להצגה</p>';
    const nm = c.display_name || c.name || c.nickname || 'צופה';
    let h = '<div class="cardview">' + (c.photo_url ? '<div class="av lg zoomable" data-zoom="' + H.esc(c.photo_url) + '" style="background-image:url(\'' + H.esc(c.photo_url) + '\')"></div>' : H.avatar('', nm, c.id, 'lg')) + '<h3>' + H.esc(nm) + (c.mood ? ' ' + H.esc(c.mood) : '') + '</h3>' +
      (c.type ? '<span class="tag">' + (c.type === 'business' ? 'כרטיס עסקי' : 'כרטיס חברתי') + '</span>' : '') + (opts.tag || '') + '</div>';
    const row = (k, v, link) => '<div class="cv-row"><span>' + LABELS[k] + '</span><span>' + (link ? '<a href="' + H.esc(link) + '" target="_blank" rel="noopener">' + H.esc(v) + '</a>' : H.esc(v)) + '</span></div>';
    if (c.nickname && c.name) h += row('nickname', c.nickname);
    ['title', 'company', 'bio', 'phone', 'email'].forEach(k => { if (c[k]) h += row(k, c[k], k === 'phone' ? 'tel:' + c[k] : k === 'email' ? 'mailto:' + c[k] : null); });
    ['website', 'linkedin', 'instagram', 'tiktok', 'other_social'].forEach(k => { if (c[k]) h += row(k, c[k], /^https?:/i.test(c[k]) ? c[k] : (k === 'website' || k === 'linkedin' ? 'https://' + c[k] : null)); });
    (c.networks || []).forEach(n => { const l = netLink(n); h += '<div class="cv-row"><span>' + H.esc(netName(n)) + '</span><span>' + (l ? '<a href="' + H.esc(l) + '" target="_blank" rel="noopener">' + H.esc(n.value) + '</a>' : H.esc(n.value)) + '</span></div>'; });
    if (c.card_image) h += '<img class="cv-img" src="' + c.card_image + '" alt="">';
    if (c.photos && c.photos.length > 1) h += '<div class="photo-grid" style="justify-content:center;margin-top:10px">' + c.photos.map(u => '<img class="thumb" style="width:52px;height:52px;border-radius:10px" src="' + H.esc(u) + '">').join('') + '</div>';
    return h;
  };

  H.routes.cards = async (p, root) => {
    const w = H.el('<div class="screen"></div>');
    root.appendChild(w);
    let cards = [];
    const load = async () => { cards = await H.get('/api/cards'); await H.refreshMe(); };

    const list = async () => {
      await load();
      w.innerHTML = '';
      w.appendChild(H.topbar({ title: 'הכרטיסים שלי' }));
      const pg = H.el('<div class="page"></div>'); w.appendChild(pg);
      pg.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><button class="fab" id="cdNew" title="כרטיס חדש">${H.ic('plus', 26)}</button><h1 class="title" style="flex:1;text-align:right;margin:0;font-size:20px">${cards.length ? 'הכרטיסים שלי' : 'עדיין אין לך כרטיסים — לחץ על ה-+ כדי ליצור'}</h1></div><div class="card-list" id="cdList"></div>`;
      const box = H.$('#cdList', pg);
      cards.forEach(c => {
        const el = H.el(`<div class="card-row ${c.is_active ? 'active' : ''}">
          ${H.avatar(c.photo_url, c.display_name, c.id)}
          <div class="card-info"><div class="n">${H.esc(c.card_name || c.display_name)} - ${c.type === 'business' ? 'עסקי' : 'חברתי'}${c.is_active ? '<span class="active-lbl">פעיל</span>' : ''}</div>
            <div class="l">${H.esc(c.display_name)}${c.mood ? ' ' + c.mood : ''}${c.is_viewer ? ' (צופה)' : ''}</div></div>
          <span class="dot click ${c.effective_open ? 'g' : 'rd'}" title="${c.is_viewer ? 'כרטיס צופה — סגור לתקשורת' : c.effective_open ? 'פתוח לתקשורת — לחץ לסגירה' : 'סגור לתקשורת — לחץ לפתיחה'}"></span>
          <div class="acts">${c.is_active ? '' : '<button class="btn sm primary" data-a="act">הפוך לפעיל</button>'}<button class="btn sm" data-a="edit">עריכה</button><button class="btn sm danger" data-a="del">מחיקה</button></div></div>`);
        H.$('.dot', el).onclick = async () => {
          if (c.is_viewer) return H.toast('כדי להיות פתוח לתקשורת יש להציג שם או כינוי בכרטיס');
          await H.post('/api/cards/' + c.id + '/open', { open: !c.is_open_to_contact }); list();
        };
        H.$$('[data-a]', el).forEach(b => b.onclick = async () => {
          const a = b.dataset.a;
          if (a === 'act') { await H.post('/api/cards/' + c.id + '/activate'); H.toast('הכרטיס הפך לפעיל'); list(); }
          if (a === 'edit') editor(c);
          if (a === 'del' && await H.confirm('למחוק את הכרטיס "' + H.esc(c.card_name || c.display_name) + '"?', 'מחיקה', true)) { await H.del('/api/cards/' + c.id); list(); }
        });
        box.appendChild(el);
      });
      H.$('#cdNew', pg).onclick = () => {
        H.modal({
          title: 'איזה כרטיס ליצור?', body: '<p>כרטיס עסקי נדרש להאב מקצועי. כרטיס חברתי מתאים להאבים חברתיים.</p>',
          actions: [{ label: 'כרטיס עסקי', cls: 'primary', onClick: () => editor(null, 'business') }, { label: 'כרטיס חברתי', cls: 'primary', onClick: () => editor(null, 'social') }, { label: 'ביטול' }]
        });
      };
    };

    const editor = (card, type) => {
      type = card ? card.type : type;
      const st = card ? JSON.parse(JSON.stringify(card)) : { type, card_name: '', degree: '', is_open_to_contact: true, photos: [], card_image: '', card_image_visible: false };
      st.networks = (st.networks || []).slice();
      if (!st.networks.length && card) LEGACY_NET.forEach(f => { if (st[f]) st.networks.push({ type: f === 'other_social' ? 'other' : f, value: st[f] }); });
      if (st.networks_visible === undefined) st.networks_visible = !!st.networks.length || false;
      st.mood = st.mood || '';
      FIELDS[type].forEach(f => { if (st[f] === undefined) { st[f] = ''; st[f + '_visible'] = (type === 'social' ? ['name', 'nickname', 'bio'] : ['name', 'title', 'company']).includes(f); } });
      w.innerHTML = '';
      w.appendChild(H.topbar({ title: card ? 'עריכת כרטיס' : (type === 'business' ? 'כרטיס עסקי חדש' : 'כרטיס חברתי חדש') }));
      const pg = H.el('<div class="page"></div>'); w.appendChild(pg);
      const fieldRow = f => `<div class="row cf-row"><span class="lbl">${LABELS[f]}</span><input type="text" data-f="${f}" value="${H.esc(st[f] || '')}" placeholder="">
        <label class="vis chk"><input type="checkbox" data-v="${f}" ${st[f + '_visible'] ? 'checked' : ''}>מוצג</label></div>`;
      pg.innerHTML = `
        <div class="row"><span class="lbl">שם הכרטיס (רק אתה רואה שם זה)</span><input type="text" id="ceCardName" value="${H.esc(st.card_name)}" placeholder="${type === 'business' ? 'כרטיס עסקי' : 'כרטיס חברתי'}"></div>
        ${type === 'business' ? `<div class="row"><span class="lbl">תואר</span><input type="text" id="ceDegree" value="${H.esc(st.degree)}" placeholder="ד״ר, עו״ד, מהנדס..."></div>` : ''}
        <div class="row clickable" id="ceMoodRow"><span class="lbl">מצב רוח</span><span class="grow" id="ceMoodVal" style="font-size:22px">${st.mood || '<span class="small">לא נבחר</span>'}</span><span class="small">בחירה</span></div>
        <div class="emojis hidden" id="ceMoods">${MOODS.map(e => '<span data-e="' + e + '" class="' + (st.mood === e ? 'on' : '') + '">' + e + '</span>').join('')}<span data-e="" style="font-size:13px;grid-column:span 5">ללא</span></div>
        <div class="grp">פרטי הכרטיס — סמן מה יוצג לאחרים</div>
        <div id="ceFields">${FIELDS[type].map(fieldRow).join('')}</div>
        <div class="grp">רשתות חברתיות</div>
        <div id="ceNets"></div>
        <div class="erow-sn row" id="ceNetAdd" style="flex-wrap:wrap"><span class="lbl">רשתות חברתיות</span>
          <select id="ceNetType"><option value="">בחר רשת...</option>${NET_TYPES.map(n => '<option value="' + n[0] + '">' + n[1] + '</option>').join('')}</select>
          <input type="text" id="ceNetOther" class="hidden" placeholder="שם הרשת" style="flex:1;min-width:90px">
          <input type="text" id="ceNetVal" placeholder="כתובת / שם משתמש" style="flex:2;min-width:120px">
          <button class="btn sm primary" id="ceNetOk">אישור</button><button class="btn sm" id="ceNetNo">ביטול</button></div>
        <div class="row"><span class="grow small">הצגת הרשתות החברתיות באופן ציבורי בכרטיס</span><label class="vis chk"><input type="checkbox" id="ceNetsVis" ${st.networks_visible ? 'checked' : ''}>מוצג</label></div>
        ${type === 'business' ? `<div class="row"><span class="lbl">כרטיס ביקור (תמונה)</span><span class="grow"><img class="thumb ${st.card_image ? '' : 'hidden'}" id="ceCiThumb" src="${st.card_image || ''}" style="border-radius:8px"></span>
          <label class="btn sm">העלאה<input type="file" id="ceCi" accept="image/*" hidden></label><label class="vis chk"><input type="checkbox" data-v="card_image" ${st.card_image_visible ? 'checked' : ''}>מוצג</label></div>` : ''}
        <div class="grp">תמונות (לחיצה על תמונה מגדילה אותה; "הגדר כפרופיל" קובע את תמונת הפרופיל)</div>
        <div class="photo-grid" id="cePhotos"></div>
        <label class="btn sm" style="display:inline-block">הוספת תמונה<input type="file" id="cePh" accept="image/*" multiple hidden></label>
        <div class="grp">זמינות</div>
        <div class="row"><span class="grow">פתוח לתקשורת (נקודה ירוקה) / סגור (אדומה)</span><label class="sw"><input type="checkbox" id="ceOpen" ${st.is_open_to_contact ? 'checked' : ''}><span></span></label></div>
        <div class="note" id="ceViewerNote"></div>
        <div class="err" id="ceErr"></div>
        <div class="btn-row center" style="margin-top:12px"><button class="btn" id="ceCancel">ביטול</button><button class="btn" id="cePrev">הצג כרטיס</button><button class="btn primary" id="ceSave">שמור כרטיס</button></div>`;
      const read = () => {
        const dg = H.$('#ceDegree', pg);
        const d = { type, card_name: H.$('#ceCardName', pg).value.trim(), degree: dg ? dg.value.trim() : '', is_open_to_contact: H.$('#ceOpen', pg).checked,
          mood: st.mood || '', networks: st.networks, networks_visible: H.$('#ceNetsVis', pg).checked };
        LEGACY_NET.forEach(f => { d[f] = ''; d[f + '_visible'] = false; });
        H.$$('[data-f]', pg).forEach(i => { d[i.dataset.f] = i.value.trim(); });
        H.$$('[data-v]', pg).forEach(i => { d[i.dataset.v + '_visible'] = i.checked; });
        if (type === 'business') d.card_image = st.card_image || '';
        d.photos = st.photos.map(x => ({ url: x.url, is_visible: true, is_profile_photo: !!x.is_profile_photo }));
        return d;
      };
      const viewerNote = () => {
        const d = read();
        const viewer = !((d.name_visible && d.name) || (d.nickname_visible && d.nickname));
        H.$('#ceViewerNote', pg).textContent = viewer ? 'שם וכינוי מוסתרים — הכרטיס יוצג כ"צופה": סגור לתקשורת וניתן רק לצפות בהאבים.' : '';
        H.$('#ceViewerNote', pg).style.color = viewer ? '#ff9a9d' : '';
      };
      H.$('#ceFields', pg).addEventListener('input', viewerNote); H.$('#ceFields', pg).addEventListener('change', viewerNote);
      viewerNote();
      /* mood picker */
      H.$('#ceMoodRow', pg).onclick = () => H.$('#ceMoods', pg).classList.toggle('hidden');
      H.$$('#ceMoods [data-e]', pg).forEach(s => s.onclick = () => {
        st.mood = s.dataset.e; H.$('#ceMoodVal', pg).innerHTML = st.mood || '<span class="small">לא נבחר</span>';
        H.$$('#ceMoods [data-e]', pg).forEach(x => x.classList.toggle('on', x === s)); H.$('#ceMoods', pg).classList.add('hidden');
      });
      /* social networks: choose a network, type the handle, approve / cancel */
      const netsRender = () => {
        const box = H.$('#ceNets', pg); box.innerHTML = '';
        st.networks.forEach((n, i) => {
          const it = H.el('<div class="sn-done"><b>' + H.esc(netName(n)) + '</b><span style="flex:1;direction:ltr;text-align:right">' + H.esc(n.value) + '</span><button class="btn sm danger">הסר</button></div>');
          H.$('button', it).onclick = () => { st.networks.splice(i, 1); netsRender(); };
          box.appendChild(it);
        });
      };
      const netType = H.$('#ceNetType', pg), netOther = H.$('#ceNetOther', pg), netVal = H.$('#ceNetVal', pg);
      const netReset = () => { netType.value = ''; netOther.value = ''; netOther.classList.add('hidden'); netVal.value = ''; };
      netType.onchange = () => netOther.classList.toggle('hidden', netType.value !== 'other');
      H.$('#ceNetNo', pg).onclick = netReset;
      H.$('#ceNetOk', pg).onclick = () => {
        const t = netType.value, v = netVal.value.trim();
        if (!t) return H.toast('בחר רשת חברתית');
        if (!v) return H.toast('הזן כתובת או שם משתמש');
        if (t === 'other' && !netOther.value.trim()) return H.toast('הזן את שם הרשת');
        st.networks.push({ type: t === 'other' ? netOther.value.trim() : t, value: v });
        if (st.networks.length >= 12) H.toast('הגעת למקסימום רשתות');
        netReset(); netsRender();
      };
      netsRender();
      const phRender = () => {
        const g = H.$('#cePhotos', pg); g.innerHTML = '';
        if (st.photos.length && !st.photos.some(x => x.is_profile_photo)) st.photos[0].is_profile_photo = true;
        st.photos.forEach((ph, i) => {
          const it = H.el(`<div class="photo-item ${ph.is_profile_photo ? 'main' : ''}"><img src="${H.esc(ph.url)}" alt=""><button title="הסר">×</button><a class="setp" style="cursor:pointer">${ph.is_profile_photo ? 'פרופיל' : 'הגדר כפרופיל'}</a></div>`);
          H.$('.setp', it).onclick = () => { st.photos.forEach(x => x.is_profile_photo = false); ph.is_profile_photo = true; phRender(); };
          H.$('button', it).onclick = () => { st.photos.splice(i, 1); phRender(); };
          g.appendChild(it);
        });
      };
      phRender();
      H.$('#cePh', pg).onchange = async e => { for (const f of e.target.files) { if (st.photos.length >= 8) break; st.photos.push({ url: await H.readImage(f, 700), is_profile_photo: false, is_visible: true }); } e.target.value = ''; phRender(); };
      const ci = H.$('#ceCi', pg);
      if (ci) ci.onchange = async e => { st.card_image = await H.readImage(e.target.files[0], 1100); const t = H.$('#ceCiThumb', pg); t.src = st.card_image; t.classList.remove('hidden'); };
      H.$('#ceCancel', pg).onclick = list;
      H.$('#cePrev', pg).onclick = () => {
        const d = read(); const pub = { type, display_name: '', photos: [] };
        FIELDS[type].concat(type === 'business' ? ['card_image'] : []).forEach(f => { if (d[f + '_visible'] && d[f]) pub[f] = d[f]; });
        pub.display_name = pub.name ? (d.degree ? d.degree + ' ' : '') + pub.name : (pub.nickname || 'צופה');
        const prof = st.photos.find(x => x.is_profile_photo); pub.photo_url = prof ? prof.url : ''; pub.photos = st.photos.map(x => x.url);
        if (d.networks_visible && st.networks.length) pub.networks = st.networks;
        if (st.mood) pub.mood = st.mood;
        const viewer = !pub.name && !pub.nickname;
        H.modal({ title: 'כך אחרים יראו את הכרטיס', body: H.cardHtml(pub, { tag: viewer ? '<span class="tag" style="color:#ff9a9d;border-color:#e0494e">צופה</span>' : '' }), actions: [{ label: 'סגור', cls: 'primary' }] });
      };
      H.$('#ceSave', pg).onclick = async () => {
        const d = read(); const err = H.$('#ceErr', pg); err.textContent = '';
        try {
          if (card) await H.put('/api/cards/' + card.id, d); else await H.post('/api/cards', d);
          await H.refreshMe(); H.toast('הכרטיס נשמר');
          if (p.back) return H.go(p.back, p.backParams || {});
          list();
        } catch (e) { err.textContent = e.message; }
      };
    };

    if (p.editId) { await load(); const cc = cards.find(x => x.id === p.editId); if (cc) return editor(cc); }
    if (p.newType) editor(null, p.newType); else await list();
  };
})();
