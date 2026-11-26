/**
 * FixMyCampus 2.0 - Production Google Apps Script Web App Backend
 *
 * SPREADSHEET INITIALIZATION:
 *   When deployed as a Web App, SpreadsheetApp.getActiveSpreadsheet() returns null
 *   if the script runs in a standalone project without a container binding.
 *
 *   To configure:
 *   1. Locate your Google Sheet URL in your browser:
 *      https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
 *   2. Copy the Spreadsheet ID between /d/ and /edit (or paste the full URL).
 *   3. Set SPREADSHEET_ID below (or set Script Property SPREADSHEET_ID in Project Settings).
 *   4. Ensure appsscript.json includes OAuth scopes:
 *      "oauthScopes": [
 *        "https://www.googleapis.com/auth/spreadsheets",
 *        "https://www.googleapis.com/auth/script.send_mail"
 *      ]
 *   5. Run authorizeMailPermissions() and setupFixMyCampus() once from the Apps Script editor
 *      (choose Execute as: "Me", Who has access: "Anyone").
 *   6. Deploy: Deploy > Manage deployments > Edit > New version > Deploy.
 */

// =============================================================
// CONFIGURATION: Set your Google Sheet Spreadsheet ID here
// =============================================================
var SPREADSHEET_ID = 'REPLACE_WITH_YOUR_SPREADSHEET_ID';

/**
 * Globally accessible OAuth authorization helper for MailApp.
 * Select "authorizeMailPermissions" in the Apps Script editor dropdown and click Run
 * to authorize MailApp (script.send_mail) without sending any email or touching any sheet data.
 */
function authorizeMailPermissions() {
  var remainingQuota = null;
  var mailAuthorized = false;
  var mailError = '';

  try {
    remainingQuota = MailApp.getRemainingDailyQuota();
    mailAuthorized = true;
    Logger.log('MailApp authorization verified. Remaining daily email quota: ' + remainingQuota);
  } catch (err) {
    mailError = err ? err.toString() : 'MailApp permission not yet granted.';
    Logger.log('MailApp authorization failed or denied: ' + mailError);
  }

  return {
    success: mailAuthorized,
    mailAuthorized: mailAuthorized,
    remainingQuota: remainingQuota,
    requiredScope: 'https://www.googleapis.com/auth/script.send_mail',
    message: mailAuthorized
      ? 'MailApp authorized (remaining daily quota: ' + remainingQuota + '). Zero emails were sent and no spreadsheet data was modified.'
      : 'MailApp authorization required: ' + mailError
  };
}

// =============================================================
// AUTHORITATIVE SHEET SCHEMAS (HEADERS)
// =============================================================
var HEADERS = {
  Tickets: [
    'TicketID', 'CreatedAt', 'ReporterName', 'IsAnonymous', 'Building',
    'RoomNumber', 'Description', 'AISummary', 'Category', 'Priority',
    'Department', 'Status', 'DuplicateOf', 'AssignedAt', 'ResolvedAt',
    'ClosedAt', 'ResolutionNotes', 'EvidenceReference', 'AssignedTo', 'UpdatedAt'
  ],
  DepartmentDirectory: [
    'Department', 'Keywords', 'ResponsibleName', 'ResponsibleEmail',
    'DepartmentHeadEmail', 'Active'
  ],
  NotificationLogs: [
    'TicketID', 'Timestamp', 'Department', 'Recipient', 'CC', 'Subject', 'Status', 'Details'
  ],
  ResolutionEvidence: [
    'EvidenceID', 'TicketID', 'EvidenceType', 'EvidenceReference', 'Notes', 'SubmittedAt', 'SubmittedBy'
  ],
  AuditLogs: [
    'TicketID', 'Timestamp', 'Action', 'Actor', 'Target', 'Details'
  ]
};

var REQUIRED_SHEETS = ['Tickets', 'DepartmentDirectory', 'NotificationLogs', 'ResolutionEvidence', 'AuditLogs'];
var MAX_SHEET_CELL_CHARS = 45000;

var VALID_STATUSES = [
  'Open',
  'Assigned',
  'In Progress',
  'Pending Verification',
  'Resolved',
  'Closed',
  'Needs Review'
];

var VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

var STATUS_TRANSITIONS = {
  'Needs Review': ['Needs Review', 'Open', 'Assigned', 'In Progress'],
  'Open': ['Open', 'Assigned', 'In Progress', 'Pending Verification', 'Resolved', 'Needs Review'],
  'Assigned': ['Assigned', 'In Progress', 'Pending Verification', 'Resolved', 'Open'],
  'In Progress': ['In Progress', 'Pending Verification', 'Resolved', 'Assigned'],
  'Pending Verification': ['Pending Verification', 'Resolved', 'Closed', 'In Progress'],
  'Resolved': ['Resolved', 'Closed', 'In Progress'],
  'Closed': ['Closed']
};

function normalizeStatus_(val) {
  var raw = String(val === null || val === undefined ? '' : val).trim();
  if (!raw) return '';
  var cleaned = raw.toLowerCase().replace(/[\s_-]+/g, '');
  for (var i = 0; i < VALID_STATUSES.length; i++) {
    if (VALID_STATUSES[i].toLowerCase().replace(/[\s_-]+/g, '') === cleaned) {
      return VALID_STATUSES[i];
    }
  }
  return '';
}

function normalizePriority_(val) {
  var raw = String(val === null || val === undefined ? '' : val).trim();
  if (!raw) return '';
  var cleaned = raw.toLowerCase();
  for (var i = 0; i < VALID_PRIORITIES.length; i++) {
    if (VALID_PRIORITIES[i].toLowerCase() === cleaned) {
      return VALID_PRIORITIES[i];
    }
  }
  return '';
}

function normalizeKeywordText_(input) {
  return String(input === null || input === undefined ? '' : input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts and normalizes a Google Spreadsheet ID from either Script Properties
 * or the top-level SPREADSHEET_ID constant (supports raw ID or full Sheets URL).
 */
function getConfiguredSpreadsheetId_() {
  var raw = '';
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      var propVal = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
      if (propVal && String(propVal).trim()) {
        raw = String(propVal);
      }
    }
  } catch (propErr) {
    Logger.log('PropertiesService lookup notice: ' + propErr.toString());
  }

  if (!raw && typeof SPREADSHEET_ID !== 'undefined' && SPREADSHEET_ID !== null) {
    raw = String(SPREADSHEET_ID);
  }

  raw = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!raw || raw === 'REPLACE_WITH_YOUR_SPREADSHEET_ID') {
    return '';
  }

  var urlMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  return raw;
}

/**
 * Opens the target spreadsheet and verifies actual read access, returning non-PII diagnostics.
 */
function getSpreadsheetWithDiagnostics_() {
  var configuredId = getConfiguredSpreadsheetId_();
  var configured = configuredId.length > 0;
  var ss = null;
  var openError = '';
  var source = 'none';

  if (configured) {
    try {
      ss = SpreadsheetApp.openById(configuredId);
      source = 'openById';
    } catch (err) {
      openError = err.toString();
      Logger.log('SpreadsheetApp.openById failed: ' + openError);
    }
  }

  if (!ss) {
    try {
      var activeSs = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSs) {
        ss = activeSs;
        source = 'getActiveSpreadsheet';
      }
    } catch (activeErr) {
      if (!openError) openError = activeErr.toString();
      Logger.log('SpreadsheetApp.getActiveSpreadsheet failed: ' + activeErr.toString());
    }
  }

  if (!ss) {
    var diagMsg = !configured
      ? 'SPREADSHEET_ID is not configured (still set to placeholder) and no active container-bound spreadsheet exists.'
      : 'SpreadsheetApp.openById failed (' + (openError || 'access denied or invalid Spreadsheet ID') + '). Verify SPREADSHEET_ID and re-authorize Apps Script permissions.';
    return {
      ss: null,
      configured: configured,
      connected: false,
      source: source,
      sheetsFound: [],
      missingSheets: REQUIRED_SHEETS.slice(),
      diagnostic: diagMsg
    };
  }

  try {
    ss.getId();
    var sheetObjects = ss.getSheets();
    var sheetsFound = [];
    for (var i = 0; i < sheetObjects.length; i++) {
      sheetsFound.push(sheetObjects[i].getName());
    }

    var missingSheets = [];
    for (var j = 0; j < REQUIRED_SHEETS.length; j++) {
      if (sheetsFound.indexOf(REQUIRED_SHEETS[j]) === -1) {
        missingSheets.push(REQUIRED_SHEETS[j]);
      }
    }

    var okMsg = missingSheets.length > 0
      ? 'Connected via ' + source + ', but missing sheet(s): ' + missingSheets.join(', ') + '. Run setupFixMyCampus() in Apps Script editor.'
      : 'Connected via ' + source + ' with all 5 required sheets verified.';

    Logger.log('Health check OK (' + source + '). Sheets found: ' + sheetsFound.join(', '));
    return {
      ss: ss,
      configured: configured,
      connected: true,
      source: source,
      sheetsFound: sheetsFound,
      missingSheets: missingSheets,
      diagnostic: okMsg
    };
  } catch (verifyErr) {
    var verifyMsg = 'Spreadsheet handle opened via ' + source + ' but sheet read failed: ' + verifyErr.toString();
    Logger.log(verifyMsg);
    return {
      ss: null,
      configured: configured,
      connected: false,
      source: source,
      sheetsFound: [],
      missingSheets: REQUIRED_SHEETS.slice(),
      diagnostic: verifyMsg
    };
  }
}

/**
 * Robust spreadsheet getter with fallback to getActiveSpreadsheet()
 */
function getSpreadsheet() {
  return getSpreadsheetWithDiagnostics_().ss;
}

/**
 * Validates sheet headers non-destructively.
 * Normalizes headers by trimming whitespace and case-insensitive comparison.
 * Accepts the authoritative 7-column ResolutionEvidence schema.
 * If legacy 6-column ResolutionEvidence is present, safely migrates without data loss.
 */
function validateSheetHeaders_(sheet, expectedHeaders, sheetName) {
  if (!sheet) return false;
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return true;

  var actualHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var normalizedActual = actualHeaders.map(function(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  });

  // Special handling for ResolutionEvidence
  if (sheetName === 'ResolutionEvidence') {
    var hasEvidenceId = normalizedActual.indexOf('evidenceid') !== -1;
    var hasTicketId = normalizedActual.indexOf('ticketid') !== -1;
    var hasEvidenceType = normalizedActual.indexOf('evidencetype') !== -1;
    var hasEvidenceRef = normalizedActual.indexOf('evidencereference') !== -1;
    var hasSubmittedAt = normalizedActual.indexOf('submittedat') !== -1;
    var hasSubmittedBy = normalizedActual.indexOf('submittedby') !== -1;

    // Matches authoritative 7-column schema
    if (hasEvidenceId && hasTicketId && (hasEvidenceType || hasEvidenceRef) && (hasSubmittedAt || hasSubmittedBy)) {
      return true;
    }

    // Check if legacy 6-column schema: Timestamp, TicketID, SubmittedBy, Note, PhotoURL, VerificationStatus
    var hasTimestamp = normalizedActual.indexOf('timestamp') !== -1;
    var hasPhotoUrl = normalizedActual.indexOf('photourl') !== -1;
    if (hasTimestamp && hasTicketId && (hasPhotoUrl || normalizedActual.indexOf('verificationstatus') !== -1)) {
      Logger.log('Legacy 6-column ResolutionEvidence schema detected. Running non-destructive migration...');
      migrateLegacySheet_(sheet.getParent(), 'ResolutionEvidence');
      return true;
    }

    // If TicketID is present and some columns match, accept without breaking setup
    if (hasTicketId) {
      return true;
    }

    throw new Error('Sheet "ResolutionEvidence" has unexpected headers. Expected: ' + expectedHeaders.join(', '));
  }

  // Special handling for NotificationLogs (supports legacy 7-col schema + canonical 7-col schema)
  if (sheetName === 'NotificationLogs') {
    var hasNotifTicketId = normalizedActual.indexOf('ticketid') !== -1;
    var hasNotifTimestamp = normalizedActual.indexOf('timestamp') !== -1;
    var hasNotifDepartment = normalizedActual.indexOf('department') !== -1;
    var hasNotifStatus = normalizedActual.indexOf('status') !== -1;
    var hasNotifResult = normalizedActual.indexOf('result') !== -1;
    var hasNotifRecipient = normalizedActual.indexOf('recipient') !== -1;

    if (!hasNotifTicketId || !hasNotifTimestamp || (!hasNotifStatus && !hasNotifResult && !hasNotifRecipient)) {
      var foundHeadersStr = actualHeaders.map(function(h) { return String(h || '').replace(/[\r\n]/g, '').trim(); }).join(', ');
      throw new Error(
        'Sheet "NotificationLogs" has unexpected headers. Required: TicketID, Timestamp, and Status (or legacy Result). Found: [' + foundHeadersStr + ']'
      );
    }

    // Non-destructive compatibility: preserve existing columns & rows, append Department at the end if missing
    if (!hasNotifDepartment) {
      var lastNonEmptyCol = 0;
      for (var hIdx = 0; hIdx < actualHeaders.length; hIdx++) {
        if (String(actualHeaders[hIdx] || '').replace(/[\r\n]/g, '').trim() !== '') {
          lastNonEmptyCol = hIdx + 1;
        }
      }
      var deptCol = lastNonEmptyCol + 1;
      sheet.getRange(1, deptCol).setValue('Department');
      Logger.log('NotificationLogs: legacy schema detected; preserved existing columns/rows and appended "Department" header at column ' + deptCol + '.');
    }
    return true;
  }

  // General validation for other sheets
  var missing = [];
  for (var i = 0; i < expectedHeaders.length; i++) {
    var exp = expectedHeaders[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    var found = false;
    for (var j = 0; j < normalizedActual.length; j++) {
      var act = normalizedActual[j];
      if (!act) continue;
      if (act === exp || act.indexOf(exp) !== -1 || (act.length >= 2 && exp.indexOf(act) !== -1)) {
        found = true;
        break;
      }
    }
    if (!found && (i < 2 || expectedHeaders[i].indexOf('ID') !== -1 || expectedHeaders[i].indexOf('Department') !== -1)) {
      missing.push(expectedHeaders[i]);
    }
  }

  if (missing.length > 0) {
    throw new Error('Sheet "' + sheetName + '" has unexpected headers. Missing required: ' + missing.join(', ') + '. Expected: ' + expectedHeaders.join(', '));
  }

  return true;
}

/**
 * Safely adapts legacy ResolutionEvidence sheet structure without clearing or deleting any data.
 * Target schema: EvidenceID | TicketID | EvidenceType | EvidenceReference | Notes | SubmittedAt | SubmittedBy
 */
function migrateLegacySheet_(ss, sheetName) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) return { success: false, message: 'Spreadsheet not found.' };

  var targetName = sheetName || 'ResolutionEvidence';
  if (targetName !== 'ResolutionEvidence') return { success: true };

  var sheet = ss.getSheetByName('ResolutionEvidence');
  if (!sheet) return { success: true };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) {
    sheet.appendRow(HEADERS.ResolutionEvidence);
    return { success: true, message: 'Initialized empty ResolutionEvidence headers.' };
  }

  var rawData = sheet.getDataRange().getValues();
  if (rawData.length === 0) return { success: true };

  var currentHeaders = rawData[0].map(function(h) { return String(h || '').trim(); });
  var normHeaders = currentHeaders.map(function(h) { return h.toLowerCase().replace(/[^a-z0-9]/g, ''); });

  // If already 7-column schema, no migration is necessary
  if (normHeaders.indexOf('evidenceid') !== -1 && normHeaders.indexOf('ticketid') !== -1) {
    return { success: true, message: 'ResolutionEvidence already uses authoritative 7-column schema.' };
  }

  var colTimestamp = findCol(currentHeaders, ['timestamp', 'submittedat', 'date', 'time']);
  var colTicketId = findCol(currentHeaders, ['ticketid', 'id']);
  var colSubmittedBy = findCol(currentHeaders, ['submittedby', 'actor', 'user', 'technician']);
  var colNote = findCol(currentHeaders, ['note', 'notes', 'resolutionnotes']);
  var colPhotoUrl = findCol(currentHeaders, ['photourl', 'evidencereference', 'photo', 'url']);
  var colEvidenceType = findCol(currentHeaders, ['evidencetype', 'type']);

  var migratedRows = [HEADERS.ResolutionEvidence];

  for (var r = 1; r < rawData.length; r++) {
    var row = rawData[r];
    var ticketId = colTicketId !== -1 ? String(row[colTicketId] || '').trim() : '';
    if (!ticketId) continue;

    var evidenceId = 'EVD-' + Utilities.getUuid().substring(0, 8).toUpperCase();
    var photoRef = colPhotoUrl !== -1 ? String(row[colPhotoUrl] || '').trim() : '';
    var evidenceType = (colEvidenceType !== -1 && row[colEvidenceType])
      ? String(row[colEvidenceType]).trim()
      : (photoRef ? 'Photo Verification' : 'Resolution Note');
    var notes = colNote !== -1 ? String(row[colNote] || '').trim() : '';
    var submittedAt = colTimestamp !== -1 ? (row[colTimestamp] || new Date().toISOString()) : new Date().toISOString();
    var submittedBy = colSubmittedBy !== -1 ? String(row[colSubmittedBy] || '').trim() : 'Technician';

    migratedRows.push([
      evidenceId,
      ticketId,
      evidenceType,
      photoRef,
      notes,
      submittedAt,
      submittedBy
    ]);
  }

  sheet.getRange(1, 1, migratedRows.length, HEADERS.ResolutionEvidence.length).setValues(migratedRows);
  return { success: true, message: 'Safely migrated ResolutionEvidence to 7-column schema without data loss.' };
}

