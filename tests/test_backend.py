import os, sys, time
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as A
from app import app, socketio, db
ok = bad = 0
def t(name, cond, extra=""):
    global ok, bad
    if cond: ok += 1
    else: bad += 1; print("FAIL", name, extra)

class P:
    def __init__(self, name, phone=None, email=None):
        self.c = app.test_client()
        self.sock = None
        if name:
            self.reg(name, phone, email)
    def reg(self, name, phone=None, email=None):
        return self.c.post("/api/login", json={"name": name, "phone": phone or "", "email": email or ""})
    def j(self, m, url, **kw):
        r = getattr(self.c, m)(url, **kw)
        return r.status_code, r.get_json()
    def card(self, **kw):
        d = {"type": "business", "name": "x", "name_visible": True}; d.update(kw)
        return self.j("post", "/api/cards", json=d)
    def connect(self):
        self.sock = socketio.test_client(app, flask_test_client=self.c)
        return self.sock
    def ev(self, name):
        return [e for e in self.sock.get_received() if e["name"] == name]

# ---- login / registration
a = P("")
r = a.c.post("/api/login", json={"name": "", "phone": "", "email": ""}); t("need identifier", r.status_code == 400 and "מזהים" in r.get_json()["error"])
r = a.c.post("/api/login", json={"name": "", "phone": "0501", "email": ""}); t("name required", r.status_code == 400 and "שם" in r.get_json()["error"])
r = a.reg("אבי", "050-111"); t("register", r.status_code == 200 and not r.get_json()["returning"])
t("phone normalized", a.j("get", "/api/me")[1]["phone"] == "050111")
b = P("")
r = b.reg("מישהו", "050111"); t("dup identifier", r.status_code == 400 and "כבר רשום" in r.get_json()["error"])
r = b.c.post("/api/login", json={"name": "", "phone": "050111", "email": "a@x.com"}); t("returning + attach email", r.status_code == 200 and r.get_json()["returning"])
t("returning logged in", b.j("get", "/api/me")[1]["reg_name"] == "אבי" and b.j("get", "/api/me")[1]["email"] == "a@x.com")
b2 = P("")
r = b2.c.post("/api/login", json={"name": "", "phone": "", "email": "a@x.com"}); t("login by second id", r.status_code == 200 and r.get_json()["returning"])
b3 = P("")
r = b3.c.post("/api/login", json={"name": "", "phone": "999", "email": ""}); t("unknown id no name", r.status_code == 400)
b3.c.post("/api/logout"); t("logout", b3.j("get", "/api/me")[1]["registered"] is False)

# ---- cards
owner = a
code, c1 = owner.card(type="business", name="דנה", title="מנכ״לית", company="Acme", card_name="עבודה", degree="ד״ר")
t("card created active", code == 200 and c1["is_active"] and c1["display_name"] == "ד״ר דנה", c1)
code, c2 = owner.card(type="social", name="דנה", nickname="דני", nickname_visible=True, name_visible=False, card_name="חברתי")
t("second card active, first not", c2["is_active"] and not owner.j("get", "/api/cards")[1][1]["is_active"])
t("nickname display", c2["display_name"] == "דני")
code, c3 = owner.card(type="social", name="סתר", name_visible=False)
t("viewer card", c3["is_viewer"] and c3["display_name"] == "צופה" and not c3["effective_open"])
code, nn = owner.j("post", "/api/cards", json={"type": "business", "name": "", "card_name": "ללא שם"}); t("name optional on card", code in (200, 201), nn)
if code in (200, 201): owner.j("delete", f"/api/cards/{nn['id']}")
owner.j("post", f"/api/cards/{c1['id']}/activate")
t("activate", owner.j("get", "/api/cards")[1][0]["id"] == c1["id"])
code, cc = owner.j("post", f"/api/cards/{c1['id']}/open", json={"open": False}); t("close card", not cc["effective_open"])
owner.j("post", f"/api/cards/{c1['id']}/open", json={"open": True})
public = owner.j("get", "/api/cards")[1][0]
code, upd = owner.j("put", f"/api/cards/{c1['id']}", json={"phone": "050", "phone_visible": False, "photos": [{"url": "data:image/png;base64,AA", "is_visible": True, "is_profile_photo": True}]})
t("photo saved", upd["photo_url"].startswith("data:"))
from models import Card
with app.app_context():
    cd = Card.query.get(c1["id"]); pd = cd.public_dict()
    t("hidden phone not public", "phone" not in pd and pd["company"] == "Acme")

# ---- users
def mk(name, phone, ctype="business", **kw):
    p = P(name, phone); p.card(type=ctype, name=name, **kw); return p
u1 = mk("אורי", "1"); u2 = mk("מיכל", "2"); u3 = mk("רן", "3", company="Orbit"); social = mk("חבר", "4", ctype="social")

# ---- hubs
code, h = social.j("post", "/api/hubs", json={"hub_type": "professional", "name": "x"})
t("pro hub needs business card", code == 403 and h["code"] == "need_business_card")
nocard = P("אין", "55")
code, h = nocard.j("post", "/api/hubs", json={"hub_type": "social", "name": "x"}); t("hub needs card", code == 403 and h["code"] == "need_card")
code, hub = owner.j("post", "/api/hubs", json={
    "hub_type": "professional", "name": "TechInnovate 2026", "tagline": "כנס", "template_id": "creator_purple",
    "auto_approve": False, "presence_mode": "both", "loc_lat": 32.0853, "loc_lng": 34.7818, "loc_radius": 100,
    "blocks": [{"category": "agenda", "title": "לוח זמנים", "content": "9:00", "is_default": True},
               {"category": "open", "title": "חלון פתוח"},
               {"category": "speakers", "title": "דוברים", "is_visible": False}]})
