"""
Hubble v15 — Flask + Socket.IO backend.

REST handles all state changes (cards, hubs, contacts, messages, management);
Socket.IO is used for presence, the hub boards and for pushing live
notifications to the relevant people.
"""

import json
import math
import os
import re
import time
import uuid

from flask import Flask, request, jsonify, render_template, g, session
from werkzeug.security import generate_password_hash, check_password_hash
from flask_socketio import SocketIO, join_room, leave_room, emit

from models import (
    db, User, Card, CardPhoto, Hub, HubBlock, HubOpenPost, Favorite, HubPresence, HubBan,
    BoardMessage, PrivateMessage, ContactGroup, ContactShare, ContactGroupMember,
    CARD_FIELD_NAMES, VIEWER_NAME, gen_hub_serial, gen_presence_code,
)

app = Flask(__name__)
# the session cookie (password unlock) is signed with this key: set SECRET_KEY on Render; without it a random key is used per start
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY") or os.urandom(24).hex()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
db_url = os.environ.get("DATABASE_URL", "sqlite:///" + os.path.join(BASE_DIR, "hubble.db"))
# use the psycopg 3 driver explicitly (works on every Python version Render offers)
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)
elif db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True, "pool_recycle": 280, "pool_size": 10, "max_overflow": 20} if not db_url.startswith("sqlite") else {}
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
db.init_app(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading",
                    max_http_buffer_size=25 * 1024 * 1024)

def ensure_columns():
    """db.create_all() never adds columns to existing tables; add any missing ones so a
    new version can run on the existing database without wiping it."""
    from sqlalchemy import inspect, text
    insp = inspect(db.engine)
    for table in db.metadata.sorted_tables:
        if not insp.has_table(table.name):
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in have:
                continue
            ctype = col.type.compile(dialect=db.engine.dialect)
            default = ""
            if col.default is not None and getattr(col.default, "is_scalar", False):
                v = col.default.arg
                default = " DEFAULT " + ("'%s'" % str(v).replace("'", "''") if isinstance(v, str) else ("TRUE" if v is True else "FALSE" if v is False else str(v)))
            with db.engine.begin() as conn:
                conn.execute(text('ALTER TABLE "%s" ADD COLUMN "%s" %s%s' % (table.name, col.name, ctype, default)))


with app.app_context():
    if os.environ.get("RESET_DB") == "1":
        # one-time schema reset: set RESET_DB=1, deploy once, then REMOVE the variable
        db.drop_all()
    db.create_all()
    ensure_columns()
    # a restart drops every socket, so nobody can be "live" yet
    HubPresence.query.update({HubPresence.is_live: False})
    db.session.commit()

DEVICE_COOKIE = "hubble_device_id"
APP_VERSION = str(int(time.time()))
VALID_TEMPLATES = {"corporate_classic", "community_dynamic", "creator_purple", "minimalist_dark", "logistics_red"}
HUB_TYPES = ("social", "business", "professional")
PHYSICAL_TTL = 2 * 3600     # pilot: a location/code verification stays valid for 2 hours (also after leaving and returning)
PIN_SECONDS = 30 * 60
BOARD_LIMIT = 100

# In-memory socket bookkeeping (single process demo)
SID_TO_USER = {}
SID_TO_HUB = {}
RECENT_HUB = {}      # user_id -> (hub_id, ts): connection dropped (phone in pocket) without leaving the hub
RECENT_TTL = 15 * 60
USER_SIDS = {}


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

@app.before_request
def load_current_user():
    if request.path.startswith("/static/") or request.path.startswith("/socket.io"):
        return
    device_id = request.cookies.get(DEVICE_COOKIE)
    user = User.query.filter_by(device_id=device_id).first() if device_id else None
    g.new_device_id = None
    if not user:
        g.new_device_id = str(uuid.uuid4())
        user = User(device_id=g.new_device_id)
        db.session.add(user)
        db.session.commit()
    g.user = user


@app.after_request
def persist_device_cookie(response):
    nd = getattr(g, "new_device_id", None)
    if nd:
        set_device_cookie(response, nd)
    return response


def set_device_cookie(resp, device_id):
    resp.set_cookie(DEVICE_COOKIE, device_id, max_age=60 * 60 * 24 * 365, samesite="Lax", path="/")


def client_ip():
    fwd = request.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote_addr or ""


def err(msg, status=400, **extra):
    return jsonify({"error": msg, **extra}), status


def socket_user():
    device_id = request.cookies.get(DEVICE_COOKIE)
    return User.query.filter_by(device_id=device_id).first() if device_id else None


def norm_phone(p):
    """Digits only, Israeli numbers in international form: 05x-xxxxxxx -> 9725xxxxxxxx."""
    raw = (p or "").strip()
    if not raw:
        return None
    plus = raw.startswith("+")
    d = re.sub(r"\D", "", raw)
    if not d:
        return None
    if d.startswith("00"):
        d = d[2:]
    elif not plus and d.startswith("0") and 9 <= len(d) <= 10:
        d = "972" + d[1:]
    return d


HUB_ADMIN_PHONES = {norm_phone(x) for x in os.environ.get("HUB_ADMIN_PHONES", "0526180201").split(",") if norm_phone(x)}


def is_hub_admin(user_id):
    """Pilot: designated phone numbers hold manager rights in every hub (shown as manager only in hubs they opened)."""
    u = User.query.get(user_id) if user_id else None
    return bool(u and u.phone and norm_phone(u.phone) in HUB_ADMIN_PHONES)


def is_mgr(hub, user_id):
    return bool(hub and user_id and (hub.owner_user_id == user_id or is_hub_admin(user_id)))


def norm_email(e):
    e = (e or "").strip().lower()
    return e or None


@app.route("/")
def index():
    session.pop("unlocked", None)   # every fresh page load = fresh app open: a password must be entered again
    return render_template("index.html", v=APP_VERSION)


@app.after_request
def no_cache_shell(resp):
    # the app shell must always come from the server (a cached page would skip the password prompt)
    if request.path == "/":
        resp.headers["Cache-Control"] = "no-store, max-age=0"
    return resp


@app.route("/api/lock", methods=["POST"])
def lock_now():
    session.pop("unlocked", None)
    return jsonify({"ok": True})


@app.route("/healthz")
def healthz():
    return "ok"


def merge_user_into(source, target):
    if source.id == target.id:
        return
    for model, col in ((Card, "user_id"), (Hub, "owner_user_id"), (Favorite, "user_id"),
                       (ContactGroup, "owner_user_id"), (HubPresence, "user_id")):
        db.session.query(model).filter(getattr(model, col) == source.id).update({getattr(model, col): target.id})
    db.session.query(ContactShare).filter_by(owner_user_id=source.id).update({ContactShare.owner_user_id: target.id})
    db.session.query(ContactShare).filter_by(from_user_id=source.id).update({ContactShare.from_user_id: target.id})
    db.session.query(BoardMessage).filter_by(sender_user_id=source.id).update({BoardMessage.sender_user_id: target.id})
    db.session.query(PrivateMessage).filter_by(from_user_id=source.id).update({PrivateMessage.from_user_id: target.id})
    db.session.query(PrivateMessage).filter_by(to_user_id=source.id).update({PrivateMessage.to_user_id: target.id})
    db.session.delete(source)
    db.session.commit()


DEFAULT_PREFS = {
    "sound_pm": True, "sound_hub_msg": True, "sound_hub_join": False, "sound_invite": True, "sound_app_open": True, "sound_hub_enter": True, "sound_send": True,
    "hubs_view": "list", "contacts_view": "list", "groups_view": "list", "lang": "he",
    "hub_people_view": "list", "messages_view": "list", "skip_cards": [],
}
THEMES = ("space", "light")


def user_prefs(user):
    try:
        p = json.loads(user.prefs or "{}")
    except Exception:
        p = {}
    out = dict(DEFAULT_PREFS)
    out["skip_cards"] = []
    out.update({k: v for k, v in p.items() if k in DEFAULT_PREFS})
    return out


def is_locked(user):
    return bool(user.pw_hash) and session.get("unlocked") != user.id


OPEN_WHEN_LOCKED = ("/api/me", "/api/unlock", "/api/logout")


@app.before_request
def lock_gate():
    p = request.path
    if p.startswith("/static/") or p.startswith("/socket.io") or not p.startswith("/api/"):
        return
    user = getattr(g, "user", None)
    if user and is_locked(user) and p not in OPEN_WHEN_LOCKED:
        return jsonify({"error": "האפליקציה נעולה", "locked": True}), 401


def me_payload(user):
    if is_locked(user):
        return {"registered": user.is_registered(), "locked": True, "theme": user.theme or "space", "reg_name": user.reg_name}
    cards = Card.query.filter_by(user_id=user.id).all()
    active = next((c for c in cards if c.is_active), None)
    return {
        "registered": user.is_registered(), "user_id": user.id, "reg_name": user.reg_name,
        "email": user.email, "phone": user.phone,
        "cards_count": len(cards),
        "has_business_card": any(c.card_type == "business" for c in cards),
        "active_card": active.full_dict() if active else None,
        "unread": PrivateMessage.query.filter_by(to_user_id=user.id, is_read=False).count(),
        "theme": user.theme or "space", "prefs": user_prefs(user), "has_password": bool(user.pw_hash),
        "is_super": bool(user.is_super), "locked": False,
    }


@app.route("/api/me")
def api_me():
    return jsonify(me_payload(g.user))


@app.route("/api/login", methods=["POST"])
def api_login():
    """Single entry point: register (name + identifier) or log back in (identifier)."""
    user = g.user
    d = request.get_json(force=True)
    name = (d.get("name") or "").strip()
    phone, email = norm_phone(d.get("phone")), norm_email(d.get("email"))
    legacy_phone = re.sub(r"[\s\-()]", "", (d.get("phone") or "")) or None
    if not phone and not email:
        return err("יש למלא לפחות אחד מהשדות המזהים")

    by_phone = User.query.filter(User.phone.in_([phone, legacy_phone]), User.id != user.id).first() if phone else None
    by_email = User.query.filter(User.email == email, User.id != user.id).first() if email else None
    if by_phone and by_email and by_phone.id != by_email.id:
        return err("מזהה זה כבר רשום במערכת")
    existing = by_phone or by_email

    if existing:
        if name and existing.reg_name and name.lower() != existing.reg_name.lower():
            return err("מזהה זה כבר רשום במערכת")
        # returning user: attach a new second identifier if one was supplied
        if phone and (not existing.phone or existing.phone == legacy_phone):
            existing.phone = phone
        if email and not existing.email:
            existing.email = email
        db.session.commit()
        merge_user_into(user, existing)
        resp = jsonify({"ok": True, "returning": True, "reg_name": existing.reg_name})
        set_device_cookie(resp, existing.device_id)
        g.new_device_id = None
        return resp

    if not name:
        if user.is_registered():
            return err("מזהה לא מוכר. נא למלא את המזהה השני")
        return err("שדה השם הוא חובה בהרשמה. משתמש חוזר – מזהה לא מוכר, נא למלא את המזהה השני")
    user.reg_name = name
    if phone:
        user.phone = phone
    if email:
        user.email = email
    db.session.commit()
    return jsonify({"ok": True, "returning": False, "reg_name": name})