/**
 * Ensures all 5 FixMyCampus sheets exist and meet schema requirements.
 * Non-destructive and safe for existing data.
 */
function ensureSheets_(ss) {
  if (!ss) ss = getSpreadsheet();
  if (!ss) {
    throw new Error('Spreadsheet context missing: SPREADSHEET_ID is not configured or invalid. Please set SPREADSHEET_ID in Code.gs.');
  }

  var sheetsVerified = [];
  var sheetNames = REQUIRED_SHEETS;

  for (var i = 0; i < sheetNames.length; i++) {
    var name = sheetNames[i];
    var expectedHeaders = HEADERS[name];
    var sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(expectedHeaders);
      if (name === 'DepartmentDirectory') {
        populateDefaultDepartmentDirectory_(sheet);
      }
    } else {
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(expectedHeaders);
        if (name === 'DepartmentDirectory') {
          populateDefaultDepartmentDirectory_(sheet);
        }
      } else {
        if (name === 'DepartmentDirectory') {
          sanitizeDirectoryHeaders(sheet);
        }
        if (name === 'Tickets') {
          ensureTicketHeaders(sheet);
        } else {
          validateSheetHeaders_(sheet, expectedHeaders, name);
        }
      }
    }
    sheetsVerified.push(name);
  }

  return {
    success: true,
    message: 'FixMyCampus 2.0 sheets verified and initialized successfully.',
    verifiedSheets: sheetsVerified
  };
}

/**
 * Checks whether MailApp authorization is granted without sending any email.
 */
function getMailDiagnostics_() {
  try {
    if (typeof MailApp === 'undefined' || !MailApp.getRemainingDailyQuota) {
      return { authorized: false, remainingQuota: null, diagnostic: 'MailApp service unavailable.' };
    }
    var quota = MailApp.getRemainingDailyQuota();
    return {
      authorized: true,
      remainingQuota: quota,
      diagnostic: 'MailApp authorized (remaining daily quota: ' + quota + ').'
    };
  } catch (err) {
    return {
      authorized: false,
      remainingQuota: null,
      diagnostic: 'MailApp not yet authorized: ' + err.toString() + '. Run authorizeMailPermissions() in Apps Script editor, approve script.send_mail permission, then publish Deploy > Manage deployments > New version.'
    };
  }
}

/**
 * Backward-compatible alias that safely checks spreadsheet + MailApp permissions without throwing.
 */
function authorizeFixMyCampusPermissions() {
  var diag = getSpreadsheetWithDiagnostics_();
  var mailDiag = getMailDiagnostics_();
  Logger.log('Spreadsheet connected: ' + diag.connected + ' | ' + diag.diagnostic);
  Logger.log('MailApp authorized: ' + mailDiag.authorized + ' | ' + mailDiag.diagnostic);
  return {
    success: diag.connected && mailDiag.authorized,
    mailAuthorized: mailDiag.authorized,
    remainingQuota: mailDiag.remainingQuota,
    spreadsheet: diag.diagnostic,
    mail: mailDiag
  };
}

/**
 * Setup and verify all 5 FixMyCampus sheets without overwriting existing data.
 * Safe, backward-compatible, and normalizes headers case-insensitively.
 * Run this function from the Apps Script editor to initialize or verify tabs.
 */
function setupFixMyCampus() {
  var diag = getSpreadsheetWithDiagnostics_();
  if (!diag.ss) {
    throw new Error(diag.diagnostic);
  }
  var result = ensureSheets_(diag.ss);
  var mailDiag = getMailDiagnostics_();
  result.mailAuthorized = mailDiag.authorized;
  result.mailRemainingQuota = mailDiag.remainingQuota;
  result.mailDiagnostic = mailDiag.diagnostic;
  Logger.log('FixMyCampus 2.0 setup verified: ' + result.verifiedSheets.join(', ') + ' | ' + mailDiag.diagnostic);
  return result;
}

// -------------------------------------------------------------
// GET Request Handler
// -------------------------------------------------------------
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'health';
    var diag = getSpreadsheetWithDiagnostics_();

    // Health check reports live read connectivity + non-PII diagnostics
    if (action === 'health') {
      var mailDiag = getMailDiagnostics_();
      var deptEmailSummary = diag.ss ? computeDepartmentEmailSummary_(diag.ss.getSheetByName('DepartmentDirectory')).summary : null;
      return createJsonResponse({
        success: true,
        message: 'FixMyCampus Backend V2 is running.',
        spreadsheetConnected: diag.connected,
        spreadsheetIdConfigured: diag.configured,
        sheetsFound: diag.sheetsFound,
        missingSheets: diag.missingSheets,
        mailAuthorized: mailDiag.authorized,
        mailRemainingQuota: mailDiag.remainingQuota,
        mailDiagnostic: mailDiag.diagnostic,
        departmentEmailSummary: deptEmailSummary,
        requiredOAuthScopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/script.send_mail'
        ],
        diagnostic: diag.diagnostic,
        timestamp: new Date().toISOString()
      });
    }

    var ss = diag.ss;
    if (!ss) {
      return createJsonResponse({
        success: false,
        message: diag.diagnostic || 'Spreadsheet context missing. Please configure SPREADSHEET_ID at the top of Code.gs.'
      });
    }

    if (action === 'getTickets') {
      var ticketsSheet = ss.getSheetByName('Tickets');
      if (!ticketsSheet) {
        return createJsonResponse({
          success: false,
          message: 'Required sheet "Tickets" not found in spreadsheet. Run setupFixMyCampus() in Apps Script editor.'
        });
      }
      return createJsonResponse({
        success: true,
        tickets: readSheetAsJson(ticketsSheet)
      });
    }

    if (action === 'getDepartments') {
      var dirSheet = ss.getSheetByName('DepartmentDirectory');
      if (!dirSheet) {
        return createJsonResponse({
          success: false,
          message: 'Required sheet "DepartmentDirectory" not found in spreadsheet.'
        });
      }
      sanitizeDirectoryHeaders(dirSheet);
      var rawDepts = readSheetAsJson(dirSheet);
      var enriched = computeDepartmentEmailSummary_(dirSheet, rawDepts);
      return createJsonResponse({
        success: true,
        departments: enriched.rows,
        summary: enriched.summary
      });
    }

    if (action === 'getNotificationLogs') {
      var notifSheet = ss.getSheetByName('NotificationLogs');
      if (!notifSheet) {
        return createJsonResponse({
          success: false,
          message: 'Required sheet "NotificationLogs" not found in spreadsheet.'
        });
      }
      return createJsonResponse({
        success: true,
        notificationLogs: formatNotificationLogRows_(readSheetAsJson(notifSheet))
      });
    }

    if (action === 'getAuditLogs') {
      var auditSheet = ss.getSheetByName('AuditLogs');
      if (!auditSheet) {
        return createJsonResponse({
          success: false,
          message: 'Required sheet "AuditLogs" not found in spreadsheet.'
        });
      }
      return createJsonResponse({
        success: true,
        auditLogs: readSheetAsJson(auditSheet)
      });
    }

    if (action === 'getEvidence') {
      var evidenceSheet = ss.getSheetByName('ResolutionEvidence');
      if (!evidenceSheet) {
        return createJsonResponse({
          success: false,
          message: 'Required sheet "ResolutionEvidence" not found in spreadsheet.'
        });
      }
      return createJsonResponse({
        success: true,
        evidence: formatEvidenceRows_(readSheetAsJson(evidenceSheet))
      });
    }

    if (action === 'getLogs') {
      var nSheet = ss.getSheetByName('NotificationLogs');
      var aSheet = ss.getSheetByName('AuditLogs');
      var eSheet = ss.getSheetByName('ResolutionEvidence');
      var rawEvidenceList = eSheet ? readSheetAsJson(eSheet) : [];

      return createJsonResponse({
        success: true,
        notificationLogs: nSheet ? formatNotificationLogRows_(readSheetAsJson(nSheet)) : [],
        auditLogs: aSheet ? readSheetAsJson(aSheet) : [],
        evidence: formatEvidenceRows_(rawEvidenceList)
      });
    }

    return createJsonResponse({ success: false, message: 'Unknown GET action: ' + action });
  } catch (err) {
    return createJsonResponse({ success: false, message: err.toString() });
  }
}

function pickFieldNormalized_(item, normalizedCandidates) {
  if (!item) return '';
  var keys = Object.keys(item);
  for (var c = 0; c < normalizedCandidates.length; c++) {
    var target = normalizedCandidates[c];
    for (var k = 0; k < keys.length; k++) {
      var cleanKey = String(keys[k]).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanKey === target && item[keys[k]] !== '' && item[keys[k]] !== null && item[keys[k]] !== undefined) {
        return item[keys[k]];
      }
    }
  }
  return '';
}

function formatNotificationLogRows_(rawLogs) {
  return rawLogs.map(function(item) {
    var tId = pickFieldNormalized_(item, ['ticketid', 'id']) || '';
    var ts = pickFieldNormalized_(item, ['timestamp', 'createdat', 'date', 'time']) || '';
    var dept = pickFieldNormalized_(item, ['department', 'dept']) || '';
    var recipient = pickFieldNormalized_(item, ['recipient', 'responsibleemail', 'to']) || '';
    var cc = pickFieldNormalized_(item, ['cc', 'departmentheademail', 'heademail']) || '';
    var subj = pickFieldNormalized_(item, ['subject', 'emailsubject']) || '';
    var statusVal = pickFieldNormalized_(item, ['status', 'dispatchstatus', 'result', 'dispatchresult']) || '';
    var resultVal = pickFieldNormalized_(item, ['result', 'dispatchresult', 'status', 'dispatchstatus']) || '';
    var details = pickFieldNormalized_(item, ['details', 'message', 'notes']) || '';

    var normalized = {};
    for (var k in item) {
      if (Object.prototype.hasOwnProperty.call(item, k)) {
        normalized[k] = item[k];
      }
    }
    normalized.TicketID = tId;
    normalized.Timestamp = ts;
    normalized.Department = dept;
    normalized.Recipient = recipient;
    normalized.CC = cc;
    if (subj) normalized.Subject = subj;
    normalized.Status = statusVal;
    normalized.Result = resultVal;
    normalized.Details = details;
    normalized.ticketId = tId;
    normalized.timestamp = ts;
    normalized.department = dept;
    normalized.recipient = recipient;
    normalized.cc = cc;
    if (subj) normalized.subject = subj;
    normalized.status = statusVal;
    normalized.result = resultVal;
    normalized.details = details;
    return normalized;
  });
}

function formatEvidenceRows_(rawEvidence) {
  return rawEvidence.map(function(item) {
    var evId = item.EvidenceID || item.evidenceId || '';
    var tId = item.TicketID || item.ticketId || '';
    var evType = item.EvidenceType || item.evidenceType || 'Photo Verification';
    var evRef = item.EvidenceReference || item.evidenceReference || item.PhotoURL || item.photoUrl || '';
    var notes = item.Notes || item.notes || item.Note || item.note || '';
    var subAt = item.SubmittedAt || item.submittedAt || item.Timestamp || item.timestamp || '';
    var subBy = item.SubmittedBy || item.submittedBy || 'Technician';

    return {
      EvidenceID: evId,
      TicketID: tId,
      EvidenceType: evType,
      EvidenceReference: evRef,
      Notes: notes,
      SubmittedAt: subAt,
      SubmittedBy: subBy,
      evidenceId: evId,
      ticketId: tId,
      evidenceType: evType,
      evidenceReference: evRef,
      photoUrl: evRef,
      notes: notes,
      note: notes,
      submittedAt: subAt,
      timestamp: subAt,
      submittedBy: subBy
    };
  });
}

// -------------------------------------------------------------
// POST Request Handler
// -------------------------------------------------------------
function doPost(e) {
  var lock = null;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, message: 'No post data received.' });
    }

    var data = JSON.parse(e.postData.contents);
    var diag = getSpreadsheetWithDiagnostics_();
    if (!diag.ss) {
      return createJsonResponse({
        success: false,
        message: diag.diagnostic || 'Spreadsheet context missing. Please configure SPREADSHEET_ID at the top of Code.gs.'
      });
    }

    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(10000);
    }

    if (data.action === 'createTicket') {
      return handleCreateTicket(data, diag.ss);
    }

    if (data.action === 'updateStatus') {
      return handleUpdateStatus(data, diag.ss);
    }

    if (data.action === 'addEvidence') {
      return handleAddEvidence(data, diag.ss);
    }

    if (data.action === 'retryNotification') {
      return handleRetryNotification(data, diag.ss);
    }

    if (data.action === 'sendTestEmail') {
      return handleSendTestEmail(data, diag.ss);
    }

    if (data.action === 'updateDepartment') {
      return handleUpdateDepartment(data, diag.ss);
    }

    if (data.action === 'syncAll') {
      return handleSyncAll(data, diag.ss);
    }

    return createJsonResponse({ success: false, message: 'Unknown POST action: ' + data.action });
  } catch (err) {
    return createJsonResponse({ success: false, message: err.toString() });
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (releaseErr) {
        Logger.log('Lock release notice: ' + releaseErr.toString());
      }
    }
  }
}