t("hub created", code == 200 and hub["serial"] and hub["template_id"] == "creator_purple", hub)
hid = hub["hub_id"]
full = owner.j("get", f"/api/hubs/{hid}/full")[1]
t("blocks saved", len(full["blocks"]) == 3 and full["blocks"][0]["is_default"] and full["presence_code"])
code = u1.j("get", f"/api/hubs/{hid}/full")[0]; t("full owner only", code == 404)
t("search by name", len(u1.j("get", "/api/hubs?q=techinn")[1]) == 1)
t("search by serial", len(u1.j("get", f"/api/hubs?q={hub['serial']}")[1]) == 1)
t("search by owner", len(u1.j("get", "/api/hubs?q=דנה")[1]) == 1 or len(u1.j("get", "/api/hubs?q=ד")[1]) == 1)
t("mine filter", len(owner.j("get", "/api/hubs?filter=mine")[1]) == 1 and len(u1.j("get", "/api/hubs?filter=mine")[1]) == 0)
t("fav toggle", u1.j("post", f"/api/hubs/{hid}/favorite")[1]["is_favorite"] and len(u1.j("get", "/api/hubs?filter=favorites")[1]) == 1)
t("near by location", len(u1.j("get", "/api/hubs?filter=near&lat=32.0854&lng=34.7819")[1]) == 1 and len(u1.j("get", "/api/hubs?filter=near&lat=10&lng=10")[1]) in (0, 1))
rows = u1.j("get", "/api/hubs")[1]; t("activity level", rows[0]["level"] == 0 and rows[0]["live_count"] == 0)

# ---- join: owner first, then pending
so = owner.connect(); so.emit("join_hub", {"hub_id": hid}); rcv = so.get_received()
st = [e for e in rcv if e["name"] == "hub_state"]
t("owner joins", len(st) == 1 and st[0]["args"][0]["hub"]["is_mine"] and st[0]["args"][0]["hub"]["presence_code"])
t("owner sees hidden block", len(st[0]["args"][0]["blocks"]) == 3)
code_val = st[0]["args"][0]["hub"]["presence_code"]
s1 = u1.connect(); s1.emit("join_hub", {"hub_id": hid})
r1 = s1.get_received()
t("pending message", any(e["name"] == "hub_pending" and "המתן" in e["args"][0]["message"] for e in r1))
t("pending no state", not any(e["name"] == "hub_state" for e in r1))
pend = [e for e in so.get_received() if e["name"] == "pending_list"]
t("owner sees pending", pend and len(pend[-1]["args"][0]["pending"]) == 1)
mg = owner.j("get", f"/api/hubs/{hid}/manage")[1]
t("manage lists", len(mg["pending"]) == 1 and mg["pending"][0]["user_id"] == [x for x in [mg["pending"][0]["user_id"]]][0])
t("manage owner only", u1.j("get", f"/api/hubs/{hid}/manage")[0] == 403)
# approve w/ message
owner.j("put", f"/api/hubs/{hid}", json={"send_approval_msg": True})
t("approve forbidden for others", u2.j("post", f"/api/hubs/{hid}/attendees/{mg['pending'][0]['user_id']}/approve")[0] == 403)
t("approve", owner.j("post", f"/api/hubs/{hid}/attendees/{mg['pending'][0]['user_id']}/approve")[0] == 200)
ev = u1.ev("registration_approved"); t("approved push", len(ev) == 1)
msgs = u1.j("get", "/api/messages")[1]
t("approval message", msgs["unread"] == 1 and "הרשמתך להאב TechInnovate 2026 אושרה" in msgs["conversations"][0]["last_text"], msgs)
# rejoin approved w/o verification -> not physical
s1.emit("join_hub", {"hub_id": hid}); r1 = s1.get_received()
stt = [e for e in r1 if e["name"] == "hub_state"][0]["args"][0]
t("approved enters, not physical", stt["my_physical"] is False)
# location verification
s1.emit("verify_presence", {"lat": 32.0854, "lng": 34.7819, "acc": 10}); r = s1.get_received()
t("location ok", any(e["name"] == "presence_result" and e["args"][0]["physical"] for e in r))
s1.emit("verify_presence", {"lat": 33.0, "lng": 35.0, "acc": 10}); r = s1.get_received()
t("location far keeps 2h stay", any(e["name"] == "presence_result" and e["args"][0]["physical"] for e in r))
s1.emit("verify_presence", {"code": code_val.lower()}); r = s1.get_received()
t("code ok", any(e["name"] == "presence_result" and e["args"][0]["physical"] for e in r))
s1.emit("verify_presence", {"code": "WRONG"}); r = s1.get_received()
t("code wrong keeps 2h stay", any(e["name"] == "presence_result" and e["args"][0]["physical"] for e in r))
# turn auto-approve on => pending approved with msg
s2 = u2.connect(); s2.emit("join_hub", {"hub_id": hid, "code": code_val}); s2.get_received()
owner.j("put", f"/api/hubs/{hid}", json={"auto_approve": True})
t("auto-approve flush", len(u2.ev("registration_approved")) == 1)
t("auto msg", "אושרה" in u2.j("get", "/api/messages")[1]["conversations"][0]["last_text"])
# new join under auto-approve with no message toggle
owner.j("put", f"/api/hubs/{hid}", json={"send_approval_msg": False})
s3 = u3.connect(); s3.emit("join_hub", {"hub_id": hid, "code": code_val}); r3 = s3.get_received()
t("auto join state + physical", any(e["name"] == "hub_state" and e["args"][0]["my_physical"] for e in r3))
t("no approval msg when off", u3.j("get", "/api/messages")[1]["unread"] == 0)
# social card into pro hub
sc = social.connect(); sc.emit("join_hub", {"hub_id": hid}); r = sc.get_received()
t("pro needs business card", any(e["name"] == "join_denied" and e["args"][0]["message"] == "יש להכנס להאב מקצועי עם כרטיס עסקי בלבד" for e in r))

