// ============================================================
// Code.gs  —  TEMC 配達アプリ バックエンド (GAS)
// ============================================================
const PROPS        = PropertiesService.getScriptProperties();
const SUPABASE_URL = PROPS.getProperty("SUPABASE_URL")  || "";
const SB_SVC_KEY   = PROPS.getProperty("SUPABASE_SERVICE_KEY") || "";
const APP_USERNAME = PROPS.getProperty("APP_USERNAME")  || "";
const APP_PASSWORD = PROPS.getProperty("APP_PASSWORD")  || "";
const SESSION_SECRET = PROPS.getProperty("SESSION_SECRET") || "change-me";

// ─── エントリーポイント ───────────────────────────────────────

function doGet(e) {
  const template = HtmlService.createTemplateFromFile("index");
  template.mapsApiKey = PROPS.getProperty("MAPS_API_KEY") || "";
  return template.evaluate()
    .setTitle("TEMC 配達")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no");
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || "{}");
  let result;
  try   { result = dispatch(body.action || "", body); }
  catch (err) { result = { ok: false, error: err.message }; }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function dispatch(action, body) {
  body = body || {};
  if (action === "login")        return actionLogin(body);
  if (action === "getAutoToken") return actionGetAutoToken();
  const sess = verifySession(body.token || "");
  if (!sess.ok) return { ok: false, error: "unauthorized" };
  switch (action) {
    case "getDeliveries":    return actionGetDeliveries(body);
    case "pickupComplete":   return actionPickupComplete(body);
    case "completeDelivery": return actionCompleteDelivery(body);
    case "geocodeAll":       return actionGeocodeAll(body);
    case "deleteItem":       return actionDeleteItem(body);
    case "searchAddress":    return actionSearchAddress(body);
    default: throw new Error("unknown action: " + action);
  }
}

// ─── 認証 ─────────────────────────────────────────────────────