// -------------------------------------------------------------
// Action: Create Ticket with Department Matching & Real Email Dispatch
// -------------------------------------------------------------
function handleCreateTicket(data, ss) {
  var description = String(data.description || data.issueDescription || '').trim();
  if (!description) {
    return createJsonResponse({ success: false, message: 'Description is required.' });
  }

  var rawEvidenceRef = String(data.photoUrl || data.evidenceReference || '').trim();
  if (rawEvidenceRef.length > MAX_SHEET_CELL_CHARS) {
    return createJsonResponse({
      success: false,
      message: 'Evidence reference exceeds Google Sheets ' + MAX_SHEET_CELL_CHARS + ' character cell limit (' + rawEvidenceRef.length + ' chars). Please compress the image or provide a hosted URL.'
    });
  }

  var ticketsSheet = ss.getSheetByName('Tickets') || ss.insertSheet('Tickets');
  var dirSheet = ss.getSheetByName('DepartmentDirectory');
  var notifSheet = ss.getSheetByName('NotificationLogs') || ss.insertSheet('NotificationLogs');
  var auditSheet = ss.getSheetByName('AuditLogs') || ss.insertSheet('AuditLogs');

  ensureTicketHeaders(ticketsSheet);
  ensureNotificationHeaders(notifSheet);
  ensureAuditHeaders(auditSheet);

  if (dirSheet) {
    sanitizeDirectoryHeaders(dirSheet);
  }

  // Load Department Directory Contacts & Keywords
  var dirInfo = loadDepartmentDirectory(dirSheet);

  // 1. Authoritative Department & Caller/AI Category Preservation
  var resolvedDept = resolveDepartment(data, description, dirInfo);
  var department = resolvedDept.department;
  var explicitCategory = String(data.category || '').trim();
  var category = explicitCategory ? explicitCategory.substring(0, 120) : department;

  // 2. Priority Resolution
  var priority = resolvePriority(data, description);

  // 3. Unique Ticket ID (scan existing Tickets to guarantee uniqueness)
  var existingIds = {};
  var existingRows = ticketsSheet.getDataRange().getValues();
  if (existingRows.length > 1) {
    var tHeaders = existingRows[0].map(function(h) { return String(h || '').trim(); });
    var tIdCol = findCol(tHeaders, ['ticketid', 'ticket id', 'id']);
    if (tIdCol !== -1) {
      for (var rIdx = 1; rIdx < existingRows.length; rIdx++) {
        var rowId = String(existingRows[rIdx][tIdCol] || '').trim().toUpperCase();
        if (rowId) existingIds[rowId] = true;
      }
    }
  }

  var requestedId = data.ticketId ? String(data.ticketId).trim().toUpperCase() : '';
  var ticketId = (requestedId && requestedId.indexOf('FMC-') === 0 && !existingIds[requestedId])
    ? requestedId
    : '';
  while (!ticketId || existingIds[ticketId]) {
    ticketId = 'FMC-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  }

  var now = new Date().toISOString();
  var rawReporterName = data.isAnonymous ? 'Anonymous Faculty' : String(data.facultyName || data.reporterName || 'Faculty').trim();
  var reporterName = sanitizeCellValue_(rawReporterName, 120);
  var isAnonymous = !!data.isAnonymous;
  var building = sanitizeCellValue_(String(data.building || '').trim(), 120);
  var roomNumber = sanitizeCellValue_(String(data.roomNumber || '').trim(), 120);
  var aiSummary = sanitizeCellValue_(String(data.aiSummary || description).substring(0, 150), 200);
  var evidenceRef = rawEvidenceRef;
  var assignedTo = data.assignedTo ? sanitizeCellValue_(String(data.assignedTo).trim(), 120) : '';
  var status = resolvedDept.requiresManualReview ? 'Needs Review' : (assignedTo ? 'Assigned' : 'Open');

  // 4. Save to Tickets sheet aligned cleanly to actual sheet headers (preserves custom column orders)
  appendTicketRow_(ticketsSheet, {
    ticketId: ticketId,
    createdAt: now,
    reporterName: reporterName,
    isAnonymous: isAnonymous,
    building: building,
    roomNumber: roomNumber,
    description: sanitizeCellValue_(description, 10000),
    aiSummary: aiSummary,
    category: category,
    priority: priority,
    department: department,
    status: status,
    duplicateOf: sanitizeCellValue_(String(data.duplicateOf || ''), 60),
    assignedAt: assignedTo ? now : '',
    resolvedAt: '',
    closedAt: '',
    resolutionNotes: '',
    evidenceReference: evidenceRef,
    assignedTo: assignedTo,
    updatedAt: now
  });

  // 5. Department Email Notification Dispatch (Email failure never rolls back ticket)
  var notifResult = dispatchDepartmentEmail_({
    notifSheet: notifSheet,
    ticketId: ticketId,
    timestamp: now,
    priority: priority,
    category: category,
    department: department,
    building: building,
    roomNumber: roomNumber,
    reporterName: reporterName,
    facultyEmail: data.facultyEmail || '',
    isAnonymous: isAnonymous,
    aiSummary: aiSummary,
    description: description,
    evidenceRef: evidenceRef,
    status: status,
    assignedTo: assignedTo,
    appUrl: data.appUrl || '',
    responsibleEmail: resolvedDept.responsibleEmail,
    headEmail: resolvedDept.headEmail,
    eventType: 'NEW_TICKET'
  });

  // 5b. Reporter Acknowledgement Email (only if valid email provided, non-anonymous, and enabled)
  var reporterNotifResult = null;
  var cleanFacultyEmail = String(data.facultyEmail || '').replace(/[\r\n\t]/g, '').trim();
  if (!isAnonymous && cleanFacultyEmail && isValidEmail(cleanFacultyEmail) && data.notifyReporter !== false) {
    reporterNotifResult = dispatchReporterAcknowledgementEmail_({
      notifSheet: notifSheet,
      ticketId: ticketId,
      timestamp: now,
      priority: priority,
      category: category,
      department: department,
      building: building,
      roomNumber: roomNumber,
      reporterName: reporterName,
      facultyEmail: cleanFacultyEmail,
      aiSummary: aiSummary,
      status: status,
      appUrl: data.appUrl || ''
    });
  }

  // 6. Record Audit Log
  var auditDetails = 'Ticket ' + ticketId + ' created (' + priority + ' Priority) and routed to ' + department;
  if (resolvedDept.requiresManualReview) {
    auditDetails += ' [Manual Review Flagged: no specific keyword match]';
  }
  auditSheet.appendRow([
    ticketId,
    now,
    'CREATE_TICKET',
    reporterName,
    department,
    sanitizeCellValue_(auditDetails, 1000)
  ]);

  return createJsonResponse({
    success: true,
    ticketId: ticketId,
    status: status,
    category: category,
    priority: priority,
    department: department,
    requiresManualReview: !!resolvedDept.requiresManualReview,
    notification: notifResult,
    reporterNotification: reporterNotifResult
  });
}

// -------------------------------------------------------------
// Action: Update Ticket Status, Technician Assignment & Record Evidence
// -------------------------------------------------------------
function handleUpdateStatus(data, ss) {
  var ticketId = String(data.ticketId || '').trim();
  var statusInput = String(data.status || '').trim();
  if (!ticketId || !statusInput) {
    return createJsonResponse({ success: false, message: 'ticketId and status are required.' });
  }

  var status = normalizeStatus_(statusInput);
  if (!status) {
    return createJsonResponse({
      success: false,
      message: 'Invalid status "' + statusInput + '". Allowed values: ' + VALID_STATUSES.join(', ') + '.'
    });
  }

  var rawEvidenceRef = String(data.evidenceReference || data.photoUrl || '').trim();
  if (rawEvidenceRef.length > MAX_SHEET_CELL_CHARS) {
    return createJsonResponse({
      success: false,
      message: 'Evidence reference exceeds Google Sheets ' + MAX_SHEET_CELL_CHARS + ' character cell limit (' + rawEvidenceRef.length + ' chars). Compress photo or provide a hosted URL.'
    });
  }

  var ticketsSheet = ss.getSheetByName('Tickets');
  if (!ticketsSheet) {
    return createJsonResponse({ success: false, message: 'Tickets sheet not found.' });
  }

  // Ensure AssignedTo and UpdatedAt headers exist non-destructively so assignments always persist
  ensureTicketHeaders(ticketsSheet);

  var rows = ticketsSheet.getDataRange().getValues();
  if (rows.length === 0) {
    return createJsonResponse({ success: false, message: 'Tickets sheet is empty.' });
  }

  var headers = rows[0].map(function(h) { return String(h).trim(); });
  var idCol = findCol(headers, ['ticketid', 'ticket id', 'id']);
  var statusCol = findCol(headers, ['status']);
  var deptCol = findCol(headers, ['department', 'dept']);
  var buildingCol = findCol(headers, ['building']);
  var roomCol = findCol(headers, ['roomnumber', 'room number', 'room']);
  var descCol = findCol(headers, ['description']);
  var summaryCol = findCol(headers, ['aisummary', 'ai summary', 'summary']);
  var priorityCol = findCol(headers, ['priority']);
  var reporterCol = findCol(headers, ['reportername', 'reporter name', 'reporter']);
  var anonCol = findCol(headers, ['isanonymous', 'is anonymous']);
  var assignedAtCol = findCol(headers, ['assignedat', 'assigned at']);
  var resolvedAtCol = findCol(headers, ['resolvedat', 'resolved at']);
  var closedAtCol = findCol(headers, ['closedat', 'closed at']);
  var updatedAtCol = findCol(headers, ['updatedat', 'updated at']);
  var assignedToCol = findCol(headers, ['assignedto', 'assigned to', 'technician']);
  var notesCol = findCol(headers, ['resolutionnotes', 'resolution notes', 'notes']);
  var evidenceCol = findCol(headers, ['evidencereference', 'evidence reference', 'photourl']);

  if (idCol === -1 || statusCol === -1) {
    return createJsonResponse({ success: false, message: 'Required columns not found in Tickets sheet.' });
  }

  var rowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]).trim().toUpperCase() === ticketId.toUpperCase()) {
      rowIndex = i + 1; // 1-indexed for Sheets API
      break;
    }
  }

  if (rowIndex === -1) {
    return createJsonResponse({ success: false, message: 'Ticket ID ' + ticketId + ' not found in sheet.' });
  }

  var existingRow = rows[rowIndex - 1];
  var currentStatus = normalizeStatus_(existingRow[statusCol]) || 'Open';
  var allowedNext = STATUS_TRANSITIONS[currentStatus] || VALID_STATUSES;
  if (allowedNext.indexOf(status) === -1) {
    return createJsonResponse({
      success: false,
      message: 'Invalid status transition from "' + currentStatus + '" to "' + status + '". Allowed next statuses: ' + allowedNext.join(', ') + '.'
    });
  }

  var existingNotes = notesCol !== -1 ? String(existingRow[notesCol] || '').trim() : '';
  var existingEvidence = evidenceCol !== -1 ? String(existingRow[evidenceCol] || '').trim() : '';
  var existingDept = deptCol !== -1 ? String(existingRow[deptCol] || '').trim() : '';
  var previousAssignedTo = assignedToCol !== -1 ? String(existingRow[assignedToCol] || '').trim() : '';
  var incomingAssignedTo = data.assignedTo !== undefined ? sanitizeCellValue_(String(data.assignedTo || '').trim(), 120) : previousAssignedTo;

  if (incomingAssignedTo && !isValidTechnicianForDepartment_(incomingAssignedTo, existingDept)) {
    return createJsonResponse({
      success: false,
      message: 'Technician "' + incomingAssignedTo + '" does not belong to department "' + (existingDept || 'General Administration') + '".'
    });
  }

  var safeEvidenceRef = rawEvidenceRef;
  var safeNotes = data.resolutionNotes ? sanitizeCellValue_(data.resolutionNotes, 5000) : '';
  var effectiveNotes = safeNotes || existingNotes;
  var effectiveEvidence = safeEvidenceRef || (existingEvidence && existingEvidence.indexOf('[') !== 0 ? existingEvidence : '');

  if (status === 'Resolved' && !effectiveNotes) {
    return createJsonResponse({
      success: false,
      message: 'Resolution notes are required before transitioning a ticket to Resolved.'
    });
  }

  if (status === 'Closed' && (!effectiveNotes || !effectiveEvidence)) {
    return createJsonResponse({
      success: false,
      message: 'Both resolution notes and verified evidence reference are required before transitioning a ticket to Closed.'
    });
  }

  var now = new Date().toISOString();
  var actor = String(data.updatedBy || 'Staff').trim();
  var assignmentChanged = (data.assignedTo !== undefined && incomingAssignedTo !== previousAssignedTo);

  ticketsSheet.getRange(rowIndex, statusCol + 1).setValue(status);

  if (updatedAtCol !== -1) {
    ticketsSheet.getRange(rowIndex, updatedAtCol + 1).setValue(now);
  }
  if (assignedToCol !== -1 && data.assignedTo !== undefined) {
    ticketsSheet.getRange(rowIndex, assignedToCol + 1).setValue(incomingAssignedTo);
  }
  if ((status === 'Assigned' || assignmentChanged) && assignedAtCol !== -1 && !String(existingRow[assignedAtCol] || '').trim()) {
    ticketsSheet.getRange(rowIndex, assignedAtCol + 1).setValue(now);
  }
  if (status === 'Resolved' && resolvedAtCol !== -1) {
    ticketsSheet.getRange(rowIndex, resolvedAtCol + 1).setValue(now);
  }
  if (status === 'Closed' && closedAtCol !== -1) {
    ticketsSheet.getRange(rowIndex, closedAtCol + 1).setValue(now);
  }
  if (safeNotes && notesCol !== -1) {
    ticketsSheet.getRange(rowIndex, notesCol + 1).setValue(safeNotes);
  }
  if (safeEvidenceRef && evidenceCol !== -1) {
    ticketsSheet.getRange(rowIndex, evidenceCol + 1).setValue(safeEvidenceRef);
  }

  // Record evidence in ResolutionEvidence sheet using header-aware 7-column schema:
  // EvidenceID | TicketID | EvidenceType | EvidenceReference | Notes | SubmittedAt | SubmittedBy
  if (safeNotes || safeEvidenceRef || status === 'Resolved' || status === 'Closed') {
    var evidenceSheet = ss.getSheetByName('ResolutionEvidence') || ss.insertSheet('ResolutionEvidence');
    var evId = 'EVD-' + Utilities.getUuid().substring(0, 8).toUpperCase();
    var evType = safeEvidenceRef ? 'Photo Verification' : 'Technician Resolution Note';
    var evRef = safeEvidenceRef || 'N/A';
    var evNotes = safeNotes || ('Status transitioned to ' + status);

    appendEvidenceRow_(evidenceSheet, {
      evidenceId: evId,
      ticketId: ticketId,
      evidenceType: evType,
      evidenceReference: evRef,
      notes: evNotes,
      submittedAt: now,
      submittedBy: sanitizeCellValue_(actor, 120)
    });
  }

  // Send Email Notification for Technician Assignment, Status Change, or Resolution (never doubles in one call)
  var lifecycleNotif = null;
  var statusActuallyChanged = (currentStatus !== status);
  var shouldNotifyAssignment = (assignmentChanged && !!incomingAssignedTo);
  var shouldNotifyStatus = statusActuallyChanged && !shouldNotifyAssignment;

  if (shouldNotifyAssignment || shouldNotifyStatus) {
    var dirSheet = ss.getSheetByName('DepartmentDirectory');
    var dirList = loadDepartmentDirectory(dirSheet);
    var deptEntry = findInDir(dirList, existingDept) || { responsibleEmail: '', headEmail: '' };
    var notifSheet = ss.getSheetByName('NotificationLogs') || ss.insertSheet('NotificationLogs');
    ensureNotificationHeaders(notifSheet);

    var reqEmailCol = findCol(headers, ['reporteremail', 'facultyemail', 'email']);
    var storedReporterEmail = (reqEmailCol !== -1 && existingRow[reqEmailCol]) ? String(existingRow[reqEmailCol]).trim() : '';
    var isTicketAnon = anonCol !== -1 ? (existingRow[anonCol] === true || String(existingRow[anonCol]).toLowerCase() === 'true') : false;
    var candidateReporterEmail = isTicketAnon ? '' : String(data.reporterEmail || data.facultyEmail || storedReporterEmail || '').trim();
    var candidateTechEmail = String(data.assignedTechnicianEmail || data.technicianEmail || '').trim();
    var isResolutionEvent = (status === 'Resolved' || status === 'Closed');
    var isVerifiedResolution = (status === 'Closed' && (currentStatus === 'Pending Verification' || data.isVerified === true));

    if (shouldNotifyAssignment) {
      lifecycleNotif = dispatchStatusNotification_({
        notifSheet: notifSheet,
        ticketId: ticketId,
        timestamp: now,
        eventType: 'TECHNICIAN_ASSIGNED',
        priority: priorityCol !== -1 ? String(existingRow[priorityCol] || 'Medium') : 'Medium',
        department: existingDept || 'General Administration',
        building: buildingCol !== -1 ? String(existingRow[buildingCol] || '') : '',
        roomNumber: roomCol !== -1 ? String(existingRow[roomCol] || '') : '',
        reporterName: reporterCol !== -1 ? String(existingRow[reporterCol] || 'Faculty') : 'Faculty',
        isAnonymous: isTicketAnon,
        aiSummary: summaryCol !== -1 ? String(existingRow[summaryCol] || '') : '',
        description: descCol !== -1 ? String(existingRow[descCol] || '') : '',
        previousStatus: currentStatus,
        newStatus: status,
        assignedTo: incomingAssignedTo,
        previousAssignedTo: previousAssignedTo,
        technicianEmail: candidateTechEmail,
        reporterEmail: data.notifyReporter === false ? '' : candidateReporterEmail,
        responsibleEmail: deptEntry.responsibleEmail || '',
        headEmail: deptEntry.headEmail || '',
        resolutionNotes: effectiveNotes,
        evidenceRef: effectiveEvidence,
        isVerified: isVerifiedResolution,
        appUrl: data.appUrl || ''
      });
    } else if (shouldNotifyStatus) {
      lifecycleNotif = dispatchStatusNotification_({
        notifSheet: notifSheet,
        ticketId: ticketId,
        timestamp: now,
        eventType: isResolutionEvent ? 'TICKET_RESOLUTION' : 'STATUS_CHANGE',
        priority: priorityCol !== -1 ? String(existingRow[priorityCol] || 'Medium') : 'Medium',
        department: existingDept || 'General Administration',
        building: buildingCol !== -1 ? String(existingRow[buildingCol] || '') : '',
        roomNumber: roomCol !== -1 ? String(existingRow[roomCol] || '') : '',
        reporterName: reporterCol !== -1 ? String(existingRow[reporterCol] || 'Faculty') : 'Faculty',
        isAnonymous: isTicketAnon,
        aiSummary: summaryCol !== -1 ? String(existingRow[summaryCol] || '') : '',
        description: descCol !== -1 ? String(existingRow[descCol] || '') : '',
        previousStatus: currentStatus,
        newStatus: status,
        assignedTo: incomingAssignedTo,
        technicianEmail: candidateTechEmail,
        reporterEmail: data.notifyReporter === false ? '' : candidateReporterEmail,
        responsibleEmail: deptEntry.responsibleEmail || '',
        headEmail: deptEntry.headEmail || '',
        resolutionNotes: effectiveNotes,
        evidenceRef: effectiveEvidence,
        isVerified: isVerifiedResolution,
        appUrl: data.appUrl || ''
      });
    }
  }

  // Record Audit Log
  var auditSheet = ss.getSheetByName('AuditLogs') || ss.insertSheet('AuditLogs');
  ensureAuditHeaders(auditSheet);
  var detailParts = [];
  if (currentStatus !== status) {
    detailParts.push('Status: ' + currentStatus + ' -> ' + status);
  }
  if (assignmentChanged) {
    detailParts.push(incomingAssignedTo ? ('Assigned to: ' + incomingAssignedTo) : 'Technician unassigned');
  } else if (incomingAssignedTo) {
    detailParts.push('Technician: ' + incomingAssignedTo);
  }
  if (safeNotes) {
    detailParts.push('Notes: ' + safeNotes.substring(0, 120));
  }
  if (detailParts.length === 0) {
    detailParts.push('Status confirmed: ' + status);
  }
  auditSheet.appendRow([
    ticketId,
    now,
    assignmentChanged ? 'ASSIGN_TECHNICIAN' : 'STATUS_CHANGE',
    actor,
    assignmentChanged ? (incomingAssignedTo || status) : status,
    detailParts.join(' | ')
  ]);

  return createJsonResponse({
    success: true,
    ticketId: ticketId,
    previousStatus: currentStatus,
    status: status,
    department: existingDept,
    assignedTo: incomingAssignedTo,
    updatedAt: now,
    notification: lifecycleNotif,
    message: 'Ticket ' + ticketId + ' status updated to ' + status
  });
}