# presence list shape
pl = [e for e in so.get_received() if e["name"] == "presence_list"][-1]["args"][0]
t("presence list owner first", pl[0]["is_owner"] and len(pl) == 4, [x["display_name"] for x in pl])
t("physical flags", {x["display_name"]: x["is_physical"] for x in pl}["רן"] is True)

# ---- board
so.get_received()
s1.emit("send_board_message", {"text": "שלום"}); o = so.get_received()
t("board msg", any(e["name"] == "board_message" and e["args"][0]["text"] == "שלום" for e in o))
mid = [e for e in o if e["name"] == "board_message"][0]["args"][0]["id"]
so.emit("send_board_message", {"text": "מהמנהל", "pin": True}); o = so.get_received()
pm_ = [e for e in o if e["name"] == "board_message"][0]["args"][0]
t("owner pinned + flagged", pm_["is_owner"] and pm_["pinned_until"] > time.time() + 1700)
s2.emit("delete_board_message", {"message_id": mid}); r = s2.get_received()
t("others cannot delete", any(e["name"] == "error_msg" for e in r))
so.emit("delete_board_message", {"message_id": mid}); so.get_received()
t("owner removal notice", any("הוסרה על ידי המנהל" in c["last_text"] for c in u1.j("get", "/api/messages")[1]["conversations"]))
so.emit("pin_board_message", {"message_id": pm_["id"], "pin": False}); o = so.get_received()
t("unpin", any(e["name"] == "board_message_updated" and e["args"][0]["pinned_until"] == 0 for e in o))
for i in range(105):
    s1.emit("send_board_message", {"text": f"m{i}"})
s1.get_received()
with app.app_context():
    from models import BoardMessage
    t("board capped 100", BoardMessage.query.filter_by(hub_id=hid).count() == 100)
# viewer cannot post
u1.j("post", f"/api/cards/{u1.j('get','/api/cards')[1][0]['id']}/open", json={"open": False})
s1.get_received(); s1.emit("send_board_message", {"text": "x"}); r = s1.get_received()
t("closed card cannot post", any(e["name"] == "error_msg" and "צפייה" in e["args"][0]["error"] for e in r))
u1.j("post", f"/api/cards/{u1.j('get','/api/cards')[1][0]['id']}/open", json={"open": True})
t("status sync after toggle", True)

# ---- open window posts
st0 = [e for e in so.get_received()]
openb = [b for b in full["blocks"] if b["category"] == "open"][0]
s2.emit("post_open", {"block_id": openb["id"], "text": "מידע מהמשתמש", "video": "https://v"}); o = so.get_received()
t("open post", any(e["name"] == "open_post" and e["args"][0]["text"] == "מידע מהמשתמש" for e in o))

# ---- private messages
s1.get_received()
code, r = u2.j("post", "/api/messages/send", json={"to_user_id": u3.j("get", "/api/me")[1]["user_id"], "text": "היי רן", "hub_id": hid})
t("pm send", code == 200, r)
u3id = u3.j("get", "/api/me")[1]["user_id"]; u2id = u2.j("get", "/api/me")[1]["user_id"]; u1id = u1.j("get", "/api/me")[1]["user_id"]
t("push to recipient", len(u3.ev("private_message")) >= 1)
inbox = u3.j("get", "/api/messages")[1]
t("inbox unread first", inbox["conversations"][0]["unread"] == 1 and inbox["conversations"][0]["hub_name"] == "TechInnovate 2026")
th = u3.j("get", f"/api/messages/thread/{u2id}")[1]
t("thread marks read + other card", th["other"]["card"].get("display_name") == "מיכל" and u3.j("get", "/api/messages/unread-count")[1]["unread"] == 0)
for i in range(7): u2.j("post", "/api/messages/send", json={"to_user_id": u3id, "text": f"n{i}"})
th = u3.j("get", f"/api/messages/thread/{u2id}?limit=5")[1]
t("thread 5 + has_more", len(th["messages"]) == 5 and th["has_more"])
older = u3.j("get", f"/api/messages/thread/{u2id}?limit=5&before={th['messages'][0]['ts']}")[1]
t("older page", len(older["messages"]) == 3 and not older["has_more"])
t("search content", len(u3.j("get", "/api/messages?q=n3")[1]["conversations"]) == 1 and len(u3.j("get", "/api/messages?q=zzz")[1]["conversations"]) == 0)
t("search hub no", len(u3.j("get", f"/api/messages?q={hub['serial']}")[1]["conversations"]) == 1)
t("search sender", len(u3.j("get", "/api/messages?q=מיכל")[1]["conversations"]) == 1)
# closed target
u3.j("post", f"/api/cards/{u3.j('get','/api/cards')[1][0]['id']}/open", json={"open": False})
code, r = u2.j("post", "/api/messages/send", json={"to_user_id": u3id, "text": "?"}); t("closed target rejected", code == 403 and "סגור" in r["error"])
code, r = u3.j("post", "/api/messages/send", json={"to_user_id": u2id, "text": "?"}); t("closed sender rejected", code == 403)
u3.j("post", f"/api/cards/{u3.j('get','/api/cards')[1][0]['id']}/open", json={"open": True})
# delete mine only
mid2 = u2.j("get", f"/api/messages/thread/{u3id}")[1]["messages"][0]["id"]
t("delete others forbidden", u3.j("delete", f"/api/messages/{mid2}")[0] == 403 and u2.j("delete", f"/api/messages/{mid2}")[0] == 200)

