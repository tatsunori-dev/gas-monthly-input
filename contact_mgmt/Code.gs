// ============================================================
// Code.gs  —  TEMC お問い合わせ管理アプリ バックエンド (GAS)
// ============================================================
const PROPS         = PropertiesService.getScriptProperties();
const SUPABASE_URL  = PROPS.getProperty("SUPABASE_URL")  || "";
const SB_ANON_KEY   = PROPS.getProperty("SUPABASE_ANON_KEY") || "";
const SB_SVC_KEY    = PROPS.getProperty("SUPABASE_SERVICE_KEY") || "";  // service_role: RLSバイパス用
const APP_USERNAME  = PROPS.getProperty("APP_USERNAME")  || "";
const APP_PASSWORD  = PROPS.getProperty("APP_PASSWORD")  || "";
const SESSION_SECRET= PROPS.getProperty("SESSION_SECRET")|| "change-me";
const NOTIFY_EMAIL  = PROPS.getProperty("NOTIFY_EMAIL")  || "";

const TBL = "contact_requests";
const RECORDS_TBL = "records";

// ─── エントリーポイント ───────────────────────────────────────

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("TEMC 管理")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no");
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || "{}");
  let result;
  try   { result = dispatch(body.action || "", body); }
  catch (err) { result = { ok: false, error: err.message }; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch(action, body) {
  body = body || {};
  if (action === "login") return actionLogin(body);
  if (action === "submitHPForm") return actionSubmitHPForm(body);  // 認証不要（HP公開フォーム用）
  const sess = verifySession(body.token || "");
  if (!sess.ok) return { ok: false, error: "unauthorized" };
  switch (action) {
    case "loadDeliveries":  return actionLoadDeliveries(body);
    case "loadInquiries":   return actionLoadInquiries();
    case "loadConfirmed":   return actionLoadConfirmed();
    case "countUnread":     return actionCountUnread();
    case "markRead":        return actionMarkRead(body);
    case "updateStatus":    return actionUpdateStatus(body);
    case "updateMemo":      return actionUpdateMemo(body);
    case "insertDelivery":  return actionInsertDelivery(body);
    case "insertInquiry":   return actionInsertInquiry(body);
    case "completeDelivery":return actionCompleteDelivery(body);
    case "getDistance":     return actionGetDistance(body);
    case "generateIcal":    return actionGenerateIcal(body);
    case "loadMessages":    return actionLoadMessages();
    case "acceptMessage":   return actionAcceptMessage(body);
    case "rejectMessage":   return actionRejectMessage(body);
    case "skipMessage":     return actionSkipMessage(body);
    case "deleteRecord":    return actionDeleteRecord(body);
    case "broadcastLine":   return actionBroadcastLine(body);
    case "updateNote":          return actionUpdateNote(body);
    case "updateLineMessage":   return actionUpdateLineMessage(body);
    case "insertOtherWork":         return actionInsertOtherWork(body);
    case "loadOtherWorks":          return actionLoadOtherWorks(body);
    case "deleteOtherWork":         return actionDeleteOtherWork(body);
    case "completeOtherWork":       return actionCompleteOtherWork(body);
    case "sendReceipt":             return actionSendReceipt(body);
    case "loadArchivedInquiries":   return actionLoadArchivedInquiries();
    case "completeAndArchiveInquiry": return actionCompleteAndArchiveInquiry(body);
    case "archiveInquiry":          return actionArchiveInquiry(body);
    case "unarchiveInquiry":        return actionUnarchiveInquiry(body);
    case "archiveBoardItem":        return archiveBoardItem(body);
    case "getBanner":               return actionGetBanner();
    case "setBanner":               return actionSetBanner(body);
    default: return { ok: false, error: "unknown action: " + action };
  }
}

// ─── お知らせバナー ────────────────────────────────────────────

function actionGetBanner() {
  const rows = sbGet("settings?key=in.(banner_text,banner_active)&select=key,value");
  if (!Array.isArray(rows)) return { ok: false, error: "DB取得失敗" };
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  return { ok: true, text: map["banner_text"] || "", active: map["banner_active"] === "true" };
}

function actionSetBanner(body) {
  const { text, active } = body;
  // banner_text と banner_active を upsert
  sbUpsert("settings", [
    { key: "banner_text",   value: text   ?? "" },
    { key: "banner_active", value: active ? "true" : "false" }
  ]);
  return { ok: true };
}

function sbUpsert(table, rows) {
  const url = SUPABASE_URL + "/rest/v1/" + table + "?on_conflict=key";
  const res = UrlFetchApp.fetch(url, {
    method: "POST",
    headers: {
      "apikey": SB_SVC_KEY,
      "Authorization": "Bearer " + SB_SVC_KEY,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates"
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) throw new Error("Supabase upsert error: " + res.getContentText());
}

// ─── 認証 ─────────────────────────────────────────────────────

function actionLogin(body) {
  const { username, password } = body;
  if (!APP_USERNAME || !APP_PASSWORD) return { ok: false, error: "認証設定なし" };
  if (username === APP_USERNAME && password === APP_PASSWORD) {
    return { ok: true, token: makeSessionToken(username), username };
  }
  return { ok: false, error: "ユーザー名/パスワードが違います" };
}

function makeSessionToken(username) {
  const exp = Date.now() + 8 * 60 * 60 * 1000;
  const payload = username + "|" + exp;
  const sig = Utilities.computeHmacSha256Signature(payload, SESSION_SECRET)
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
  return Utilities.base64Encode(payload + "|" + sig);
}

function verifySession(token) {
  try {
    const decoded = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    const parts = decoded.split("|");
    if (parts.length < 3) return { ok: false };
    const sig = parts.pop();
    const payload = parts.join("|");
    const expected = Utilities.computeHmacSha256Signature(payload, SESSION_SECRET)
      .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
    if (sig !== expected) return { ok: false };
    if (Date.now() > parseInt(parts[1], 10)) return { ok: false, error: "session expired" };
    return { ok: true, username: parts[0] };
  } catch(e) { return { ok: false }; }
}

// ─── Supabase ヘルパー ─────────────────────────────────────────

function sbHeaders(extra) {
  const key = SB_SVC_KEY || SB_ANON_KEY;  // service_role優先
  return Object.assign({
    "Content-Type": "application/json",
    "apikey": key,
    "Authorization": "Bearer " + key
  }, extra || {});
}

function sbGet(table, params) {
  let url = SUPABASE_URL + "/rest/v1/" + table;
  if (params) {
    const q = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
    url += "?" + q;
  }
  const res = UrlFetchApp.fetch(url, {
    method: "GET",
    headers: sbHeaders({ "Prefer": "return=representation" }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) throw new Error("Supabase GET error: " + res.getContentText());
  return JSON.parse(res.getContentText());
}

function sbPatch(table, filter, data) {
  const url = SUPABASE_URL + "/rest/v1/" + table + "?" + filter;
  const res = UrlFetchApp.fetch(url, {
    method: "PATCH",
    headers: sbHeaders({ "Prefer": "return=minimal" }),
    payload: JSON.stringify(data),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) throw new Error("Supabase PATCH error: " + res.getContentText());
}

function sbInsert(table, row) {
  const res = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: sbHeaders({ "Prefer": "return=representation" }),
    payload: JSON.stringify(row),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) throw new Error("Supabase INSERT error: " + res.getContentText());
  const data = JSON.parse(res.getContentText());
  return Array.isArray(data) ? data[0] : data;
}

// ─── アクション: 配送依頼 ──────────────────────────────────────

function actionLoadDeliveries(body) {
  // 確定・配達完了以外を取得
  const rows = sbGet(TBL, {
    select: "*",
    form_type: "eq.delivery",
    status: "not.in.(確定,配達完了)",
    order: "created_at.desc"
  });
  if (!Array.isArray(rows)) throw new Error("DB取得失敗: " + JSON.stringify(rows));
  return { ok: true, rows };
}

function actionLoadConfirmed() {
  const rows = sbGet(TBL, {
    select: "*",
    form_type: "eq.delivery",
    status: "eq.確定",
    "is_archived": "not.is.true",
    order: "desired_datetime.asc.nullslast"
  });
  if (!Array.isArray(rows)) throw new Error("DB取得失敗");
  return { ok: true, rows };
}

function actionCountUnread() {
  const delivery = sbGet(TBL, { select: "id", form_type: "eq.delivery", is_read: "eq.false" });
  const inquiry  = sbGet(TBL, { select: "id", form_type: "eq.inquiry",  is_read: "eq.false" });
  return {
    ok: true,
    delivery: Array.isArray(delivery) ? delivery.length : 0,
    inquiry:  Array.isArray(inquiry)  ? inquiry.length  : 0
  };
}

function actionMarkRead(body) {
  sbPatch(TBL, "id=eq." + body.id, { is_read: true });
  return { ok: true };
}

function actionUpdateStatus(body) {
  sbPatch(TBL, "id=eq." + body.id, { status: body.status });
  return { ok: true };
}

function actionUpdateMemo(body) {
  sbPatch(TBL, "id=eq." + body.id, { memo: body.memo });
  return { ok: true };
}

function actionInsertDelivery(body) {
  const row = body.row || {};
  row.form_type = "delivery";
  row.status    = row.status || "新規";
  row.is_read   = true;
  const inserted = sbInsert(TBL, row);
  // バックアップ
  try {
    const backup = Object.assign({}, row, { original_id: inserted.id });
    sbInsert(TBL + "_backup", backup);
  } catch(e) { /* バックアップテーブルなければスキップ */ }
  return { ok: true, id: inserted.id };
}

function actionSubmitHPForm(body) {
  const formType = body.form_type || "";
  if (formType !== "delivery" && formType !== "inquiry") {
    return { ok: false, error: "invalid form_type" };
  }
  const row = Object.assign({}, body);
  delete row.action;
  row.status  = "新規";
  row.is_read = false;
  row.name    = row.name || "(未記入)";
  row.tel     = row.tel  || "(未記入)";
  const inserted = sbInsert(TBL, row);
  // LINE通知
  try { sendLineNotificationFromCode(formType, row); } catch(e) { Logger.log("LINE通知失敗: " + e.message); }
  // 自動返信メール（メールアドレスがある場合のみ）
  try { sendAutoReplyFromCode(formType, row); } catch(e) { Logger.log("自動返信メール失敗: " + e.message); }
  return { ok: true, id: inserted.id };
}

function sendLineNotificationFromCode(formType, record) {
  const token  = PROPS.getProperty("LINE_CHANNEL_TOKEN");
  const userId = PROPS.getProperty("LINE_USER_ID");
  if (!token || !userId) return;
  const label = formType === "delivery" ? "配送依頼" : "お問い合わせ";
  const msg = "【TEMC新着】" + label + "\n"
    + "氏名: " + (record.name || "") + "\n"
    + "電話: " + (record.tel  || "") + "\n"
    + (formType === "delivery"
        ? "集荷先: " + (record.pickup_address || "") + "\n希望日時: " + (record.desired_datetime || "未記入")
        : "内容: " + (record.message || "").slice(0, 60));
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
    method: "post",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    payload: JSON.stringify({ to: userId, messages: [{ type: "text", text: msg }] }),
    muteHttpExceptions: true
  });
}

function sendAutoReplyFromCode(formType, record) {
  const email = record.email;
  if (!email) return;

  const name        = record.name || "お客様";
  const isDelivery  = formType === "delivery";
  const tel         = PROPS.getProperty("NOTIFY_TEL")        || "";
  const lineUrl     = PROPS.getProperty("LINE_OFFICIAL_URL") || "";
  const myEmail     = PROPS.getProperty("CONTACT_EMAIL")     || "";

  const subject = isDelivery
    ? "【自動返信】配送依頼を受け付けました｜TEMC"
    : "【自動返信】お問い合わせを受け付けました｜TEMC";

  const footer = [
    "─────────────────",
    "TEMC（テムシー）",
    "代表 松本 辰則",
    myEmail  ? "Email：" + myEmail  : "",
    tel      ? "TEL：" + tel        : "",
    lineUrl  ? "LINE：" + lineUrl   : "",
    "─────────────────",
  ].filter(Boolean).join("\n");

  const bodyLines = isDelivery ? [
    name + " 様",
    "",
    "配送のご依頼ありがとうございます。",
    "TEMC（テムシー）の松本です。",
    "",
    "このメールは自動送信されています。",
    "いただいた内容を確認の上、見積もり金額をご連絡いたします。",
    "",
    "━━━━━━━━━━━━━━━━━━",
    "■ 見積もりのご連絡目安",
    "当日〜翌営業日中にご連絡いたします。",
    "",
    "■ 確認事項がある場合",
    "詳細確認のため、先にご連絡する場合がございます。",
    tel ? "■ お急ぎの場合\n📞 " + tel + "（受付時間：9:00〜21:00）" : "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "引き続きよろしくお願いいたします。",
    "",
    footer,
  ] : [
    name + " 様",
    "",
    "お問い合わせいただきありがとうございます。",
    "TEMC（テムシー）の松本です。",
    "",
    "このメールは自動送信されています。",
    "内容を確認の上、担当者よりご連絡いたします。",
    "",
    "━━━━━━━━━━━━━━━━━━",
    "■ ご返信の目安",
    "当日〜翌営業日中にご連絡いたします。",
    tel ? "■ お急ぎの場合\n📞 " + tel + "（受付時間：9:00〜21:00）" : "",
    "━━━━━━━━━━━━━━━━━━",
    "",
    "どうぞよろしくお願いいたします。",
    "",
    footer,
  ];

  MailApp.sendEmail({
    to:      email,
    subject: subject,
    body:    bodyLines.filter(l => l !== "").join("\n"),
    name:    "TEMC 松本",
  });
}

function actionInsertInquiry(body) {
  const row = body.row || {};
  row.form_type = "inquiry";
  row.status    = row.status || "新規";
  row.is_read   = true;
  row.name      = row.name || "(未記入)";
  row.tel       = row.tel  || "(未記入)";
  const inserted = sbInsert(TBL, row);
  return { ok: true, id: inserted.id };
}

function actionCompleteDelivery(body) {
  const rec = body.rec || {};
  const totalAmount = body.totalAmount || 0;

  // ① status を配達完了に更新
  sbPatch(TBL, "id=eq." + rec.id, { status: "配達完了" });

  // ② monthly_input_app の records テーブルに売上INSERT
  const today = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  const recordRow = {
    "日付":    today,
    "合計売上": totalAmount,
    "合計h":   0,
    "frex h":  0,
    "fresh h": 0,
    "他 h":    0,
    "合計時給": 0,
    "5h+":     "",
    "警告":    "",
    "U":"","出":"","R":"","menu":"","しょんぴ":"","CW":"","Afrex":"","Afresh":"","ハコベル":"","pickg":"",
    "その他":  totalAmount,
    "メモ":    "HP依頼: " + (rec.name || "")
  };
  sbInsert(RECORDS_TBL, recordRow);

  return { ok: true };
}

/// ─── アクション: 問い合わせ ────────────────────────────────────

function actionLoadInquiries() {
  const rows = sbGet(TBL, {
    select: "*",
    form_type: "eq.inquiry",
    "is_archived": "not.is.true",
    order: "created_at.desc"
  });
  if (!Array.isArray(rows)) throw new Error("DB取得失敗: " + JSON.stringify(rows));
  return { ok: true, rows };
}

function actionLoadArchivedInquiries() {
  const rows = sbGet(TBL, {
    select: "*",
    form_type: "eq.inquiry",
    "is_archived": "is.true",
    order: "created_at.desc"
  });
  if (!Array.isArray(rows)) throw new Error("DB取得失敗: " + JSON.stringify(rows));
  return { ok: true, rows };
}

function actionCompleteAndArchiveInquiry(body) {
  sbPatch(TBL, "id=eq." + body.id, { status: "完了", is_archived: true });
  return { ok: true };
}

function actionArchiveInquiry(body) {
  sbPatch(TBL, "id=eq." + body.id, { is_archived: true });
  return { ok: true };
}

function actionUnarchiveInquiry(body) {
  sbPatch(TBL, "id=eq." + body.id, { is_archived: false });
  return { ok: true };
}

// ─── アクション: 距離計算（サーバーサイド）────────────────────

function actionGetDistance(body) {
  const pickup   = body.pickup   || "";
  const delivery = body.delivery || "";
  if (!pickup || !delivery) return { ok: true, dist: null };

  const p = geocode(pickup);
  const d = geocode(delivery);
  if (!p || !d) return { ok: true, dist: null };

  try {
    const url = "https://router.project-osrm.org/route/v1/driving/" +
      p.lon + "," + p.lat + ";" + d.lon + "," + d.lat + "?overview=false";
    const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const data = JSON.parse(res.getContentText());
    if (data.code === "Ok") {
      const km = Math.round(data.routes[0].distance / 100) / 10;
      return { ok: true, dist: km };
    }
  } catch(e) { /* fall through */ }
  return { ok: true, dist: null };
}

function geocode(address) {
  try {
    const url = "https://nominatim.openstreetmap.org/search?q=" +
      encodeURIComponent(address) + "&format=json&limit=1&countrycodes=jp";
    const res  = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { "User-Agent": "TEMC-ContactApp/1.0" }
    });
    const data = JSON.parse(res.getContentText());
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch(e) { /* fall through */ }
  return null;
}

// ─── アクション: iCal生成 ──────────────────────────────────────

function actionGenerateIcal(body) {
  const rec = body.rec || {};
  const dt  = rec.desired_datetime ? new Date(rec.desired_datetime) : new Date();

  function fmtDt(d) {
    return Utilities.formatDate(d, "UTC", "yyyyMMdd'T'HHmmss'Z'");
  }
  const dtStart = fmtDt(dt);
  const dtEnd   = new Date(dt.getTime() + 2 * 60 * 60 * 1000);
  const uid     = Utilities.getUuid();
  const now     = fmtDt(new Date());
  const name    = rec.name     || "";
  const nameSan = removeSan(name) + " 様";  // 「様様」防止
  const pickup  = rec.pickup_address   || "";
  const delivery= rec.delivery_address || "";
  const cargo   = rec.cargo_info || "";
  const tel     = rec.tel        || "";
  const payment = rec.payment_method   || "";
  const startHH = Utilities.formatDate(dt, "Asia/Tokyo", "H");  // 開始時刻（時のみ）

  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TEMC//ContactMgmt//JP",
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + now,
    "DTSTART:" + dtStart,
    "DTEND:" + fmtDt(dtEnd),
    "SUMMARY:" + startHH + "-TEMC配達 " + nameSan,
    "DESCRIPTION:依頼者: " + name + "\\n電話: " + tel + "\\n集荷先: " + pickup + "\\n配達先: " + delivery + "\\n荷物: " + cargo + "\\n支払: " + payment,
    "LOCATION:" + delivery,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  return { ok: true, ical: ical };
}

// ─── 料金計算 ─────────────────────────────────────────────────

function calcPrice(distKm, opts) {
  opts = opts || [];
  let base = 0;
  const rates = [[5,1500],[10,2500],[20,3500],[30,4500],[999,5000]];
  for (const [max, rate] of rates) {
    if (distKm <= max) { base = rate; break; }
  }
  if (distKm > 30) base = 5000 + Math.floor((distKm - 30) * 100);

  const OPTIONS = {
    "夜間（20〜22時）": 1500, "深夜（22〜24時）": 3000,
    "時間指定（その他）": 1000,
    "重量物（30〜50kg）": 500, "重量物（50kg超）": 0,
    "積み置き（1日）": 1500
  };
  const optAmounts = {};
  opts.forEach(o => { if (OPTIONS[o] !== undefined) optAmounts[o] = OPTIONS[o]; });
  const total = base + Object.values(optAmounts).reduce((s, v) => s + v, 0);
  const note = opts.includes("重量物（50kg超）") ? "50kg超は個別見積もりとなります。" : "";
  return { base, optAmounts, total, note };
}

// ─── アクション: LINE受付 ─────────────────────────────────────

const MESSAGES_TBL = "messages";

function actionLoadMessages() {
  const rows = sbGet(MESSAGES_TBL, {
    select: "*",
    processed: "eq.false",
    source: "eq.line_personal",
    order: "created_at.asc"
  });
  if (!Array.isArray(rows)) throw new Error("メッセージ取得失敗");

  // 確定済み案件のdatetime一覧もあわせて返す（スケジュール照合用）
  const confirmed = sbGet(TBL, {
    select: "id,name,desired_datetime",
    form_type: "eq.delivery",
    status: "eq.確定"
  });
  const confirmedList = Array.isArray(confirmed) ? confirmed : [];

  return { ok: true, rows, confirmed: confirmedList };
}

function actionAcceptMessage(body) {
  const row = body.row || {};
  const msgId = body.msgId;

  // contact_requests にINSERT
  row.form_type = "delivery";
  row.status    = row.status || "new";
  row.is_read   = true;
  row.note      = ("[LINE経由] " + (row.note || "")).trim();
  const inserted = sbInsert(TBL, row);

  // messages を処理済みに更新
  if (msgId) sbPatch(MESSAGES_TBL, "id=eq." + msgId, { processed: true });

  // Googleカレンダー登録（失敗してもDB登録は成功扱い）
  if (row.desired_datetime) {
    try {
      const dt = new Date(row.desired_datetime);
      const calRow = {
        id:              inserted.id,
        client_name:     "しょんぴぃ",
        work_date:       Utilities.formatDate(dt, "Asia/Tokyo", "yyyy-MM-dd"),
        pickup_time:     Utilities.formatDate(dt, "Asia/Tokyo", "HH:mm"),
        end_time:        Utilities.formatDate(new Date(dt.getTime() + 2 * 60 * 60 * 1000), "Asia/Tokyo", "HH:mm"),
        pickup_location: row.pickup_address || "",
        name:            row.name || ""
      };
      addToCalendarInner(calRow);
    } catch(e) { Logger.log("カレンダー登録失敗: " + e.message); }
  }

  return { ok: true, id: inserted.id };
}

function actionRejectMessage(body) {
  const msgId = body.msgId;
  if (msgId) sbPatch(MESSAGES_TBL, "id=eq." + msgId, { processed: true });
  return { ok: true };
}

function actionSkipMessage(body) {
  if (body.id) sbPatch(MESSAGES_TBL, "id=eq." + body.id, { processed: true });
  return { ok: true };
}

function actionDeleteRecord(body) {
  const id = body.id;
  if (!id) throw new Error("IDがありません");
  const res = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/" + TBL + "?id=eq." + id, {
    method: "DELETE",
    headers: sbHeaders({ "Prefer": "return=minimal" }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) throw new Error("削除失敗: " + res.getContentText());
  return { ok: true };
}

function actionUpdateNote(body) {
  if (!body.id) throw new Error("IDがありません");
  sbPatch(TBL, "id=eq." + body.id, { note: body.note });
  return { ok: true };
}

function actionUpdateLineMessage(body) {
  if (!body.id) throw new Error("IDがありません");
  const updates = body.updates || {};
  // 許可フィールドのみ通す
  const allowed = ["sender_name", "amount"];
  const data = {};
  allowed.forEach(function(key) {
    if (updates[key] !== undefined) data[key] = updates[key];
  });
  if (Object.keys(data).length === 0) return { ok: true };
  sbPatch(MESSAGES_TBL, "id=eq." + body.id, data);
  return { ok: true };
}

// ─── アクション: 他業務管理 ────────────────────────────────────

const OTHER_WORKS_TBL = "other_works";

function calcOtherWorkHours(pickupTime, endTime) {
  if (!pickupTime || !endTime) return null;
  const toMins = function(t) {
    const parts = t.split(":");
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };
  const diff = toMins(endTime) - toMins(pickupTime);
  if (diff <= 0) return null;
  return Math.round(diff / 60 * 100) / 100;
}

function actionInsertOtherWork(body) {
  const row = body.row || {};
  // status未設定の場合はactiveをセット（neq.完了フィルターでNULLが除外されるのを防ぐ）
  row.status = row.status || "active";
  // work_hours を pickup_time と end_time から自動計算（フロントから送られていない場合も対応）
  if (row.work_hours == null && row.pickup_time && row.end_time) {
    row.work_hours = calcOtherWorkHours(row.pickup_time, row.end_time);
  }
  const inserted = sbInsert(OTHER_WORKS_TBL, row);
  // Googleカレンダー登録（失敗してもDB登録は成功扱い）
  let calError = null;
  try {
    addToCalendarInner(Object.assign({}, row, { id: inserted.id }));
  } catch(e) {
    calError = e.message;
  }
  return { ok: true, id: inserted.id, calError: calError };
}

// ─── カレンダー登録 ────────────────────────────────────────

function buildEventDates(row) {
  const dateStr     = row.work_date   || "";
  const pickupStr   = row.pickup_time || "00:00";
  const endStr      = row.end_time    || "01:00";
  const [ph, pm]    = pickupStr.split(":").map(Number);
  const [eh, em]    = endStr.split(":").map(Number);
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const startDate = new Date(yr, mo - 1, dy, ph, pm, 0);
  let   endDate   = new Date(yr, mo - 1, dy, eh, em, 0);
  // 終了が開始以前の場合は+1時間でフォールバック
  if (endDate <= startDate) endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  return [startDate, endDate];
}

// カレンダーイベントのタイトルを構築（addToCalendarInner と deleteCalendarEvent で共用）
function buildCalendarTitle(row) {
  const client  = (row.client_name     || "").trim();
  const pickup  = (row.pickup_location || "").trim();
  const pickupT = (row.pickup_time     || "00:00");
  const hh      = pickupT.split(":")[0];
  const mm      = pickupT.split(":")[1] || "00";
  const tLabel  = mm === "00" ? hh : pickupT;
  if (client === "Flex") {
    if (pickup.includes("北広島")) return tLabel + "-北広Flex";
    if (pickup.includes("雁来"))   return tLabel + "-雁来Flex";
    return tLabel + "-Flex";
  }
  if (client === "Fresh") {
    if (pickup.includes("澄川"))   return tLabel + "-澄川fresh";
    if (pickup.includes("北24条")) return tLabel + "-北24条fresh";
    return tLabel + "-Fresh";
  }
  if (client === "ハコベル")  return tLabel + "-ハコベル";
  if (client === "HP客")      return tLabel + "-" + (row.name || "HP客");
  if (client === "しょんぴぃ") return tLabel + "-TEMC配達 " + removeSan(row.name || "") + " 様";
  return tLabel + "-" + client;
}

function addToCalendarInner(row) {
  if (!row) throw new Error("row が undefined");
  const calId = PROPS.getProperty("CALENDAR_ID") || "";
  const cal   = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error("カレンダーが見つかりません: " + calId);
  const client  = (row.client_name     || "").trim();
  const pickup  = (row.pickup_location || "").trim();
  const pickupT = (row.pickup_time     || "00:00");
  const hh      = pickupT.split(":")[0];

  const title = buildCalendarTitle(row);

  // ── 色の決定 ──
  let color;
  if (client === "Flex") {
    const hourNum = parseInt(hh, 10);
    if (pickup.includes("北広島")) {
      color = hourNum < 16 ? CalendarApp.EventColor.PALE_BLUE  : CalendarApp.EventColor.MAUVE;
    } else if (pickup.includes("雁来")) {
      color = hourNum < 16 ? CalendarApp.EventColor.PALE_GREEN : CalendarApp.EventColor.GRAY;
    } else {
      color = CalendarApp.EventColor.PALE_BLUE;
    }
  } else if (client === "Fresh")      { color = CalendarApp.EventColor.YELLOW;   }
  else if (client === "ハコベル")      { color = CalendarApp.EventColor.CYAN;     }
  else if (client === "HP客")          { color = CalendarApp.EventColor.RED;      }
  else if (client === "しょんぴぃ")    { color = "4"; } // Flamingo (pink)
  else                                 { color = CalendarApp.EventColor.ORANGE;   }

  const [startDate, endDate] = buildEventDates(row);
  const event = cal.createEvent(title, startDate, endDate);
  event.setColor(color);
  if (pickup) event.setLocation(pickup);
  Logger.log("カレンダー登録成功: " + title + " / " + startDate.toString());
}

// 他業務削除時にカレンダーイベントも連動削除
function deleteCalendarEvent(row) {
  try {
    const calId = PROPS.getProperty("CALENDAR_ID") || "";
    const cal   = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
    if (!cal) return;
    const [startDate] = buildEventDates(row);
    const dayStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0,  0,  0);
    const dayEnd   = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 23, 59, 59);
    const title    = buildCalendarTitle(row);
    cal.getEvents(dayStart, dayEnd).forEach(ev => {
      if (ev.getTitle() === title) ev.deleteEvent();
    });
    Logger.log("カレンダー削除成功: " + title);
  } catch(e) {
    Logger.log("カレンダー削除失敗: " + e.message);
  }
}