// -------------------------------------------------------------
// Action: Retry Failed / Skipped Notification Dispatch (with duplicate prevention)
// -------------------------------------------------------------
function handleRetryNotification(data, ss) {
  var ticketId = String(data.ticketId || '').trim();
  if (!ticketId) {
    return createJsonResponse({ success: false, message: 'ticketId is required to retry notification.' });
  }

  var ticketsSheet = ss.getSheetByName('Tickets');
  if (!ticketsSheet) {
    return createJsonResponse({ success: false, message: 'Tickets sheet not found.' });
  }

  var rows = ticketsSheet.getDataRange().getValues();
  if (rows.length <= 1) {
    return createJsonResponse({ success: false, message: 'Tickets sheet has no records.' });
  }

  var headers = rows[0].map(function(h) { return String(h).trim(); });
  var idCol = findCol(headers, ['ticketid', 'ticket id', 'id']);
  var deptCol = findCol(headers, ['department', 'dept']);
  var buildingCol = findCol(headers, ['building']);
  var roomCol = findCol(headers, ['roomnumber', 'room number', 'room']);
  var descCol = findCol(headers, ['description']);
  var summaryCol = findCol(headers, ['aisummary', 'ai summary', 'summary']);
  var priorityCol = findCol(headers, ['priority']);
  var statusCol = findCol(headers, ['status']);
  var reporterCol = findCol(headers, ['reportername', 'reporter name', 'reporter']);
  var anonCol = findCol(headers, ['isanonymous', 'is anonymous']);
  var assignedToCol = findCol(headers, ['assignedto', 'assigned to', 'technician']);
  var evidenceCol = findCol(headers, ['evidencereference', 'evidence reference', 'photourl']);

  var targetRow = null;
  for (var i = 1; i < rows.length; i++) {
    if (idCol !== -1 && String(rows[i][idCol]).trim().toUpperCase() === ticketId.toUpperCase()) {
      targetRow = rows[i];
      break;
    }
  }

  if (!targetRow) {
    return createJsonResponse({ success: false, message: 'Ticket ' + ticketId + ' not found in Tickets sheet.' });
  }

  var dept = deptCol !== -1 ? String(targetRow[deptCol] || 'General Administration').trim() : 'General Administration';
  var dirSheet = ss.getSheetByName('DepartmentDirectory');
  var dirList = loadDepartmentDirectory(dirSheet);
  var deptEntry = findInDir(dirList, dept) || { responsibleEmail: '', headEmail: '' };

  var notifSheet = ss.getSheetByName('NotificationLogs') || ss.insertSheet('NotificationLogs');
  ensureNotificationHeaders(notifSheet);
  var now = new Date().toISOString();

  // Duplicate notification safeguard: skip resend if latest notification for this ticket & recipient already succeeded
  if (data.force !== true && wasLatestNotificationSent_(notifSheet, ticketId, deptEntry.responsibleEmail)) {
    return createJsonResponse({
      success: true,
      alreadySent: true,
      ticketId: ticketId,
      department: dept,
      notification: {
        sent: true,
        status: 'SENT',
        recipient: deptEntry.responsibleEmail,
        message: 'Latest notification for ' + ticketId + ' is already marked SENT. Duplicate email suppressed.'
      },
      message: 'Latest notification for ' + ticketId + ' already succeeded; duplicate email skipped.'
    });
  }

  var retryRes = dispatchDepartmentEmail_({
    notifSheet: notifSheet,
    ticketId: ticketId,
    timestamp: now,
    priority: priorityCol !== -1 ? String(targetRow[priorityCol] || 'Medium') : 'Medium',
    department: dept,
    building: buildingCol !== -1 ? String(targetRow[buildingCol] || '') : '',
    roomNumber: roomCol !== -1 ? String(targetRow[roomCol] || '') : '',
    reporterName: reporterCol !== -1 ? String(targetRow[reporterCol] || 'Faculty') : 'Faculty',
    facultyEmail: '',
    isAnonymous: anonCol !== -1 ? (targetRow[anonCol] === true || String(targetRow[anonCol]).toLowerCase() === 'true') : false,
    aiSummary: summaryCol !== -1 ? String(targetRow[summaryCol] || '') : '',
    description: descCol !== -1 ? String(targetRow[descCol] || '') : '',
    evidenceRef: evidenceCol !== -1 ? String(targetRow[evidenceCol] || '') : '',
    status: statusCol !== -1 ? String(targetRow[statusCol] || 'Open') : 'Open',
    assignedTo: assignedToCol !== -1 ? String(targetRow[assignedToCol] || '') : '',
    appUrl: data.appUrl || '',
    responsibleEmail: deptEntry.responsibleEmail || '',
    headEmail: deptEntry.headEmail || '',
    eventType: 'RETRY_DISPATCH'
  });

  var auditSheet = ss.getSheetByName('AuditLogs') || ss.insertSheet('AuditLogs');
  ensureAuditHeaders(auditSheet);
  auditSheet.appendRow([
    ticketId,
    now,
    'RETRY_NOTIFICATION',
    String(data.actor || 'Dispatcher').trim(),
    dept,
    'Email retry result: ' + retryRes.status + ' — ' + retryRes.message
  ]);

  return createJsonResponse({
    success: retryRes.sent,
    ticketId: ticketId,
    department: dept,
    notification: retryRes,
    message: retryRes.message
  });
}

// -------------------------------------------------------------
// Action: Safe Send Test Email (Creates NO ticket & NO dept dispatch)
// -------------------------------------------------------------
function handleSendTestEmail(data, ss) {
  var recipientEmail = String(data.recipientEmail || '').replace(/[\r\n\t]/g, '').trim();
  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    return createJsonResponse({
      success: false,
      status: 'SKIPPED',
      message: 'Please provide a valid recipient email address for the test email.'
    });
  }

  var safeAppUrl = /^https?:\/\/[^\s]+$/i.test(String(data.appUrl || '').trim())
    ? String(data.appUrl).trim()
    : '';
  var now = new Date().toISOString();
  var subject = '[FixMyCampus 2.0] MailApp Delivery Diagnostic Test';
  var plainBody =
    'FixMyCampus 2.0 - Safe Email Delivery Diagnostic\n' +
    '================================================\n\n' +
    'This is an explicit diagnostic test email requested from FixMyCampus 2.0.\n' +
    'Recipient: ' + recipientEmail + '\n' +
    'Timestamp: ' + now + '\n' +
    (safeAppUrl ? 'App Link:  ' + safeAppUrl + '\n' : '') +
    '\nNo fake ticket or department dispatch was created.\n';

  var htmlBody =
    '<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">' +
      '<div style="background-color: #1d4ed8; color: #ffffff; padding: 14px 20px;">' +
        '<h2 style="margin: 0; font-size: 16px;">FixMyCampus 2.0 &mdash; Email Diagnostic Test</h2>' +
      '</div>' +
      '<div style="padding: 18px 20px; background-color: #ffffff; color: #1e293b; font-size: 13px; line-height: 1.5;">' +
        '<p style="margin: 0 0 10px;">This confirms your Google Apps Script <code>MailApp.sendEmail</code> OAuth authorization is active and able to deliver real email.</p>' +
        '<p style="margin: 0 0 6px;"><strong>Recipient:</strong> ' + escapeHtml_(recipientEmail) + '</p>' +
        '<p style="margin: 0 0 12px;"><strong>Sent At:</strong> ' + escapeHtml_(now) + '</p>' +
        (safeAppUrl ? '<p style="margin: 12px 0;"><a href="' + escapeHtml_(safeAppUrl) + '" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-weight:bold;">Open FixMyCampus</a></p>' : '') +
        '<p style="font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; margin-top: 14px;">Safe diagnostic test &mdash; no campus ticket was created.</p>' +
      '</div>' +
    '</div>';

  try {
    MailApp.sendEmail({
      to: recipientEmail,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody
    });

    var quotaAfter = null;
    try {
      quotaAfter = MailApp.getRemainingDailyQuota();
    } catch (qErr) {
      quotaAfter = null;
    }

    var auditSheet = ss.getSheetByName('AuditLogs') || ss.insertSheet('AuditLogs');
    ensureAuditHeaders(auditSheet);
    auditSheet.appendRow([
      'DIAGNOSTIC-EMAIL',
      now,
      'SEND_TEST_EMAIL',
      String(data.actor || 'Admin').trim(),
      recipientEmail,
      'MailApp diagnostic test SENT (no ticket created).'
    ]);

    return createJsonResponse({
      success: true,
      status: 'SENT',
      recipient: recipientEmail,
      timestamp: now,
      remainingQuota: quotaAfter,
      message: 'Test email accepted by MailApp for ' + recipientEmail + '.'
    });
  } catch (err) {
    var errStr = err.toString();
    var isPerm = errStr.toLowerCase().indexOf('permission') !== -1 || errStr.toLowerCase().indexOf('sendemail') !== -1;
    var errMsg = 'MailApp failed: ' + errStr + (isPerm ? ' — Run authorizeMailPermissions() in Apps Script editor, accept OAuth consent, and deploy Deploy > Manage deployments > New version.' : '');

    var auditErrSheet = ss.getSheetByName('AuditLogs') || ss.insertSheet('AuditLogs');
    ensureAuditHeaders(auditErrSheet);
    auditErrSheet.appendRow([
      'DIAGNOSTIC-EMAIL',
      now,
      'SEND_TEST_EMAIL_FAILED',
      String(data.actor || 'Admin').trim(),
      recipientEmail,
      sanitizeCellValue_(errMsg, 1000)
    ]);

    return createJsonResponse({
      success: false,
      status: 'FAILED',
      recipient: recipientEmail,
      timestamp: now,
      message: errMsg
    });
  }
}

