// ============================================================
// Code.gs  —  月次入力アプリ バックエンド (GAS)
// ============================================================
const PROPS = PropertiesService.getScriptProperties();
const SUPABASE_URL = PROPS.getProperty("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = PROPS.getProperty("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_USERNAME = PROPS.getProperty("APP_USERNAME") || "";
const APP_PASSWORD = PROPS.getProperty("APP_PASSWORD") || "";
const SESSION_SECRET = PROPS.getProperty("SESSION_SECRET") || "change-me-please";
const TABLE = "records";

// ★ W削除・しょんぴの次にCW追加
const CLIENT_COLS = ["U", "出", "R", "menu", "しょんぴ", "CW", "Afrex", "Afresh", "ハコベル", "pickg", "その他"];
const COLUMNS = [
  "日付", "合計売上", "合計h", "frex h", "fresh h", "他 h", "合計時給", "5h+", "警告",
  ...CLIENT_COLS, "メモ"
];

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle("月次入力")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || "{}");
  let result;
  try { result = dispatch(body.action || "", body); }
  catch (err) { result = { ok: false, error: err.message }; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch(action, body) {
  body = body || {};
  if (action === "login") return actionLogin(body);
  if (action === "getAutoToken") return actionGetAutoToken();
  const sess = verifySession(body.token || "");
  if (!sess.ok) return { ok: false, error: "unauthorized" };
  try {
    switch (action) {
      case "loadAll":     return actionLoadAll();
      case "loadRow":     return actionLoadRow(body);
      case "upsertRow":   return actionUpsertRow(body);
      case "deleteRows":  return actionDeleteRows(body);
      case "importCsv":   return actionImportCsv(body);
      case "reportMonth": return actionReportMonth(body);
      case "reportYear":  return actionReportYear(body);
      default: return { ok: false, error: "unknown action: " + action };
    }
  } catch(e) { return { ok: false, error: e.message }; }
}

function actionLogin(body) {
  const { username, password } = body;
  if (!APP_USERNAME || !APP_PASSWORD) return { ok: false, error: "認証設定なし" };
  if (username === APP_USERNAME && password === APP_PASSWORD) {
    const t = makeSessionToken(username);
    PROPS.setProperty("auto_token", t);
    return { ok: true, token: t, username };
  }
  return { ok: false, error: "ユーザー名/パスワードが違います" };
}

function actionGetAutoToken() {
  const t = PROPS.getProperty("auto_token") || "";
  if (!t) return { ok: false };
  const check = verifySession(t);
  if (!check.ok) { PROPS.deleteProperty("auto_token"); return { ok: false }; }
  return { ok: true, token: t, username: check.username };
}

function makeSessionToken(username) {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
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

function sbHeaders(extra) {
  return { "Content-Type": "application/json", "apikey": SUPABASE_SERVICE_KEY, "Authorization": "Bearer " + SUPABASE_SERVICE_KEY, ...extra };
}
function sbGet(path, params) {
  let url = SUPABASE_URL + "/rest/v1/" + path;
  if (params) url += "?" + Object.entries(params).map(([k,v]) => encodeURIComponent(k)+"="+encodeURIComponent(v)).join("&");
  const res = UrlFetchApp.fetch(url, { method:"GET", headers:sbHeaders({"Prefer":"return=representation"}), muteHttpExceptions:true });
  return JSON.parse(res.getContentText());
}
function sbUpsert(path, rows) {
  const res = UrlFetchApp.fetch(SUPABASE_URL+"/rest/v1/"+path, {
    method:"POST", headers:sbHeaders({"Prefer":"resolution=merge-duplicates,return=minimal"}),
    payload:JSON.stringify(rows), muteHttpExceptions:true
  });
  if (res.getResponseCode() >= 400) throw new Error("Supabase upsert error: " + res.getContentText());
}
function sbDelete(path, filter) {
  const res = UrlFetchApp.fetch(SUPABASE_URL+"/rest/v1/"+path+"?"+filter, {
    method:"DELETE", headers:sbHeaders({"Prefer":"return=minimal"}), muteHttpExceptions:true
  });
  if (res.getResponseCode() >= 400) throw new Error("Supabase delete error: " + res.getContentText());
}

// ============================================================
// 2025年CSV読み込み（GitHub raw）
// ============================================================
const CSV_2025_URL = "https://raw.githubusercontent.com/tatsunori-dev/streamlit-monthly-input/main/2025_all.csv";

// 2025年CSVの列マッピング
const CLIENT_COLS_2025 = ["U", "出", "menu", "しょんぴ", "Afrex", "Afresh", "ハコベル", "pickg", "その他"];

function load2025Csv() {
  try {
    const res = UrlFetchApp.fetch(CSV_2025_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return [];
    const text = res.getContentText("UTF-8");
    const lines = text.split("\n").map(l => l.replace(/\r$/, ""));
    if (lines.length < 2) return [];

    const headers = parseCsvLine(lines[0]);

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const vals = parseCsvLine(line);
      const r = {};
      headers.forEach((h, idx) => { r[h] = vals[idx] || ""; });

      const dateRaw = (r[""] || r["Unnamed: 0"] || "").trim();
      if (!dateRaw || !/^\d{4}\/\d{2}\/\d{2}$/.test(dateRaw)) continue;
      const dateStr = dateRaw.replace(/\//g, "-");

      function nc(v) {
        if (!v || v === "") return 0;
        const n = parseFloat(String(v).replace(/,/g, "").replace(/"/g, "").trim());
        return isNaN(n) ? 0 : n;
      }

      const sumSales = nc(r["計"]) || nc(r["合計"]);
      const frexH  = nc(r["frex"]);
      const freshH = nc(r["fresh"]);
      const otherH = nc(r["他"]);
      const totalH = (frexH || freshH || otherH) ? frexH + freshH + otherH : 0;
      const jikyu = nc(r["時給"]);

      const clients = {};
      for (const c of CLIENT_COLS_2025) {
        clients[c] = nc(r[c]);
      }
      clients["その他"] = (clients["その他"] || 0) + nc(r["7now"]);

      const cwVal = nc(r["W"]);

      const row = {
        "日付":    dateStr,
        "合計売上": sumSales || "",
        "合計h":   totalH   || "",
        "frex h":  frexH    || "",
        "fresh h": freshH   || "",
        "他 h":    otherH   || "",
        "合計時給": jikyu    || "",
        "5h+":     "",
        "警告":    "",
        "U":       clients["U"]       || "",
        "出":      clients["出"]      || "",
        "R":       "",
        "menu":    clients["menu"]    || "",
        "しょんぴ": clients["しょんぴ"] || "",
        "CW":      cwVal              || "",
        "Afrex":   clients["Afrex"]   || "",
        "Afresh":  clients["Afresh"]  || "",
        "ハコベル": clients["ハコベル"] || "",
        "pickg":   clients["pickg"]   || "",
        "その他":  clients["その他"]  || "",
        "メモ":    "",
      };
      rows.push(row);
    }
    return rows;
  } catch(e) {
    Logger.log("load2025Csv error: " + e.message);
    return [];
  }
}

function parseCsvLine(line) {
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cur += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { result.push(cur); cur = ""; }
      else { cur += c; }
    }
  }
  result.push(cur);
  return result;
}

function mergedRows() {
  const dbRows = sbGet(TABLE, { select:"*", order:"日付.asc", limit:10000 });
  if (!Array.isArray(dbRows)) throw new Error("DB読み込み失敗: " + JSON.stringify(dbRows));
  const csv2025 = load2025Csv();
  const dbDates = new Set(dbRows.map(r => r["日付"]));
  const filtered2025 = csv2025.filter(r => !dbDates.has(r["日付"]));
  const all = [...filtered2025, ...dbRows];
  all.sort((a, b) => (a["日付"] || "") < (b["日付"] || "") ? -1 : 1);
  return all;
}

function actionLoadAll() {
  const rows = mergedRows();
  return { ok:true, rows };
}
function actionLoadRow(body) {
  const key = body.dateKey || "";
  if (!key) return { ok:true, row:null };
  const rows = sbGet(TABLE, { select:"*", "日付":"eq."+key, limit:1 });
  if (!Array.isArray(rows)) throw new Error("DB読み込み失敗");
  return { ok:true, row:rows[0]||null };
}
function actionUpsertRow(body) {
  const row = body.row || {};
  const safe = {};
  for (const c of COLUMNS) { const v=row[c]; safe[c]=(v===null||v===undefined)?"":String(v); }
  sbUpsert(TABLE, [safe]);
  return { ok:true };
}
function actionDeleteRows(body) {
  const keys = body.dateKeys || [];
  if (!keys.length) return { ok:true };
  sbDelete(TABLE, "日付=in.("+keys.map(k=>'"'+k+'"').join(",")+")");
  return { ok:true };
}
function actionImportCsv(body) {
  const rows = body.rows || [];
  if (body.strictMonth && body.monthPrefix) sbDelete(TABLE, "日付=like."+body.monthPrefix+"-*");
  if (!rows.length) return { ok:true, count:0 };
  const BATCH = 500;
  for (let i=0; i<rows.length; i+=BATCH) {
    sbUpsert(TABLE, rows.slice(i,i+BATCH).map(r => {
      const safe={};
      for (const c of COLUMNS) { const v=r[c]; safe[c]=(v===null||v===undefined)?"":String(v); }
      return safe;
    }));
  }
  return { ok:true, count:rows.length };
}

function actionReportMonth(body) {
  const rows = mergedRows();
  return { ok:true, text:buildMonthReportFull(rows, body.monthStr||""), pace:calcMonthPace(rows, body.monthStr||"") };
}
function actionReportYear(body) {
  const rows = mergedRows();
  return { ok:true, text:buildYearReportFull(rows, parseInt(body.year,10)) };
}

function toNum(v) {
  if (v===null||v===undefined||v==="") return 0;
  const n=parseFloat(String(v).replace(/,/g,""));
  return isNaN(n)?0:n;
}
function fmtComma(n) { return Math.round(n).toLocaleString("ja-JP"); }

const MONTH_TARGETS = {
  1:448000, 2:405000, 3:420000, 4:420000, 5:400000, 6:400000,
  7:410000, 8:400000, 9:400000, 10:460000, 11:447000, 12:390000
};
const YEAR_TARGET = 5000000;

function getMonthTarget(y, mo) {
  return MONTH_TARGETS[mo] || 400000;
}

function buildMonthReportFull(rows, monthStr) {
  const tmp = rows.filter(r => (r["日付"]||"").startsWith(monthStr+"-"));
  if (!tmp.length) return "\nデータなし\n";

  const sumSales=tmp.reduce((s,r)=>s+toNum(r["合計売上"]),0);
  const sumH=tmp.reduce((s,r)=>s+toNum(r["合計h"]),0);
  const hourly=sumH>0?Math.round(sumSales/sumH):0;
  const flexSales=tmp.reduce((s,r)=>s+toNum(r["Afrex"]),0);
  const freshSales=tmp.reduce((s,r)=>s+toNum(r["Afresh"]),0);
  const flexH=tmp.reduce((s,r)=>s+toNum(r["frex h"]),0);
  const freshH=tmp.reduce((s,r)=>s+toNum(r["fresh h"]),0);
  const otherSales=Math.max(0,sumSales-flexSales-freshSales);
  const otherH=Math.max(0,sumH-flexH-freshH);

  const [y,mo]=monthStr.split("-").map(Number);
  const now=new Date();
  const isCurrentMonth=now.getFullYear()===y&&(now.getMonth()+1)===mo;
  const isFutureMonth=(y*12+mo)>(now.getFullYear()*12+now.getMonth()+1);
  const season=[12,1,2,3].includes(mo)?"冬":"夏";
  const dailyTarget=season==="冬"?20000:15000;
  const hourlyTiers=season==="冬"?[3000,3500,4000]:[2000,2500,3000];
  const MONTH_TARGET=getMonthTarget(y,mo);

  const tmp5h=tmp.filter(r=>toNum(r["合計h"])>=5.0);
  const days5h=tmp5h.length;
  const avg5hSales=days5h>0?Math.round(tmp5h.reduce((s,r)=>s+toNum(r["合計売上"]),0)/days5h):0;
  const dailyOk=avg5hSales>=dailyTarget?"✅":"❌";
  function gradeHourly(v,t){if(v>=t[2])return"上振れ（バブル）✅";if(v>=t[1])return"良い✅";if(v>=t[0])return"合格✅";return"未達🔄";}
  const hourlyGrade=gradeHourly(hourly,hourlyTiers);

  const lines=[`【${monthStr} 月次レポート】`];

  if (isFutureMonth) {
    lines.push("","（未来月のため、実績系は当月開始後に表示）","","【目標】",`月目標: ${fmtComma(MONTH_TARGET)}円`);
    if(season==="冬"){lines.push("季節: 冬（12〜3月）","・平均日給（5h+）目標: 20,000円","・時給目標: 合格 3,000 / 良い 3,500 / 上振れ 4,000");}
    else{lines.push("季節: 夏（4〜11月）","・平均日給（5h+）目標: 15,000円","・時給目標: 合格 2,000 / 良い 2,500 / 上振れ 3,000");}
    return lines.join("\n");
  }

  const fH=flexH>0?Math.round(flexSales/flexH):0;
  const frH=freshH>0?Math.round(freshSales/freshH):0;
  const oH=otherH>0?Math.round(otherSales/otherH):0;
  lines.push("","【月合計（売上/時間/時給）】",
    `全体: 売上 ${fmtComma(sumSales)} 円 / 時間 ${sumH} h / 時給 ${fmtComma(hourly)} 円`,
    `Flex : 売上 ${fmtComma(flexSales)} 円 / 時間 ${flexH} h / 時給 ${fmtComma(fH)} 円`,
    `Fresh: 売上 ${fmtComma(freshSales)} 円 / 時間 ${freshH} h / 時給 ${fmtComma(frH)} 円`,
    `他   : 売上 ${fmtComma(otherSales)} 円 / 時間 ${otherH} h / 時給 ${fmtComma(oH)} 円`
  );

  const workDays=tmp.filter(r=>toNum(r["合計h"])>0).length;
  const lastDay=new Date(y,mo,0).getDate();
  lines.push("","【稼働時間（当月）】",
    `稼働日数: ${workDays} 日 / 稼働日平均: ${workDays>0?(sumH/workDays).toFixed(2):"0.00"} h/日`,
    `暦日平均（休み込み）: ${(sumH/lastDay).toFixed(2)} h/日（${lastDay}日で割り算）`
  );

  {
    const remainSales=Math.max(0,MONTH_TARGET-sumSales);
    const achieved=sumSales>=MONTH_TARGET;
    const mark=achieved?"✅":isCurrentMonth?"🔄":"❌";
    lines.push("","【月間目標進捗】",
      `月目標 ${fmtComma(MONTH_TARGET)}円: ${mark}（${fmtComma(sumSales)}円 / あと${fmtComma(remainSales)}円）`
    );
    if(isCurrentMonth){
      const remainDays=Math.max(0,lastDay-now.getDate());
      const planDaily=avg5hSales>0?avg5hSales:dailyTarget;
      const need5hDays=remainSales>0?Math.min(Math.ceil(remainSales/planDaily),remainDays):0;
      if(remainDays>0) lines.push(`月末まで残り: ${remainDays}日（明日から） / 1日あたり必要: ${fmtComma(Math.ceil(remainSales/remainDays))}円`);
      lines.push(`5h+換算で必要: ${need5hDays}日（平均日給 ${fmtComma(planDaily)}円ベース）`);
    }
  }

  lines.push("",`季節: ${season}`,
    `${season}：平均日給${fmtComma(dailyTarget)}（5h+）: ${dailyOk}（${fmtComma(avg5hSales)}円 / 5h+日数 ${days5h}日）`,
    `${season}：時給（合格${fmtComma(hourlyTiers[0])}/良い${fmtComma(hourlyTiers[1])}/上振れ${fmtComma(hourlyTiers[2])}）: ${hourlyGrade}（${fmtComma(hourly)}円/h）`
  );

  const withH=tmp.filter(r=>toNum(r["合計h"])>0).map(r=>({...r,_sales:toNum(r["合計売上"]),_h:toNum(r["合計h"]),_hourly:toNum(r["合計売上"])/toNum(r["合計h"])}));
  const isSummer = season === "夏";
  const top5  = [...withH].sort((a,b) => isSummer ? b._sales-a._sales   : b._hourly-a._hourly).slice(0,5);
  const worst5= [...withH].sort((a,b) => isSummer ? a._sales-b._sales   : a._hourly-b._hourly).slice(0,5);
  function fmtRow(r){ return isSummer
    ? `${r["日付"]}: ${fmtComma(r._sales)} 円（${fmtComma(r._hourly)}/${r._h}h）`
    : `${r["日付"]}: ${fmtComma(r._hourly)} 円（${fmtComma(r._sales)}/${r._h}h）`; }
  function fmtBD(r){
    const parts=CLIENT_COLS.map(c=>[c,toNum(r[c])]).filter(([,v])=>v!==0).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${fmtComma(v)}`);
    return `${r["日付"]}  売上:${fmtComma(r._sales)}  時間:${r._h}h  時給:${fmtComma(r._hourly)}円\n  内訳: ${parts.length?parts.join(" / "):"（内訳なし）"}`;
  }
  const top5Label   = isSummer ? "日次売上 TOP5"   : "全体時給 TOP5";
  const worst5Label = isSummer ? "日次売上 WORST5" : "全体時給 WORST5";
  lines.push("",`【${top5Label}（当月・日次）】`);top5.length?top5.forEach((r,i)=>lines.push(`${i+1}. ${fmtRow(r)}`)):lines.push("データなし");
  lines.push("",`【${worst5Label}（当月・日次）】`);worst5.length?worst5.forEach((r,i)=>lines.push(`${i+1}. ${fmtRow(r)}`)):lines.push("データなし");
  lines.push("","【TOP5内訳（当月・日次）】");top5.length?top5.forEach((r,i)=>{lines.push(`[TOP${i+1}]`);lines.push(fmtBD(r));}):lines.push("データなし");
  lines.push("","【WORST5内訳（当月・日次）】");worst5.length?worst5.forEach((r,i)=>{lines.push(`[WORST${i+1}]`);lines.push(fmtBD(r));}):lines.push("データなし");
  return lines.join("\n");
}

function calcMonthPace(rows, monthStr) {
  const now=new Date();
  const [y,mo]=monthStr.split("-").map(Number);
  if(now.getFullYear()!==y||(now.getMonth()+1)!==mo) return {show:false};
  const tmp=rows.filter(r=>(r["日付"]||"").startsWith(monthStr+"-"));
  if(!tmp.length) return {show:false};
  const monthTarget=getMonthTarget(y,mo);
  const actual=tmp.reduce((s,r)=>s+toNum(r["合計売上"]),0);
  const lastDay=new Date(y,mo,0).getDate();
  const dayIdx=Math.min(now.getDate(),lastDay);
  const idealCum=Math.round(monthTarget*dayIdx/lastDay);
  return {show:true,ok:actual>=idealCum,idealCum,actual,diff:actual-idealCum,dayIdx,lastDay,monthTarget};
}

function buildYearReportFull(rows, year) {
  const tmp=rows.filter(r=>(r["日付"]||"").startsWith(String(year)+"-")).map(r=>({...r,_sales:toNum(r["合計売上"]),_h:toNum(r["合計h"])}));
  if(!tmp.length) return `\n${year}年 データなし\n`;

  const sumSales=tmp.reduce((s,r)=>s+r._sales,0);
  const sumH=tmp.reduce((s,r)=>s+r._h,0);
  const hourly=sumH>0?Math.round(sumSales/sumH):0;
  const flexSales=tmp.reduce((s,r)=>s+toNum(r["Afrex"]),0);
  const freshSales=tmp.reduce((s,r)=>s+toNum(r["Afresh"]),0);
  const flexH=tmp.reduce((s,r)=>s+toNum(r["frex h"]),0);
  const freshH=tmp.reduce((s,r)=>s+toNum(r["fresh h"]),0);
  const otherSales=Math.max(0,sumSales-flexSales-freshSales);
  const otherH=Math.max(0,sumH-flexH-freshH);
  const workDays=tmp.filter(r=>r._h>0).length;
  const isLeap=(year%4===0&&year%100!==0)||year%400===0;
  const daysInYear=isLeap?366:365;

  const monthMap={};
  tmp.forEach(r=>{
    const m=(r["日付"]||"").slice(0,7);
    if(!monthMap[m])monthMap[m]={sales:0,h:0,workDays:0};
    monthMap[m].sales+=r._sales; monthMap[m].h+=r._h;
    if(r._h>0)monthMap[m].workDays++;
  });

  const withH=tmp.filter(r=>r._h>0).map(r=>({...r,_hourly:r._sales/r._h}));
  const top5=[...withH].sort((a,b)=>b._hourly-a._hourly).slice(0,5);
  const worst5=[...withH].sort((a,b)=>a._hourly-b._hourly).slice(0,5);
  function fmtRow(r){return `${r["日付"]}: ${fmtComma(r._hourly)} 円（${fmtComma(r._sales)}/${r._h}h）`;}
  function fmtBD(r){
    const parts=CLIENT_COLS.map(c=>[c,toNum(r[c])]).filter(([,v])=>v!==0).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${fmtComma(v)}`);
    return `${r["日付"]}  売上:${fmtComma(r._sales)}  時間:${r._h}h  時給:${fmtComma(r._hourly)}円\n  内訳: ${parts.length?parts.join(" / "):"（内訳なし）"}`;
  }

  const fH=flexH>0?Math.round(flexSales/flexH):0;
  const frH=freshH>0?Math.round(freshSales/freshH):0;
  const oH=otherH>0?Math.round(otherSales/otherH):0;
  const lines=[`【${year} 年次レポート】`,"","【年合計（売上/時間/時給）】",
    `全体: 売上 ${fmtComma(sumSales)} 円 / 時間 ${sumH} h / 時給 ${fmtComma(hourly)} 円`,
    `Flex : 売上 ${fmtComma(flexSales)} 円 / 時間 ${flexH} h / 時給 ${fmtComma(fH)} 円`,
    `Fresh: 売上 ${fmtComma(freshSales)} 円 / 時間 ${freshH} h / 時給 ${fmtComma(frH)} 円`,
    `他   : 売上 ${fmtComma(otherSales)} 円 / 時間 ${otherH} h / 時給 ${fmtComma(oH)} 円`,
    "","【月別サマリ（売上/時間/時給/稼働日数/稼働日平均h）】"
  ];

  const now=new Date();
  let achievedMonths=0; let totalMonths=0;
  Object.keys(monthMap).sort().forEach(m=>{
    const d=monthMap[m];
    const [my,mm]=m.split("-").map(Number);
    const target=getMonthTarget(my,mm);
    const hr=d.h>0?Math.round(d.sales/d.h):0;
    const avgH=d.workDays>0?(d.h/d.workDays).toFixed(2):"0.00";
    const isCurrentM=now.getFullYear()===my&&(now.getMonth()+1)===mm;
    const achieved=d.sales>=target;
    const mark=achieved?"✅":isCurrentM?"🔄":"❌";
    totalMonths++;
    if(achieved) achievedMonths++;
    lines.push(`${m}: ${mark} 目標 ${fmtComma(target)} / 売上 ${fmtComma(d.sales)} 円 / 時間 ${d.h} h / 時給 ${fmtComma(hr)} 円 / 稼働 ${d.workDays} 日 / 稼働日平均 ${avgH} h`);
  });

  lines.push("","【稼働時間（年間）】",
    `稼働日数: ${workDays} 日 / 稼働日平均: ${workDays>0?(sumH/workDays).toFixed(2):"0.00"} h/日`,
    `暦日平均（休み込み）: ${(sumH/daysInYear).toFixed(2)} h/日（${daysInYear}日で割り算）`
  );

  const yearPct=(sumSales/YEAR_TARGET*100).toFixed(1);
  const yearMark=sumSales>=YEAR_TARGET?"✅":"🔄";
  lines.push("","【年間目標達成状況】",
    `年間目標: ${fmtComma(YEAR_TARGET)} 円 / 実績: ${fmtComma(sumSales)} 円 （${yearPct}%）`,
    `月別達成: ${achievedMonths} / ${totalMonths} ヶ月 ${achievedMonths===totalMonths?"✅":yearMark}`
  );

  lines.push("","【全体時給 TOP5（年間・日次）】");top5.length?top5.forEach((r,i)=>lines.push(`${i+1}. ${fmtRow(r)}`)):lines.push("データなし");
  lines.push("","【全体時給 WORST5（年間・日次）】");worst5.length?worst5.forEach((r,i)=>lines.push(`${i+1}. ${fmtRow(r)}`)):lines.push("データなし");
  lines.push("","【TOP5内訳（年間・日次）】");top5.length?top5.forEach((r,i)=>{lines.push(`[TOP${i+1}]`);lines.push(fmtBD(r));}):lines.push("データなし");
  lines.push("","【WORST5内訳（年間・日次）】");worst5.length?worst5.forEach((r,i)=>{lines.push(`[WORST${i+1}]`);lines.push(fmtBD(r));}):lines.push("データなし");
  return lines.join("\n");
}
