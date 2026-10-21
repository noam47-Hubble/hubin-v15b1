/* HUBIN — sharing: a hub, window contents (as pictures) or the report (as a PDF file);
   inside the app (contacts + groups) or outside it (WhatsApp / other apps) */
(function () {
  const esc = H.esc;
  const loadScript = src => new Promise((res, rej) => {
    if (document.querySelector('script[data-lib="' + src + '"]')) return res();
    const s = document.createElement('script'); s.src = src; s.dataset.lib = src; s.onload = res; s.onerror = () => rej(new Error('טעינת הרכיב נכשלה. בדוק חיבור לאינטרנט')); document.head.appendChild(s);
  });
  const libs = async pdf => { await loadScript('/static/vendor/share/html2canvas.min.js'); if (pdf) await loadScript('/static/vendor/share/jspdf.umd.min.js'); };
  const hubUrl = hub => location.origin + '/?hub=' + hub.hub_id;
  const inviteText = hub => 'הוזמנת להאב "' + hub.name + '" ב-HUBIN\n' + hubUrl(hub);
  const toFile = (url, name) => { const [h, b] = url.split(','); const mime = (h.match(/:(.*?)[;,]/) || [0, 'application/octet-stream'])[1]; const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name, { type: mime }); };
  const download = (url, name) => { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  const busy = msg => { const el = H.el('<div class="ov"><div class="modal"><p style="text-align:center;margin:10px 0">' + esc(msg) + '</p></div></div>'); (H.screenRoot || document.body).appendChild(el); return () => el.remove(); };

  /* ----- capture a hub window as a picture ----- */
  async function captureBlocks(view, ids) {
    await libs(false);
    const root = H.screenRoot || document.body, out = [];
    for (const id of ids) {
      const b = view.blocks().find(x => x.id === id); if (!b) continue;
      const box = H.el('<div class="hubwrap share-cap" style="position:fixed;left:-12000px;top:0;width:560px;display:block"><div class="windows" style="display:block"><div class="win">' + view.winHtml(b, true) + '</div></div></div>');
      root.appendChild(box);
      try {
        await new Promise(r => setTimeout(r, 60));
        const cv = await window.html2canvas(H.$('.win', box), { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, onclone: d => { const st = d.createElement('style'); st.textContent = NOFX; d.head.appendChild(st); fixColors(d); } });
        out.push(cv.toDataURL('image/jpeg', 0.88));
      } catch (e) { console.error(e); } finally { box.remove(); }
    }
    return out;
  }

  const CP = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor', 'fill', 'stroke'];
  let _cx; function rgba(v) { _cx = _cx || document.createElement('canvas').getContext('2d', { willReadFrequently: true }); _cx.clearRect(0, 0, 1, 1); _cx.fillStyle = '#000'; _cx.fillStyle = v; _cx.fillRect(0, 0, 1, 1); const d = _cx.getImageData(0, 0, 1, 1).data; return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(3) + ')'; }
  function fixColors(d) {
    const w = d.defaultView; if (!w) return;
    d.querySelectorAll('*').forEach(el => { let cs; try { cs = w.getComputedStyle(el); } catch (e) { return; } CP.forEach(p => { const v = cs[p]; if (v && v.indexOf('color(') >= 0) el.style[p] = rgba(v); }); });
  }
  const NOFX = '*{box-shadow:none!important;animation:none!important;background-image:none!important;border-image:none!important;text-shadow:none!important;filter:none!important;backdrop-filter:none!important}';
  /* ----- the report element as a multi-page A4 PDF ----- */
  async function reportPdf(el) {
    await libs(true);
    const cv = await window.html2canvas(el, { scale: 1.6, useCORS: true, backgroundColor: '#ffffff', logging: false, windowHeight: el.scrollHeight + 50, ignoreElements: e => e.classList && e.classList.contains('noprint'), onclone: d => { const st = d.createElement('style'); st.textContent = NOFX; d.head.appendChild(st); fixColors(d); d.querySelectorAll('.rep-ov').forEach(x => { x.style.overflow = 'visible'; x.style.height = 'auto'; x.style.position = 'static'; }); } });
    const { jsPDF } = window.jspdf; const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), m = 24;
    const iw = pw - 2 * m, scale = iw / cv.width, slice = Math.floor((ph - 2 * m) / scale);
    for (let y = 0, p = 0; y < cv.height; y += slice, p++) {
      const h = Math.min(slice, cv.height - y), pg = document.createElement('canvas'); pg.width = cv.width; pg.height = h;
      pg.getContext('2d').drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
      if (p) pdf.addPage();
      pdf.addImage(pg.toDataURL('image/jpeg', 0.9), 'JPEG', m, m, iw, h * scale);
    }
    return pdf.output('datauristring');
  }

  /* ----- outside the app ----- */
  async function externalShare(o) {
    const title = 'HUBIN — ' + o.hub.name, text = inviteText(o.hub);
    const files = (o.images || []).map((u, i) => toFile(u, 'hubin-' + (i + 1) + '.jpg'));
    if (o.file) files.push(toFile(o.file, o.fileName || 'report.pdf'));
    try {
      if (files.length && navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files, text, title }); return; }
      if (!files.length && navigator.share) { await navigator.share({ title, text, url: hubUrl(o.hub) }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const body = H.el('<div><p style="margin:0 0 10px">בחר אפליקציה לשיתוף. הקישור להאב נכלל בהודעה.</p><div class="share-opts"></div>' + (files.length ? '<div class="warnnote" style="margin-top:10px">אפשר לצרף את הקבצים אחרי שמירתם למכשיר.</div>' : '') + '</div>');
    const box = H.$('.share-opts', body);
    const add = (label, fn) => { const b = H.el('<button class="btn lg">' + label + '</button>'); b.onclick = fn; box.appendChild(b); };
    add('וואטסאפ', () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener'));
    add('טלגרם', () => window.open('https://t.me/share/url?url=' + encodeURIComponent(hubUrl(o.hub)) + '&text=' + encodeURIComponent('הוזמנת להאב "' + o.hub.name + '"'), '_blank', 'noopener'));
    add('מייל', () => { location.href = 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(text); });
    add('העתק קישור', async () => { try { await navigator.clipboard.writeText(hubUrl(o.hub)); H.toast('הקישור הועתק'); } catch (e) { H.toast(hubUrl(o.hub), 6000); } });
    if (files.length) add('שמור קבצים למכשיר', () => { (o.images || []).forEach((u, i) => download(u, 'hubin-' + (i + 1) + '.jpg')); if (o.file) download(o.file, o.fileName || 'report.pdf'); });
    H.modal({ title: 'שיתוף מחוץ לאפליקציה', body, actions: [{ label: 'סגור' }] });
  }

  /* ----- inside the app: contacts + groups ----- */
  async function internalShare(o) {
    let cts, grs;
    try { [cts, grs] = await Promise.all([H.get('/api/contacts'), H.get('/api/contact-groups')]); } catch (e) { return H.toast(e.message); }
    if (!cts.length) return H.toast('אין לך עדיין אנשי קשר. אפשר לשמור אנשים מתוך האב');
    let h = '<p style="margin:0 0 6px">בחר למי לשלוח בהודעה פרטית:</p><div class="picker">';
    if (grs.length) h += '<div class="grp">קבוצות</div>' + grs.map(g => '<label class="r"><input type="checkbox" data-g="' + g.id + '"><span class="n">' + esc(g.name) + ' (' + g.contact_ids.length + ')</span></label>').join('');
    h += '<div class="grp">אנשי קשר</div>' + cts.map(c => '<label class="r"><input type="checkbox" data-c="' + c.id + '">' + H.avatar(c.photo, c.name, c.id, 'sm') + '<span class="n">' + esc(c.name) + '</span><span class="dot ' + (c.open ? 'g' : 'rd') + '"></span></label>').join('') + '</div>' +
      '<input class="field-in" id="shNote" type="text" placeholder="הוספת הערה (לא חובה)" style="margin-top:8px" maxlength="300">';
    H.modal({
      title: 'שיתוף "' + esc(o.hub.name) + '" באפליקציה', body: h, actions: [{ label: 'ביטול' }, {
        label: 'שלח', cls: 'primary', onClick: async (close, box) => {
          const contact_ids = H.$$('[data-c]:checked', box).map(x => x.dataset.c), group_ids = H.$$('[data-g]:checked', box).map(x => x.dataset.g);
          if (!contact_ids.length && !group_ids.length) { H.toast('לא נבחרו נמענים'); return false; }
          try { const res = await H.post('/api/hubs/' + o.hub.hub_id + '/share', { contact_ids, group_ids, images: o.images || [], file: o.file || '', file_name: o.fileName || '', text: H.$('#shNote', box).value.trim() }); H.toast('נשלח ל-' + res.sent + ' אנשים'); }
          catch (e) { H.toast(e.message); return false; }
        }
      }]
    });
  }

  function destination(o) {
    const body = H.el('<div class="share-opts"><button class="btn lg primary" id="shIn">באפליקציה — אנשי קשר וקבוצות</button><button class="btn lg" id="shOut">מחוץ לאפליקציה — וואטסאפ ואחרים</button></div>');
    const m = H.modal({ title: 'לאן לשתף?', body, actions: [{ label: 'סגור' }] });
    H.$('#shIn', body).onclick = () => { m.close(); internalShare(o); };
    H.$('#shOut', body).onclick = () => { m.close(); externalShare(o); };
  }

  /* entry points
     H.shareFlow({hub:{hub_id,name,serial}, view})   — hub: from the hub card (no view) or from inside the hub (view: choose hub / content)
     H.shareReport({hub, el})                         — the report as a PDF */
  H.shareFlow = o => {
    if (!o || !o.hub) return;
    if (!o.view || o.hub.hub_id === 'preview') return destination({ hub: o.hub, images: [] });
    const body = H.el('<div class="share-opts"><button class="btn lg primary" id="shH">שתף את ההאב</button><button class="btn lg" id="shC">שתף תכולה</button></div>');
    const m = H.modal({ title: 'שיתוף', body, actions: [{ label: 'סגור' }] });
    H.$('#shH', body).onclick = () => { m.close(); destination({ hub: o.hub, images: [] }); };
    H.$('#shC', body).onclick = () => {
      m.close();
      const blocks = o.view.blocks();
      if (!blocks.length) return H.toast('אין בהאב חלונות רשות לשיתוף');
      const b2 = H.el('<div><p style="margin:0 0 8px">בחר את החלונות לשיתוף (כל חלון יישלח כתמונה):</p><div class="picker">' + blocks.map(b => '<label class="r"><input type="checkbox" data-b="' + b.id + '"><span class="n">' + esc(b.title) + '</span></label>').join('') + '</div></div>');
      H.modal({
        title: 'שיתוף תכולה', body: b2, actions: [{ label: 'ביטול' }, {
          label: 'המשך', cls: 'primary', onClick: async (close, box) => {
            const ids = H.$$('[data-b]:checked', box).map(x => x.dataset.b);
            if (!ids.length) { H.toast('לא נבחרו חלונות'); return false; }
            close(); const done = busy('מכין תמונות…');
            let images = []; try { images = await captureBlocks(o.view, ids); } catch (e) { H.toast(e.message); } finally { done(); }
            if (!images.length) return H.toast('לא הצלחנו להכין את התמונות');
            destination({ hub: o.hub, images }); return false;
          }
        }]
      });
    };
  };
  H.shareReport = async o => {
    const done = busy('מכין קובץ PDF…');
    let pdf; try { pdf = await reportPdf(o.el); } catch (e) { done(); console.error(e); return H.toast('לא הצלחנו להכין את הקובץ'); }
    done();
    destination({ hub: o.hub, images: [], file: pdf, fileName: 'דוח ' + o.hub.name + '.pdf' });
  };

  /* ----- "send an external message" from the private-messages screen ----- */
  const normPhone = p => { p = String(p || '').replace(/[^\d+]/g, ''); if (p.startsWith('+')) return p.slice(1); if (p.startsWith('00')) return p.slice(2); if (p.startsWith('0')) return '972' + p.slice(1); return p; };
  H.externalMessage = (opts = {}) => {
    const phone = normPhone(opts.phone);
    const body = H.el('<div><p style="margin:0 0 8px">כתוב הודעה ובחר באיזו אפליקציה לשלוח אותה. תיפתח האפליקציה שבחרת, ואחר כך אפשר לחזור ל-HUBIN.' + (opts.name ? '<br><small>נמען: ' + esc(opts.name) + '</small>' : '') + '</p><textarea class="field-in" id="exText" rows="3" placeholder="תוכן ההודעה" style="width:100%"></textarea><div class="share-opts" style="margin-top:10px"></div></div>');
    const box = H.$('.share-opts', body), txt = () => H.$('#exText', body).value.trim();
    const add = (label, fn) => { const b = H.el('<button class="btn lg">' + label + '</button>'); b.onclick = () => { if (!txt()) return H.toast('נא להזין הודעה'); fn(encodeURIComponent(txt()), txt()); }; box.appendChild(b); };
    add('וואטסאפ', t => window.open('https://wa.me/' + (phone || '') + '?text=' + t, '_blank', 'noopener'));
    add('SMS', t => { location.href = 'sms:' + (opts.phone ? String(opts.phone).replace(/[^\d+]/g, '') : '') + '?body=' + t; });
    add('טלגרם', t => window.open('https://t.me/share/url?url=%20&text=' + t, '_blank', 'noopener'));
    add('מייל', (t, raw) => { location.href = 'mailto:?body=' + t; });
    if (navigator.share) add('אפליקציות נוספות…', (t, raw) => navigator.share({ text: raw }).catch(() => { }));
    H.modal({ title: 'שלח הודעה חיצונית', body, actions: [{ label: 'סגור' }] });
  };
})();
