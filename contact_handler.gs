// ============================================================
// contact_handler.gs — HP問い合わせ受信バックエンド
// ============================================================
// GAS ScriptProperties に以下を設定してください:
//   SUPABASE_URL       : https://xxxx.supabase.co
//   SUPABASE_ANON_KEY  : eyJ...（anon公開キー）
//   NOTIFY_EMAIL       : たつのGmailアドレス
//   NOTIFY_TEL         : 電話番号（自動返信メールに表示）
//   LINE_OFFICIAL_URL  : LINE公式アカウントURL（自動返信メール署名用）
// ============================================================

// PROPS / SUPABASE_URL / NOTIFY_EMAIL は Code.gs で宣言済み（GASグローバルスコープ共有）
const SUPABASE_ANON_KEY = PROPS.getProperty("SUPABASE_ANON_KEY") || "";
const TABLE             = "contact_requests";

// ---- JSON レスポンス生成 ----
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- doPost エントリポイント ----
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    const formType = body.form_type || "";

    if (formType !== "delivery" && formType !== "inquiry") {
      return jsonResponse({ ok: false, error: "invalid form_type" });
    }

    const record = buildRecord(body, formType);
    handlerSbInsert(TABLE, record);
    sendNotification(formType, record);
    sendAutoReplyEmail(formType, record);

    return jsonResponse({ ok: true });

  } catch (err) {
    Logger.log("doPost error: " + err.message);
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ---- レコード組み立て ----
function buildRecord(body, formType) {
  const base = {
    form_type:      formType,
    name:           body.name           || "",
    tel:            body.tel            || body.contact || "",
    email:          body.email          || null,
    contact_method: body.contact_method || null,
    status:         "新規",
    is_read:        false,
  };

  if (formType === "delivery") {
    return Object.assign({}, base, {
      pickup_address:   body.pickup    || "",
      delivery_address: body.delivery  || "",
      desired_datetime: body.datetime  || null,
      cargo_info:       body.cargo     || "",
      weight:           body.weight    || null,
      loading_needed:   body.loading   === "yes",
      stairs:           body.stairs    === "yes",
      payment_method:   body.payment   || null,
      note:             body.note      || null,
    });
  } else {
    return Object.assign({}, base, {
      inquiry_type: body.inquiry_type || null,
      message:      body.message      || null,
    });
  }
}

// ---- Supabase REST API INSERT（contact_handler専用・Code.gsのsbInsertと名前衝突回避）----
function handlerSbInsert(table, row) {
  const url = SUPABASE_URL + "/rest/v1/" + table;
  const res = UrlFetchApp.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "apikey":        SUPABASE_ANON_KEY,
      "Authorization": "Bearer " + SUPABASE_ANON_KEY,
      "Prefer":        "return=minimal",
    },
    payload:            JSON.stringify(row),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 400) {
    throw new Error("Supabase insert failed (" + code + "): " + res.getContentText());
  }
}

// ---- Gmail 通知 ----
function sendNotification(formType, record) {
  sendLineNotification(formType, record);

  if (!NOTIFY_EMAIL) return;

  const isDelivery = formType === "delivery";
  const subject = isDelivery
    ? "【TEMC】新規配送依頼が届きました"
    : "【TEMC】新規お問い合わせが届きました";

  const lines = [
    "== " + subject + " ==",
    "",
    "受信日時: " + new Date().toLocaleString("ja-JP"),
    "フォーム: " + (isDelivery ? "配送依頼" : "お問い合わせ"),
    "",
    "氏名: "     + record.name,
    "電話: "     + record.tel,
  ];

  if (record.email)          lines.push("メール: "    + record.email);
  if (record.contact_method) lines.push("連絡方法: "  + record.contact_method);

  if (isDelivery) {
    lines.push(
      "",
      "--- 配送情報 ---",
      "集荷先: "      + record.pickup_address,
      "お届け先: "    + record.delivery_address,
      "希望日時: "    + (record.desired_datetime || "未記入"),
      "荷物内容: "    + record.cargo_info,
      "重量: "        + (record.weight || "未選択"),
      "積み込み作業: " + (record.loading_needed ? "必要" : "不要"),
      "階段あり: "    + (record.stairs ? "あり" : "なし"),
      "支払い方法: "  + (record.payment_method || "未選択"),
      "備考: "        + (record.note || "なし"),
    );
  } else {
    lines.push(
      "",
      "--- お問い合わせ内容 ---",
      "種別: "   + (record.inquiry_type || "未選択"),
      "内容: \n" + (record.message || "なし"),
    );
  }

  lines.push(
    "",
    "---",
    "管理アプリ: https://[your-app].streamlit.app",
  );

  try {
    GmailApp.sendEmail(NOTIFY_EMAIL, subject, lines.join("\n"));
  } catch(e) { Logger.log("Gmail送信失敗: " + e.message); }
}