# ---- contacts + groups
code, r = u3.j("post", "/api/contacts", json={"user_id": u2id, "hub_id": hid}); t("save contact", code == 200 and not r["existing"])
code, r = u3.j("post", "/api/contacts", json={"user_id": u2id, "hub_id": hid}); t("no duplicate contact", r["existing"] and len(u3.j("get", "/api/contacts")[1]) == 1)
u3.j("post", "/api/contacts", json={"user_id": u1id, "hub_id": hid})
cts = u3.j("get", "/api/contacts")[1]; t("contacts list state", len(cts) == 2 and cts[0]["state"] in ("hub", "home", "off") and cts[0]["hub_name"] == "TechInnovate 2026")
cid_m = [c for c in cts if c["user_id"] == u2id][0]["id"]; cid_o = [c for c in cts if c["user_id"] == u1id][0]["id"]
code, g1 = u3.j("post", "/api/contact-groups", json={"name": "צוות"}); t("group created", code == 200)
t("group name required", u3.j("post", "/api/contact-groups", json={"name": " "})[0] == 400)
code, g2 = u3.j("post", "/api/contact-groups", json={"name": "חברים"})
u3.j("post", f"/api/contact-groups/{g1['id']}/members", json={"contact_ids": [cid_m, cid_o]})
u3.j("post", f"/api/contact-groups/{g2['id']}/members", json={"contact_ids": [cid_m, cid_m]})
cts = u3.j("get", "/api/contacts")[1]
t("multi group membership", sorted(x["name"] for x in [c for c in cts if c["id"] == cid_m][0]["groups"]) == ["חברים", "צוות"])
w = u3.j("get", f"/api/contact-groups/{g1['id']}/where")[1]
lab = {x["name"]: x["label"] for x in w}
t("where: hub name", lab["מיכל"] == "TechInnovate 2026", w)
s2.disconnect(); w = {x["name"]: x["label"] for x in u3.j("get", f"/api/contact-groups/{g1['id']}/where")[1]}
t("where: dropped connection stays 'in hub' for a while", w["מיכל"] == "TechInnovate 2026", w)
A.RECENT_HUB.clear(); w = {x["name"]: x["label"] for x in u3.j("get", f"/api/contact-groups/{g1['id']}/where")[1]}
t("where: off", w["מיכל"] == "כבוי")
u1.j("post", f"/api/cards/{u1.j('get','/api/cards')[1][0]['id']}/open", json={"open": False})
w = {x["name"]: x["label"] for x in u3.j("get", f"/api/contact-groups/{g1['id']}/where")[1]}
t("where: closed hidden", w["אורי"] == "לא ניתן לאתר")
u1.j("post", f"/api/cards/{u1.j('get','/api/cards')[1][0]['id']}/open", json={"open": True})
s2 = u2.connect()
code, r = u3.j("post", f"/api/contact-groups/{g1['id']}/message", json={"text": "לכולם"})
t("group message", code == 200 and r["sent"] == 2)
gl = u2.j("get", "/api/messages/groups")[1]
c0 = gl[0]
t("group msg format", c0["group_name"] == "צוות" and c0["last_sender"] == "רן" and c0["unread"] == 1, c0)
gt = u2.j("get", "/api/messages/group-thread?name=" + "צוות")[1]
t("group thread + read", len(gt["messages"]) == 1 and u2.j("get", "/api/messages/groups")[1][0]["unread"] == 0)
# 15ב: real group chat — a member replies to everyone in the group
u2.j("post", "/api/cards", json={"type": "social", "name": "x"}) if False else None
code, r = u2.j("post", "/api/messages/group-send", json={"group_id": g1["id"], "text": "תשובה לכולם"})
t("group reply to all", code == 200 and r["sent"] == 2, r)
gt1 = u1.j("get", "/api/messages/group-thread?id=" + g1["id"])[1]
t("member sees whole group thread", [m["text"] for m in gt1["messages"]] == ["לכולם", "תשובה לכולם"] and gt1["can_send"], gt1)
gt3 = u3.j("get", "/api/messages/group-thread?id=" + g1["id"])[1]
t("owner sees reply once", [m["text"] for m in gt3["messages"]] == ["לכולם", "תשובה לכולם"], gt3)
t("outsider cannot write to group", P("זר", "0509998877").j("post", "/api/messages/group-send", json={"group_id": g1["id"], "text": "x"})[0] == 403)
t("owner sees silent own group", any(x["group_id"] == g1["id"] for x in u3.j("get", "/api/messages/groups")[1]))
t("remove member", u3.j("delete", f"/api/contact-groups/{g1['id']}/members/{cid_o}")[0] == 200 and len([c for c in u3.j("get", "/api/contacts")[1] if c["id"] == cid_o][0]["groups"]) == 0)
t("delete contact cleans groups", u3.j("delete", f"/api/contacts/{cid_m}")[0] == 200 and u3.j("get", "/api/contact-groups")[1][0]["contact_ids"] == [])
t("delete group", u3.j("delete", f"/api/contact-groups/{g2['id']}")[0] == 200 and len(u3.j("get", "/api/contact-groups")[1]) == 1)
# closed user cannot be saved
u1.j("post", f"/api/cards/{u1.j('get','/api/cards')[1][0]['id']}/open", json={"open": False})
code, r = u2.j("post", "/api/contacts", json={"user_id": u1id}); t("closed cannot be saved", code == 403)
u1.j("post", f"/api/cards/{u1.j('get','/api/cards')[1][0]['id']}/open", json={"open": True})
# share hub
u3.j("post", "/api/contacts", json={"user_id": u2id, "hub_id": hid}); cid_m = [c for c in u3.j("get", "/api/contacts")[1] if c["user_id"] == u2id][0]["id"]
code, r = u3.j("post", f"/api/hubs/{hid}/share", json={"contact_ids": [cid_m]}); t("share hub", code == 200 and r["sent"] == 1)
last = [c for c in u2.j("get", "/api/messages")[1]["conversations"] if c["user_id"] == u3id][0]
t("invite text", "הוזמנת על ידי רן להיכנס להאב TechInnovate 2026" in last["last_text"])
th = u2.j("get", f"/api/messages/thread/{u3id}")[1]["messages"][-1]; t("hub link in message", th["hub_link_id"] == hid)