// -------------------------------------------------------------
// Action: Non-destructively update DepartmentDirectory email/active config
// -------------------------------------------------------------
function handleUpdateDepartment(data, ss) {
  var deptName = String(data.department || '').replace(/[\r\n]/g, '').trim();
  if (!deptName) {
    return createJsonResponse({ success: false, message: 'department name is required.' });
  }

  var responsibleEmail = data.responsibleEmail !== undefined
    ? String(data.responsibleEmail || '').replace(/[\r\n\t]/g, '').trim()
    : undefined;
  var headEmail = data.departmentHeadEmail !== undefined
    ? String(data.departmentHeadEmail || '').replace(/[\r\n\t]/g, '').trim()
    : undefined;

  if (responsibleEmail && !isValidEmail(responsibleEmail)) {
    return createJsonResponse({ success: false, message: 'Invalid ResponsibleEmail format: ' + responsibleEmail });
  }
  if (headEmail && !isValidEmail(headEmail)) {
    return createJsonResponse({ success: false, message: 'Invalid DepartmentHeadEmail format: ' + headEmail });
  }

  var dirSheet = ss.getSheetByName('DepartmentDirectory');
  if (!dirSheet || dirSheet.getLastRow() <= 1) {
    return createJsonResponse({ success: false, message: 'DepartmentDirectory sheet not initialized.' });
  }

  sanitizeDirectoryHeaders(dirSheet);
  var rows = dirSheet.getDataRange().getValues();
  var headers = rows[0].map(function(h) { return String(h || '').trim(); });
  var deptIdx = findCol(headers, ['department', 'name']);
  var respEmailIdx = findCol(headers, ['responsibleemail', 'email', 'responsible_email']);
  var headEmailIdx = findCol(headers, ['departmentheademail', 'heademail', 'head_email']);
  var respNameIdx = findCol(headers, ['responsiblename', 'responsibleperson', 'responsible_name']);
  var activeIdx = findCol(headers, ['active', 'isactive']);

  if (deptIdx === -1) {
    return createJsonResponse({ success: false, message: 'Department column missing in DepartmentDirectory.' });
  }

  var targetRowNum = -1;
  var normTarget = deptName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (var i = 1; i < rows.length; i++) {
    var rowDept = String(rows[i][deptIdx] || '').replace(/[\r\n]/g, '').trim();
    if (rowDept.toLowerCase().replace(/[^a-z0-9]/g, '') === normTarget) {
      targetRowNum = i + 1;
      break;
    }
  }

  if (targetRowNum === -1) {
    return createJsonResponse({ success: false, message: 'Department "' + deptName + '" not found in DepartmentDirectory.' });
  }

  if (responsibleEmail !== undefined && respEmailIdx !== -1) {
    dirSheet.getRange(targetRowNum, respEmailIdx + 1).setValue(sanitizeCellValue_(responsibleEmail, 160));
  }
  if (headEmail !== undefined && headEmailIdx !== -1) {
    dirSheet.getRange(targetRowNum, headEmailIdx + 1).setValue(sanitizeCellValue_(headEmail, 160));
  }
  if (data.responsibleName !== undefined && respNameIdx !== -1) {
    dirSheet.getRange(targetRowNum, respNameIdx + 1).setValue(sanitizeCellValue_(String(data.responsibleName || '').trim(), 120));
  }
  if (data.active !== undefined && activeIdx !== -1) {
    dirSheet.getRange(targetRowNum, activeIdx + 1).setValue(!!data.active);
  }

  var now = new Date().toISOString();
  var auditSheet = ss.getSheetByName('AuditLogs') || ss.insertSheet('AuditLogs');
  ensureAuditHeaders(auditSheet);
  auditSheet.appendRow([
    'DIR-CONFIG',
    now,
    'UPDATE_DEPARTMENT_CONFIG',
    String(data.actor || 'Admin').trim(),
    deptName,
    'Updated contacts for ' + deptName
  ]);

  var enriched = computeDepartmentEmailSummary_(dirSheet);
  return createJsonResponse({
    success: true,
    message: 'Updated DepartmentDirectory settings for ' + deptName + '.',
    departments: enriched.rows,
    summary: enriched.summary
  });
}

// -------------------------------------------------------------
// Action: Explicit Add Evidence
// -------------------------------------------------------------
function handleAddEvidence(data, ss) {
  var ticketId = String(data.ticketId || '').trim();
  if (!ticketId) {
    return createJsonResponse({ success: false, message: 'ticketId is required.' });
  }

  var rawRef = String(data.evidenceReference || data.photoUrl || '').trim();
  if (rawRef.length > MAX_SHEET_CELL_CHARS) {
    return createJsonResponse({
      success: false,
      message: 'Evidence reference exceeds Google Sheets ' + MAX_SHEET_CELL_CHARS + ' character cell limit (' + rawRef.length + ' chars). Compress photo or provide a hosted URL.'
    });
  }

  var notes = sanitizeCellValue_(data.notes || data.resolutionNotes || data.note || '', 5000);
  if (!rawRef && !notes) {
    return createJsonResponse({
      success: false,
      message: 'Either evidenceReference (photo/URL) or notes is required to record resolution evidence.'
    });
  }

  var evidenceSheet = ss.getSheetByName('ResolutionEvidence') || ss.insertSheet('ResolutionEvidence');

  var evidenceId = (data.evidenceId && String(data.evidenceId).indexOf('EVD-') === 0)
    ? String(data.evidenceId).trim()
    : 'EVD-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  var now = new Date().toISOString();
  var evidenceReference = rawRef;
  var evidenceType = sanitizeCellValue_(data.evidenceType || (rawRef ? 'Photo Verification' : 'Resolution Note'), 120);
  var submittedAt = data.submittedAt || data.timestamp || now;
  var submittedBy = sanitizeCellValue_(String(data.submittedBy || data.actor || data.updatedBy || 'Technician / Staff').trim(), 120);

  // Header-aware 7-column schema: EvidenceID | TicketID | EvidenceType | EvidenceReference | Notes | SubmittedAt | SubmittedBy
  appendEvidenceRow_(evidenceSheet, {
    evidenceId: evidenceId,
    ticketId: ticketId,
    evidenceType: evidenceType,
    evidenceReference: evidenceReference,
    notes: notes,
    submittedAt: submittedAt,
    submittedBy: submittedBy
  });

  var auditSheet = ss.getSheetByName('AuditLogs') || ss.insertSheet('AuditLogs');
  ensureAuditHeaders(auditSheet);
  auditSheet.appendRow([
    ticketId,
    now,
    'SUBMIT_EVIDENCE',
    submittedBy,
    evidenceType,
    sanitizeCellValue_('Evidence ' + evidenceId + ' recorded: ' + (notes ? notes.substring(0, 80) : 'Verification attached'), 500)
  ]);

  return createJsonResponse({
    success: true,
    evidenceId: evidenceId,
    ticketId: ticketId,
    evidenceType: evidenceType,
    evidenceReference: evidenceReference,
    notes: notes,
    submittedAt: submittedAt,
    submittedBy: submittedBy,
    message: 'Resolution evidence recorded successfully.'
  });
}

// -------------------------------------------------------------
// Action: Sync All Tickets (Bulk Import)
// -------------------------------------------------------------
function handleSyncAll(data, ss) {
  var tickets = data.tickets || [];
  if (!Array.isArray(tickets) || tickets.length === 0) {
    return createJsonResponse({ success: false, message: 'No tickets provided to sync.' });
  }

  for (var v = 0; v < tickets.length; v++) {
    var item = tickets[v];
    if (!item || typeof item !== 'object') {
      return createJsonResponse({ success: false, message: 'Invalid ticket object at index ' + v + '.' });
    }
    var refCheck = String(item.photoUrl || item.evidenceReference || '').trim();
    if (refCheck.length > MAX_SHEET_CELL_CHARS) {
      return createJsonResponse({
        success: false,
        message: 'Ticket ' + (item.id || item.ticketId || ('#' + v)) + ' image exceeds Google Sheets ' + MAX_SHEET_CELL_CHARS + ' character cell limit.'
      });
    }
  }

  var ticketsSheet = ss.getSheetByName('Tickets') || ss.insertSheet('Tickets');
  ensureTicketHeaders(ticketsSheet);

  var existingRows = ticketsSheet.getDataRange().getValues();
  var existingIds = {};
  if (existingRows.length > 1) {
    var headers = existingRows[0].map(function(h) { return String(h).trim(); });
    var idCol = findCol(headers, ['ticketid', 'ticket id', 'id']);
    if (idCol !== -1) {
      for (var i = 1; i < existingRows.length; i++) {
        var existingId = String(existingRows[i][idCol] || '').trim().toUpperCase();
        if (existingId) {
          existingIds[existingId] = true;
        }
      }
    }
  }

  var added = 0;
  var now = new Date().toISOString();
  for (var j = 0; j < tickets.length; j++) {
    var t = tickets[j];
    var tIdRaw = String(t.id || t.ticketId || '').trim();
    var tId = tIdRaw.toUpperCase();
    if (!tId) continue;
    if (!existingIds[tId]) {
      appendTicketRow_(ticketsSheet, {
        ticketId: tIdRaw,
        createdAt: t.reportedAt || t.timestamp || now,
        reporterName: t.isAnonymous ? 'Anonymous Faculty' : (t.facultyName || 'Faculty'),
        isAnonymous: !!t.isAnonymous,
        building: t.building || '',
        roomNumber: t.roomNumber || t.room || '',
        description: sanitizeCellValue_(t.description || '', 10000),
        aiSummary: sanitizeCellValue_(t.aiSummary || t.summary || '', 200),
        category: t.category || t.recommendedDepartment || t.department || 'Other',
        priority: normalizePriority_(t.priority) || 'Medium',
        department: t.recommendedDepartment || t.department || 'General Administration',
        status: normalizeStatus_(t.status) || 'Open',
        duplicateOf: t.isDuplicateOf || '',
        assignedAt: t.reportedAt || now,
        resolvedAt: t.resolution ? (t.resolution.resolvedAt || '') : '',
        closedAt: t.resolution && t.status === 'Closed' ? (t.resolution.verifiedAt || now) : '',
        resolutionNotes: t.resolution ? sanitizeCellValue_(t.resolution.notes || '', 5000) : '',
        evidenceReference: String(t.photoUrl || t.evidenceReference || '').trim(),
        assignedTo: sanitizeCellValue_(t.assignedTo || '', 120),
        updatedAt: t.updatedAt || now
      });
      existingIds[tId] = true;
      added++;
    }
  }

  var auditSheet = ss.getSheetByName('AuditLogs') || ss.insertSheet('AuditLogs');
  ensureAuditHeaders(auditSheet);
  auditSheet.appendRow([
    'BATCH-SYNC',
    now,
    'SYNC_ALL',
    'System Sync',
    'Tickets',
    'Bulk sync processed ' + tickets.length + ' item(s); added ' + added + ' new ticket(s).'
  ]);

  return createJsonResponse({
    success: true,
    added: added,
    message: 'Sync completed. Added ' + added + ' new tickets to Google Sheets.'
  });
}

// -------------------------------------------------------------
// Helper: Department Directory Loader & Sanitizer
// -------------------------------------------------------------
function sanitizeDirectoryHeaders(dirSheet) {
  if (!dirSheet || dirSheet.getLastColumn() === 0) return;
  var range = dirSheet.getRange(1, 1, 1, dirSheet.getLastColumn());
  var headers = range.getValues()[0];
  var hasCorruptedHeaders = false;
  var cleaned = headers.map(function(h) {
    var s = String(h || '').replace(/[\r\n]/g, '').trim();
    if (String(h) !== s) hasCorruptedHeaders = true;
    return s;
  });
  if (hasCorruptedHeaders) {
    range.setValues([cleaned]);
  }
}

function loadDepartmentDirectory(dirSheet) {
  var result = [];
  if (!dirSheet) return result;

  var rows = dirSheet.getDataRange().getValues();
  if (rows.length <= 1) return result;

  var headers = rows[0].map(function(h) { return String(h || '').trim(); });
  var deptIdx = findCol(headers, ['department', 'name']);
  var kwIdx = findCol(headers, ['keywords', 'keyword', 'categorykeywords']);
  var respNameIdx = findCol(headers, ['responsiblename', 'responsibleperson', 'responsible_name', 'contact_name']);
  var emailIdx = findCol(headers, ['responsibleemail', 'email', 'responsible_email', 'contact_email']);
  var headEmailIdx = findCol(headers, ['departmentheademail', 'heademail', 'department_head_email', 'head_email']);
  var activeIdx = findCol(headers, ['active', 'isactive', 'status']);

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var activeVal = activeIdx !== -1 ? r[activeIdx] : true;
    var isActive = (activeVal === true || String(activeVal).toLowerCase().trim() === 'true' || activeVal === 1 || activeVal === '1');
    if (!isActive) continue;

    var deptName = deptIdx !== -1 ? String(r[deptIdx] || '').replace(/[\r\n]/g, '').trim() : '';
    if (!deptName) continue;

    var kwRaw = kwIdx !== -1 ? String(r[kwIdx] || '').replace(/[\r\n]/g, '').toLowerCase() : '';
    var kwList = kwRaw.split(',').map(function(k) { return k.trim(); }).filter(function(k) { return k.length > 0; });

    var rawEmail = emailIdx !== -1 ? String(r[emailIdx] || '').replace(/[\r\n\t]/g, '').trim() : '';
    var rawHeadEmail = headEmailIdx !== -1 ? String(r[headEmailIdx] || '').replace(/[\r\n\t]/g, '').trim() : '';

    result.push({
      department: deptName,
      keywords: kwList,
      responsibleName: respNameIdx !== -1 ? String(r[respNameIdx] || '').trim() : '',
      responsibleEmail: rawEmail,
      headEmail: rawHeadEmail
    });
  }

  return result;
}

/**
 * Computes non-destructive DepartmentDirectory configuration health & missing email report.
 */
