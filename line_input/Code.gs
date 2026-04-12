// LINE個人やりとり → Supabase登録 GAS Webアプリ

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('LINE登録フォーム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var supabaseUrl = props.getProperty('SUPABASE_URL');
    var serviceRoleKey = props.getProperty('SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return buildResponse({ status: 'error', message: 'スクリプトプロパティが未設定です' });
    }

    var params = e.parameter;
    var senderName = params.sender_name || 'しょんぴぃ';
    var content    = params.content    || '';

    if (!content) {
      return buildResponse({ status: 'error', message: 'メッセージが空です' });
    }

    var payload = JSON.stringify({
      source:      'line_personal',
      sender_name: senderName,
      sender_id:   'personal_line',
      room_id:     'personal_line',
      content:     content,
      processed:   false
    });

    var options = {
      method:      'post',
      contentType: 'application/json',
      headers: {
        'apikey':        serviceRoleKey,
        'Authorization': 'Bearer ' + serviceRoleKey,
        'Prefer':        'return=minimal'
      },
      payload:            payload,
      muteHttpExceptions: true
    };

    var endpoint = supabaseUrl.replace(/\/$/, '') + '/rest/v1/messages';
    var response = UrlFetchApp.fetch(endpoint, options);
    var code     = response.getResponseCode();

    if (code === 200 || code === 201) {
      return buildResponse({ status: 'ok' });
    } else {
      return buildResponse({
        status:  'error',
        message: 'Supabaseエラー: HTTP ' + code + ' / ' + response.getContentText()
      });
    }

  } catch (err) {
    return buildResponse({ status: 'error', message: err.message });
  }
}

function submitMessage(senderName, content) {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty('SUPABASE_URL');
  var serviceRoleKey = props.getProperty('SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('スクリプトプロパティが未設定です');
  }

  if (!content) {
    throw new Error('メッセージが空です');
  }

  var payload = JSON.stringify({
    source:      'line_personal',
    sender_name: senderName || 'しょんぴぃ',
    sender_id:   'personal_line',
    room_id:     'personal_line',
    content:     content,
    processed:   false
  });

  var options = {
    method:      'post',
    contentType: 'application/json',
    headers: {
      'apikey':        serviceRoleKey,
      'Authorization': 'Bearer ' + serviceRoleKey,
      'Prefer':        'return=minimal'
    },
    payload:            payload,
    muteHttpExceptions: true
  };

  var endpoint = supabaseUrl.replace(/\/$/, '') + '/rest/v1/messages';
  var response = UrlFetchApp.fetch(endpoint, options);
  var code     = response.getResponseCode();

  if (code === 200 || code === 201) {
    return true;
  } else {
    throw new Error('Supabaseエラー: HTTP ' + code + ' / ' + response.getContentText());
  }
}

function buildResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