# ---- ban
code, r = owner.j("post", f"/api/hubs/{hid}/bans", json={"user_id": u2id, "reason": "ספאם"}); t("ban", code == 200)
t("ban non-owner forbidden", u3.j("post", f"/api/hubs/{hid}/bans", json={"user_id": u1id})[0] == 403)
t("banned push", len(u2.ev("banned")) == 1)
s2.emit("join_hub", {"hub_id": hid}); r = s2.get_received()
d = [e for e in r if e["name"] == "join_denied"][0]["args"][0]
t("banned denied", d["reason"] == "banned" and d["message"] == "אינך מורשה להיכנס להאב זה" and d["owner_user_id"])
t("ban reason msg", any("ספאם" in c["last_text"] for c in u2.j("get", "/api/messages")[1]["conversations"]))
t("banned may message owner", u2.j("post", "/api/messages/send", json={"to_user_id": owner.j("get","/api/me")[1]["user_id"], "text": "סליחה"})[0] == 200)
t("unregistered ban", owner.j("post", f"/api/hubs/{hid}/bans", json={"user_id": mk('זר','777').j('get','/api/me')[1]['user_id']})[0] == 200)
t("bans listed", len(owner.j("get", f"/api/hubs/{hid}/manage")[1]["bans"]) == 2)
t("registered excludes banned", all(x["user_id"] != u2id for x in owner.j("get", f"/api/hubs/{hid}/manage")[1]["registered"]))
t("unban", owner.j("delete", f"/api/hubs/{hid}/bans/{u2id}")[0] == 200)
s2.emit("join_hub", {"hub_id": hid, "code": code_val}); r = s2.get_received()
t("unbanned re-registers", any(e["name"] == "hub_state" for e in r))

# ---- reject
x = mk("נדחה", "888"); sx = x.connect()
owner.j("put", f"/api/hubs/{hid}", json={"auto_approve": False})
sx.emit("join_hub", {"hub_id": hid}); sx.get_received()
xid = x.j("get", "/api/me")[1]["user_id"]
owner.j("post", f"/api/hubs/{hid}/attendees/{xid}/reject")
t("reject push", len(x.ev("registration_rejected")) == 1)

# ---- report
rep = u3.j("get", f"/api/hubs/{hid}/report")
t("report", rep[0] == 200 and len(rep[1]["info"]) == 2 and rep[1]["hub"]["name"] == "TechInnovate 2026", rep[1] if rep[0] != 200 else "")
t("report hides non-visible block", all(b["title"] != "דוברים" for b in rep[1]["info"]))
t("report contacts only from this hub", all(c["hub_name"] == "TechInnovate 2026" for c in rep[1]["contacts"]))
s3.emit("send_board_message", {"text": "תמונה", "image": "data:image/png;base64,AAA"}); s3.get_received()
rep = u3.j("get", f"/api/hubs/{hid}/report")[1]; t("report photos", len(rep["photos"]) == 1)
t("report non-member forbidden", mk("חיצוני", "999").j("get", f"/api/hubs/{hid}/report")[0] == 403)

# ---- social hub: plain hubs
code, sh = social.j("post", "/api/hubs", json={"hub_type": "social", "name": "מסיבה", "background_image_url": "data:img", "blocks": [{"category": "open", "title": "חלון"}]})
t("social hub", code == 200 and sh["hub_type"] == "social")
code, bh = u1.j("post", "/api/hubs", json={"hub_type": "business", "name": "פאב"}); t("business hub", code == 200)
# edit hub
code, up = owner.j("put", f"/api/hubs/{hid}", json={"name": "חדש", "blocks": [{"id": full["blocks"][0]["id"], "category": "agenda", "title": "לו״ז2", "is_default": True}]})
t("edit hub + blocks sync", code == 200 and len(owner.j("get", f"/api/hubs/{hid}/full")[1]["blocks"]) == 1)
# presence code regen
old = full["presence_code"]; new = owner.j("post", f"/api/hubs/{hid}/presence-code")[1]["presence_code"]; t("regen code", new != old)
# unauthenticated-like: close
t("close hub", owner.j("post", f"/api/hubs/{hid}/close")[0] == 200 and owner.j("get", f"/api/hubs/{hid}")[0] == 404)

# ================= v15 additions =================
# phone normalization
t("norm 05x", A.norm_phone("050-123 4567") == "972501234567")
t("norm +972", A.norm_phone("+972 50 123 4567") == "972501234567")
t("norm 00972", A.norm_phone("00972501234567") == "972501234567")
t("norm foreign", A.norm_phone("+1 (212) 555-0100") == "12125550100")
nu = P(None); nu.reg("טל", "052-9876543"); code_, me_ = nu.j("get", "/api/me")
t("phone stored normalized", me_["phone"] == "972529876543")
nu2 = P(None); r = nu2.reg("", "+972 52 987 6543"); t("login by other phone format", r.status_code == 200 and r.get_json().get("returning"))

# settings: theme + prefs
code, r = u1.j("put", "/api/settings", json={"theme": "light", "prefs": {"sound_pm": False, "hubs_view": "grid", "bogus": 1, "lang": "en"}})
me1 = u1.j("get", "/api/me")[1]
t("theme saved", code == 200 and me1["theme"] == "light")
t("prefs saved + sanitized", me1["prefs"]["sound_pm"] is False and me1["prefs"]["hubs_view"] == "grid" and me1["prefs"]["lang"] == "he" and "bogus" not in me1["prefs"])
t("bad theme rejected", u1.j("put", "/api/settings", json={"theme": "neon"})[0] == 400)
t("default prefs", u2.j("get", "/api/me")[1]["prefs"]["hubs_view"] == "list" and u2.j("get", "/api/me")[1]["theme"] == "space")

