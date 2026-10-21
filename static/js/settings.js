/* HUBBLE v15 — settings (gear), lock screen, super-admin entry */
(function () {
  const sw = (id, on) => '<button class="sw2 ' + (on ? 'on' : '') + '" data-sw="' + id + '" aria-pressed="' + !!on + '"></button>';

  H.settings = () => {
    const me = H.me || {}, prefs = me.prefs || {};
    const lines = [
      ['sound_pm', 'צליל להודעה פרטית חדשה'], ['sound_hub_msg', 'צליל להודעה בלוח ההאב'],
      ['sound_hub_join', 'צליל כשמישהו מצטרף להאב'], ['sound_invite', 'צליל להזמנה להאב'],
      ['sound_app_open', 'צליל בכניסה לאפליקציה'], ['sound_hub_enter', 'צליל בכניסה להאב'], ['sound_send', 'צליל בשליחת הודעה'],
    ];
    const body = H.el('<div></div>');
    body.innerHTML =
      '<div class="set-sec">עיצוב האפליקציה</div>' +
      '<div class="designs"><button class="dz ' + (me.theme !== 'light' ? 'on' : '') + '" data-th="space"><i class="s1"></i>חללי</button>' +
      '<button class="dz ' + (me.theme === 'light' ? 'on' : '') + '" data-th="light"><i class="s2"></i>בהיר</button></div>' +
      '<div class="set-sec">צלילים</div>' +
      lines.map(l => '<div class="set-row"><span class="lb">' + l[1] + '</span>' + sw(l[0], prefs[l[0]]) + '</div>').join('') +
      '<div class="set-sec">אבטחה</div>' +
      '<div class="set-row"><div><div class="lb">סיסמת כניסה</div><div class="sub">' + (me.has_password ? 'מוגדרת — תידרש בכל פתיחה חדשה של האפליקציה. אין שחזור עצמי; במקרה שכחה יש לפנות למנהל.' : 'לא מוגדרת') + '</div></div>' +
      '<span style="display:flex;gap:6px"><button class="btn sm" id="stPw">' + (me.has_password ? 'שינוי' : 'הגדרה') + '</button>' + (me.has_password ? '<button class="btn sm danger" id="stPwDel">מחיקה</button>' : '') + '</span></div>' +
      '<div class="set-sec">שפה</div>' +
      '<div class="set-row"><span class="lb">שפת האפליקציה</span><span style="display:flex;gap:6px"><button class="chip2 on" data-lang="he">עברית</button><button class="chip2" data-lang="en" style="opacity:.6">English</button></span></div>' +
      '<div class="set-sec">מנהל מערכת</div>' +
      '<div class="set-row"><span class="lb">' + (me.is_super ? 'מנהל-על פעיל במכשיר זה' : 'כניסת מנהל') + '</span><button class="btn sm" id="stSuper">' + (me.is_super ? 'סטטיסטיקה' : 'כניסה') + '</button></div>';
    const mod = H.modal({ title: 'הגדרות', body, actions: [{ label: 'סגור', cls: 'primary' }] });

    H.$$('[data-th]', body).forEach(b => b.onclick = async () => {
      try { await H.put('/api/settings', { theme: b.dataset.th }); me.theme = b.dataset.th; H.applyTheme(me.theme); H.$$('[data-th]', body).forEach(x => x.classList.toggle('on', x === b)); } catch (e) { H.toast(e.message); }
    });
    H.$$('[data-sw]', body).forEach(b => b.onclick = () => {
      const on = !b.classList.contains('on'); b.classList.toggle('on', on); H.setPref(b.dataset.sw, on);
      if (on) H.sound(b.dataset.sw.replace('sound_', ''));
    });
    H.$$('[data-lang]', body).forEach(b => b.onclick = () => { if (b.dataset.lang === 'en') H.toast('English will be available in a later version. האנגלית עדיין לא פעילה'); });
    H.$('#stPw', body).onclick = () => { mod.close(); passwordDialog(); };
    const del = H.$('#stPwDel', body);
    if (del) del.onclick = async () => {
      mod.close();
      const cur = await H.prompt('מחיקת סיסמה', 'הזן את הסיסמה הנוכחית'); if (cur === null) return;
      try { await H.api('DELETE', '/api/password', { current: cur }); me.has_password = false; H.toast('הסיסמה נמחקה'); } catch (e) { H.toast(e.message); }
    };
    H.$('#stSuper', body).onclick = async () => {
      mod.close();
      if (me.is_super) {
        try { const s = await H.get('/api/super/stats'); H.modal({ title: 'סטטיסטיקת מערכת', body: '<p>משתמשים: <b>' + s.users + '</b><br>האבים: <b>' + s.hubs + '</b> (פתוחים: ' + s.open_hubs + ')<br>כרטיסים: <b>' + s.cards + '</b><br>הודעות פרטיות: <b>' + s.messages + '</b></p>', actions: [{ label: 'סגור' }] }); } catch (e) { H.toast(e.message); }
        return;
      }
      const pw = await H.prompt('כניסת מנהל', 'סיסמת מנהל'); if (!pw) return;
      try { await H.post('/api/super/claim', { password: pw }); me.is_super = true; H.toast('מנהל-על הופעל במכשיר זה'); } catch (e) { H.toast(e.message); }
    };
  };

  function passwordDialog() {
    const me = H.me;
    const body = '<p class="hint">הסיסמה תידרש בכל פתיחה חדשה של האפליקציה. אין שחזור עצמי.</p>' +
      (me.has_password ? '<input class="field-in" id="pwCur" type="password" placeholder="סיסמה נוכחית" style="margin-bottom:8px">' : '') +
      '<input class="field-in" id="pw1" type="password" placeholder="סיסמה חדשה (לפחות 4 תווים)" style="margin-bottom:8px"><input class="field-in" id="pw2" type="password" placeholder="הזן שוב את הסיסמה"><div class="err" id="pwErr"></div>';
    H.modal({
      title: me.has_password ? 'שינוי סיסמה' : 'הגדרת סיסמה', body, actions: [{ label: 'ביטול' }, {
        label: 'שמור', cls: 'primary', onClick: async (close, box) => {
          const cur = box.querySelector('#pwCur');
          try { await H.post('/api/password', { password: box.querySelector('#pw1').value, confirm: box.querySelector('#pw2').value, current: cur ? cur.value : '' }); me.has_password = true; H.toast('הסיסמה נשמרה'); }
          catch (e) { box.querySelector('#pwErr').textContent = e.message; return false; }
        }
      }]
    });
  }

  H.routes.lock = async (p, root) => {
    const w = H.el(`<div class="screen"><div class="lock-wrap"><div class="glass login-card">
      <img class="logo-full" src="/static/img/logo_full.png" alt="HUBIN">
      <h1>האפליקציה נעולה</h1><p class="lead">הזן את הסיסמה כדי להמשיך</p>
      <div class="row"><span class="ico">${H.ic('lock', 18)}</span><input type="password" id="lkPw" placeholder="סיסמה" autocomplete="current-password"></div>
      <div class="err" id="lkErr"></div><button class="btn primary lg block" id="lkGo">כניסה</button>
      <p class="terms">שכחת סיסמה? אין שחזור עצמי — יש לפנות למנהל המערכת.</p></div></div></div>`);
    root.appendChild(w);
    const go = async () => {
      try {
        await H.post('/api/unlock', { password: H.$('#lkPw', w).value });
        await H.refreshMe(); H.connectSocket();
        if (!H.me.registered) return H.go('login');
        H.afterLogin();
      } catch (e) { H.$('#lkErr', w).textContent = e.message; }
    };
    H.$('#lkGo', w).onclick = go; w.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    H.$('#lkPw', w).focus();
  };
})();