// 後方互換・testAddCalendar用ラッパー
function addToCalendar(row) {
  try {
    addToCalendarInner(row);
  } catch(e) {
    Logger.log("カレンダー登録失敗: " + e.message);
  }
}

function actionLoadOtherWorks(body) {
  const rows = sbGet(OTHER_WORKS_TBL, {
    select: "*",
    status: "neq.完了",
    order: "work_date.desc"
  });
  if (!Array.isArray(rows)) throw new Error("他業務データ取得失敗: " + JSON.stringify(rows));
  return { ok: true, rows };
}

function actionCompleteOtherWork(body) {
  const id = body.id;
  if (!id) throw new Error("IDがありません");
  sbPatch(OTHER_WORKS_TBL, "id=eq." + id, { status: "完了" });
  return { ok: true };
}

function actionDeleteOtherWork(body) {
  const id = body.id;
  if (!id) throw new Error("IDがありません");

  // DB削除前にレコード取得してカレンダーも連動削除
  try {
    const rows = sbGet(OTHER_WORKS_TBL + "?id=eq." + id + "&select=*");
    if (Array.isArray(rows) && rows.length > 0) deleteCalendarEvent(rows[0]);
  } catch(e) {
    Logger.log("カレンダー削除試行エラー: " + e.message);
  }

  const res = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/" + OTHER_WORKS_TBL + "?id=eq." + id, {
    method: "DELETE",
    headers: sbHeaders({ "Prefer": "return=minimal" }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) throw new Error("削除失敗: " + res.getContentText());
  return { ok: true };
}