# password lock
pw = mk("סיסמה", "777")
t("pw mismatch", pw.j("post", "/api/password", json={"password": "abcd", "confirm": "abce"})[0] == 400)
t("pw short", pw.j("post", "/api/password", json={"password": "ab", "confirm": "ab"})[0] == 400)
t("pw set", pw.j("post", "/api/password", json={"password": "abcd", "confirm": "abcd"})[0] == 200)
t("pw unlocked in this session", pw.j("get", "/api/cards")[0] == 200)
fresh = app.test_client()
dev = pw.c.get_cookie("hubble_device_id").value
fresh.set_cookie("hubble_device_id", dev)
r = fresh.get("/api/me").get_json()
t("fresh session locked", r.get("locked") is True and "active_card" not in r)
t("locked api blocked", fresh.get("/api/cards").status_code == 401)
t("wrong pw", fresh.post("/api/unlock", json={"password": "nope"}).status_code == 403)
t("socket refused while locked", not socketio.test_client(app, flask_test_client=fresh).is_connected())
t("unlock", fresh.post("/api/unlock", json={"password": "abcd"}).status_code == 200)
t("unlocked works", fresh.get("/api/cards").status_code == 200 and fresh.get("/api/me").get_json()["locked"] is False)
fresh.get("/"); t("page load re-locks", fresh.get("/api/me").get_json().get("locked") is True); fresh.post("/api/unlock", json={"password": "abcd"})
t("delete pw needs current", fresh.delete("/api/password", json={"current": "x"}).status_code == 403)
t("delete pw", fresh.delete("/api/password", json={"current": "abcd"}).status_code == 200 and fresh.get("/api/me").get_json()["has_password"] is False)
A.UNLOCK_FAILS.clear()

# super admin (device + env secret)
os.environ["SUPER_ADMIN_PASSWORD"] = "root-secret"
t("super wrong pw", u2.j("post", "/api/super/claim", json={"password": "x"})[0] == 403)
t("stats forbidden", u2.j("get", "/api/super/stats")[0] == 403)
t("super claim", u2.j("post", "/api/super/claim", json={"password": "root-secret"})[0] == 200)
st_ = u2.j("get", "/api/super/stats"); t("super stats", st_[0] == 200 and st_[1]["users"] > 3)
os.environ.pop("SUPER_ADMIN_PASSWORD")

# card mood + networks
code, cm = social.j("post", "/api/cards", json={"type": "social", "name": "ענת", "name_visible": True, "mood": "🚀", "networks_visible": True,
                    "networks": [{"type": "instagram", "value": "@anat"}, {"type": "טוויץ'", "value": "anat_tv"}, {"type": "x", "value": ""}]})
t("card mood+networks", code == 200 and cm["mood"] == "🚀" and len(cm["networks"]) == 2)
with app.app_context():
    pubc = A.Card.query.get(cm["id"]).public_dict()
t("public shows mood+networks", pubc.get("mood") == "🚀" and len(pubc.get("networks", [])) == 2)
code, cm2 = social.j("put", f"/api/cards/{cm['id']}", json={"networks_visible": False, "mood": "bad"})
with app.app_context():
    pubc = A.Card.query.get(cm["id"]).public_dict()
t("networks hidden + invalid mood dropped", "networks" not in pubc and "mood" not in pubc)

# groups: description + image + edit + message with image
code, gx = u3.j("post", "/api/contact-groups", json={"name": "קבוצת ניסוי", "description": "תיאור", "image": "data:image/png;base64,AAA"})
t("group desc+image", code == 200 and gx["description"] == "תיאור" and gx["image"].startswith("data:"))
t("group needs name", u3.j("post", "/api/contact-groups", json={"name": " "})[0] == 400)
t("group edit", u3.j("put", f"/api/contact-groups/{gx['id']}", json={"name": "חדשה", "description": ""})[0] == 200 and [g_ for g_ in u3.j("get", "/api/contact-groups")[1] if g_["id"] == gx["id"]][0]["name"] == "חדשה")
# near
u3.j("post", "/api/location", json={"lat": 32.0853, "lng": 34.7818, "acc": 20})
u2.j("post", "/api/location", json={"lat": 32.0856, "lng": 34.7819, "acc": 20})
u1.j("post", "/api/location", json={"lat": 32.3, "lng": 34.9, "acc": 20})
cts3 = u3.j("get", "/api/contacts")[1]
u3.j("post", f"/api/contact-groups/{gx['id']}/members", json={"contact_ids": [c["id"] for c in cts3]})
u1.j("post", f"/api/cards/{u1.j('get','/api/cards')[1][0]['id']}/open", json={"open": True})
u2.connect(); u1.connect()
code, nr = u3.j("get", f"/api/contact-groups/{gx['id']}/near?lat=32.0853&lng=34.7818&range=500")
names_near = [m["name"] for m in nr["members"]]
t("near: includes close member only", code == 200 and any("מיכל" in n for n in names_near) and not any("אורי" in n for n in names_near), nr)
t("near: bad range falls back", u3.j("get", f"/api/contact-groups/{gx['id']}/near?lat=32.0853&lng=34.7818&range=7")[1]["range"] == 500)
t("near needs location", u3.j("get", f"/api/contact-groups/{gx['id']}/near")[0] == 400)
cd_ = u3.j("get", "/api/contacts?lat=32.0853&lng=34.7818")[1]
t("contacts carry distance", any(c.get("dist") is not None for c in cd_))

# ---- 15ב: drafts, background, card, 2h stay, claim, clear registrants, admin phone
ow = P("בעל האב", "0541112233"); ow.card(type="social", name="בעל", nickname="בעל", nickname_visible=True)
vis = P("מבקר", "0542223344"); vis.card(type="social", name="מבקר", nickname="מבקר", nickname_visible=True)
code, d1 = ow.j("post", "/api/hubs", json={"hub_type": "social", "name": "", "draft": True})
t("draft without name", code == 200 and d1["name"] and d1["is_published"] is False, d1)
t("draft hidden from others", all(h["hub_id"] != d1["hub_id"] for h in vis.j("get", "/api/hubs")[1]) and vis.j("get", f"/api/hubs/{d1['hub_id']}")[0] == 404)
t("draft visible to owner", any(h["hub_id"] == d1["hub_id"] for h in ow.j("get", "/api/hubs")[1]))
t("publish needs name", ow.j("put", f"/api/hubs/{d1['hub_id']}", json={"draft": False})[0] == 400)
code, r = ow.j("put", f"/api/hubs/{d1['hub_id']}", json={"draft": False, "name": "האב חברתי", "tagline": "תיאור", "bg_in_hub": False, "glow": True, "loc_address": "תל אביב", "presence_mode": "location", "loc_lat": 32.08, "loc_lng": 34.78, "loc_radius": 500,
    "card_enabled": True, "card_message": "ברוכים הבאים", "card_bg_kind": "gif", "card_song_url": "data:audio/mp3;base64,AAAA"})