@app.route("/api/logout", methods=["POST"])
def api_logout():
    nd = str(uuid.uuid4())
    db.session.add(User(device_id=nd))
    db.session.commit()
    resp = jsonify({"ok": True})
    set_device_cookie(resp, nd)
    g.new_device_id = None
    return resp


# ---------------------------------------------------------------------------
# Settings / password / super admin
# ---------------------------------------------------------------------------

UNLOCK_FAILS = {}   # user_id -> (count, first_ts)


@app.route("/api/settings", methods=["PUT"])
def save_settings():
    d = request.get_json(force=True) or {}
    u = g.user
    if "theme" in d:
        if d["theme"] not in THEMES:
            return err("עיצוב לא מוכר")
        u.theme = d["theme"]
    if "prefs" in d and isinstance(d["prefs"], dict):
        cur = user_prefs(u)
        for k, v in d["prefs"].items():
            if k in DEFAULT_PREFS:
                if isinstance(DEFAULT_PREFS[k], bool):
                    cur[k] = bool(v)
                elif k.endswith("_view"):
                    cur[k] = "grid" if v == "grid" else "list"
                elif k == "lang":
                    cur[k] = "he"
                elif k == "skip_cards":
                    pass   # managed through /api/hubs/<id>/card-pref
        u.prefs = json.dumps(cur)
    db.session.commit()
    return jsonify({"ok": True, "theme": u.theme, "prefs": user_prefs(u)})


@app.route("/api/password", methods=["POST"])
def set_password():
    d = request.get_json(force=True) or {}
    pw, pw2 = d.get("password") or "", d.get("confirm") or ""
    u = g.user
    if u.pw_hash and not check_password_hash(u.pw_hash, d.get("current") or ""):
        return err("הסיסמה הנוכחית שגויה", 403)
    if len(pw) < 4:
        return err("הסיסמה קצרה מדי (לפחות 4 תווים)")
    if pw != pw2:
        return err("שתי הסיסמאות אינן זהות")
    u.pw_hash = generate_password_hash(pw)
    db.session.commit()
    session["unlocked"] = u.id
    return jsonify({"ok": True})


@app.route("/api/password", methods=["DELETE"])
def delete_password():
    d = request.get_json(silent=True) or {}
    u = g.user
    if not u.pw_hash:
        return jsonify({"ok": True})
    if not check_password_hash(u.pw_hash, d.get("current") or ""):
        return err("הסיסמה שגויה", 403)
    u.pw_hash = ""
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/unlock", methods=["POST"])
def unlock():
    u = g.user
    if not u.pw_hash:
        return jsonify({"ok": True})
    cnt, first = UNLOCK_FAILS.get(u.id, (0, time.time()))
    if time.time() - first > 300:
        cnt, first = 0, time.time()
    if cnt >= 5:
        return err("יותר מדי ניסיונות. נסה שוב בעוד מספר דקות", 429)
    if not check_password_hash(u.pw_hash, (request.get_json(force=True) or {}).get("password") or ""):
        UNLOCK_FAILS[u.id] = (cnt + 1, first)
        return err("סיסמה שגויה", 403)
    UNLOCK_FAILS.pop(u.id, None)
    session["unlocked"] = u.id
    return jsonify({"ok": True})


@app.route("/api/super/claim", methods=["POST"])
def super_claim():
    """Super-admin rights are bound to this device's user + a secret kept in the SUPER_ADMIN_PASSWORD env var."""
    secret = os.environ.get("SUPER_ADMIN_PASSWORD", "")
    pw = (request.get_json(force=True) or {}).get("password") or ""
    key = "super:" + g.user.id
    cnt, first = UNLOCK_FAILS.get(key, (0, time.time()))
    if time.time() - first > 300:
        cnt, first = 0, time.time()
    if cnt >= 5:
        return err("יותר מדי ניסיונות. נסה שוב בעוד מספר דקות", 429)
    if not secret or pw != secret:
        UNLOCK_FAILS[key] = (cnt + 1, first)
        return err("סיסמת מנהל שגויה", 403)
    g.user.is_super = True
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/super/stats")
def super_stats():
    if not g.user.is_super:
        return err("אין הרשאה", 403)
    return jsonify({"users": User.query.count(), "hubs": Hub.query.count(), "open_hubs": Hub.query.filter_by(is_open=True).count(),
                    "cards": Card.query.count(), "messages": PrivateMessage.query.count()})


# ---------------------------------------------------------------------------
# Cards
# ---------------------------------------------------------------------------

def get_active_card(user_id):
    return Card.query.filter_by(user_id=user_id, is_active=True).first()


MOODS = ("", "😀", "😎", "🥳", "🤔", "😴", "💪", "🎯", "☕", "🎧", "🚀")


def apply_card_fields(card, d):
    for f in CARD_FIELD_NAMES:
        if f in d:
            setattr(card, f, (d.get(f) or "").strip() if isinstance(d.get(f), str) or d.get(f) is None else d.get(f))
        if f + "_visible" in d:
            setattr(card, f + "_visible", bool(d.get(f + "_visible")))
    for f in ("card_name", "degree"):
        if f in d:
            setattr(card, f, (d.get(f) or "").strip())
    if "is_open_to_contact" in d:
        card.is_open_to_contact = bool(d.get("is_open_to_contact"))
    if "mood" in d:
        card.mood = (d.get("mood") or "")[:8] if (d.get("mood") or "") in MOODS else ""
    if "networks" in d and isinstance(d["networks"], list):
        clean = [{"type": str(n.get("type") or "other")[:20], "value": str(n.get("value") or "").strip()[:200]}
                 for n in d["networks"] if isinstance(n, dict) and str(n.get("value") or "").strip()][:12]
        card.networks = json.dumps(clean)
    if "networks_visible" in d:
        card.networks_visible = bool(d.get("networks_visible"))


def sync_presence_status(user_id):
    """Keep the in-hub green/red dot in sync with the active card's openness."""
    card = get_active_card(user_id)
    if not card:
        return
    for p in HubPresence.query.filter_by(user_id=user_id, is_live=True).all():
        p.card_id = card.id
        p.status = "green" if card.effective_open() else "red"
    db.session.commit()
    for p in HubPresence.query.filter_by(user_id=user_id, is_live=True).all():
        emit_presence_list(p.hub_id)


@app.route("/api/cards", methods=["GET"])
def list_cards():
    cards = Card.query.filter_by(user_id=g.user.id).order_by(Card.created_at.desc()).all()
    cards.sort(key=lambda c: not c.is_active)
    return jsonify([c.full_dict() for c in cards])


@app.route("/api/cards", methods=["POST"])
def create_card():
    d = request.get_json(force=True)
    if d.get("type") not in ("business", "social"):
        return err("סוג כרטיס לא תקין")
    # the name is optional (it may be hidden: the card is then a "viewer" card)
    card = Card(user_id=g.user.id, card_type=d["type"])
    apply_card_fields(card, d)
    if not card.card_name:
        card.card_name = "כרטיס עסקי" if card.card_type == "business" else "כרטיס חברתי"
    # a freshly saved card becomes the active one
    Card.query.filter_by(user_id=g.user.id).update({Card.is_active: False})
    card.is_active = True
    db.session.add(card)
    db.session.flush()
    for i, url in enumerate(d.get("photos") or []):
        url_s = url.get("url") if isinstance(url, dict) else url
        if url_s:
            vis = url.get("is_visible", True) if isinstance(url, dict) else True
            prof = url.get("is_profile_photo", i == 0) if isinstance(url, dict) else (i == 0)
            db.session.add(CardPhoto(card_id=card.id, url=url_s, is_visible=vis, is_profile_photo=prof, order=i))
    db.session.commit()
    sync_presence_status(g.user.id)
    return jsonify(card.full_dict())


@app.route("/api/cards/<card_id>", methods=["PUT"])
def update_card(card_id):
    card = Card.query.filter_by(id=card_id, user_id=g.user.id).first()
    if not card:
        return err("לא נמצא", 404)
    d = request.get_json(force=True)
    apply_card_fields(card, d)
    if "photos" in d and isinstance(d["photos"], list):
        CardPhoto.query.filter_by(card_id=card.id).delete()
        for i, p in enumerate(d["photos"]):
            url = p.get("url") if isinstance(p, dict) else p
            if url:
                db.session.add(CardPhoto(card_id=card.id, url=url, order=i,
                                         is_visible=(p.get("is_visible", True) if isinstance(p, dict) else True),
                                         is_profile_photo=(p.get("is_profile_photo", False) if isinstance(p, dict) else False)))
        db.session.flush()
        db.session.expire(card)
        photos = CardPhoto.query.filter_by(card_id=card.id).order_by(CardPhoto.order).all()
        if photos and not any(p.is_profile_photo for p in photos):
            photos[0].is_profile_photo = True
    db.session.commit()
    if card.is_active:
        sync_presence_status(g.user.id)
    return jsonify(card.full_dict())


@app.route("/api/cards/<card_id>", methods=["DELETE"])
def delete_card(card_id):
    card = Card.query.filter_by(id=card_id, user_id=g.user.id).first()
    if not card:
        return err("לא נמצא", 404)
    was_active = card.is_active
    db.session.delete(card)
    db.session.commit()
    if was_active:
        nxt = Card.query.filter_by(user_id=g.user.id).order_by(Card.created_at.desc()).first()
        if nxt:
            nxt.is_active = True
            db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/cards/<card_id>/activate", methods=["POST"])
def activate_card(card_id):
    card = Card.query.filter_by(id=card_id, user_id=g.user.id).first()
    if not card:
        return err("לא נמצא", 404)
    if card.card_type != "business":
        # a professional hub cannot be used with a social card
        for hid in {SID_TO_HUB.get(sid) for sid in USER_SIDS.get(g.user.id, set())} - {None}:
            hb = Hub.query.get(hid)
            if hb and hb.hub_type == "professional" and not is_mgr(hb, g.user.id):
                return err("לא ניתן להיות בהאב מקצועי עם כרטיס חברתי. צא מההאב כדי להחליף כרטיס")
    Card.query.filter_by(user_id=g.user.id).update({Card.is_active: False})
    card.is_active = True
    db.session.commit()
    sync_presence_status(g.user.id)
    return jsonify(card.full_dict())


@app.route("/api/cards/<card_id>/open", methods=["POST"])
def toggle_card_open(card_id):
    card = Card.query.filter_by(id=card_id, user_id=g.user.id).first()
    if not card:
        return err("לא נמצא", 404)
    d = request.get_json(force=True) or {}
    card.is_open_to_contact = bool(d["open"]) if "open" in d else not card.is_open_to_contact
    db.session.commit()
    if card.is_active:
        sync_presence_status(g.user.id)
    return jsonify(card.full_dict())


# ---------------------------------------------------------------------------
# Presence helpers
# ---------------------------------------------------------------------------