// ---- 顧客への自動返信メール ----
function sendAutoReplyEmail(formType, record) {
  const email = record.email;
  if (!email) return;

  const name       = record.name || "お客様";
  const isDelivery = formType === "delivery";
  const tel        = PROPS.getProperty("NOTIFY_TEL")        || "";
  const lineUrl    = PROPS.getProperty("LINE_OFFICIAL_URL") || "";
  const myEmail    = PROPS.getProperty("CONTACT_EMAIL")     || "";

  const subject = isDelivery
    ? "【自動返信】配送依頼を受け付けました｜TEMC"
    : "【自動返信】お問い合わせを受け付けました｜TEMC";

  const telLine = tel
    ? "■ お急ぎの場合\n" + (isDelivery ? "" : "下記のお電話でもご対応いたします。\n") + "📞 " + tel + "（受付時間：9:00〜21:00）"
    : "";

  const footer = [
    "─────────────────",
    "TEMC（テムシー）",
    "代表 松本 辰則",
    myEmail  ? "Email：" + myEmail  : "",
    lineUrl  ? "LINE：" + lineUrl   : "",
    "─────────────────",
  ].filter(Boolean).join("\n");

  let bodyLines;
  if (isDelivery) {
    bodyLines = [
      name + " 様",
      "",
      "配送のご依頼ありがとうございます。",
      "TEMC（テムシー）の松本です。",
      "",
      "このメールは自動送信されています。",
      "いただいた内容を確認の上、",
      "見積もり金額をご連絡いたします。",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "■ 見積もりのご連絡目安",
      "当日〜翌営業日中にご連絡いたします。",
      "",
      "■ 確認事項がある場合",
      "詳細確認のため、先にご連絡する場合がございます。",
      "あらかじめご了承ください。",
      telLine,
      "━━━━━━━━━━━━━━━━━━",
      "",
      "引き続きよろしくお願いいたします。",
      "",
      footer,
    ];
  } else {
    bodyLines = [
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
      "",
      telLine,
      "━━━━━━━━━━━━━━━━━━",
      "",
      "どうぞよろしくお願いいたします。",
      "",
      footer,
    ];
  }

  try {
    MailApp.sendEmail({
      to:      email,
      subject: subject,
      body:    bodyLines.filter(l => l !== "").join("\n"),
      name:    "TEMC 松本",
    });
  } catch(e) {
    Logger.log("自動返信メール送信失敗: " + e.message);
  }
}

// ---- LINE Messaging API 通知 ----
function sendLineNotification(formType, record) {
  const token  = PROPS.getProperty("LINE_CHANNEL_TOKEN");
  const userId = PROPS.getProperty("LINE_USER_ID");
  if (!token || !userId) return;
  const label = formType === "delivery" ? "配送依頼" : "お問い合わせ";
  const msg = "【TEMC新着】" + label + "\n"
    + "氏名: " + record.name + "\n"
    + "電話: " + record.tel + "\n"
    + (formType === "delivery"
        ? "集荷先: " + record.pickup_address + "\n希望日時: " + (record.desired_datetime || "未記入")
        : "内容: " + (record.message || "").slice(0, 60));
  try {
    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      method: "post",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + token
      },
      payload: JSON.stringify({ to: userId, messages: [{ type: "text", text: msg }] }),
      muteHttpExceptions: true
    });
  } catch(e) { Logger.log("LINE通知失敗: " + e.message); }
}
