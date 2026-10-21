/* HUBBLE v15 — login / registration */
H.routes.login = async (p, root) => {
  const w = H.el(`<div class="screen"><div class="login-wrap"><div class="glass login-card">
    <img class="logo-full" src="/static/img/logo_full.png" alt="HUBIN">
    <h1>ברוכים הבאים ל-HUBIN</h1>
    <p class="lead" style="margin-bottom:18px">משתמש חדש - צור חשבון כדי להתחיל<br>משתמש חוזר - אנא הכנס את אחד המזהים שלך</p>
    <div class="row"><span class="ico">${H.ic('user', 18)}</span><input type="text" id="lgName" placeholder="שם (חובה למשתמש חדש)" autocomplete="name"></div>
    <p class="idlabel" style="margin-top:-4px">השם שתזין כאן הוא שם הרישום שלך — רק אתה תראה אותו. מה שאחרים יראו נקבע בכרטיס שלך.</p>
    <p class="idlabel"><b>מזהים</b> (בחר אחד או שניהם)</p>
    <div class="row"><span class="ico">${H.ic('phone', 18)}</span><input type="tel" id="lgPhone" placeholder="טלפון (למשל 050-1234567)" autocomplete="tel"></div>
    <div class="row"><span class="ico">${H.ic('mail', 18)}</span><input type="email" id="lgEmail" placeholder="מייל" autocomplete="email"></div>
    <div class="err" id="lgErr"></div>
    <button class="btn primary lg block" id="lgGo">כניסה</button>
    <p class="terms">בהמשך התהליך, הנך מאשר/ת את<br><a href="#" onclick="return false">תנאי השימוש</a> ואת <a href="#" onclick="return false">מדיניות הפרטיות</a> שלנו.</p>
  </div></div></div>`);
  root.appendChild(w);
  const go = async () => {
    const err = H.$('#lgErr', w); err.textContent = '';
    const body = { name: H.$('#lgName', w).value.trim(), phone: H.$('#lgPhone', w).value.trim(), email: H.$('#lgEmail', w).value.trim() };
    try {
      await H.post('/api/login', body);
      await H.refreshMe();
      if (H.sock) { H.sock.disconnect(); H.sock = null; }
      H.connectSocket();
      H.afterLogin();
    } catch (e) { err.textContent = e.message; }
  };
  H.$('#lgGo', w).onclick = go;
  w.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  H.$('#lgName', w).focus();
};