function computeDepartmentEmailSummary_(dirSheet, existingJsonRows) {
  var rows = existingJsonRows || (dirSheet ? readSheetAsJson(dirSheet) : []);
  var total = rows.length;
  var activeCount = 0;
  var configuredCount = 0;
  var missingResponsible = [];
  var missingHead = [];

  var enrichedRows = rows.map(function(row) {
    var deptName = String(row.Department || row.department || row.Name || '').trim();
    var respEmail = String(row.ResponsibleEmail || row.responsibleEmail || row.Email || '').replace(/[\r\n\t]/g, '').trim();
    var headEmail = String(row.DepartmentHeadEmail || row.HeadEmail || row.headEmail || '').replace(/[\r\n\t]/g, '').trim();
    var activeRaw = row.Active !== undefined ? row.Active : row.IsActive;
    var isActive = activeRaw === undefined || activeRaw === '' || activeRaw === true ||
      String(activeRaw).toLowerCase().trim() === 'true' || activeRaw === 1 || activeRaw === '1';

    var respValid = !!respEmail && isValidEmail(respEmail);
    var headValid = !!headEmail && isValidEmail(headEmail);

    var configStatus = !isActive
      ? 'Inactive'
      : respValid && headValid
      ? 'Configured'
      : respValid
      ? 'Missing Head CC'
      : 'Missing Responsible Email';

    if (isActive) {
      activeCount++;
      if (respValid) {
        configuredCount++;
      } else if (deptName) {
        missingResponsible.push(deptName);
      }
      if (!headValid && deptName) {
        missingHead.push(deptName);
      }
    }

    var out = {};
    for (var k in row) {
      if (Object.prototype.hasOwnProperty.call(row, k)) {
        out[k] = row[k];
      }
    }
    out.EmailConfigStatus = configStatus;
    out.ResponsibleEmailValid = respValid;
    out.DepartmentHeadEmailValid = headValid;
    out.IsActive = isActive;
    return out;
  });

  return {
    rows: enrichedRows,
    summary: {
      totalDepartments: total,
      activeDepartments: activeCount,
      configuredDepartments: configuredCount,
      missingResponsibleCount: missingResponsible.length,
      missingResponsibleEmail: missingResponsible,
      missingHeadCount: missingHead.length,
      missingHeadEmail: missingHead
    }
  };
}

/**
 * Checks whether the latest NotificationLogs row for a ticket + recipient already completed as SENT,
 * preventing accidental duplicate email sends from repeated clicks/retries.
 */
function wasLatestNotificationSent_(notifSheet, ticketId, recipientEmail) {
  if (!notifSheet || notifSheet.getLastRow() <= 1) return false;
  var rows = readSheetAsJson(notifSheet);
  var formatted = formatNotificationLogRows_(rows);
  var normId = String(ticketId || '').trim().toUpperCase();
  var normRecip = String(recipientEmail || '').trim().toLowerCase();

  for (var i = formatted.length - 1; i >= 0; i--) {
    var r = formatted[i];
    if (String(r.TicketID || '').trim().toUpperCase() !== normId) continue;
    if (normRecip && String(r.Recipient || '').trim().toLowerCase() !== normRecip) continue;
    var st = String(r.Status || r.Result || '').trim().toUpperCase();
    return st === 'SENT';
  }
  return false;
}

function findCol(headers, aliases) {
  var cleanHeaders = headers.map(function(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  });
  var cleanAliases = aliases.map(function(a) {
    return String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  });

  // Pass 1: exact match first
  for (var a = 0; a < cleanAliases.length; a++) {
    var alias = cleanAliases[a];
    if (!alias) continue;
    for (var i = 0; i < cleanHeaders.length; i++) {
      if (cleanHeaders[i] && cleanHeaders[i] === alias) {
        return i;
      }
    }
  }

  // Pass 2: safe non-empty substring match
  for (var i2 = 0; i2 < cleanHeaders.length; i2++) {
    var h = cleanHeaders[i2];
    if (!h) continue;
    for (var a2 = 0; a2 < cleanAliases.length; a2++) {
      var alias2 = cleanAliases[a2];
      if (!alias2) continue;
      if (h.indexOf(alias2) !== -1 || (h.length >= 2 && alias2.indexOf(h) !== -1)) {
        return i2;
      }
    }
  }
  return -1;
}

var TECHNICIAN_SPECIALTY_DEPTS = {
  'leo ramirez': ['it / audio-visual support', 'it/av support'],
  'marcus vance': ['facilities / maintenance', 'facilities/maintenance'],
  'elena rostova': ['classroom supplies'],
  'carlos mendez': ['plumbing / maintenance', 'plumbing', 'housekeeping', 'facilities / maintenance'],
  'kofi mensah': ['electrical maintenance', 'electrical'],
  'derrick powell': ['facilities / maintenance', 'facilities/maintenance'],
  'amina diallo': ['housekeeping']
};

function isValidTechnicianForDepartment_(techName, departmentName) {
  var cleanTech = String(techName || '').trim().toLowerCase();
  if (!cleanTech) return true;
  var cleanDept = String(departmentName || '').trim().toLowerCase();
  if (!cleanDept || cleanDept.indexOf('general') !== -1) return true;

  for (var key in TECHNICIAN_SPECIALTY_DEPTS) {
    if (Object.prototype.hasOwnProperty.call(TECHNICIAN_SPECIALTY_DEPTS, key) && cleanTech.indexOf(key) !== -1) {
      var allowed = TECHNICIAN_SPECIALTY_DEPTS[key];
      for (var i = 0; i < allowed.length; i++) {
        if (cleanDept === allowed[i] || cleanDept.indexOf(allowed[i]) !== -1 || allowed[i].indexOf(cleanDept) !== -1) {
          return true;
        }
      }
      return false;
    }
  }
  return true;
}

function dispatchDepartmentEmail_(opts) {
  var notifSheet = opts.notifSheet;
  var ticketId = opts.ticketId;
  var timestamp = opts.timestamp || new Date().toISOString();
  var priority = opts.priority || 'Medium';
  var category = opts.category || opts.department || 'Other';
  var department = opts.department || 'General Administration';
  var locationStr = opts.roomNumber ? (opts.roomNumber + ' (' + opts.building + ')') : (opts.building || 'Campus');
  var reporterDisplay = opts.isAnonymous
    ? 'Anonymous Faculty Member'
    : (opts.reporterName + (opts.facultyEmail ? ' (' + opts.facultyEmail + ')' : ''));
  var aiSummary = opts.aiSummary || '';
  var description = opts.description || '';
  var evidenceRef = String(opts.evidenceRef || '');
  var status = opts.status || 'Open';
  var assignedTo = opts.assignedTo || '';
  var appUrl = /^https?:\/\/[^\s]+$/i.test(String(opts.appUrl || '').trim()) ? String(opts.appUrl).trim() : '';
  var responsibleEmail = String(opts.responsibleEmail || '').replace(/[\r\n\t]/g, '').trim();
  var headEmail = String(opts.headEmail || '').replace(/[\r\n\t]/g, '').trim();
  var prefix = opts.eventType === 'TECHNICIAN_ASSIGNED'
    ? '[Technician Assigned: ' + assignedTo + '] '
    : opts.eventType === 'RETRY_DISPATCH'
    ? '[Retry Dispatch] '
    : '[' + priority + ' Priority Alert] ';

  var subject = prefix + 'FixMyCampus: ' + locationStr + ' - ' + department + ' (' + ticketId + ')';

  if (!responsibleEmail || !isValidEmail(responsibleEmail)) {
    var skipMsg = 'ResponsibleEmail is missing or invalid in DepartmentDirectory for ' + department + '. Dispatch skipped.';
    appendNotificationRow_(notifSheet, {
      ticketId: ticketId,
      timestamp: timestamp,
      department: department,
      recipient: responsibleEmail || 'Unconfigured',
      cc: headEmail && isValidEmail(headEmail) ? headEmail : 'None',
      subject: subject,
      status: 'SKIPPED',
      details: skipMsg
    });
    return {
      sent: false,
      status: 'SKIPPED',
      recipient: responsibleEmail || null,
      cc: headEmail && isValidEmail(headEmail) ? headEmail : null,
      message: skipMsg
    };
  }

  try {
    var evidenceDisplay = evidenceRef.indexOf('data:image/') === 0 ? '[Attached image preview saved in app]' : evidenceRef;
    var plainBody =
      'FixMyCampus 2.0 - Campus Facility Dispatch Notification\n' +
      '=======================================================\n\n' +
      'Ticket ID:     ' + ticketId + '\n' +
      'Priority:      ' + priority + '\n' +
      'Category:      ' + category + '\n' +
      'Department:    ' + department + '\n' +
      'Location:      ' + locationStr + '\n' +
      'Status:        ' + status + '\n' +
      (assignedTo ? 'Assigned Tech: ' + assignedTo + '\n' : '') +
      'Reporter:      ' + reporterDisplay + '\n' +
      'Timestamp:     ' + timestamp + '\n' +
      (appUrl ? 'App Link:      ' + appUrl + '\n' : '') +
      '\nIssue Summary:\n' + aiSummary + '\n\n' +
      'Full Description:\n' + description + '\n' +
      (evidenceDisplay ? '\nEvidence Reference:\n' + evidenceDisplay + '\n' : '') +
      '\nAction Required: Please inspect and update ticket progress in FixMyCampus.\n\n' +
      '-- FixMyCampus Automated Dispatch System';

    var htmlBody =
      '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">' +
        '<div style="background-color: ' + (priority === 'Critical' ? '#e11d48' : priority === 'High' ? '#ea580c' : '#2563eb') + '; color: #ffffff; padding: 16px 20px;">' +
          '<h2 style="margin: 0; font-size: 18px;">FixMyCampus 2.0 Dispatch Alert</h2>' +
          '<p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Ticket ' + escapeHtml_(ticketId) + ' &bull; ' + escapeHtml_(priority) + ' Priority &bull; ' + escapeHtml_(status) + '</p>' +
        '</div>' +
        '<div style="padding: 20px; background-color: #ffffff; color: #1e293b; font-size: 14px; line-height: 1.5;">' +
          '<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">' +
            '<tr><td style="padding: 6px 0; color: #64748b; width: 135px;"><strong>Category:</strong></td><td>' + escapeHtml_(category) + '</td></tr>' +
            '<tr><td style="padding: 6px 0; color: #64748b;"><strong>Department:</strong></td><td>' + escapeHtml_(department) + '</td></tr>' +
            '<tr><td style="padding: 6px 0; color: #64748b;"><strong>Location:</strong></td><td>' + escapeHtml_(locationStr) + '</td></tr>' +
            (assignedTo ? '<tr><td style="padding: 6px 0; color: #64748b;"><strong>Technician:</strong></td><td><strong>' + escapeHtml_(assignedTo) + '</strong></td></tr>' : '') +
            '<tr><td style="padding: 6px 0; color: #64748b;"><strong>Reporter:</strong></td><td>' + escapeHtml_(opts.isAnonymous ? 'Anonymous Faculty Member' : opts.reporterName) + '</td></tr>' +
            '<tr><td style="padding: 6px 0; color: #64748b;"><strong>Logged At:</strong></td><td>' + escapeHtml_(timestamp) + '</td></tr>' +
          '</table>' +
          '<div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">' +
            '<p style="margin: 0 0 4px; font-weight: bold; color: #0f172a;">Issue Summary:</p>' +
            '<p style="margin: 0; color: #334155;">' + escapeHtml_(aiSummary) + '</p>' +
          '</div>' +
          '<p style="margin: 0 0 6px; font-weight: bold; color: #0f172a;">Full Description:</p>' +
          '<p style="margin: 0 0 16px; color: #334155; white-space: pre-wrap;">' + escapeHtml_(description) + '</p>' +
          (evidenceDisplay ? '<p style="margin: 0 0 6px; font-weight: bold; color: #0f172a;">Evidence Reference:</p><p style="margin: 0 0 16px; word-break: break-all; color: #2563eb;">' + escapeHtml_(evidenceDisplay) + '</p>' : '') +
          (appUrl ? '<p style="margin: 16px 0;"><a href="' + escapeHtml_(appUrl) + '" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 6px; font-weight: bold; font-size: 13px;">Open FixMyCampus Dashboard</a></p>' : '') +
          '<p style="font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">' +
            'Automated dispatch from FixMyCampus 2.0.' +
          '</p>' +
        '</div>' +
      '</div>';

    var mailOptions = {
      to: responsibleEmail,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody
    };

    if (headEmail && isValidEmail(headEmail) && headEmail.toLowerCase() !== responsibleEmail.toLowerCase()) {
      mailOptions.cc = headEmail;
    }

    MailApp.sendEmail(mailOptions);

    var okMsg = 'Email dispatch accepted by MailApp for ' + responsibleEmail + (mailOptions.cc ? ' (CC: ' + mailOptions.cc + ')' : '');
    appendNotificationRow_(notifSheet, {
      ticketId: ticketId,
      timestamp: timestamp,
      department: department,
      recipient: responsibleEmail,
      cc: mailOptions.cc || 'None',
      subject: subject,
      status: 'SENT',
      details: okMsg
    });

    return {
      sent: true,
      status: 'SENT',
      recipient: responsibleEmail,
      cc: mailOptions.cc || null,
      message: okMsg
    };
  } catch (mailErr) {
    var errText = mailErr.toString();
    var isPermErr = errText.toLowerCase().indexOf('permission') !== -1 || errText.toLowerCase().indexOf('sendemail') !== -1;
    var errMsg = 'MailApp error: ' + errText + (isPermErr ? ' — Fix: In Apps Script editor run authorizeMailPermissions(), accept script.send_mail consent, then publish Deploy > Manage deployments > New version.' : '');
    appendNotificationRow_(notifSheet, {
      ticketId: ticketId,
      timestamp: timestamp,
      department: department,
      recipient: responsibleEmail,
      cc: headEmail && isValidEmail(headEmail) ? headEmail : 'None',
      subject: subject,
      status: 'FAILED',
      details: errMsg
    });
    return {
      sent: false,
      status: 'FAILED',
      recipient: responsibleEmail,
      cc: headEmail && isValidEmail(headEmail) ? headEmail : null,
      message: errMsg
    };
  }
}

/**
 * Sends reporter acknowledgement email on ticket creation when valid facultyEmail & opt-in exist.
 */