def haversine(lat1, lng1, lat2, lng2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def verify_physical(hub, lat=None, lng=None, acc=None, code=None, ip=None):
    """Is this person physically at the hub? Owner picks location and/or code;
    with no method configured we fall back to 'same public IP as the owner'."""
    mode = hub.presence_mode or "none"
    if mode == "none":
        return bool(hub.owner_public_ip) and hub.owner_public_ip == (ip or "")
    if mode in ("location", "both") and hub.loc_lat is not None and hub.loc_lng is not None \
            and lat is not None and lng is not None:
        try:
            slack = min(float(acc or 0), 50.0)
            if haversine(float(lat), float(lng), hub.loc_lat, hub.loc_lng) <= (hub.loc_radius or 150) + slack:
                return True
        except (TypeError, ValueError):
            pass
    if mode in ("code", "both") and code and hub.presence_code \
            and str(code).strip().upper() == hub.presence_code.upper():
        return True
    return False


def phys_now(p):
    return bool(p.is_physical and p.is_live and (time.time() - (p.physical_ts or 0)) < PHYSICAL_TTL)


def user_state(user_id):
    """Where is this person right now? -> open flag + 'hub' | 'home' | 'off'."""
    card = get_active_card(user_id)
    open_ = bool(card and card.effective_open())
    sids = USER_SIDS.get(user_id, set())
    if not sids:
        rec = RECENT_HUB.get(user_id)
        if rec and time.time() - rec[1] < RECENT_TTL:
            hub = Hub.query.get(rec[0])
            if hub and hub.is_open:
                return {"open": open_, "state": "hub", "hub_name": hub.name}
        return {"open": open_, "state": "off", "hub_name": ""}
    for sid in sids:
        hid = SID_TO_HUB.get(sid)
        if hid:
            pr = HubPresence.query.filter_by(hub_id=hid, user_id=user_id, approval_status="approved").first()
            hub = Hub.query.get(hid)
            if pr and hub:
                return {"open": open_, "state": "hub", "hub_name": hub.name}
    return {"open": open_, "state": "home", "hub_name": ""}


USER_LOC = {}          # user_id -> (lat, lng, acc, ts)  — only while the app is open
LOC_TTL = 10 * 60
NEAR_RANGES = (100, 500, 1000, 2000)


@app.route("/api/location", methods=["POST"])
def report_location():
    d = request.get_json(force=True) or {}
    try:
        lat, lng = float(d.get("lat")), float(d.get("lng"))
    except (TypeError, ValueError):
        return err("מיקום לא תקין")
    USER_LOC[g.user.id] = (lat, lng, float(d.get("acc") or 0), time.time())
    return jsonify({"ok": True})


def dist_to(user_id, lat, lng):
    loc = USER_LOC.get(user_id)
    if not loc or time.time() - loc[3] > LOC_TTL:
        return None
    return haversine(lat, lng, loc[0], loc[1])


@app.route("/api/contact-groups/<gid>/near")
def group_near(gid):
    """'מי לידי': open members of the group whose app recently reported a location within range."""
    if not own_group(gid):
        return err("לא נמצא", 404)
    try:
        lat, lng = float(request.args.get("lat")), float(request.args.get("lng"))
        rng = int(request.args.get("range", 500))
    except (TypeError, ValueError):
        return err("נדרש מיקום")
    if rng not in NEAR_RANGES:
        rng = 500
    out = []
    for s in group_contacts(gid):
        st = user_state(s.from_user_id)
        if not st["open"]:
            continue
        dist = dist_to(s.from_user_id, lat, lng)
        if dist is not None and dist <= rng:
            snap = s.card_snapshot or {}
            out.append({"contact_id": s.id, "user_id": s.from_user_id, "dist": round(dist),
                        "name": snap.get("display_name") or snap.get("name") or snap.get("nickname") or VIEWER_NAME,
                        "photo": snap.get("photo_url", ""), "state": st["state"], "hub_name": st["hub_name"]})
    out.sort(key=lambda r: r["dist"])
    return jsonify({"range": rng, "members": out})


def person_brief(user_id, snapshot=None):
    card = get_active_card(user_id)
    snap = snapshot or (card.public_dict() if card and card.effective_open() else {})
    st = user_state(user_id)
    return {
        "user_id": user_id,
        "name": snap.get("display_name") or snap.get("name") or snap.get("nickname")
                or (card.display_name() if card else VIEWER_NAME),
        "photo": snap.get("photo_url", ""),
        "desc": snap.get("title") or snap.get("bio") or "",
        "company": snap.get("company", ""),
        "open": st["open"], "state": st["state"], "hub_name": st["hub_name"],
    }


def snapshot_for(user_id, hub_id=None):
    """The card as others may currently see it (visible fields only)."""
    card = None
    if hub_id:
        pr = HubPresence.query.filter_by(hub_id=hub_id, user_id=user_id).first()
        card = Card.query.get(pr.card_id) if pr else None
    card = card or get_active_card(user_id)
    return card.public_dict() if card else {}


def compute_names(presences):
    """Display names, with (1),(2) suffixes for duplicates in join order."""
    ordered = sorted(presences, key=lambda p: p.joined_at)
    cards = {p.id: Card.query.get(p.card_id) for p in ordered}
    base = {p.id: (cards[p.id].display_name() if cards[p.id] else VIEWER_NAME) for p in ordered}
    counts = {}
    for b in base.values():
        counts[b] = counts.get(b, 0) + 1
    run, out = {}, {}
    for p in ordered:
        b = base[p.id]
        if counts[b] > 1 and b != VIEWER_NAME:
            run[b] = run.get(b, 0) + 1
            out[p.id] = f"{b}({run[b]})"
        else:
            out[p.id] = b
    return out


def presence_entry(p, hub, names, card=None):
    card = card or Card.query.get(p.card_id)
    if card and not card.effective_open():
        # closed / viewer cards expose no details to others
        cdict = {"id": card.id, "type": card.card_type, "display_name": card.display_name(),
                 "is_viewer": card.is_viewer(), "photo_url": "", "photos": []}
    else:
        cdict = card.public_dict() if card else {}
    return {
        "user_id": p.user_id, "card_id": p.card_id, "display_name": names.get(p.id, VIEWER_NAME),
        "status": p.status, "is_live": p.is_live, "is_physical": phys_now(p),
        "approval_status": p.approval_status, "is_owner": p.user_id == hub.owner_user_id,
        "joined_at": p.joined_at, "card": cdict,
    }


def sids_of(user_id):
    return list(USER_SIDS.get(user_id, set()))


def emit_to_user(user_id, event, payload):
    for sid in sids_of(user_id):
        socketio.emit(event, payload, room=sid)


def emit_presence_list(hub_id):
    hub = Hub.query.get(hub_id)
    if not hub:
        return
    allp = HubPresence.query.filter_by(hub_id=hub_id).all()
    names = compute_names(allp)
    approved = [p for p in allp if p.approval_status == "approved"]
    entries = [presence_entry(p, hub, names) for p in approved]
    entries.sort(key=lambda r: (not r["is_owner"], not r["is_live"], r["joined_at"]))
    socketio.emit("presence_list", entries, room=f"hub:{hub_id}")
    emit_pending(hub, allp, names)


def emit_pending(hub, allp=None, names=None):
    allp = allp if allp is not None else HubPresence.query.filter_by(hub_id=hub.id).all()
    names = names or compute_names(allp)
    pend = [presence_entry(p, hub, names) for p in allp if p.approval_status == "pending"]
    emit_to_user(hub.owner_user_id, "pending_list", {"hub_id": hub.id, "pending": pend})


# ---------------------------------------------------------------------------
# Private messages (REST) — shared by hubs, "My messages" and "My contacts"
# ---------------------------------------------------------------------------

def pm_dict(m, me_id):
    return {
        "id": m.id, "from_user_id": m.from_user_id, "to_user_id": m.to_user_id,
        "mine": m.from_user_id == me_id, "text": m.text, "image": m.image_url, "ts": m.ts, "file_name": (m.file_name or "") if m.file_url else "",
        "kind": m.kind, "group_name": m.group_name, "group_id": m.group_id, "sender_name": m.sender_name,
        "hub_id": m.hub_id, "hub_name": m.hub_name, "hub_link_id": m.hub_link_id,
        "is_read": m.is_read,
    }


def banned_from_owner(sender_id, recipient_id):
    """A banned user may still write to the owner of the hub that banned them."""
    q = (HubBan.query.filter_by(user_id=sender_id)
         .join(Hub, Hub.id == HubBan.hub_id).filter(Hub.owner_user_id == recipient_id))
    return q.first() is not None


def create_pm(from_id, to_id, text, image="", kind="normal", group_name="", hub=None, sender_card=None, hub_link_id=None, group_id=None, file_url="", file_name=""):
    card = sender_card or get_active_card(from_id)
    snap = card.public_dict() if card else {}
    sender = User.query.get(from_id)
    pm = PrivateMessage(
        from_user_id=from_id, to_user_id=to_id, text=text, image_url=image, kind=kind,
        group_name=group_name, hub_id=hub.id if hub else None, hub_name=hub.name if hub else "",
        sender_name=(card.display_name() if card else (sender.reg_name if sender else VIEWER_NAME)),
        card_snapshot=snap, is_read=False, group_id=group_id, file_url=file_url, file_name=file_name,
    )
    pm.hub_link_id = hub_link_id
    db.session.add(pm)
    db.session.commit()
    return pm


def push_pm(pm):
    for uid in {pm.from_user_id, pm.to_user_id}:
        emit_to_user(uid, "private_message", {**pm_dict(pm, uid), "other_user_id": pm.from_user_id if uid == pm.to_user_id else pm.to_user_id})


def check_can_send(sender, recipient_id, hub=None):
    card = get_active_card(sender.id)
    if not card:
        return "יש להגדיר כרטיס לפני שליחת הודעות"
    rcard = get_active_card(recipient_id)
    if banned_from_owner(sender.id, recipient_id):
        return None
    if not card.effective_open():
        return "הכרטיס שלך סגור לתקשורת – אתה במצב צפייה בלבד"
    if not rcard or not rcard.effective_open():
        return "איש הקשר סגור לתקשורת"
    return None


@app.route("/api/messages/send", methods=["POST"])
def send_message():
    d = request.get_json(force=True)
    to_id = d.get("to_user_id")
    text = (d.get("text") or "").strip()
    image = d.get("image") or ""
    if not to_id or (not text and not image):
        return err("נא להזין הודעה")
    if to_id == g.user.id or not User.query.get(to_id):
        return err("נמען לא תקין")
    hub = Hub.query.get(d.get("hub_id")) if d.get("hub_id") else None
    e = check_can_send(g.user, to_id, hub)
    if e:
        return err(e, 403)
    pm = create_pm(g.user.id, to_id, text, image, hub=hub)
    push_pm(pm)
    return jsonify(pm_dict(pm, g.user.id))


@app.route("/api/messages/<message_id>", methods=["DELETE"])
def delete_message(message_id):
    m = PrivateMessage.query.get(message_id)
    if not m or m.from_user_id != g.user.id:
        return err("אפשר למחוק רק הודעות ששלחת בעצמך", 403)
    other = m.to_user_id
    db.session.delete(m)
    db.session.commit()
    for uid in (g.user.id, other):
        emit_to_user(uid, "private_message_deleted", {"id": message_id, "other_user_id": other if uid == g.user.id else g.user.id})
    return jsonify({"ok": True})


def conversation_rows(user, q="", hub_id=None):
    msgs = PrivateMessage.query.filter(
        db.or_(PrivateMessage.to_user_id == user.id, PrivateMessage.from_user_id == user.id)).order_by(PrivateMessage.ts).all()
    if hub_id:
        msgs = [m for m in msgs if m.hub_id == hub_id]
    conv = {}
    for m in msgs:
        other = m.from_user_id if m.to_user_id == user.id else m.to_user_id
        conv.setdefault(other, []).append(m)
    ql = q.strip().lower()
    rows = []
    for other, ms in conv.items():
        last = ms[-1]
        unread = sum(1 for m in ms if m.to_user_id == user.id and not m.is_read)
        direct = [m for m in ms if m.kind != "group"]
        if not direct and not hub_id:
            continue            # only group messages: they live under the groups tab
        ms = direct or ms
        last = ms[-1]
        unread = sum(1 for m in ms if m.to_user_id == user.id and not m.is_read)
        brief = person_brief(other)
        incoming = [m for m in ms if m.to_user_id == user.id]
        name = (incoming[-1].sender_name if incoming else "") or brief["name"]
        hub_names = " ".join({m.hub_name for m in ms if m.hub_name})
        serials = " ".join({(Hub.query.get(m.hub_id).serial or "") for m in ms if m.hub_id and Hub.query.get(m.hub_id)})
        if ql:
            hay = " ".join([name, brief["name"], hub_names, serials] + [m.text for m in ms]).lower()
            if ql not in hay:
                continue
        photo = ((incoming[-1].card_snapshot or {}).get("photo_url") if incoming else "") or brief["photo"]
        rows.append({
            "user_id": other, "name": name, "photo": photo,
            "hub_name": last.hub_name or ("הודעה ישירה" if last.kind != "system" else ""),
            "hub_id": last.hub_id,
            "last_text": last.text or ("📷 תמונה" if last.image_url else ""),
            "last_kind": last.kind, "group_name": last.group_name if last.kind == "group" else "",
            "last_sender": last.sender_name if last.kind == "group" else "",
            "ts": last.ts, "unread": unread,
            "open": brief["open"], "state": brief["state"], "now_hub": brief["hub_name"],
        })
    rows.sort(key=lambda r: (r["unread"] == 0, -r["ts"]))
    return rows[:100]


@app.route("/api/messages")
def list_messages():
    q = (request.args.get("q") or "").strip()
    rows = conversation_rows(g.user, q, request.args.get("hub_id"))
    out = {"conversations": rows, "unread": PrivateMessage.query.filter_by(to_user_id=g.user.id, is_read=False).count()}
    if q:
        ql = q.lower()
        out["contacts"] = [c for c in contacts_payload(g.user) if ql in (c["name"] + " " + c["company"]).lower()]
    return jsonify(out)


def gkey(m):
    return m.group_id or ("n:" + (m.group_name or ""))


@app.route("/api/messages/groups")
def message_groups():
    """Group conversations I take part in (as owner or as a member), plus my own groups even if still silent."""
    uid = g.user.id
    msgs = (PrivateMessage.query.filter(PrivateMessage.kind == "group",
            db.or_(PrivateMessage.to_user_id == uid, PrivateMessage.from_user_id == uid)).order_by(PrivateMessage.ts).all())
    # old messages (no group id, from before groups had ids) join the group of the same name, so one group = one row
    name2id = {m.group_name: m.group_id for m in msgs if m.group_id and m.group_name}
    for gr0 in ContactGroup.query.filter_by(owner_user_id=uid).all():
        name2id[gr0.name] = gr0.id
    by = {}
    for m in msgs:
        k = m.group_id or name2id.get(m.group_name or "") or gkey(m)
        by.setdefault(k, []).append(m)
    rows = []
    for key, ms in by.items():
        last = ms[-1]
        gid_ = next((m.group_id for m in reversed(ms) if m.group_id), "")
        gr = ContactGroup.query.get(gid_) if gid_ else None
        rows.append({"group_id": gid_, "key": key, "group_name": gr.name if gr else last.group_name,
                     "image": gr.image if gr else "", "last_text": last.text or ("📷 תמונה" if last.image_url else ""),
                     "last_sender": "אני" if last.from_user_id == uid else last.sender_name, "ts": last.ts,
                     "unread": sum(1 for m in ms if m.to_user_id == uid and not m.is_read)})
    have = {r["group_id"] for r in rows}
    for gr in ContactGroup.query.filter_by(owner_user_id=uid).all():
        if gr.id not in have:
            rows.append({"group_id": gr.id, "key": gr.id, "group_name": gr.name, "image": gr.image, "last_text": "", "last_sender": "", "ts": 0, "unread": 0})
    rows.sort(key=lambda r: -r["ts"])
    return jsonify(rows[:100])


@app.route("/api/messages/group-thread")
def group_thread():
    uid = g.user.id
    gid = request.args.get("id", "")
    name = request.args.get("name", "")
    q = PrivateMessage.query.filter(PrivateMessage.kind == "group", db.or_(PrivateMessage.to_user_id == uid, PrivateMessage.from_user_id == uid))
    gr0 = ContactGroup.query.get(gid) if gid else None
    if gid:
        cond = PrivateMessage.group_id == gid
        if gr0:
            cond = db.or_(cond, db.and_(PrivateMessage.group_id.is_(None), PrivateMessage.group_name == gr0.name))
        q = q.filter(cond)
    else:
        q = q.filter(PrivateMessage.group_name == name)
    ms = q.order_by(PrivateMessage.ts).all()
    # one outgoing message is stored once per recipient: show it once
    seen, out, changed = set(), [], False
    for m in ms:
        if m.from_user_id == uid:
            key = (m.ts // 2, m.text, bool(m.image_url))
            if key in seen:
                continue
            seen.add(key)
        elif not m.is_read and m.to_user_id == uid:
            m.is_read = True
            changed = True
        out.append(pm_dict(m, uid))
    if changed:
        db.session.commit()
        emit_to_user(uid, "unread_changed", {})
    gr = ContactGroup.query.get(gid) if gid else None
    can_send = bool(gid) and bool(gr) and (gr.owner_user_id == uid or any(not o["mine"] for o in out))
    return jsonify({"messages": out[-100:], "group_name": gr.name if gr else name, "group_id": gid, "can_send": can_send})


@app.route("/api/messages/group-send", methods=["POST"])
def group_send():
    """Write to a whole group conversation (owner or any member who received a group message): everyone sees it."""
    uid = g.user.id
    d = request.get_json(force=True) or {}
    gr = ContactGroup.query.get(d.get("group_id") or "")
    if not gr:
        return err("הקבוצה לא נמצאה", 404)
    text = (d.get("text") or "").strip()
    image = d.get("image") or ""
    if not text and not image:
        return err("נא להזין הודעה")
    member = gr.owner_user_id == uid or PrivateMessage.query.filter_by(kind="group", group_id=gr.id, to_user_id=uid).first() is not None
    if not member:
        return err("אינך חבר בקבוצה", 403)
    my = get_active_card(uid)
    if not my or not my.effective_open():
        return err("הכרטיס שלך סגור לתקשורת – אתה במצב צפייה בלבד", 403)
    targets = {s.from_user_id for s in group_contacts(gr.id)} | {gr.owner_user_id}
    targets.discard(uid)
    sent = 0
    for t in targets:
        rc = get_active_card(t)
        if not rc or not rc.effective_open():
            continue
        push_pm(create_pm(uid, t, text, image=image, kind="group", group_name=gr.name, group_id=gr.id))
        sent += 1
    if not sent:
        # nobody could receive it: keep a copy for the sender so the conversation shows it
        push_pm(create_pm(uid, uid, text, image=image, kind="group", group_name=gr.name, group_id=gr.id))
    return jsonify({"ok": True, "sent": sent})


@app.route("/api/messages/unread-count")
def unread_count():
    return jsonify({"unread": PrivateMessage.query.filter_by(to_user_id=g.user.id, is_read=False).count()})


@app.route("/api/messages/thread/<other_id>")
def message_thread(other_id):
    uid = g.user.id
    limit = max(1, min(int(request.args.get("limit", 5)), 100))
    before = request.args.get("before", type=float)
    base = PrivateMessage.query.filter(db.or_(
        db.and_(PrivateMessage.from_user_id == uid, PrivateMessage.to_user_id == other_id),
        db.and_(PrivateMessage.from_user_id == other_id, PrivateMessage.to_user_id == uid)))
    if request.args.get("hub_id"):
        base = base.filter(PrivateMessage.hub_id == request.args.get("hub_id"))
    q = base
    if before:
        q = q.filter(PrivateMessage.ts < before)
    page = q.order_by(PrivateMessage.ts.desc()).limit(limit + 1).all()
    has_more = len(page) > limit
    page = list(reversed(page[:limit]))
    if not before:
        changed = False
        for m in base.filter(PrivateMessage.to_user_id == uid, PrivateMessage.is_read == False).all():  # noqa: E712
            m.is_read = True
            changed = True
        if changed:
            db.session.commit()
            emit_to_user(uid, "unread_changed", {})
    resp = {"messages": [pm_dict(m, uid) for m in page], "has_more": has_more}
    if not before:
        resp["other"] = other_card_info(g.user, other_id)
    return jsonify(resp)


def other_card_info(me, other_id):
    """The other person's card (as saved in my contacts, else as last sent) + flags."""
    brief = person_brief(other_id)
    contact = ContactShare.query.filter_by(owner_user_id=me.id, from_user_id=other_id).first()
    card = None
    if contact:
        card = contact.card_snapshot
    else:
        last_in = (PrivateMessage.query.filter_by(from_user_id=other_id, to_user_id=me.id)
                   .order_by(PrivateMessage.ts.desc()).first())
        card = last_in.card_snapshot if last_in else {}
    groups = []
    if contact:
        for gm in ContactGroupMember.query.filter_by(contact_id=contact.id).all():
            gr = ContactGroup.query.get(gm.group_id)
            if gr:
                groups.append({"id": gr.id, "name": gr.name})
    my_card = get_active_card(me.id)
    can_msg = check_can_send(me, other_id) is None
    return {**brief, "card": card or {}, "is_contact": bool(contact), "contact_id": contact.id if contact else None,
            "groups": groups, "can_message": can_msg,
            "saved_ts": contact.ts if contact else None, "i_am_viewer": bool(my_card and not my_card.effective_open())}


# ---------------------------------------------------------------------------
# Contacts + groups
# ---------------------------------------------------------------------------

def contacts_payload(user):
    shares = ContactShare.query.filter_by(owner_user_id=user.id).order_by(ContactShare.ts.desc()).all()
    members = {}
    for gm in ContactGroupMember.query.filter(
            ContactGroupMember.group_id.in_([g_.id for g_ in ContactGroup.query.filter_by(owner_user_id=user.id).all()] or [""])).all():
        members.setdefault(gm.contact_id, []).append(gm.group_id)
    gnames = {g_.id: g_.name for g_ in ContactGroup.query.filter_by(owner_user_id=user.id).all()}
    out = []
    for s in shares:
        brief = person_brief(s.from_user_id, snapshot=s.card_snapshot)
        # open/state are LIVE values; name/photo/desc come from the saved card
        live = user_state(s.from_user_id)
        snap = s.card_snapshot or {}
        out.append({
            "id": s.id, "user_id": s.from_user_id,
            "name": snap.get("display_name") or snap.get("name") or snap.get("nickname") or brief["name"],
            "photo": snap.get("photo_url", ""),
            "desc": snap.get("bio") or snap.get("title") or "",
            "company": snap.get("company", ""),
            "card": snap, "hub_name": s.hub_name_snapshot, "saved_ts": s.ts,
            "open": live["open"], "state": live["state"], "now_hub": live["hub_name"],
            "groups": [{"id": gid, "name": gnames.get(gid, "")} for gid in members.get(s.id, [])],
        })
    return out


@app.route("/api/contacts", methods=["GET"])
def list_contacts():
    rows = contacts_payload(g.user)
    lat, lng = request.args.get("lat", type=float), request.args.get("lng", type=float)
    if lat is not None and lng is not None:
        for r in rows:
            d_ = dist_to(r["user_id"], lat, lng) if r["open"] else None
            r["dist"] = None if d_ is None else round(d_)
    return jsonify(rows)


@app.route("/api/contacts", methods=["POST"])
def save_contact():
    d = request.get_json(force=True)
    other = d.get("user_id")
    if not other or other == g.user.id or not User.query.get(other):
        return err("משתמש לא תקין")
    ocard = get_active_card(other)
    hub = Hub.query.get(d.get("hub_id")) if d.get("hub_id") else None
    pr = HubPresence.query.filter_by(hub_id=hub.id, user_id=other).first() if hub else None
    card = (Card.query.get(pr.card_id) if pr else None) or ocard
    if not card or not card.effective_open():
        return err("איש הקשר סגור לתקשורת – אי אפשר לשמור אותו", 403)
    existing = ContactShare.query.filter_by(owner_user_id=g.user.id, from_user_id=other).first()
    if existing:
        existing.card_snapshot = card.public_dict()
        existing.ts = time.time()
        if hub:
            existing.hub_id, existing.hub_name_snapshot = hub.id, hub.name
        db.session.commit()
        return jsonify({"ok": True, "id": existing.id, "existing": True})
    s = ContactShare(owner_user_id=g.user.id, from_user_id=other, hub_id=hub.id if hub else None,
                     hub_name_snapshot=hub.name if hub else (d.get("hub_name") or ""),
                     card_snapshot=card.public_dict())
    db.session.add(s)
    db.session.commit()
    return jsonify({"ok": True, "id": s.id, "existing": False})


@app.route("/api/contacts/<cid>", methods=["DELETE"])
def delete_contact(cid):
    s = ContactShare.query.filter_by(id=cid, owner_user_id=g.user.id).first()
    if not s:
        return err("לא נמצא", 404)
    ContactGroupMember.query.filter_by(contact_id=cid).delete()
    db.session.delete(s)
    db.session.commit()
    return jsonify({"ok": True})


def groups_payload(user):
    out = []
    for gr in ContactGroup.query.filter_by(owner_user_id=user.id).order_by(ContactGroup.created_at).all():
        ids = [m.contact_id for m in ContactGroupMember.query.filter_by(group_id=gr.id).all()]
        out.append({"id": gr.id, "name": gr.name, "contact_ids": ids,
                    "description": gr.description or "", "image": gr.image or ""})
    return out


@app.route("/api/contact-groups", methods=["GET"])
def list_groups():
    return jsonify(groups_payload(g.user))


@app.route("/api/contact-groups", methods=["POST"])
def create_group():
    d = request.get_json(force=True) or {}
    name = (d.get("name") or "").strip()
    if not name:
        return err("יש להזין שם לקבוצה")
    gr = ContactGroup(owner_user_id=g.user.id, name=name, description=(d.get("description") or "").strip()[:300],
                      image=d.get("image") or "")
    db.session.add(gr)
    db.session.commit()
    return jsonify({"id": gr.id, "name": gr.name, "contact_ids": [], "description": gr.description, "image": gr.image})


@app.route("/api/contact-groups/<gid>", methods=["PUT"])
def update_group(gid):
    gr = own_group(gid)
    if not gr:
        return err("לא נמצא", 404)
    d = request.get_json(force=True) or {}
    if "name" in d:
        if not (d["name"] or "").strip():
            return err("יש להזין שם לקבוצה")
        gr.name = d["name"].strip()
    if "description" in d:
        gr.description = (d["description"] or "").strip()[:300]
    if "image" in d:
        gr.image = d["image"] or ""
    db.session.commit()
    return jsonify({"ok": True})


def own_group(gid):
    return ContactGroup.query.filter_by(id=gid, owner_user_id=g.user.id).first()


@app.route("/api/contact-groups/<gid>", methods=["DELETE"])
def delete_group(gid):
    gr = own_group(gid)
    if not gr:
        return err("לא נמצא", 404)
    ContactGroupMember.query.filter_by(group_id=gid).delete()
    db.session.delete(gr)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/contact-groups/<gid>/members", methods=["POST"])
def add_group_members(gid):
    gr = own_group(gid)
    if not gr:
        return err("לא נמצא", 404)
    added = 0
    for cid in (request.get_json(force=True) or {}).get("contact_ids", []):
        if not ContactShare.query.filter_by(id=cid, owner_user_id=g.user.id).first():
            continue
        if not ContactGroupMember.query.filter_by(group_id=gid, contact_id=cid).first():
            db.session.add(ContactGroupMember(group_id=gid, contact_id=cid))
            added += 1
    db.session.commit()
    return jsonify({"ok": True, "added": added})


@app.route("/api/contact-groups/<gid>/members/<cid>", methods=["DELETE"])
def remove_group_member(gid, cid):
    if not own_group(gid):
        return err("לא נמצא", 404)
    ContactGroupMember.query.filter_by(group_id=gid, contact_id=cid).delete()
    db.session.commit()
    return jsonify({"ok": True})


def group_contacts(gid):
    ids = [m.contact_id for m in ContactGroupMember.query.filter_by(group_id=gid).all()]
    return [ContactShare.query.get(i) for i in ids if ContactShare.query.get(i)]


@app.route("/api/contact-groups/<gid>/where")
def group_where(gid):
    """'Where are they now': hub name for open people in a hub, 'פעיל' at home,
    'כבוי' offline; people who are closed (red) cannot be located."""
    if not own_group(gid):
        return err("לא נמצא", 404)
    out = []
    for s in group_contacts(gid):
        st = user_state(s.from_user_id)
        snap = s.card_snapshot or {}
        name = snap.get("display_name") or snap.get("name") or snap.get("nickname") or VIEWER_NAME
        if not st["open"]:
            label = "לא ניתן לאתר"
        elif st["state"] == "hub":
            label = st["hub_name"]
        elif st["state"] == "home":
            label = "פעיל"
        else:
            label = "כבוי"
        out.append({"contact_id": s.id, "name": name, "state": st["state"] if st["open"] else "hidden", "label": label})
    return jsonify(out)


@app.route("/api/contact-groups/<gid>/message", methods=["POST"])
def message_group(gid):
    gr = own_group(gid)
    if not gr:
        return err("לא נמצא", 404)
    body = request.get_json(force=True) or {}
    text = (body.get("text") or "").strip()
    image = body.get("image") or ""
    if not text and not image:
        return err("נא להזין הודעה")
    my = get_active_card(g.user.id)
    if not my or not my.effective_open():
        return err("הכרטיס שלך סגור לתקשורת – אתה במצב צפייה בלבד", 403)
    sent, skipped = 0, 0
    for s in group_contacts(gid):
        rc = get_active_card(s.from_user_id)
        if not rc or not rc.effective_open():
            skipped += 1
            continue
        pm = create_pm(g.user.id, s.from_user_id, text, image=image, kind="group", group_name=gr.name, group_id=gr.id)
        push_pm(pm)
        sent += 1
    return jsonify({"ok": True, "sent": sent, "skipped": skipped, "group_name": gr.name, "sender_name": my.display_name()})


# ---------------------------------------------------------------------------
# Hubs
# ---------------------------------------------------------------------------

def hub_owner_card(hub):
    return Card.query.get(hub.owner_card_id) if hub.owner_card_id else get_active_card(hub.owner_user_id)


def activity_for(hub):
    live = HubPresence.query.filter_by(hub_id=hub.id, is_live=True, approval_status="approved").count()
    since = time.time() - 3600
    msgs = BoardMessage.query.filter(BoardMessage.hub_id == hub.id, BoardMessage.ts > since).count()
    lv_people = 0 if live <= 10 else (1 if live <= 20 else 2)
    lv_msgs = 0 if msgs <= 5 else (1 if msgs <= 20 else 2)
    return {"live_count": live, "msgs_last_hour": msgs, "level": max(lv_people, lv_msgs)}


def hub_row(hub, user, fav_ids, lat=None, lng=None, rng=None):
    d = hub.public_dict(hub_owner_card(hub))
    d.update(activity_for(hub))
    d["is_favorite"] = hub.id in fav_ids
    d["is_mine"] = is_mgr(hub, user.id)
    near = bool(hub.owner_public_ip) and hub.owner_public_ip == client_ip()
    if lat is not None and lng is not None and hub.loc_lat is not None:
        dist = haversine(lat, lng, hub.loc_lat, hub.loc_lng)
        d["dist"] = int(dist)
        if rng:      # the user chose a search radius: only hubs with a defined location, within that radius
            near = dist <= rng
        else:
            near = near or dist <= max(hub.loc_radius or 150, 1000)
    elif rng:
        near = False
    d["is_near"] = near
    return d


@app.route("/api/hubs", methods=["GET"])
def list_hubs():
    user = g.user
    scope = request.args.get("filter", "all")
    q = (request.args.get("q") or "").strip().lower()
    lat = request.args.get("lat", type=float)
    lng = request.args.get("lng", type=float)
    rng = request.args.get("range", type=int)
    hubs = [h for h in Hub.query.filter_by(is_open=True).order_by(Hub.created_at.desc()).all()
            if h.is_published is not False or h.owner_user_id == user.id]
    fav_ids = {f.hub_id for f in Favorite.query.filter_by(user_id=user.id).all()}
    rows = []
    for h in hubs:
        r = hub_row(h, user, fav_ids, lat, lng, rng if scope == "near" else None)
        if scope == "mine" and not r["is_mine"]:
            continue
        if scope == "favorites" and not r["is_favorite"]:
            continue
        if scope == "near" and not r["is_near"]:
            continue
        if q and not (q in h.name.lower() or q == (h.serial or "") or q in (r["owner_name"] or "").lower()):
            continue
        rows.append(r)
    if scope == "near" and rng:
        rows.sort(key=lambda r: r.get("dist", 10**9))
    return jsonify(rows)


@app.route("/api/hubs/<hub_id>", methods=["GET"])
def get_hub(hub_id):
    hub = Hub.query.filter_by(id=hub_id, is_open=True).first()
    if not hub or (hub.is_published is False and not is_mgr(hub, g.user.id)):
        return err("ההאב לא נמצא או נסגר", 404)
    fav_ids = {f.hub_id for f in Favorite.query.filter_by(user_id=g.user.id).all()}
    return jsonify(hub_row(hub, g.user, fav_ids))


def apply_hub_fields(hub, d):
    for f in ("name", "description", "tagline", "location", "event_dates", "organizer_names", "loc_address", "card_message"):
        if f in d:
            setattr(hub, f, (d.get(f) or "").strip()[:500])
    for f in ("bg_in_hub", "glow", "card_enabled", "card_use_hub_bg", "auto_clear_on"):
        if f in d:
            setattr(hub, f, bool(d.get(f)))
    for f, lim in (("card_bg_url", 7_500_000), ("card_song_url", 7_500_000)):
        if f in d:
            v = d.get(f) or ""
            if len(v) > lim:      # ~5MB binary as base64
                continue
            setattr(hub, f, v)
    if d.get("card_bg_kind") in ("image", "gif"):
        hub.card_bg_kind = d["card_bg_kind"]
    if "auto_clear_at" in d:
        try:
            hub.auto_clear_at = float(d["auto_clear_at"]) if d["auto_clear_at"] not in (None, "", 0) else None
        except (TypeError, ValueError):
            pass
    for f in ("tagline", "location", "event_dates", "logo", "organizer_names"):
        if f + "_visible" in d:
            setattr(hub, f + "_visible", bool(d.get(f + "_visible")))
    if "logo_url" in d:
        hub.logo_url = d.get("logo_url") or ""
    if "background_image_url" in d:
        hub.background_image_url = d.get("background_image_url") or ""
    if d.get("template_id") in VALID_TEMPLATES:
        hub.template_id = d["template_id"]
    if "send_approval_msg" in d:
        hub.send_approval_msg = bool(d["send_approval_msg"])
    if d.get("presence_mode") in ("none", "location", "code", "both"):
        hub.presence_mode = d["presence_mode"]
    for f in ("loc_lat", "loc_lng"):
        if f in d:
            try:
                setattr(hub, f, float(d[f]) if d[f] not in (None, "") else None)
            except (TypeError, ValueError):
                pass
    if "loc_radius" in d:
        try:
            hub.loc_radius = max(20, min(int(d["loc_radius"]), 5000))
        except (TypeError, ValueError):
            pass


def sync_blocks(hub, blocks):
    existing = {b.id: b for b in HubBlock.query.filter_by(hub_id=hub.id).all()}
    keep = set()
    default_seen = False
    for i, bd in enumerate(blocks or []):
        title = (bd.get("title") or "").strip()
        if not title:
            continue
        b = existing.get(bd.get("id")) or HubBlock(hub_id=hub.id)
        if b.id is None:
            db.session.add(b)
        b.category = bd.get("category") or "other"
        b.title = title
        b.content = (bd.get("content") or "").strip()
        b.image_url = bd.get("image_url") or ""
        b.video_url = (bd.get("video_url") or "").strip()
        b.link_url = (bd.get("link_url") or "").strip()
        b.is_visible = bool(bd.get("is_visible", True))
        b.order = i
        b.is_default = bool(bd.get("is_default")) and not default_seen
        default_seen = default_seen or b.is_default
        db.session.flush()
        keep.add(b.id)
    for bid, b in existing.items():
        if bid not in keep:
            HubOpenPost.query.filter_by(block_id=bid).delete()
            db.session.delete(b)


@app.route("/api/hubs", methods=["POST"])
def open_hub():
    user = g.user
    d = request.get_json(force=True)
    hub_type = d.get("hub_type")
    if hub_type not in HUB_TYPES:
        return err("סוג האב לא תקין")
    cards = Card.query.filter_by(user_id=user.id).all()
    if not cards:
        return err("נא ליצור כרטיס אישי לפני פתיחת האב", 403, code="need_card")
    biz = next((c for c in cards if c.card_type == "business" and c.is_active), None) or \
        next((c for c in cards if c.card_type == "business"), None)
    if hub_type == "professional" and not biz:
        return err("נא ליצור לעצמך כרטיס עסקי לפני הגדרת האב מקצועי", 403, code="need_business_card")
    draft = bool(d.get("draft"))
    if not (d.get("name") or "").strip():
        if not draft:
            return err("שם ההאב הוא שדה חובה")
        d["name"] = "טיוטה ללא שם"
    owner_card = biz if hub_type == "professional" else (get_active_card(user.id) or cards[0])
    serial = gen_hub_serial()
    while Hub.query.filter_by(serial=serial).first():
        serial = gen_hub_serial()
    hub = Hub(owner_user_id=user.id, owner_card_id=owner_card.id, name=d["name"].strip(), serial=serial,
              hub_type=hub_type, owner_public_ip=client_ip(), presence_code=gen_presence_code(),
              auto_approve=bool(d.get("auto_approve", True)), is_published=not draft)
    apply_hub_fields(hub, d)
    db.session.add(hub)
    db.session.flush()
    sync_blocks(hub, d.get("blocks"))
    db.session.commit()
    return jsonify({**hub_row(hub, user, set()), "presence_code": hub.presence_code})


def own_hub(hub_id):
    h = Hub.query.filter_by(id=hub_id).first()
    return h if h and is_mgr(h, g.user.id) else None


def approve_presence(hub, p, notify=True):
    p.approval_status = "approved"
    db.session.commit()
    if hub.send_approval_msg and p.user_id != hub.owner_user_id:
        oc = hub_owner_card(hub)
        pm = create_pm(hub.owner_user_id, p.user_id, f"הרשמתך להאב {hub.name} אושרה", kind="system", hub=hub, sender_card=oc)
        push_pm(pm)
    if notify:
        emit_to_user(p.user_id, "registration_approved", {"hub_id": hub.id})


@app.route("/api/hubs/<hub_id>", methods=["PUT"])
def update_hub(hub_id):
    hub = own_hub(hub_id)
    if not hub:
        return err("ההאב לא נמצא או שאינו שלך", 404)
    d = request.get_json(force=True)
    if "draft" in d:
        if not d["draft"] and not (d.get("name") or hub.name or "").strip():
            return err("שם ההאב הוא שדה חובה")
        if not d["draft"] and not hub.is_published and not (d.get("name") or "").strip():
            return err("שם ההאב הוא שדה חובה")
        hub.is_published = not bool(d["draft"])
    apply_hub_fields(hub, d)
    if "blocks" in d:
        sync_blocks(hub, d["blocks"])
    turned_on = "auto_approve" in d and bool(d["auto_approve"]) and not hub.auto_approve
    if "auto_approve" in d:
        hub.auto_approve = bool(d["auto_approve"])
    db.session.commit()
    if turned_on or (hub.auto_approve and HubPresence.query.filter_by(hub_id=hub.id, approval_status="pending").first()):
        for p in HubPresence.query.filter_by(hub_id=hub.id, approval_status="pending").all():
            approve_presence(hub, p)
        emit_presence_list(hub.id)
    payload = hub.public_dict(hub_owner_card(hub))
    socketio.emit("hub_details_updated", {"hub_id": hub.id, "hub": payload, "blocks": blocks_for(hub, False)}, room=f"hub:{hub.id}")
    return jsonify(payload)


def hub_counts(hub):
    reg = HubPresence.query.filter_by(hub_id=hub.id, approval_status="approved").count()
    live = HubPresence.query.filter_by(hub_id=hub.id, approval_status="approved", is_live=True).count()
    return reg, live


@app.route("/api/hubs/<hub_id>/card")
def hub_card(hub_id):
    """The hub's business card (shown before entering)."""
    hub = Hub.query.filter_by(id=hub_id, is_open=True).first()
    if not hub or (hub.is_published is False and not is_mgr(hub, g.user.id)):
        return err("ההאב לא נמצא או נסגר", 404)
    reg, live = hub_counts(hub)
    bg = hub.background_image_url if hub.card_use_hub_bg and hub.background_image_url else hub.card_bg_url
    kind = "image" if (hub.card_use_hub_bg and hub.background_image_url) else (hub.card_bg_kind or "image")
    fav = Favorite.query.filter_by(user_id=g.user.id, hub_id=hub.id).first() is not None
    return jsonify({"hub_id": hub.id, "name": hub.name, "tagline": hub.tagline if hub.tagline_visible else "",
                    "has_card": bool(hub.card_enabled), "bg": bg or "", "bg_kind": kind, "song": hub.card_song_url or "",
                    "message": hub.card_message or "", "registered": reg, "present": live, "is_favorite": fav,
                    "skip": hub.id in user_prefs(g.user).get("skip_cards", []), "hub_type": hub.hub_type})


@app.route("/api/hubs/<hub_id>/card-pref", methods=["POST"])
def hub_card_pref(hub_id):
    """'Don't show the business card again when entering this hub' (per user)."""
    d = request.get_json(force=True) or {}
    cur = user_prefs(g.user)
    skip = [x for x in cur.get("skip_cards", []) if x != hub_id]
    if d.get("skip"):
        skip.append(hub_id)
    cur["skip_cards"] = skip[-300:]
    g.user.prefs = json.dumps(cur)
    db.session.commit()
    return jsonify({"ok": True, "skip": bool(d.get("skip"))})


def clear_registrants(hub):
    """Remove every registrant except the owner/managers from the hub."""
    rows = HubPresence.query.filter(HubPresence.hub_id == hub.id, HubPresence.user_id != hub.owner_user_id).all()
    n = len(rows)
    uids = [r.user_id for r in rows]
    for r in rows:
        db.session.delete(r)
    hub.auto_clear_on = False
    hub.auto_clear_at = None
    db.session.commit()
    for u in uids:
        emit_to_user(u, "registration_rejected", {"hub_id": hub.id})
        kick_from_room(hub.id, u)
    emit_presence_list(hub.id)
    return n


@app.route("/api/hubs/<hub_id>/registrants", methods=["DELETE"])
def delete_all_registrants(hub_id):
    hub = own_hub(hub_id)
    if not hub:
        return err("רק מנהל ההאב יכול למחוק נרשמים", 403)
    return jsonify({"ok": True, "removed": clear_registrants(hub)})


def run_auto_clear():
    now = time.time()
    for hub in Hub.query.filter(Hub.auto_clear_on == True, Hub.auto_clear_at != None, Hub.auto_clear_at <= now).all():  # noqa: E712
        try:
            clear_registrants(hub)
        except Exception:
            db.session.rollback()


def _auto_clear_loop():
    while True:
        time.sleep(60)
        try:
            with app.app_context():
                run_auto_clear()
        except Exception:
            pass


import threading
threading.Thread(target=_auto_clear_loop, daemon=True).start()


@app.route("/api/hubs/<hub_id>/full")
def hub_full(hub_id):
    """Everything the setup screen needs to edit an existing hub."""
    hub = own_hub(hub_id)
    if not hub:
        return err("ההאב לא נמצא או שאינו שלך", 404)
    full = hub.public_dict(hub_owner_card(hub))
    full.update({"card_bg_url": hub.card_bg_url, "card_bg_kind": hub.card_bg_kind, "card_use_hub_bg": hub.card_use_hub_bg is not False,
                 "card_song_url": hub.card_song_url, "card_message": hub.card_message, "card_enabled": bool(hub.card_enabled)})
    return jsonify({"hub": full, "blocks": blocks_for(hub, True),
                    "presence_code": hub.presence_code})


@app.route("/api/hubs/<hub_id>/presence-code", methods=["POST"])
def regen_code(hub_id):
    hub = own_hub(hub_id)
    if not hub:
        return err("לא נמצא", 404)
    hub.presence_code = gen_presence_code()
    db.session.commit()
    return jsonify({"presence_code": hub.presence_code})


@app.route("/api/hubs/<hub_id>/close", methods=["POST"])
def close_hub(hub_id):
    hub = own_hub(hub_id)
    if not hub:
        return err("לא נמצא", 404)
    hub.is_open = False
    db.session.commit()
    socketio.emit("hub_closed", {"hub_id": hub.id}, room=f"hub:{hub.id}")
    return jsonify({"ok": True})


@app.route("/api/hubs/<hub_id>/favorite", methods=["POST"])
def toggle_favorite(hub_id):
    if not Hub.query.get(hub_id):
        return err("לא נמצא", 404)
    ex = Favorite.query.filter_by(user_id=g.user.id, hub_id=hub_id).first()
    if ex:
        db.session.delete(ex)
        db.session.commit()
        return jsonify({"is_favorite": False})
    db.session.add(Favorite(user_id=g.user.id, hub_id=hub_id))
    db.session.commit()
    return jsonify({"is_favorite": True})


@app.route("/api/hubs/<hub_id>/share", methods=["POST"])
def share_hub(hub_id):
    """Invite contacts / groups to a hub via private message."""
    hub = Hub.query.get(hub_id)
    if not hub:
        return err("לא נמצא", 404)
    d = request.get_json(force=True)
    targets = set()
    for cid in d.get("contact_ids", []):
        s = ContactShare.query.filter_by(id=cid, owner_user_id=g.user.id).first()
        if s:
            targets.add(s.from_user_id)
    for gid in d.get("group_ids", []):
        if own_group(gid):
            targets.update(s.from_user_id for s in group_contacts(gid))
    if not targets:
        return err("לא נבחרו נמענים")
    my = get_active_card(g.user.id)
    if not my or not my.effective_open():
        return err("הכרטיס שלך סגור לתקשורת", 403)
    name = my.display_name()
    images = [i for i in (d.get("images") or []) if isinstance(i, str) and i.startswith("data:image/") and len(i) < 3_500_000][:4]
    fdata = d.get("file") if isinstance(d.get("file"), str) and d.get("file").startswith("data:application/pdf") and len(d["file"]) < 7_500_000 else ""
    fname = (d.get("file_name") or "report.pdf")[:80] if fdata else ""
    extra = (d.get("text") or "").strip()[:300]
    sent = 0
    for uid in targets:
        rc = get_active_card(uid)
        if not rc or not rc.effective_open():
            continue
        head = f"הוזמנת על ידי {name} להיכנס להאב {hub.name} (#{hub.serial})"
        if images or fdata:
            what = 'את הדו"ח' if fdata else 'תכולה'
            head = f"{name} שיתף/ה איתך {what} מההאב {hub.name} (#{hub.serial})"
        if extra:
            head += "\n" + extra
        pm = create_pm(g.user.id, uid, head, image=images[0] if images else "", hub=hub, hub_link_id=hub.id,
                       file_url=fdata, file_name=fname)
        push_pm(pm)
        for im in images[1:]:
            push_pm(create_pm(g.user.id, uid, f"{hub.name} — תכולה", image=im, hub=hub))
        sent += 1
    return jsonify({"ok": True, "sent": sent})


@app.route("/api/messages/<mid>/file")
def message_file(mid):
    m = PrivateMessage.query.get(mid)
    if not m or not m.file_url or g.user.id not in (m.from_user_id, m.to_user_id):
        return err("לא נמצא", 404)
    import base64
    head, _, b64 = m.file_url.partition(",")
    mime = head[5:].split(";")[0] or "application/octet-stream"
    from flask import Response
    from urllib.parse import quote
    resp = Response(base64.b64decode(b64), mimetype=mime)
    resp.headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(m.file_name or "file")
    return resp


def blocks_for(hub, owner):
    q = HubBlock.query.filter_by(hub_id=hub.id)
    if not owner:
        q = q.filter_by(is_visible=True)
    return [b.public_dict() for b in q.order_by(HubBlock.order).all()]


# ---------------------------------------------------------------------------
# Hub management (owner only)
# ---------------------------------------------------------------------------

@app.route("/api/hubs/<hub_id>/manage")
def manage_info(hub_id):
    hub = own_hub(hub_id)
    if not hub:
        return err("רק מנהל ההאב יכול לראות את מסך הניהול", 403)
    allp = HubPresence.query.filter_by(hub_id=hub.id).all()
    names = compute_names(allp)
    entries = [presence_entry(p, hub, names) for p in allp if p.user_id != hub.owner_user_id]
    bans = []
    for b in HubBan.query.filter_by(hub_id=hub.id).all():
        brief = person_brief(b.user_id)
        u = User.query.get(b.user_id)
        bans.append({"user_id": b.user_id, "name": brief["name"] if brief["name"] != VIEWER_NAME else (u.reg_name if u else VIEWER_NAME),
                     "reason": b.reason, "ts": b.ts})
    return jsonify({
        "hub": hub.public_dict(hub_owner_card(hub)),
        "pending": [e for e in entries if e["approval_status"] == "pending"],
        "registered": [e for e in entries if e["approval_status"] == "approved"],
        "bans": bans,
    })


@app.route("/api/hubs/<hub_id>/attendees/<user_id>/approve", methods=["POST"])
def approve_attendee(hub_id, user_id):
    hub = own_hub(hub_id)
    if not hub:
        return err("רק מנהל ההאב יכול לאשר נרשמים", 403)
    p = HubPresence.query.filter_by(hub_id=hub.id, user_id=user_id).first()
    if not p:
        return err("לא נמצא", 404)
    if p.approval_status != "approved":
        approve_presence(hub, p)
    emit_presence_list(hub.id)
    return jsonify({"ok": True})


@app.route("/api/hubs/<hub_id>/attendees/<user_id>/reject", methods=["POST"])
def reject_attendee(hub_id, user_id):
    hub = own_hub(hub_id)
    if not hub:
        return err("רק מנהל ההאב יכול לדחות נרשמים", 403)
    p = HubPresence.query.filter_by(hub_id=hub.id, user_id=user_id).first()
    if not p:
        return err("לא נמצא", 404)
    db.session.delete(p)
    db.session.commit()
    emit_to_user(user_id, "registration_rejected", {"hub_id": hub.id})
    kick_from_room(hub.id, user_id)
    emit_presence_list(hub.id)
    return jsonify({"ok": True})


def kick_from_room(hub_id, user_id):
    for sid in sids_of(user_id):
        if SID_TO_HUB.get(sid) == hub_id:
            try:
                socketio.server.leave_room(sid, f"hub:{hub_id}", namespace="/")
            except Exception:
                pass
            SID_TO_HUB.pop(sid, None)


@app.route("/api/hubs/<hub_id>/bans", methods=["POST"])
def ban_user(hub_id):
    hub = own_hub(hub_id)
    if not hub:
        return err("רק מנהל ההאב יכול לחסום", 403)
    d = request.get_json(force=True)
    uid = d.get("user_id")
    reason = (d.get("reason") or "").strip()
    if not uid or uid == hub.owner_user_id or not User.query.get(uid):
        return err("משתמש לא תקין")
    if not HubBan.query.filter_by(hub_id=hub.id, user_id=uid).first():
        db.session.add(HubBan(hub_id=hub.id, user_id=uid, reason=reason))
    HubPresence.query.filter_by(hub_id=hub.id, user_id=uid).delete()
    db.session.commit()
    emit_to_user(uid, "banned", {"hub_id": hub.id, "hub_name": hub.name})
    kick_from_room(hub.id, uid)
    if reason:
        pm = create_pm(hub.owner_user_id, uid, f"נחסמת מההאב {hub.name}. סיבה: {reason}", kind="system", hub=hub,
                       sender_card=hub_owner_card(hub))
        push_pm(pm)
    emit_presence_list(hub.id)
    return jsonify({"ok": True})


@app.route("/api/hubs/<hub_id>/bans/<user_id>", methods=["DELETE"])
def unban_user(hub_id, user_id):
    hub = own_hub(hub_id)
    if not hub:
        return err("רק מנהל ההאב יכול לבטל חסימה", 403)
    HubBan.query.filter_by(hub_id=hub.id, user_id=user_id).delete()
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

@app.route("/api/hubs/<hub_id>/report")
def hub_report(hub_id):
    hub = Hub.query.get(hub_id)
    if not hub:
        return err("לא נמצא", 404)
    mine = is_mgr(hub, g.user.id)
    p = HubPresence.query.filter_by(hub_id=hub.id, user_id=g.user.id, approval_status="approved").first()
    if not mine and not p:
        return err("הדוח זמין רק למשתתפי ההאב", 403)
    allp = HubPresence.query.filter_by(hub_id=hub.id, approval_status="approved").all()
    names = compute_names(allp)
    directory = [presence_entry(x, hub, names) for x in allp]
    directory.sort(key=lambda r: (not r["is_owner"], r["joined_at"]))
    contacts = [c for c in contacts_payload(g.user) if ContactShare.query.get(c["id"]).hub_id == hub.id]
    groups = [{"id": gr["id"], "name": gr["name"], "contact_ids": [i for i in gr["contact_ids"] if i in {c["id"] for c in contacts}]}
              for gr in groups_payload(g.user)]
    groups = [gr for gr in groups if gr["contact_ids"]]
    photos = []
    for m in BoardMessage.query.filter(BoardMessage.hub_id == hub.id, BoardMessage.image_url != "").order_by(BoardMessage.ts).all():
        c = Card.query.get(m.sender_card_id)
        photos.append({"id": "b" + m.id, "url": m.image_url, "by": c.display_name() if c else "", "ts": m.ts})
    for m in HubOpenPost.query.filter(HubOpenPost.hub_id == hub.id, HubOpenPost.image_url != "").order_by(HubOpenPost.ts).all():
        c = Card.query.get(m.card_id)
        photos.append({"id": "o" + m.id, "url": m.image_url, "by": c.display_name() if c else "", "ts": m.ts})
    return jsonify({"hub": hub.public_dict(hub_owner_card(hub)), "info": blocks_for(hub, False), "directory": directory,
                    "contacts": contacts, "groups": groups, "photos": photos, "generated_at": time.time()})


# ---------------------------------------------------------------------------
# Hub sockets
# ---------------------------------------------------------------------------

@socketio.on("connect")
def on_connect():
    user = socket_user()
    if user and is_locked(user):
        return False
    if user:
        SID_TO_USER[request.sid] = user.id
        USER_SIDS.setdefault(user.id, set()).add(request.sid)


@socketio.on("disconnect")
def on_disconnect():
    uid = SID_TO_USER.pop(request.sid, None)
    hub_id = SID_TO_HUB.pop(request.sid, None)
    if not uid:
        return
    sids = USER_SIDS.get(uid, set())
    sids.discard(request.sid)
    if not sids:
        USER_SIDS.pop(uid, None)
    if hub_id and not any(SID_TO_HUB.get(s) == hub_id for s in sids):
        RECENT_HUB[uid] = (hub_id, time.time())
        pr = HubPresence.query.filter_by(hub_id=hub_id, user_id=uid).first()
        if pr:
            pr.is_live = False
            db.session.commit()
        emit_presence_list(hub_id)


@socketio.on("leave_hub")
def on_leave_hub(data=None):
    hub_id = SID_TO_HUB.pop(request.sid, None)
    uid = SID_TO_USER.get(request.sid)
    if hub_id:
        leave_room(f"hub:{hub_id}")
        if uid and not any(SID_TO_HUB.get(s) == hub_id for s in USER_SIDS.get(uid, set())):
            RECENT_HUB.pop(uid, None)
            pr = HubPresence.query.filter_by(hub_id=hub_id, user_id=uid).first()
            if pr:
                pr.is_live = False
                db.session.commit()
            emit_presence_list(hub_id)


def board_dict(m, hub):
    c = Card.query.get(m.sender_card_id)
    return {
        "id": m.id, "sender_user_id": m.sender_user_id,
        "sender_name": c.display_name() if c else VIEWER_NAME,
        "sender_photo": c.profile_photo() if c else "",
        "is_owner": m.sender_user_id == hub.owner_user_id,
        "text": m.text, "image": m.image_url, "ts": m.ts, "pinned_until": m.pinned_until or 0,
    }


def open_post_dict(p):
    c = Card.query.get(p.card_id)
    return {"id": p.id, "block_id": p.block_id, "user_id": p.user_id,
            "name": c.display_name() if c else VIEWER_NAME, "text": p.text, "image": p.image_url,
            "video": p.video_url, "ts": p.ts}


@socketio.on("join_hub")
def on_join_hub(data):
    user = socket_user()
    if not user:
        emit("join_denied", {"reason": "no_session", "message": "אין חיבור – רענן את הדף"})
        return
    hub = Hub.query.filter_by(id=data.get("hub_id"), is_open=True).first()
    if not hub:
        emit("join_denied", {"reason": "closed", "message": "ההאב לא פתוח"})
        return
    owner_card = hub_owner_card(hub)
    if HubBan.query.filter_by(hub_id=hub.id, user_id=user.id).first():
        emit("join_denied", {"reason": "banned", "message": "אינך מורשה להיכנס להאב זה",
                             "owner_name": owner_card.display_name() if owner_card else "בעל ההאב",
                             "owner_user_id": hub.owner_user_id})
        return
    card = get_active_card(user.id)
    if not card:
        emit("join_denied", {"reason": "no_card", "message": "נא להגדיר כרטיס אישי לפני הכניסה להאב"})
        return
    is_owner = is_mgr(hub, user.id)
    if hub.hub_type == "professional" and card.card_type != "business" and not is_owner:
        emit("join_denied", {"reason": "need_business_card", "message": "יש להכנס להאב מקצועי עם כרטיס עסקי בלבד"})
        return

    # leave any previous hub room on this connection
    prev = SID_TO_HUB.get(request.sid)
    if prev and prev != hub.id:
        leave_room(f"hub:{prev}")
    join_room(f"hub:{hub.id}")
    SID_TO_USER[request.sid] = user.id
    SID_TO_HUB[request.sid] = hub.id
    RECENT_HUB.pop(user.id, None)
    USER_SIDS.setdefault(user.id, set()).add(request.sid)

    now = time.time()
    phys = verify_physical(hub, data.get("lat"), data.get("lng"), data.get("acc"), data.get("code"), client_ip())
    pr = HubPresence.query.filter_by(hub_id=hub.id, user_id=user.id).first()
    status = "green" if card.effective_open() else "red"
    if pr:
        pr.card_id, pr.is_live, pr.last_seen, pr.status = card.id, True, now, status
        if phys:
            pr.is_physical, pr.physical_ts = True, now
        elif hub.presence_mode != "none" and (now - (pr.physical_ts or 0)) >= PHYSICAL_TTL:
            pr.is_physical = False
    else:
        approval = "approved" if (hub.auto_approve or is_owner) else "pending"
        pr = HubPresence(hub_id=hub.id, user_id=user.id, card_id=card.id, status=status, is_live=True,
                         approval_status=approval, is_physical=phys, physical_ts=now if phys else 0.0)
        db.session.add(pr)
        db.session.commit()
        if approval == "approved" and hub.auto_approve and not is_owner:
            # auto-approval counts as an approval for the private-message option too
            if hub.send_approval_msg:
                pm = create_pm(hub.owner_user_id, user.id, f"הרשמתך להאב {hub.name} אושרה", kind="system", hub=hub, sender_card=owner_card)
                push_pm(pm)
    db.session.commit()
    emit_presence_list(hub.id)

    if pr.approval_status == "pending":
        emit("hub_pending", {"hub": hub.public_dict(owner_card), "message": "אנא המתן לאישור כניסה להאב"})
        return

    board = BoardMessage.query.filter_by(hub_id=hub.id).order_by(BoardMessage.ts).limit(BOARD_LIMIT).all()
    blocks = blocks_for(hub, is_owner)
    posts = {}
    for b in blocks:
        if b["category"] == "open":
            ps = HubOpenPost.query.filter_by(block_id=b["id"]).order_by(HubOpenPost.ts.desc()).limit(BOARD_LIMIT).all()
            posts[b["id"]] = [open_post_dict(p) for p in reversed(ps)]
    emit("hub_state", {
        "hub": {**hub.public_dict(owner_card), "is_mine": is_owner,
                "presence_code": hub.presence_code if is_owner else None},
        "my_user_id": user.id, "my_status": status, "my_physical": phys_now(pr),
        "board": [board_dict(m, hub) for m in board], "blocks": blocks, "open_posts": posts,
    })


@socketio.on("verify_presence")
def on_verify_presence(data):
    uid, hub_id = SID_TO_USER.get(request.sid), SID_TO_HUB.get(request.sid)
    hub = Hub.query.get(hub_id) if hub_id else None
    pr = HubPresence.query.filter_by(hub_id=hub_id, user_id=uid).first() if hub else None
    if not pr:
        return
    ok = verify_physical(hub, data.get("lat"), data.get("lng"), data.get("acc"), data.get("code"), client_ip())
    # position could not be determined: the user may state that they are at the hub ("אני נמצא בהאב")
    if not ok and data.get("claim") and hub.presence_mode in ("location", "both") and data.get("lat") is None:
        ok = True
    if ok:
        pr.is_physical, pr.physical_ts = True, time.time()
    elif hub.presence_mode != "none" and (time.time() - (pr.physical_ts or 0)) >= PHYSICAL_TTL:
        pr.is_physical = False
    db.session.commit()
    emit("presence_result", {"physical": phys_now(pr), "claimed": bool(data.get("claim")), "silent": bool(data.get("silent"))})
    emit_presence_list(hub_id)


@socketio.on("set_status")
def on_set_status(data):
    uid, hub_id = SID_TO_USER.get(request.sid), SID_TO_HUB.get(request.sid)
    if not uid or not hub_id or data.get("status") not in ("green", "red"):
        return
    card = get_active_card(uid)
    if not card:
        return
    if data["status"] == "green" and card.is_viewer():
        emit("error_msg", {"error": "כדי להיות פתוח לתקשורת יש להציג שם או כינוי בכרטיס"})
        return
    card.is_open_to_contact = data["status"] == "green"
    db.session.commit()
    sync_presence_status(uid)


def need_active_member():
    """(user_id, hub, presence) for a connected approved member, else sends an error."""
    uid, hub_id = SID_TO_USER.get(request.sid), SID_TO_HUB.get(request.sid)
    if not uid or not hub_id:
        emit("error_msg", {"error": "יש להיכנס להאב קודם"})
        return None
    hub = Hub.query.get(hub_id)
    pr = HubPresence.query.filter_by(hub_id=hub_id, user_id=uid, approval_status="approved").first()
    if not hub or not pr:
        emit("error_msg", {"error": "ההרשמה להאב טרם אושרה"})
        return None
    return uid, hub, pr


def can_post(pr):
    card = Card.query.get(pr.card_id)
    if not card or not card.effective_open():
        emit("error_msg", {"error": "הכרטיס שלך סגור לתקשורת – אתה במצב צפייה בלבד"})
        return False
    return True


@socketio.on("send_board_message")
def on_send_board_message(data):
    ctx = need_active_member()
    if not ctx:
        return
    uid, hub, pr = ctx
    if not can_post(pr):
        return
    text = (data.get("text") or "").strip()
    image = data.get("image") or ""
    if not text and not image:
        return
    m = BoardMessage(hub_id=hub.id, sender_user_id=uid, sender_card_id=pr.card_id, text=text, image_url=image)
    if is_mgr(hub, uid) and data.get("pin"):
        m.pinned_until = time.time() + PIN_SECONDS
    db.session.add(m)
    db.session.commit()
    # keep only the newest BOARD_LIMIT messages
    extra = BoardMessage.query.filter_by(hub_id=hub.id).count() - BOARD_LIMIT
    if extra > 0:
        for old in BoardMessage.query.filter_by(hub_id=hub.id).order_by(BoardMessage.ts).limit(extra).all():
            db.session.delete(old)
            socketio.emit("board_message_deleted", {"id": old.id}, room=f"hub:{hub.id}")
        db.session.commit()
    socketio.emit("board_message", board_dict(m, hub), room=f"hub:{hub.id}")


@socketio.on("delete_board_message")
def on_delete_board_message(data):
    ctx = need_active_member()
    if not ctx:
        return
    uid, hub, pr = ctx
    m = BoardMessage.query.filter_by(id=data.get("message_id"), hub_id=hub.id).first()
    if not m:
        return
    if m.sender_user_id != uid and not is_mgr(hub, uid):
        emit("error_msg", {"error": "אפשר למחוק רק הודעות שכתבת בעצמך"})
        return
    author = m.sender_user_id
    db.session.delete(m)
    db.session.commit()
    socketio.emit("board_message_deleted", {"id": data.get("message_id")}, room=f"hub:{hub.id}")
    if author != uid:
        pm = create_pm(hub.owner_user_id, author, "ההודעה הוסרה על ידי המנהל", kind="system", hub=hub, sender_card=hub_owner_card(hub))
        push_pm(pm)


@socketio.on("pin_board_message")
def on_pin(data):
    ctx = need_active_member()
    if not ctx:
        return
    uid, hub, pr = ctx
    if not is_mgr(hub, uid):
        emit("error_msg", {"error": "רק מנהל ההאב יכול להצמיד הודעות"})
        return
    m = BoardMessage.query.filter_by(id=data.get("message_id"), hub_id=hub.id).first()
    if not m or m.sender_user_id != uid:
        return
    m.pinned_until = (time.time() + PIN_SECONDS) if data.get("pin", True) else 0.0
    db.session.commit()
    socketio.emit("board_message_updated", board_dict(m, hub), room=f"hub:{hub.id}")


@socketio.on("post_open")
def on_post_open(data):
    ctx = need_active_member()
    if not ctx:
        return
    uid, hub, pr = ctx
    if not can_post(pr):
        return
    block = HubBlock.query.filter_by(id=data.get("block_id"), hub_id=hub.id, category="open").first()
    if not block:
        return
    text, image, video = (data.get("text") or "").strip(), data.get("image") or "", (data.get("video") or "").strip()
    if not (text or image or video):
        return
    p = HubOpenPost(hub_id=hub.id, block_id=block.id, user_id=uid, card_id=pr.card_id, text=text, image_url=image, video_url=video)
    db.session.add(p)
    db.session.commit()
    extra = HubOpenPost.query.filter_by(block_id=block.id).count() - BOARD_LIMIT
    if extra > 0:
        for old in HubOpenPost.query.filter_by(block_id=block.id).order_by(HubOpenPost.ts).limit(extra).all():
            db.session.delete(old)
            socketio.emit("open_post_deleted", {"id": old.id, "block_id": block.id}, room=f"hub:{hub.id}")
        db.session.commit()
    socketio.emit("open_post", open_post_dict(p), room=f"hub:{hub.id}")


@socketio.on("delete_open_post")
def on_delete_open_post(data):
    ctx = need_active_member()
    if not ctx:
        return
    uid, hub, pr = ctx
    p = HubOpenPost.query.filter_by(id=data.get("post_id"), hub_id=hub.id).first()
    if not p or (p.user_id != uid and not is_mgr(hub, uid)):
        return
    bid, pid = p.block_id, p.id
    db.session.delete(p)
    db.session.commit()
    socketio.emit("open_post_deleted", {"id": pid, "block_id": bid}, room=f"hub:{hub.id}")


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 5050)), debug=False, allow_unsafe_werkzeug=True)
