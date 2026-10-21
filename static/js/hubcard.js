/* HUBBLE v15ב — hub business card (shown before entering a hub; preview inside the editor; mini window inside the hub) */
(function () {
  const esc = H.esc;
  const MAX_FILE = 5 * 1024 * 1024;

  /* read any file as a data URL (no resizing: needed for GIF / audio), limited to 5MB */
  H.readFileData = (file, max = MAX_FILE) => new Promise((resolve, reject) => {
    if (!file) return reject(new Error('לא נבחר קובץ'));
    if (file.size > max) return reject(new Error('הקובץ גדול מדי (עד ' + Math.round(max / 1048576) + 'MB)'));
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('שגיאה בקריאת הקובץ')); r.readAsDataURL(file);
  });

  /* data: {name, tagline, bg, bg_kind, song, message, registered, present, is_favorite, skip}
     opts: {mini, preview, onEnter, onBack, onFav, onShare, onSkip(skip)} → {destroy} */
  H.hubCard = function (host, data, opts = {}) {
    const d = data || {};
    const bgStyle = d.bg ? ' style="background-image:url(\'' + esc(d.bg) + '\')"' : '';
    host.innerHTML = '<div class="bc ' + (opts.mini ? 'mini' : '') + '">' +
      '<div class="bc-bg"' + bgStyle + '></div><div class="bc-veil"></div>' +
      '<div class="bc-top">' + (opts.mini ? '' : '<button class="bc-logo" id="bcBack" title="חזרה לרשימת ההאבים"><img src="/static/img/logo.png" alt=""></button>') +
      '<span style="flex:1"></span>' +
      (opts.preview || opts.mini ? '' : '<button class="bc-ic' + (d.is_favorite ? ' on' : '') + '" id="bcFav" title="מועדף">' + H.starSvg(!!d.is_favorite) + '</button><button class="bc-ic" id="bcShare" title="שתף">' + H.ic('share', 20) + '</button>') + '</div>' +
      '<div class="bc-mid"><div class="plate"><h2>' + esc(d.name || '') + '</h2>' + (d.tagline ? '<p>' + esc(d.tagline) + '</p>' : '') + '</div>' +
      '<div class="bc-stats"><div><small>כמות נרשמים</small><b>' + (d.registered == null ? 0 : d.registered) + '</b></div><div><small>נוכחי</small><b>' + (d.present == null ? 0 : d.present) + ' ' + H.ic('users', 16) + '</b></div></div>' +
      (d.song ? '<div class="eq"><div class="bars" id="bcBars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="pp"><button class="bc-ic" id="bcPlay" title="נגן">▶</button><button class="bc-ic" id="bcStop" title="עצור">■</button></div></div>' : '') +
      '</div>' +
      '<div class="bc-bot">' + (d.message ? '<div class="bc-msg"><b>הודעת המנהל</b><br>' + esc(d.message) + '</div>' : '') +
      (opts.mini ? '' : '<button class="btn primary lg bc-enter" id="bcEnter">כניסה להאב</button>' +
        (opts.preview ? '' : '<label class="bc-chk"><input type="checkbox" id="bcSkip"' + (d.skip ? ' checked' : '') + '><span class="cbx"></span>אל תציג שוב כרטיס ביקור בכניסה להאב זה</label>')) +
      '</div></div>';
    const $ = s => H.$(s, host);
    let audio = null;
    const bars = $('#bcBars');
    const setPlaying = on => { if (bars) bars.classList.toggle('on', on); };
    if (d.song) {
      audio = new Audio(d.song); audio.loop = true;
      $('#bcPlay').onclick = () => { audio.play().then(() => setPlaying(true)).catch(() => H.toast('לא ניתן לנגן את הקובץ')); };
      $('#bcStop').onclick = () => { audio.pause(); audio.currentTime = 0; setPlaying(false); };
    }
    if (!opts.mini && !opts.preview) {
      $('#bcFav').onclick = () => opts.onFav && opts.onFav();
      $('#bcShare').onclick = () => opts.onShare && opts.onShare();
      const sk = $('#bcSkip'); if (sk) sk.onchange = () => opts.onSkip && opts.onSkip(sk.checked);
    }
    if (!opts.mini) {
      const b = $('#bcBack'); if (b) b.onclick = () => opts.onBack && opts.onBack();
      $('#bcEnter').onclick = () => opts.onEnter && opts.onEnter();
    }
    return { destroy() { if (audio) { audio.pause(); audio = null; } } };
  };

  /* ---------------- editor: edit panel + live preview (below on phones) ---------------- */
  H.hubCardEditor = function (st, hubInfo, onDone) {
    const c = { bg: st.card_bg_url || '', kind: st.card_bg_kind || 'image', useHub: st.card_use_hub_bg !== false, song: st.card_song_url || '', msg: st.card_message || '' };
    const ov = H.el('<div class="ce-ov"><div class="ce"><div class="ce-edit"></div><div class="ce-prev"></div></div></div>');
    document.body.appendChild(ov);
    const edit = H.$('.ce-edit', ov), prev = H.$('.ce-prev', ov);
    let pv = null;
    const hubBg = () => st.background_image_url || '';
    const refreshPreview = () => {
      if (pv) pv.destroy();
      const bg = c.useHub && hubBg() ? hubBg() : c.bg;
      pv = H.hubCard(prev, { name: st.name || 'שם ההאב', tagline: st.tagline_visible !== false ? st.tagline : '', bg, song: c.song, message: c.msg, registered: 0, present: 0 }, { mini: true });
    };
    const draw = () => {
      edit.innerHTML = '<h3>כרטיס ביקור להאב</h3><p class="small">כרטיס זה יפתח לפני כניסה להאב</p>' +
        '<div class="ce-row"><span class="lbl">רקע</span><label class="btn sm">העלאת תמונה או GIF<input type="file" id="ceBg" accept="image/*" hidden></label>' + (c.bg ? '<button class="btn sm danger" id="ceBgRm">הסר</button>' : '') + '</div>' +
        '<label class="chk" style="margin:4px 2px 10px"><input type="checkbox" id="ceUse" ' + (c.useHub ? 'checked' : '') + (hubBg() ? '' : ' disabled') + '> השתמש בתמונת הרקע של ההאב' + (hubBg() ? '' : ' (לא הוגדרה תמונת רקע)') + '</label>' +
        '<div class="ce-row"><span class="lbl">שיר</span><label class="btn sm">העלאת קובץ שמע<input type="file" id="ceSong" accept="audio/*" hidden></label>' + (c.song ? '<span class="small">✓ הועלה</span><button class="btn sm danger" id="ceSongRm">הסר</button>' : '<span class="small">עד 5MB</span>') + '</div>' +
        '<div class="ce-row stack"><span class="lbl">הודעת מנהל</span><textarea class="field-in" id="ceMsg" rows="3" maxlength="400" placeholder="למשל: ברוכים הבאים! הכניסה משער 5">' + esc(c.msg) + '</textarea></div>' +
        '<div class="small" style="margin:6px 2px">הכותרת, כותרת המשנה ומספרי הנרשמים והנוכחים מוצגים אוטומטית מההאב.</div>' +
        '<div class="err" id="ceErr"></div>' +
        '<div class="btn-row center" style="margin-top:12px"><button class="btn" id="ceCancel">ביטול</button>' + (st.card_enabled ? '<button class="btn danger" id="ceOff">הסר את כרטיס הביקור</button>' : '') + '<button class="btn primary" id="ceOk">אשר ושמור</button></div>';
      const $ = s => H.$(s, edit), err = $('#ceErr');
      $('#ceBg').onchange = async e => {
        const f = e.target.files[0]; if (!f) return; err.textContent = '';
        try {
          if (/gif$/i.test(f.type)) { c.bg = await H.readFileData(f); c.kind = 'gif'; }
          else { c.bg = await H.readImage(f, 1600, .8); c.kind = 'image'; }
          c.useHub = false; draw(); refreshPreview();
        } catch (x) { err.textContent = x.message; }
      };
      const rm = $('#ceBgRm'); if (rm) rm.onclick = () => { c.bg = ''; draw(); refreshPreview(); };
      $('#ceUse').onchange = e => { c.useHub = e.target.checked; refreshPreview(); };
      $('#ceSong').onchange = async e => { try { c.song = await H.readFileData(e.target.files[0]); err.textContent = ''; draw(); refreshPreview(); } catch (x) { err.textContent = x.message; } };
      const rs = $('#ceSongRm'); if (rs) rs.onclick = () => { c.song = ''; draw(); refreshPreview(); };
      $('#ceMsg').oninput = e => { c.msg = e.target.value; refreshPreview(); };
      $('#ceCancel').onclick = () => close();
      const off = $('#ceOff'); if (off) off.onclick = () => { st.card_enabled = false; close(true); };
      $('#ceOk').onclick = () => {
        st.card_enabled = true; st.card_bg_url = c.bg; st.card_bg_kind = c.kind; st.card_use_hub_bg = c.useHub; st.card_song_url = c.song; st.card_message = c.msg;
        close(true);
      };
    };
    const close = changed => { if (pv) pv.destroy(); ov.remove(); onDone && onDone(!!changed); };
    draw(); refreshPreview();
  };
})();