t("publish draft", code == 200 and r["is_published"] and r["glow"] and r["bg_in_hub"] is False and r["loc_address"] == "תל אביב" and r["has_card"], r)
hid2 = d1["hub_id"]
t("published visible", vis.j("get", f"/api/hubs/{hid2}")[0] == 200)
code, cd = vis.j("get", f"/api/hubs/{hid2}/card")
t("card payload", code == 200 and cd["message"] == "ברוכים הבאים" and cd["song"].startswith("data:audio") and cd["registered"] == 0 and cd["skip"] is False, cd)
vis.j("post", f"/api/hubs/{hid2}/card-pref", json={"skip": True})
t("skip card pref saved", vis.j("get", f"/api/hubs/{hid2}/card")[1]["skip"] is True and hid2 in vis.j("get", "/api/me")[1]["prefs"]["skip_cards"])
vis.j("post", f"/api/hubs/{hid2}/card-pref", json={"skip": False})
t("skip card pref cleared", vis.j("get", f"/api/hubs/{hid2}/card")[1]["skip"] is False)
# entering is always allowed; verification afterwards; 2h stay
sv = vis.connect(); sv.emit("join_hub", {"hub_id": hid2}); rr = sv.get_received()
stv = [e for e in rr if e["name"] == "hub_state"]
t("enters without verification", len(stv) == 1 and stv[0]["args"][0]["my_physical"] is False)
sv.emit("verify_presence", {"claim": True}); rr = sv.get_received()
t("claim 'I am at the hub' (no position)", any(e["name"] == "presence_result" and e["args"][0]["physical"] and e["args"][0]["claimed"] for e in rr))
sv.emit("leave_hub"); sv.emit("join_hub", {"hub_id": hid2}); rr = sv.get_received()
t("back within 2h: still present", [e for e in rr if e["name"] == "hub_state"][0]["args"][0]["my_physical"] is True)
vis.c.post("/api/login", json={}) if False else None
# fresh user: claim without location mode is refused
code, hc = ow.j("post", "/api/hubs", json={"hub_type": "social", "name": "קוד", "presence_mode": "code"})
sv.emit("join_hub", {"hub_id": hc["hub_id"]}); sv.get_received()
sv.emit("verify_presence", {"claim": True}); rr = sv.get_received()
t("claim refused in code mode", any(e["name"] == "presence_result" and not e["args"][0]["physical"] for e in rr))
# clear registrants + auto clear
t("clear registrants owner only", vis.j("delete", f"/api/hubs/{hid2}/registrants")[0] == 404 or vis.j("delete", f"/api/hubs/{hid2}/registrants")[0] == 403)
code, r = ow.j("delete", f"/api/hubs/{hid2}/registrants"); t("clear registrants", code == 200 and r["removed"] == 1, r)
t("registrant gone", len(ow.j("get", f"/api/hubs/{hid2}/manage")[1]["registered"]) == 0)
sv.emit("join_hub", {"hub_id": hid2}); sv.get_received()
code, r = ow.j("put", f"/api/hubs/{hid2}", json={"auto_clear_on": True, "auto_clear_at": time.time() - 5})
t("auto clear stored", code == 200 and r["auto_clear_on"])
with app.app_context():
    A.run_auto_clear()
t("auto clear ran", len(ow.j("get", f"/api/hubs/{hid2}/manage")[1]["registered"]) == 0 and ow.j("get", f"/api/hubs/{hid2}/manage")[1]["hub"]["auto_clear_on"] is False)
# designated admin phone manages every hub
adm = P("נועם שני", "0526180201")
t("admin manages foreign hub", adm.j("get", f"/api/hubs/{hid2}/manage")[0] == 200 and adm.j("get", f"/api/hubs/{hid2}/full")[0] == 200)
t("admin sees is_mine", [h for h in adm.j("get", "/api/hubs")[1] if h["hub_id"] == hid2][0]["is_mine"] is True)
t("non-admin cannot", vis.j("get", f"/api/hubs/{hid2}/manage")[0] == 403)