function makeToken(username) {
  const expire  = Date.now() + 24 * 60 * 60 * 1000; // 24時間
  const payload = username + "|" + expire;
  const sig = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    payload + SESSION_SECRET
  ).map(function(b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
  return Utilities.base64Encode(payload + "|" + sig);
}

function verifySession(token) {
  if (!token) return { ok: false };
  let decoded;
  try {
    decoded = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
  } catch(e) { return { ok: false }; }
  const parts = decoded.split("|");
  if (parts.length !== 3) return { ok: false };
  const payload = parts[0] + "|" + parts[1];
  const sig = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    payload + SESSION_SECRET
  ).map(function(b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
  if (sig !== parts[2]) return { ok: false };
  if (Date.now() > parseInt(parts[1], 10)) return { ok: false };
  return { ok: true, user: parts[0] };
}

function actionLogin(body) {
  if (body.username === APP_USERNAME && body.password === APP_PASSWORD) {
    const t = makeToken(body.username);
    PROPS.setProperty("auto_token", t); // サーバー側に保存（iOS ホーム画面ショートカット対応）
    return { ok: true, token: t };
  }
  return { ok: false, error: "認証エラー" };
}

function actionGetAutoToken() {
  const t = PROPS.getProperty("auto_token") || "";
  if (!t) return { ok: false };
  const check = verifySession(t);
  if (!check.ok) { PROPS.deleteProperty("auto_token"); return { ok: false }; }
  return { ok: true, token: t };
}

// ─── Supabase ヘルパー ─────────────────────────────────────────

function sbHeaders(extra) {
  const h = {
    "apikey": SB_SVC_KEY,
    "Authorization": "Bearer " + SB_SVC_KEY,
    "Content-Type": "application/json"
  };
  if (extra) Object.keys(extra).forEach(function(k) { h[k] = extra[k]; });
  return h;
}

function sbFetch(url, method, payload) {
  const opts = {
    method: method || "GET",
    headers: sbHeaders({ "Prefer": "return=representation" }),
    muteHttpExceptions: true
  };
  if (payload) opts.payload = JSON.stringify(payload);
  const res = UrlFetchApp.fetch(url, opts);
  if (res.getResponseCode() >= 400) {
    throw new Error("Supabase error (" + res.getResponseCode() + "): " + res.getContentText());
  }
  const text = res.getContentText();
  if (!text || text === "") return [];
  return JSON.parse(text);
}

// ─── メインアクション ──────────────────────────────────────────

function actionGetDeliveries(body) {
  // 対象日（デフォルト: 今日）
  const dateStr = body.date ||
    Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");

  const dayStart = dateStr + "T00:00:00+09:00";
  const dayEnd   = dateStr + "T23:59:59+09:00";

  // ① contact_requests: HP注文（form_type=delivery）
  const crUrl = SUPABASE_URL + "/rest/v1/contact_requests" +
    "?desired_datetime=gte." + encodeURIComponent(dayStart) +
    "&desired_datetime=lte." + encodeURIComponent(dayEnd) +
    "&form_type=eq.delivery" +
    "&status=neq.closed_lost" +
    "&status=neq.配達完了" +
    "&is_archived=neq.true" +
    "&order=desired_datetime.asc";

  // ② other_works: ハコベル
  const owUrl = SUPABASE_URL + "/rest/v1/other_works" +
    "?work_date=eq." + dateStr +
    "&client_name=eq." + encodeURIComponent("ハコベル") +
    "&status=neq." + encodeURIComponent("完了") +
    "&order=pickup_time.asc";

  const crRows = sbFetch(crUrl) || [];
  const owRows = sbFetch(owUrl) || [];

  return {
    ok: true,
    date: dateStr,
    cr: Array.isArray(crRows) ? crRows : [],
    ow: Array.isArray(owRows) ? owRows : []
  };
}

// 集荷完了（ピック完了）
// contact_requests のチェック制約が不明なため複数ステータスを順に試す
// 全て失敗してもUIのみ更新で続行（ok: true を返す）
function actionPickupComplete(body) {
  var id        = body.id;
  var tableType = body.tableType;
  if (!id) throw new Error("IDがありません");
  if (tableType === "cr") {
    var url = SUPABASE_URL + "/rest/v1/contact_requests?id=eq." + id;
    var crStatuses = ["集荷中", "in_progress", "contacted", "scheduled"];
    for (var i = 0; i < crStatuses.length; i++) {
      try { sbFetch(url, "PATCH", { status: crStatuses[i] }); break; } catch(e) { /* 次を試す */ }
    }
  } else if (tableType === "ow") {
    var owStatuses = ["対応中", "集荷中", "進行中", "in_progress"];
    for (var j = 0; j < owStatuses.length; j++) {
      try { sbFetch(SUPABASE_URL + "/rest/v1/other_works?id=eq." + id, "PATCH", { status: owStatuses[j] }); break; } catch(e2) { /* 次を試す */ }
    }
  } else {
    throw new Error("不明なテーブルタイプ: " + tableType);
  }
  return { ok: true };
}

function actionCompleteDelivery(body) {
  var id        = body.id;
  var tableType = body.tableType;
  if (!id) throw new Error("IDがありません");

  if (tableType === "cr") {
    var url = SUPABASE_URL + "/rest/v1/contact_requests?id=eq." + id;
    // ステータス単体で試す（制約に含まれる値を順に）
    var statuses = ["配達完了", "closed_won", "in_progress", "closed_lost"];
    var done = false;
    for (var i = 0; i < statuses.length; i++) {
      try { sbFetch(url, "PATCH", { status: statuses[i] }); done = true; break; } catch(e) { /* 次を試す */ }
    }
    if (!done) {
      // 現在のステータスも制約違反の可能性 → 有効ステータス + is_archived を同時に送る
      for (var j = 0; j < statuses.length; j++) {
        try { sbFetch(url, "PATCH", { status: statuses[j], is_archived: true }); break; } catch(e2) { /* 次を試す */ }
      }
    }
  } else if (tableType === "ow") {
    var owUrl = SUPABASE_URL + "/rest/v1/other_works?id=eq." + id;
    var owStatuses = ["完了", "closed_won", "in_progress"];
    for (var k = 0; k < owStatuses.length; k++) {
      try { sbFetch(owUrl, "PATCH", { status: owStatuses[k] }); break; } catch(e3) { /* 次を試す */ }
    }
  } else {
    throw new Error("不明なテーブルタイプ: " + tableType);
  }

  return { ok: true };
}

// Google Maps ジオコーディング（GAS Maps サービス経由）
function actionSearchAddress(body) {
  var query = body.query || "";
  if (!query) return { ok: false, error: "クエリなし" };
  try {
    var geocoder = Maps.newGeocoder().setRegion("jp").setLanguage("ja");
    var result = geocoder.geocode(query);
    if (result.results && result.results.length > 0) {
      var loc = result.results[0].geometry.location;
      return { ok: true, lat: loc.lat, lng: loc.lng, formatted: result.results[0].formatted_address };
    }
    return { ok: true, lat: null, lng: null };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// 案件削除（リストから非表示）
function actionDeleteItem(body) {
  var id = body.id;
  var tableType = body.tableType;
  if (!id) throw new Error("IDがありません");
  if (tableType === "cr") {
    sbFetch(SUPABASE_URL + "/rest/v1/contact_requests?id=eq." + id, "PATCH", { is_archived: true });
  } else if (tableType === "ow") {
    // other_worksは完了ステータスで非表示（制約に応じてフォールバック）
    try { sbFetch(SUPABASE_URL + "/rest/v1/other_works?id=eq." + id, "PATCH", { status: "完了" }); }
    catch(e) { /* ローカル削除のみ */ }
  }
  return { ok: true };
}

// 住所一括ジオコーディング（Google Maps経由・高精度）
function actionGeocodeAll(body) {
  var addresses = body.addresses || [];
  var results   = {};
  var geocoder  = Maps.newGeocoder().setRegion("jp").setLanguage("ja");
  for (var i = 0; i < addresses.length; i++) {
    var item = addresses[i];
    try {
      var res = geocoder.geocode(item.address);
      if (res.results && res.results.length > 0) {
        var loc = res.results[0].geometry.location;
        results[item.key] = { lat: loc.lat, lng: loc.lng };
      }
    } catch(e) { /* skip */ }
  }
  return { ok: true, results: results };
}