function dispatchReporterAcknowledgementEmail_(opts) {
  var notifSheet = opts.notifSheet;
  var ticketId = opts.ticketId;
  var timestamp = opts.timestamp || new Date().toISOString();
  var department = opts.department || 'General Administration';
  var facultyEmail = String(opts.facultyEmail || '').replace(/[\r\n\t]/g, '').trim();
  var appUrl = /^https?:\/\/[^\s]+$/i.test(String(opts.appUrl || '').trim()) ? String(opts.appUrl).trim() : '';
  var locationStr = opts.roomNumber ? (opts.roomNumber + ' (' + opts.building + ')') : (opts.building || 'Campus');
  var subject = '[Reporter Ack] FixMyCampus Ticket Logged: ' + ticketId + ' (' + department + ')';

  if (!facultyEmail || !isValidEmail(facultyEmail)) {
    return { sent: false, status: 'SKIPPED', message: 'Invalid or missing reporter email.' };
  }

  try {
    var plainBody =
      'FixMyCampus 2.0 - Issue Submission Confirmation\n' +
      '================================================\n\n' +
      'Hello ' + (opts.reporterName || 'Faculty') + ',\n\n' +
      'Your campus issue report has been logged and routed to ' + department + '.\n\n' +
      'Ticket ID:   ' + ticketId + '\n' +
      'Category:    ' + (opts.category || department) + '\n' +
      'Priority:    ' + (opts.priority || 'Medium') + '\n' +
      'Location:    ' + locationStr + '\n' +
      'Status:      ' + (opts.status || 'Open') + '\n' +
      'Timestamp:   ' + timestamp + '\n' +
      'Summary:     ' + (opts.aiSummary || '') + '\n' +
      (appUrl ? 'Track Issue: ' + appUrl + '\n' : '') +
      '\nThank you,\nFixMyCampus Automated System';

    var htmlBody =
      '<div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">' +
        '<div style="background-color: #0f766e; color: #ffffff; padding: 14px 20px;">' +
          '<h2 style="margin: 0; font-size: 16px;">Ticket Confirmation: ' + escapeHtml_(ticketId) + '</h2>' +
        '</div>' +
        '<div style="padding: 18px 20px; background-color: #ffffff; color: #1e293b; font-size: 14px; line-height: 1.5;">' +
          '<p>Hello <strong>' + escapeHtml_(opts.reporterName || 'Faculty') + '</strong>, your campus facility report has been logged and routed to <strong>' + escapeHtml_(department) + '</strong>.</p>' +
          '<p style="margin: 8px 0;"><strong>Location:</strong> ' + escapeHtml_(locationStr) + '<br/><strong>Priority:</strong> ' + escapeHtml_(opts.priority || 'Medium') + ' &bull; <strong>Status:</strong> ' + escapeHtml_(opts.status || 'Open') + '</p>' +
          '<div style="background-color: #f8fafc; border-left: 4px solid #0f766e; padding: 10px 14px; margin: 12px 0;">' +
            '<p style="margin: 0;">' + escapeHtml_(opts.aiSummary || '') + '</p>' +
          '</div>' +
          (appUrl ? '<p style="margin: 14px 0;"><a href="' + escapeHtml_(appUrl) + '" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:9px 14px;border-radius:6px;font-weight:bold;font-size:13px;">View Ticket Progress</a></p>' : '') +
        '</div>' +
      '</div>';

    MailApp.sendEmail({
      to: facultyEmail,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody
    });

    var okMsg = 'Reporter acknowledgement accepted by MailApp for ' + facultyEmail;
    appendNotificationRow_(notifSheet, {
      ticketId: ticketId,
      timestamp: timestamp,
      department: department,
      recipient: facultyEmail,
      cc: 'None',
      subject: subject,
      status: 'SENT',
      details: okMsg
    });
    return { sent: true, status: 'SENT', recipient: facultyEmail, message: okMsg };
  } catch (err) {
    var errMsg = 'Reporter ack MailApp error: ' + err.toString();
    appendNotificationRow_(notifSheet, {
      ticketId: ticketId,
      timestamp: timestamp,
      department: department,
      recipient: facultyEmail,
      cc: 'None',
      subject: subject,
      status: 'FAILED',
      details: errMsg
    });
    return { sent: false, status: 'FAILED', recipient: facultyEmail, message: errMsg };
  }
}

/**
 * Handles assignment, status transitions, and resolution notifications cleanly without duplicate emails.
 */
function dispatchStatusNotification_(opts) {
  var notifSheet = opts.notifSheet;
  var ticketId = opts.ticketId;
  var timestamp = opts.timestamp || new Date().toISOString();
  var department = opts.department || 'General Administration';
  var prevStatus = opts.previousStatus || 'Open';
  var newStatus = opts.newStatus || 'Open';
  var assignedTo = opts.assignedTo || '';
  var locationStr = opts.roomNumber ? (opts.roomNumber + ' (' + opts.building + ')') : (opts.building || 'Campus');
  var appUrl = /^https?:\/\/[^\s]+$/i.test(String(opts.appUrl || '').trim()) ? String(opts.appUrl).trim() : '';

  var rawRecipients = [];
  var pushValidUnique = function(email) {
    var clean = String(email || '').replace(/[\r\n\t]/g, '').trim();
    if (!clean || !isValidEmail(clean)) return;
    for (var idx = 0; idx < rawRecipients.length; idx++) {
      if (rawRecipients[idx].toLowerCase() === clean.toLowerCase()) return;
    }
    rawRecipients.push(clean);
  };

  if (opts.eventType === 'TECHNICIAN_ASSIGNED') {
    pushValidUnique(opts.technicianEmail);
    pushValidUnique(opts.responsibleEmail);
    if (opts.newStatus !== opts.previousStatus) {
      pushValidUnique(opts.reporterEmail);
    }
  } else {
    pushValidUnique(opts.reporterEmail);
    pushValidUnique(opts.technicianEmail);
    pushValidUnique(opts.responsibleEmail);
  }

  var headEmail = String(opts.headEmail || '').replace(/[\r\n\t]/g, '').trim();
  var ccList = [];
  if (headEmail && isValidEmail(headEmail)) {
    var alreadyInTo = rawRecipients.some(function(r) { return r.toLowerCase() === headEmail.toLowerCase(); });
    if (!alreadyInTo) ccList.push(headEmail);
  }

  var titlePrefix = opts.eventType === 'TECHNICIAN_ASSIGNED'
    ? '[Technician Assigned: ' + assignedTo + '] '
    : opts.eventType === 'TICKET_RESOLUTION'
    ? '[' + newStatus + '] '
    : '[Status Update: ' + prevStatus + ' -> ' + newStatus + '] ';
  var subject = titlePrefix + 'FixMyCampus: ' + ticketId + ' - ' + locationStr;

  if (rawRecipients.length === 0) {
    var skipMsg = 'No valid recipient emails (Department ResponsibleEmail, ReporterEmail, or TechnicianEmail) configured for ' + opts.eventType + ' on ' + ticketId + '.';
    appendNotificationRow_(notifSheet, {
      ticketId: ticketId,
      timestamp: timestamp,
      department: department,
      recipient: 'Unconfigured',
      cc: ccList.length > 0 ? ccList.join(', ') : 'None',
      subject: subject,
      status: 'SKIPPED',
      details: skipMsg
    });
    return { sent: false, status: 'SKIPPED', recipient: null, cc: null, message: skipMsg };
  }

  var primaryTo = rawRecipients[0];
  for (var extraIdx = 1; extraIdx < rawRecipients.length; extraIdx++) {
    ccList.push(rawRecipients[extraIdx]);
  }
  var ccHeader = ccList.length > 0 ? ccList.join(', ') : '';

  var evidenceDisplay = String(opts.evidenceRef || '').indexOf('data:image/') === 0
    ? '[Verification photo stored in FixMyCampus]'
    : String(opts.evidenceRef || '');
  var verificationLabel = opts.eventType === 'TICKET_RESOLUTION'
    ? (opts.isVerified ? 'Verified & Closed' : 'Resolution Logged (Awaiting Final Verification / Closure)')
    : '';

  try {
    var plainBody =
      'FixMyCampus 2.0 - Ticket Lifecycle Update\n' +
      '=========================================\n\n' +
      'Ticket ID:       ' + ticketId + '\n' +
      'Department:      ' + department + '\n' +
      'Location:        ' + locationStr + '\n' +
      'Previous Status: ' + prevStatus + '\n' +
      'New Status:      ' + newStatus + '\n' +
      (assignedTo ? 'Assigned Tech:   ' + assignedTo + '\n' : '') +
      (verificationLabel ? 'Verification:    ' + verificationLabel + '\n' : '') +
      'Timestamp:       ' + timestamp + '\n' +
      (appUrl ? 'App Link:        ' + appUrl + '\n' : '') +
      '\nIssue Summary:\n' + (opts.aiSummary || opts.description || '') + '\n' +
      (opts.resolutionNotes ? '\nResolution Notes:\n' + opts.resolutionNotes + '\n' : '') +
      (evidenceDisplay ? '\nEvidence Details:\n' + evidenceDisplay + '\n' : '') +
      '\n-- FixMyCampus Automated Notification System';

    var htmlBody =
      '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">' +
        '<div style="background-color: #1e293b; color: #ffffff; padding: 14px 20px;">' +
          '<h2 style="margin: 0; font-size: 17px;">FixMyCampus Ticket Update: ' + escapeHtml_(ticketId) + '</h2>' +
          '<p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">' + escapeHtml_(prevStatus) + ' &rarr; <strong>' + escapeHtml_(newStatus) + '</strong></p>' +
        '</div>' +
        '<div style="padding: 18px 20px; background-color: #ffffff; color: #1e293b; font-size: 14px; line-height: 1.5;">' +
          '<table style="width: 100%; border-collapse: collapse; margin-bottom: 12px;">' +
            '<tr><td style="padding: 4px 0; color: #64748b; width: 135px;"><strong>Department:</strong></td><td>' + escapeHtml_(department) + '</td></tr>' +
            '<tr><td style="padding: 4px 0; color: #64748b;"><strong>Location:</strong></td><td>' + escapeHtml_(locationStr) + '</td></tr>' +
            (assignedTo ? '<tr><td style="padding: 4px 0; color: #64748b;"><strong>Technician:</strong></td><td>' + escapeHtml_(assignedTo) + '</td></tr>' : '') +
            (verificationLabel ? '<tr><td style="padding: 4px 0; color: #64748b;"><strong>Verification:</strong></td><td>' + escapeHtml_(verificationLabel) + '</td></tr>' : '') +
            '<tr><td style="padding: 4px 0; color: #64748b;"><strong>Updated At:</strong></td><td>' + escapeHtml_(timestamp) + '</td></tr>' +
          '</table>' +
          '<div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 10px 14px; margin: 12px 0;">' +
            '<p style="margin: 0 0 4px; font-weight: bold;">Summary</p>' +
            '<p style="margin: 0; color: #334155;">' + escapeHtml_(opts.aiSummary || opts.description || '') + '</p>' +
          '</div>' +
          (opts.resolutionNotes ? '<p style="margin: 10px 0 4px; font-weight: bold;">Resolution Notes:</p><p style="margin: 0 0 12px; color: #334155;">' + escapeHtml_(opts.resolutionNotes) + '</p>' : '') +
          (evidenceDisplay ? '<p style="margin: 0 0 4px; font-weight: bold;">Evidence Details:</p><p style="margin: 0 0 12px; word-break: break-all; color: #2563eb;">' + escapeHtml_(evidenceDisplay) + '</p>' : '') +
          (appUrl ? '<p style="margin: 14px 0;"><a href="' + escapeHtml_(appUrl) + '" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:9px 14px;border-radius:6px;font-weight:bold;font-size:13px;">Open FixMyCampus Dashboard</a></p>' : '') +
        '</div>' +
      '</div>';

    var mailOpts = {
      to: primaryTo,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody
    };
    if (ccHeader) {
      mailOpts.cc = ccHeader;
    }

    MailApp.sendEmail(mailOpts);

    var okMsg = opts.eventType + ' email accepted by MailApp for ' + primaryTo + (ccHeader ? ' (CC: ' + ccHeader + ')' : '');
    appendNotificationRow_(notifSheet, {
      ticketId: ticketId,
      timestamp: timestamp,
      department: department,
      recipient: primaryTo,
      cc: ccHeader || 'None',
      subject: subject,
      status: 'SENT',
      details: okMsg
    });
    return { sent: true, status: 'SENT', recipient: primaryTo, cc: ccHeader || null, message: okMsg };
  } catch (err) {
    var errStr = err.toString();
    var isPermErr = errStr.toLowerCase().indexOf('permission') !== -1 || errStr.toLowerCase().indexOf('sendemail') !== -1;
    var errMsg = 'MailApp error: ' + errStr + (isPermErr ? ' — Fix: Run authorizeMailPermissions() in Apps Script editor and publish a New deployment version.' : '');
    appendNotificationRow_(notifSheet, {
      ticketId: ticketId,
      timestamp: timestamp,
      department: department,
      recipient: primaryTo,
      cc: ccHeader || 'None',
      subject: subject,
      status: 'FAILED',
      details: errMsg
    });
    return { sent: false, status: 'FAILED', recipient: primaryTo, cc: ccHeader || null, message: errMsg };
  }
}

function normalizeDeptAlias_(rawName) {
  var cleaned = String(rawName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleaned) return '';
  if (cleaned === 'itavsupport' || cleaned === 'itmultimediaservices') return 'itaudiovisualsupport';
  if (cleaned === 'academicresourcesupplies') return 'classroomsupplies';
  if (cleaned === 'facilitiesphysicalplant') return 'facilitiesmaintenance';
  if (cleaned === 'electricalinfrastructure') return 'electricalmaintenance';
  if (cleaned === 'plumbing' || cleaned === 'plumbingsanitation') return 'plumbingmaintenance';
  if (cleaned === 'custodialhousekeeping') return 'housekeeping';
  if (cleaned === 'campusoperationssafety') return 'generaladministration';
  return cleaned;
}

// -------------------------------------------------------------
// Helper: Department Matching & Fallback (Dynamic Directory Aware)
// -------------------------------------------------------------
function resolveDepartment(data, description, dirList) {
  var descLower = normalizeKeywordText_(description);
  var reqDeptRaw = String(data.department || data.category || '').trim();
  var reqDept = normalizeDeptAlias_(reqDeptRaw);
  var isGenericReq = !reqDept || reqDept === 'generaladministration' || reqDept === 'other' || reqDept === 'general';

  // 1. Direct department match from caller/AI when non-generic (exact normalized match first, then substring)
  if (!isGenericReq) {
    for (var i = 0; i < dirList.length; i++) {
      var dExact = dirList[i];
      var cleanExact = normalizeDeptAlias_(dExact.department);
      if (cleanExact === reqDept) {
        return dExact;
      }
    }
    for (var iSub = 0; iSub < dirList.length; iSub++) {
      var dSub = dirList[iSub];
      var cleanSub = normalizeDeptAlias_(dSub.department);
      if (cleanSub.indexOf(reqDept) !== -1 || reqDept.indexOf(cleanSub) !== -1) {
        return dSub;
      }
    }
  }

  // 2. Scan dynamic keywords configured in DepartmentDirectory first (skip General Administration until fallback)
  for (var j = 0; j < dirList.length; j++) {
    var entry = dirList[j];
    if (entry.department.toLowerCase().indexOf('general') !== -1) continue;
    for (var k = 0; k < entry.keywords.length; k++) {
      var kw = normalizeKeywordText_(entry.keywords[k]);
      if (kw && descLower.indexOf(kw) !== -1) {
        return entry;
      }
    }
  }

  // 3. Authoritative keyword triage fallback
  if (descLower.indexOf('marker') !== -1 || descLower.indexOf('whiteboard') !== -1 || descLower.indexOf('chalk') !== -1 || descLower.indexOf('duster') !== -1 || descLower.indexOf('stationery') !== -1 || descLower.indexOf('eraser') !== -1 || descLower.indexOf('stapler') !== -1) {
    return findInDir(dirList, 'Classroom Supplies') || { department: 'Classroom Supplies', responsibleEmail: '', headEmail: '', keywords: [] };
  }

  if (descLower.indexOf('projector') !== -1 || descLower.indexOf('hdmi') !== -1 || descLower.indexOf('display') !== -1 || descLower.indexOf('speaker') !== -1 || descLower.indexOf('microphone') !== -1 || descLower.indexOf('audio') !== -1 || descLower.indexOf('screen') !== -1 || descLower.indexOf('wifi') !== -1 || descLower.indexOf('internet') !== -1 || descLower.indexOf('crestron') !== -1) {
    return findInDir(dirList, 'IT / Audio-Visual Support') || { department: 'IT / Audio-Visual Support', responsibleEmail: '', headEmail: '', keywords: [] };
  }

  if (descLower.indexOf('electrical') !== -1 || descLower.indexOf('electricity') !== -1 || descLower.indexOf('wire') !== -1 || descLower.indexOf('socket') !== -1 || descLower.indexOf('outlet') !== -1 || descLower.indexOf('spark') !== -1 || descLower.indexOf('power') !== -1 || descLower.indexOf('breaker') !== -1 || descLower.indexOf('shock') !== -1 || descLower.indexOf('ballast') !== -1) {
    return findInDir(dirList, 'Electrical Maintenance') || { department: 'Electrical Maintenance', responsibleEmail: '', headEmail: '', keywords: [] };
  }

  if (descLower.indexOf('plumbing') !== -1 || descLower.indexOf('pipe') !== -1 || descLower.indexOf('faucet') !== -1 || descLower.indexOf('drain') !== -1 || descLower.indexOf('leak') !== -1 || descLower.indexOf('sink') !== -1 || descLower.indexOf('clog') !== -1) {
    var plumbingMatch = findInDir(dirList, 'Plumbing / Maintenance') || findInDir(dirList, 'Facilities / Maintenance') || findInDir(dirList, 'Housekeeping');
    if (plumbingMatch) return plumbingMatch;
    return { department: 'Plumbing / Maintenance', responsibleEmail: '', headEmail: '', keywords: [] };
  }

  if (descLower.indexOf('clean') !== -1 || descLower.indexOf('dirty') !== -1 || descLower.indexOf('trash') !== -1 || descLower.indexOf('garbage') !== -1 || descLower.indexOf('dustbin') !== -1 || descLower.indexOf('washroom') !== -1 || descLower.indexOf('restroom') !== -1 || descLower.indexOf('toilet') !== -1 || descLower.indexOf('spill') !== -1 || descLower.indexOf('odor') !== -1 || descLower.indexOf('smell') !== -1) {
    return findInDir(dirList, 'Housekeeping') || { department: 'Housekeeping', responsibleEmail: '', headEmail: '', keywords: [] };
  }

  if (descLower.indexOf('chair') !== -1 || descLower.indexOf('door') !== -1 || descLower.indexOf('lock') !== -1 || descLower.indexOf('window') !== -1 || descLower.indexOf('broken') !== -1 || descLower.indexOf('table') !== -1 || descLower.indexOf('desk') !== -1 || descLower.indexOf('furniture') !== -1 || descLower.indexOf('hvac') !== -1 || descLower.indexOf('cooling') !== -1 || descLower.indexOf('heating') !== -1) {
    return findInDir(dirList, 'Facilities / Maintenance') || { department: 'Facilities / Maintenance', responsibleEmail: '', headEmail: '', keywords: [] };
  }

  // 4. Fallback: Explicit Manual Review with General Administration
  var generalAdmin = findInDir(dirList, 'General Administration');
  if (generalAdmin) {
    return {
      department: generalAdmin.department,
      responsibleEmail: generalAdmin.responsibleEmail,
      headEmail: generalAdmin.headEmail,
      keywords: generalAdmin.keywords,
      requiresManualReview: true
    };
  }

  return {
    department: 'General Administration',
    responsibleEmail: '',
    headEmail: '',
    keywords: [],
    requiresManualReview: true
  };
}