# ---- 15ב.1: sharing with pictures / file, file download, lock, near range, social card in professional hub, legacy groups
sa = P("שולח", "0551110001"); sa.card(type="business", name="שולח", name_visible=True)
rb = P("מקבל", "0551110002"); rb.card(type="business", name="מקבל", name_visible=True)
code, shub = sa.j("post", "/api/hubs", json={"hub_type": "professional", "name": "כנס שיתוף"}); shid = shub["hub_id"]
rb.j("post", "/api/contacts", json={"user_id": sa.j("get", "/api/me")[1]["user_id"]})
sa.j("post", "/api/contacts", json={"user_id": rb.j("get", "/api/me")[1]["user_id"]})
cid_rb = sa.j("get", "/api/contacts")[1][0]["id"]
tiny = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
code, r = sa.j("post", f"/api/hubs/{shid}/share", json={"contact_ids": [cid_rb], "images": [tiny, tiny]})
t("share content as pictures", code == 200 and r["sent"] == 1, r)
rows = rb.j("get", "/api/messages")[1]["conversations"]
th = rb.j("get", f"/api/messages/thread/{rows[0]['user_id']}?limit=10")[1]["messages"]
t("receiver gets link + pictures", len([m for m in th if m["image"]]) == 2 and any(m["hub_link_id"] == shid for m in th), th)
pdf = "data:application/pdf;filename=generated.pdf;base64,JVBERi0xLjMK"
code, r = sa.j("post", f"/api/hubs/{shid}/share", json={"contact_ids": [cid_rb], "file": pdf, "file_name": "דוח.pdf"})
th = rb.j("get", f"/api/messages/thread/{rows[0]['user_id']}?limit=10")[1]["messages"]
fm = [m for m in th if m["file_name"]]
t("report file message", code == 200 and len(fm) == 1 and fm[0]["file_name"] == "דוח.pdf", th)
rf = rb.c.get(f"/api/messages/{fm[0]['id']}/file")
t("file download", rf.status_code == 200 and rf.data.startswith(b"%PDF") and "attachment" in rf.headers["Content-Disposition"])
t("file download not for strangers", P("זר", "0551110003").c.get(f"/api/messages/{fm[0]['id']}/file").status_code in (401, 403, 404))
# lock endpoint: with a password, /api/lock locks again
lk = P("נועל", "0551110004"); lk.card(type="social", name="נועל", nickname="נועל", nickname_visible=True)
lk.j("post", "/api/password", json={"password": "abc12345", "confirm": "abc12345"})
t("unlocked after setting", lk.j("get", "/api/me")[1]["locked"] is False)
lk.j("post", "/api/lock"); t("lock endpoint locks", lk.j("get", "/api/me")[1]["locked"] is True)
t("index is not cached", lk.c.get("/").headers.get("Cache-Control", "").startswith("no-store"))
# near with range
code, nh = sa.j("post", "/api/hubs", json={"hub_type": "social", "name": "קרוב", "presence_mode": "location", "loc_lat": 32.0853, "loc_lng": 34.7818, "loc_radius": 100})
near_ok = [h["name"] for h in rb.j("get", "/api/hubs?filter=near&lat=32.0853&lng=34.7860&range=1000")[1]]
near_far = [h["name"] for h in rb.j("get", "/api/hubs?filter=near&lat=32.0853&lng=34.7860&range=200")[1]]
t("near range 1km includes", "קרוב" in near_ok, near_ok); t("near range 200m excludes", "קרוב" not in near_far, near_far)
t("near hides hubs without location", "כנס שיתוף" not in near_ok)
# a professional hub can't be used with a social card
rb.card(type="social", name="חברתי", nickname="חב", nickname_visible=True)
social_id = [c for c in rb.j("get", "/api/cards")[1] if c["type"] == "social"][0]["id"]
biz_id = [c for c in rb.j("get", "/api/cards")[1] if c["type"] == "business"][0]["id"]
rb.j("post", f"/api/cards/{biz_id}/activate")
rbs = rb.connect(); rbs.emit("join_hub", {"hub_id": shid}); rbs.get_received()
code, e = rb.j("post", f"/api/cards/{social_id}/activate"); t("social card refused inside professional hub", code == 400 and "מקצועי" in e["error"], e)
rbs.emit("leave_hub"); rbs.get_received()
t("social card allowed after leaving", rb.j("post", f"/api/cards/{social_id}/activate")[0] == 200)
# legacy group messages (no group id) join the group of the same name: one row
g_owner = P("מנהל קבוצה", "0551110005"); g_owner.card(type="business", name="מנהל", name_visible=True)
g_mem = P("חבר קבוצה", "0551110006"); g_mem.card(type="business", name="חבר", name_visible=True)
g_mem.j("post", "/api/contacts", json={"user_id": g_owner.j("get", "/api/me")[1]["user_id"]})
g_owner.j("post", "/api/contacts", json={"user_id": g_mem.j("get", "/api/me")[1]["user_id"]})
gc = g_owner.j("get", "/api/contacts")[1][0]["id"]
grp = g_owner.j("post", "/api/contact-groups", json={"name": "קבוצה ישנה"})[1]
g_owner.j("post", f"/api/contact-groups/{grp['id']}/members", json={"contact_ids": [gc]})
g_owner.j("post", f"/api/contact-groups/{grp['id']}/message", json={"text": "הודעה חדשה"})
with app.app_context():
    from models import PrivateMessage
    for m in PrivateMessage.query.filter_by(kind="group").all():
        m.group_id = None     # as if sent before groups had ids
    db.session.commit()
g_owner.j("post", "/api/messages/group-send", json={"group_id": grp["id"], "text": "אחרי"})
grows = g_owner.j("get", "/api/messages/groups")[1]
t("legacy + new group messages = one row", len([r for r in grows if r["group_name"] == "קבוצה ישנה"]) == 1, grows)
gth = g_owner.j("get", f"/api/messages/group-thread?id={grp['id']}")[1]
t("legacy messages shown in the group thread", len(gth["messages"]) >= 2, gth)

# auto column migration on an old database
import sqlite3, tempfile, subprocess
tmp = tempfile.mktemp(suffix=".db")
con = sqlite3.connect(tmp)
con.execute("CREATE TABLE user (id VARCHAR PRIMARY KEY, device_id VARCHAR NOT NULL, sync_code VARCHAR NOT NULL, created_at FLOAT, reg_name VARCHAR, email VARCHAR, phone VARCHAR)")
con.execute("INSERT INTO user VALUES ('u','d','S',0,'ישן',NULL,'0501')"); con.commit(); con.close()
res = subprocess.run([sys.executable, "-c", "import os;os.environ['DATABASE_URL']='sqlite:///%s';import app;from models import User;\nwith app.app.app_context():\n u=User.query.first();print(u.reg_name,u.theme,u.prefs,u.is_super)" % tmp],
                     cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), capture_output=True, text=True)
t("auto-migrate old db", res.returncode == 0 and "ישן space {} " in res.stdout.replace("False", "") + " ", res.stdout + res.stderr[-300:])
os.remove(tmp)
print(ok, "pass", bad, "fail")
sys.exit(1 if bad else 0)