// ─── LINE帰り便速報ブロードキャスト ──────────────────────────

function actionBroadcastLine(body) {
  const token   = PROPS.getProperty("LINE_CHANNEL_TOKEN");
  if (!token)   throw new Error("LINE_CHANNEL_TOKEN が設定されていません");
  const message = (body.message || "").trim();
  if (!message) throw new Error("メッセージが空です");
  const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "post",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": "Bearer " + token,
    },
    payload:            JSON.stringify({ messages: [{ type: "text", text: message }] }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 400) throw new Error("LINE broadcast失敗 (" + code + "): " + res.getContentText());
  return { ok: true };
}

// ─── 領収書送信 ────────────────────────────────────────────────

function generateReceiptNumber() {
  const year = new Date().getFullYear();
  const key  = "RECEIPT_COUNTER_" + year;
  const next = parseInt(PROPS.getProperty(key) || "0") + 1;
  PROPS.setProperty(key, String(next));
  return "REC-" + year + "-" + String(next).padStart(3, "0");
}

function buildReceiptHtml(data) {
  const logoUrl  = PROPS.getProperty("LOGO_URL") || "";
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="TEMC" style="height:44px;margin-bottom:8px;">`
    : `<div style="font-size:1.5rem;font-weight:700;letter-spacing:.1em;">TEMC</div>`;
  const baseStr    = Number(data.amount).toLocaleString("ja-JP");
  const highway    = Number(data.highwayFee) || 0;
  const totalStr   = Number(data.amount + highway).toLocaleString("ja-JP");
  const highwayRow = highway > 0
    ? `<div class="field">
    <div class="field-label">高速料金（実費）</div>
    <div class="field-val">¥ ${Number(highway).toLocaleString("ja-JP")}</div>
  </div>
  <div class="field">
    <div class="field-label">合計金額</div>
    <div class="amount-val">¥ ${totalStr}</div>
  </div>`
    : "";
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><style>
body{font-family:'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN',sans-serif;background:#f5f5f5;margin:0;padding:20px;}
.wrap{max-width:520px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:8px;padding:32px;color:#222;}
.header{text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #222;}
.title{font-size:1.6rem;font-weight:700;letter-spacing:.2em;margin-top:6px;}
.meta{text-align:right;font-size:.8rem;color:#666;margin-bottom:20px;}
.field{margin-bottom:14px;padding-bottom:10px;border-bottom:1px dashed #ddd;}
.field-label{font-size:.7rem;color:#999;letter-spacing:.08em;margin-bottom:3px;}
.field-val{font-size:1rem;font-weight:600;}
.amount-val{font-size:1.7rem;font-weight:700;}
.statement{text-align:center;margin:20px 0;font-size:.9rem;color:#444;}
.footer{margin-top:20px;padding-top:14px;border-top:1px solid #ddd;font-size:.76rem;color:#777;text-align:right;line-height:1.7;}
</style></head><body>
<div class="wrap">
  <div class="header">
    ${logoHtml}
    <div class="title">領 収 書</div>
  </div>
  <div class="meta">No. ${data.receiptNo}<br>発行日: ${data.date}</div>
  <div class="field">
    <div class="field-label">宛名</div>
    <div class="field-val">${data.name ? data.name + " 様" : "　"}</div>
  </div>
  <div class="field">
    <div class="field-label">基本料金</div>
    <div class="amount-val">¥ ${baseStr}</div>
  </div>
  ${highwayRow}
  <div class="field">
    <div class="field-label">但し書き</div>
    <div class="field-val">${data.description}</div>
  </div>
  <div class="statement">上記の金額を正に領収いたしました。</div>
  <div class="footer">
    TEMC<br>
    TEL: 090-5780-6059<br>
    MAIL: temc.contact@gmail.com
  </div>
</div>
</body></html>`;
}