function findInDir(dirList, name) {
  var target = normalizeDeptAlias_(name);
  if (!target) return null;
  for (var i = 0; i < dirList.length; i++) {
    var dExact = normalizeDeptAlias_(dirList[i].department);
    if (dExact === target) {
      return dirList[i];
    }
  }
  for (var j = 0; j < dirList.length; j++) {
    var dName = normalizeDeptAlias_(dirList[j].department);
    if (dName.indexOf(target) !== -1 || target.indexOf(dName) !== -1) {
      return dirList[j];
    }
  }
  return null;
}

// -------------------------------------------------------------
// Helper: Priority Resolution
// -------------------------------------------------------------
function resolvePriority(data, description) {
  var normalized = normalizePriority_(data.priority);
  if (normalized) {
    return normalized;
  }

  var text = normalizeKeywordText_(description);
  if (text.indexOf('sharp') !== -1 || text.indexOf('spark') !== -1 || text.indexOf('smoke') !== -1 || text.indexOf('fire') !== -1 || text.indexOf('shock') !== -1 || text.indexOf('exposed wire') !== -1 || text.indexOf('bleeding') !== -1 || text.indexOf('slip') !== -1 || text.indexOf('flooding') !== -1 || text.indexOf('shattered') !== -1 || text.indexOf('broken glass') !== -1 || text.indexOf('hazard') !== -1) {
    return 'Critical';
  }
  if (text.indexOf('flicker') !== -1 || text.indexOf('exam') !== -1 || text.indexOf('lecture') !== -1 || text.indexOf('cannot teach') !== -1 || text.indexOf('cut out') !== -1 || text.indexOf('shut down') !== -1 || text.indexOf('blackout') !== -1 || text.indexOf('emergency') !== -1 || text.indexOf('drip') !== -1 || text.indexOf('leak') !== -1 || text.indexOf('stuck') !== -1) {
    return 'High';
  }
  if (text.indexOf('marker') !== -1 || text.indexOf('whiteboard') !== -1 || text.indexOf('chalk') !== -1 || text.indexOf('squeak') !== -1 || text.indexOf('scuff') !== -1) {
    return 'Low';
  }
  return 'Medium';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeCellValue_(val, maxLen) {
  var limit = maxLen || MAX_SHEET_CELL_CHARS;
  var s = String(val === null || val === undefined ? '' : val);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.length <= limit) return s;
  return s.substring(0, limit - 15) + '...[truncated]';
}

function sanitizeEvidenceRef_(val) {
  var s = String(val === null || val === undefined ? '' : val).trim();
  if (!s) return '';
  if (s.length <= MAX_SHEET_CELL_CHARS) return s;
  return '[Attached image reference omitted: exceeds Google Sheets 50k char cell limit]';
}

function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readSheetAsJson(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return [];
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  var headers = rows[0].map(function(h) { return String(h || '').replace(/[\r\n]/g, '').trim(); });
  var result = [];

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var hasContent = row.some(function(v) { return v !== '' && v !== null && v !== undefined; });
    if (!hasContent) continue;

    var item = {};
    for (var col = 0; col < headers.length; col++) {
      var key = headers[col];
      if (!key) continue;
      var val = row[col];
      item[key] = (typeof val === 'string') ? val.trim() : val;
    }
    result.push(item);
  }
  return result;
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// -------------------------------------------------------------
// Sheet Initialization & Header Helpers
// -------------------------------------------------------------
function ensureTicketHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS.Tickets);
  } else {
    validateSheetHeaders_(sheet, HEADERS.Tickets, 'Tickets');
    var lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var normHeaders = rawHeaders.map(function(h) {
        return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      });
      var lastNonEmptyCol = 0;
      for (var i = 0; i < rawHeaders.length; i++) {
        if (String(rawHeaders[i] || '').trim() !== '') {
          lastNonEmptyCol = i + 1;
        }
      }
      if (normHeaders.indexOf('assignedto') === -1 && normHeaders.indexOf('technician') === -1) {
        lastNonEmptyCol += 1;
        sheet.getRange(1, lastNonEmptyCol).setValue('AssignedTo');
        Logger.log('Tickets: appended missing "AssignedTo" header non-destructively at column ' + lastNonEmptyCol + '.');
      }
      if (normHeaders.indexOf('updatedat') === -1) {
        lastNonEmptyCol += 1;
        sheet.getRange(1, lastNonEmptyCol).setValue('UpdatedAt');
        Logger.log('Tickets: appended missing "UpdatedAt" header non-destructively at column ' + lastNonEmptyCol + '.');
      }
    }
  }
}

function appendTicketRow_(sheet, entry) {
  ensureTicketHeaders(sheet);
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.appendRow(HEADERS.Tickets);
    lastCol = HEADERS.Tickets.length;
  }
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h || '').replace(/[\r\n]/g, '').trim();
  });

  var row = [];
  for (var i = 0; i < headers.length; i++) {
    row.push('');
  }

  var setCol = function(aliases, val) {
    var idx = findCol(headers, aliases);
    if (idx !== -1) row[idx] = val;
  };

  setCol(['ticketid', 'ticket id', 'id'], entry.ticketId || '');
  setCol(['createdat', 'created at', 'timestamp'], entry.createdAt || '');
  setCol(['reportername', 'reporter name', 'reporter'], entry.reporterName || '');
  setCol(['isanonymous', 'is anonymous'], !!entry.isAnonymous);
  setCol(['building'], entry.building || '');
  setCol(['roomnumber', 'room number', 'room'], entry.roomNumber || '');
  setCol(['description'], entry.description || '');
  setCol(['aisummary', 'ai summary', 'summary'], entry.aiSummary || '');
  setCol(['category'], entry.category || '');
  setCol(['priority'], entry.priority || '');
  setCol(['department', 'dept'], entry.department || '');
  setCol(['status'], entry.status || '');
  setCol(['duplicateof', 'duplicate of'], entry.duplicateOf || '');
  setCol(['assignedat', 'assigned at'], entry.assignedAt || '');
  setCol(['resolvedat', 'resolved at'], entry.resolvedAt || '');
  setCol(['closedat', 'closed at'], entry.closedAt || '');
  setCol(['resolutionnotes', 'resolution notes', 'notes'], entry.resolutionNotes || '');
  setCol(['evidencereference', 'evidence reference', 'photourl'], entry.evidenceReference || '');
  setCol(['assignedto', 'assigned to', 'technician'], entry.assignedTo || '');
  setCol(['updatedat', 'updated at'], entry.updatedAt || '');

  sheet.appendRow(row);
}

function ensureDepartmentDirectoryHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS.DepartmentDirectory);
    populateDefaultDepartmentDirectory_(sheet);
  } else {
    sanitizeDirectoryHeaders(sheet);
    validateSheetHeaders_(sheet, HEADERS.DepartmentDirectory, 'DepartmentDirectory');
  }
}

function ensureNotificationHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS.NotificationLogs);
  } else {
    validateSheetHeaders_(sheet, HEADERS.NotificationLogs, 'NotificationLogs');
  }
}

/**
 * Appends a notification log row aligned to the sheet's actual header columns.
 * Supports both legacy 7-col schema (Timestamp | TicketID | Recipient | CC | Subject | Result | Details + appended Department)
 * and the canonical 7-col schema (TicketID | Timestamp | Department | Recipient | CC | Status | Details).
 */
function appendNotificationRow_(notifSheet, entry) {
  ensureNotificationHeaders(notifSheet);

  var lastCol = notifSheet.getLastColumn();
  if (lastCol === 0) {
    notifSheet.appendRow(HEADERS.NotificationLogs);
    lastCol = HEADERS.NotificationLogs.length;
  }

  var rawHeaders = notifSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = rawHeaders.map(function(h) {
    return String(h || '').replace(/[\r\n]/g, '').trim();
  });

  var row = [];
  for (var i = 0; i < headers.length; i++) {
    row.push('');
  }

  var ticketIdCol = findCol(headers, ['ticketid', 'ticket id']);
  var timestampCol = findCol(headers, ['timestamp', 'createdat', 'date', 'time']);
  var deptCol = findCol(headers, ['department', 'dept']);
  var recipientCol = findCol(headers, ['recipient', 'responsibleemail', 'to']);
  var ccCol = findCol(headers, ['cc', 'departmentheademail', 'heademail']);
  var subjectCol = findCol(headers, ['subject', 'emailsubject']);
  var statusCol = findCol(headers, ['status', 'dispatchstatus']);
  var resultCol = findCol(headers, ['result', 'dispatchresult']);
  var detailsCol = findCol(headers, ['details', 'message', 'notes']);

  if (ticketIdCol !== -1) row[ticketIdCol] = entry.ticketId || '';
  if (timestampCol !== -1) row[timestampCol] = entry.timestamp || new Date().toISOString();
  if (deptCol !== -1) row[deptCol] = entry.department || '';
  if (recipientCol !== -1) row[recipientCol] = entry.recipient || '';
  if (ccCol !== -1) row[ccCol] = entry.cc || '';
  if (subjectCol !== -1) row[subjectCol] = sanitizeCellValue_(entry.subject || '', 500);
  if (statusCol !== -1) row[statusCol] = entry.status || '';
  if (resultCol !== -1) row[resultCol] = entry.status || '';
  if (detailsCol !== -1) row[detailsCol] = sanitizeCellValue_(entry.details || '', 5000);

  notifSheet.appendRow(row);
}

function ensureResolutionEvidenceHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS.ResolutionEvidence);
  } else {
    validateSheetHeaders_(sheet, HEADERS.ResolutionEvidence, 'ResolutionEvidence');
  }
}

/**
 * Appends a ResolutionEvidence row aligned to the sheet's actual header columns.
 * Authoritative 7-column schema: EvidenceID | TicketID | EvidenceType | EvidenceReference | Notes | SubmittedAt | SubmittedBy
 */
function appendEvidenceRow_(evidenceSheet, entry) {
  ensureResolutionEvidenceHeaders(evidenceSheet);

  var lastCol = evidenceSheet.getLastColumn();
  if (lastCol === 0) {
    evidenceSheet.appendRow(HEADERS.ResolutionEvidence);
    lastCol = HEADERS.ResolutionEvidence.length;
  }

  var headers = evidenceSheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h || '').replace(/[\r\n]/g, '').trim();
  });

  var row = [];
  for (var i = 0; i < headers.length; i++) {
    row.push('');
  }

  var setCol = function(aliases, val) {
    var idx = findCol(headers, aliases);
    if (idx !== -1) row[idx] = val;
  };

  setCol(['evidenceid', 'id'], entry.evidenceId || '');
  setCol(['ticketid', 'ticket id'], entry.ticketId || '');
  setCol(['evidencetype', 'type'], entry.evidenceType || '');
  setCol(['evidencereference', 'photourl', 'url', 'reference'], entry.evidenceReference || '');
  setCol(['notes', 'note', 'resolutionnotes'], entry.notes || '');
  setCol(['submittedat', 'timestamp', 'date'], entry.submittedAt || new Date().toISOString());
  setCol(['submittedby', 'actor', 'user', 'technician'], entry.submittedBy || 'Technician / Staff');

  evidenceSheet.appendRow(row);
}

function ensureAuditHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS.AuditLogs);
  } else {
    validateSheetHeaders_(sheet, HEADERS.AuditLogs, 'AuditLogs');
  }
}

function populateDefaultDepartmentDirectory_(sheet) {
  sheet.appendRow(['IT / Audio-Visual Support', 'projector, hdmi, display, audio, mic, screen, sound', 'IT / AV Coordinator', '', '', true]);
  sheet.appendRow(['Classroom Supplies', 'marker, whiteboard, eraser, chalk, duster, stationery, paper', 'Supplies Coordinator', '', '', true]);
  sheet.appendRow(['Facilities / Maintenance', 'chair, desk, door, window, table, furniture, ac, blinds, hvac', 'Facilities Lead', '', '', true]);
  sheet.appendRow(['Electrical Maintenance', 'electrical, spark, wire, socket, switch, power, breaker, light', 'Electrical Supervisor', '', '', true]);
  sheet.appendRow(['Plumbing / Maintenance', 'plumbing, pipe, faucet, drain, leak, sink, clog', 'Plumbing Supervisor', '', '', true]);
  sheet.appendRow(['Housekeeping', 'clean, dirty, trash, garbage, spill, washroom, toilet, restroom, floor', 'Custodial Supervisor', '', '', true]);
  sheet.appendRow(['General Administration', 'admin, policy, schedule, access, complaint, other, lost, found', 'Campus Operations Admin', '', '', true]);
}