function actionSendReceipt(body) {
  const { toEmail, name, amount, highwayFee, description } = body;
  if (!toEmail) throw new Error("送付先メールアドレスがありません");
  const receiptNo = generateReceiptNumber();
  const date = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
  const html = buildReceiptHtml({
    receiptNo,
    date,
    name: name || "",
    amount: amount || 0,
    highwayFee: highwayFee || 0,
    description: description || "運賃として"
  });
  GmailApp.sendEmail(
    toEmail,
    "【TEMC】領収書 " + receiptNo,
    "領収書を送付いたします。",
    { htmlBody: html, name: "TEMC" }
  );
  return { ok: true, receiptNo };
}

// ─── 業務ボード アーカイブ ────────────────────────────────────

function archiveBoardItem(params) {
  var id = params.id;
  var url = SUPABASE_URL + "/rest/v1/contact_requests?id=eq." + id;
  var res = UrlFetchApp.fetch(url, {
    method: "PATCH",
    headers: sbHeaders({ "Prefer": "return=minimal" }),
    payload: JSON.stringify({ is_archived: true }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) {
    return { ok: false, error: res.getContentText() };
  }
  return { ok: true };
}

// ─── ユーティリティ ───────────────────────────────────────────

/**
 * 末尾の「様」を除去して返す（「様様」重複防止用）
 * 例: "山田様" → "山田"  /  "山田" → "山田"
 */
function removeSan(name) {
  return (name || "").replace(/\s*様\s*$/, "");
}


// ─── Gmail通知（新着時） ──────────────────────────────────────

function notifyNewDelivery(rec) {
  if (!NOTIFY_EMAIL) return;
  try {
    GmailApp.sendEmail(
      NOTIFY_EMAIL,
      "[TEMC] 新着 配送依頼: " + removeSan(rec.name || "") + " 様",
      "新しい配送依頼が届きました。\n\n" +
      "■ 依頼者: " + (rec.name || "") + "\n" +
      "■ 電話: "   + (rec.tel  || "") + "\n" +
      "■ 集荷先: " + (rec.pickup_address   || "") + "\n" +
      "■ 配達先: " + (rec.delivery_address || "") + "\n" +
      "■ 希望日時: " + (rec.desired_datetime || "") + "\n\n" +
      "管理アプリで確認してください。"
    );
  } catch(e) { Logger.log("Gmail通知失敗: " + e.message); }
}
