/**
 * FixMyCampus 2.0 - Production Google Apps Script Web App Backend
 * 
 * SPREADSHEET INITIALIZATION:
 *   When deployed as a Web App, SpreadsheetApp.getActiveSpreadsheet() can return null
 *   if the script runs in a standalone context or without an active container binding.
 *   
 *   To configure:
 *   1. Locate your Google Sheet URL in your browser:
 *      https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
 *   2. Copy the ID between /d/ and /edit (e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms)
 *   3. Paste it into SPREADSHEET_ID below.
 *   4. Deploy: Deploy > Manage deployments > Edit > New version > Deploy.
 */

// =============================================================
// CONFIGURATION: Set your Google Sheet Spreadsheet ID here
// =============================================================
var SPREADSHEET_ID = 'REPLACE_WITH_YOUR_SPREADSHEET_ID';

// =============================================================
// AUTHORITATIVE SHEET SCHEMAS (HEADERS)
// =============================================================
var HEADERS = {
  Tickets: [
    'TicketID', 'CreatedAt', 'ReporterName', 'IsAnonymous', 'Building',
    'RoomNumber', 'Description', 'AISummary', 'Category', 'Priority',
    'Department', 'Status', 'DuplicateOf', 'AssignedAt', 'ResolvedAt',
    'ClosedAt', 'ResolutionNotes', 'EvidenceReference'
  ],
  DepartmentDirectory: [
    'Department', 'Keywords', 'ResponsibleName', 'ResponsibleEmail',
    'DepartmentHeadEmail', 'Active'
  ],
  NotificationLogs: [
    'TicketID', 'Timestamp', 'Department', 'Recipient', 'CC', 'Status', 'Details'
  ],
  ResolutionEvidence: [
    'EvidenceID', 'TicketID', 'EvidenceType', 'EvidenceReference', 'Notes', 'SubmittedAt', 'SubmittedBy'
  ],
  AuditLogs: [
    'TicketID', 'Timestamp', 'Action', 'Actor', 'Target', 'Details'
  ]
};

/**
 * Robust spreadsheet getter with fallback to getActiveSpreadsheet()
 */
function getSpreadsheet() {
  var ss = null;

  // 1. Try opening via explicit SPREADSHEET_ID constant
  if (SPREADSHEET_ID && SPREADSHEET_ID !== 'REPLACE_WITH_YOUR_SPREADSHEET_ID' && SPREADSHEET_ID.trim() !== '') {
    try {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID.trim());
    } catch (err) {
      console.warn('SpreadsheetApp.openById failed: ' + err.toString());
    }
  }

  // 2. Fallback to active spreadsheet if container-bound
  if (!ss) {
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (err) {
      console.warn('SpreadsheetApp.getActiveSpreadsheet failed: ' + err.toString());
    }
  }

  return ss;
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
    var hasNotes = normalizedActual.indexOf('notes') !== -1 || normalizedActual.indexOf('note') !== -1;
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

  // General validation for other sheets
  var missing = [];
  for (var i = 0; i < expectedHeaders.length; i++) {
    var exp = expectedHeaders[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    var found = false;
    for (var j = 0; j < normalizedActual.length; j++) {
      if (normalizedActual[j] === exp || normalizedActual[j].indexOf(exp) !== -1 || exp.indexOf(normalizedActual[j]) !== -1) {
        found = true;
        break;
      }
    }
    // Only fail if core primary columns are completely absent
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
  var sheetNames = ['Tickets', 'DepartmentDirectory', 'NotificationLogs', 'ResolutionEvidence', 'AuditLogs'];

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
        validateSheetHeaders_(sheet, expectedHeaders, name);
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
 * Setup and verify all 5 FixMyCampus sheets without overwriting existing data.
 * Safe, backward-compatible, and normalizes headers case-insensitively.
 * Run this function from the Apps Script editor to initialize or verify tabs.
 */
function setupFixMyCampus() {
  var ss = getSpreadsheet();
  var result = ensureSheets_(ss);
  Logger.log('FixMyCampus 2.0 setup verified: ' + result.verifiedSheets.join(', '));
  return result;
}

// -------------------------------------------------------------
// GET Request Handler
// -------------------------------------------------------------
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'health';

    // Health check returns status immediately
    if (action === 'health') {
      var testSs = getSpreadsheet();
      return createJsonResponse({
        success: true,
        message: 'FixMyCampus Backend V2 is running.',
        spreadsheetConnected: !!testSs,
        spreadsheetIdConfigured: (SPREADSHEET_ID && SPREADSHEET_ID !== 'REPLACE_WITH_YOUR_SPREADSHEET_ID'),
        timestamp: new Date().toISOString()
      });
    }

    var ss = getSpreadsheet();
    if (!ss) {
      return createJsonResponse({
        success: false,
        message: 'Spreadsheet context missing: SpreadsheetApp.getActiveSpreadsheet() returned null. Please configure your SPREADSHEET_ID at the top of Code.gs (e.g. var SPREADSHEET_ID = "YOUR_SPREADSHEET_ID_HERE");).'
      });
    }

    if (action === 'getTickets') {
      var ticketsSheet = ss.getSheetByName('Tickets');
      if (!ticketsSheet) {
        return createJsonResponse({ success: true, tickets: [] });
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
      return createJsonResponse({
        success: true,
        departments: readSheetAsJson(dirSheet)
      });
    }

    if (action === 'getNotificationLogs') {
      var notifSheet = ss.getSheetByName('NotificationLogs');
      return createJsonResponse({
        success: true,
        notificationLogs: readSheetAsJson(notifSheet)
      });
    }

    if (action === 'getAuditLogs') {
      var auditSheet = ss.getSheetByName('AuditLogs');
      return createJsonResponse({
        success: true,
        auditLogs: readSheetAsJson(auditSheet)
      });
    }

    if (action === 'getEvidence') {
      var evidenceSheet = ss.getSheetByName('ResolutionEvidence');
      if (!evidenceSheet) {
        return createJsonResponse({ success: true, evidence: [] });
      }
      var rawEvidence = readSheetAsJson(evidenceSheet);
      var formattedEvidence = rawEvidence.map(function(item) {
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

      return createJsonResponse({
        success: true,
        evidence: formattedEvidence
      });
    }

    if (action === 'getLogs') {
      var nSheet = ss.getSheetByName('NotificationLogs');
      var aSheet = ss.getSheetByName('AuditLogs');
      var eSheet = ss.getSheetByName('ResolutionEvidence');
      var rawEvidenceList = eSheet ? readSheetAsJson(eSheet) : [];
      var formattedEvidenceList = rawEvidenceList.map(function(item) {
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

      return createJsonResponse({
        success: true,
        notificationLogs: nSheet ? readSheetAsJson(nSheet) : [],
        auditLogs: aSheet ? readSheetAsJson(aSheet) : [],
        evidence: formattedEvidenceList
      });
    }

    return createJsonResponse({ success: false, message: 'Unknown GET action: ' + action });
  } catch (err) {
    return createJsonResponse({ success: false, message: err.toString() });
  }
}

// -------------------------------------------------------------
// POST Request Handler
// -------------------------------------------------------------
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ success: false, message: 'No post data received.' });
    }

    var data = JSON.parse(e.postData.contents);
    var ss = getSpreadsheet();
    if (!ss) {
      return createJsonResponse({
        success: false,
        message: 'Spreadsheet context missing: SpreadsheetApp.getActiveSpreadsheet() returned null. Please configure your SPREADSHEET_ID at the top of Code.gs.'
      });
    }

    if (data.action === 'createTicket') {
      return handleCreateTicket(data, ss);
    }

    if (data.action === 'updateStatus') {
      return handleUpdateStatus(data, ss);
    }

    if (data.action === 'addEvidence') {
      return handleAddEvidence(data, ss);
    }

    if (data.action === 'syncAll') {
      return handleSyncAll(data, ss);
    }

    return createJsonResponse({ success: false, message: 'Unknown POST action: ' + data.action });
  } catch (err) {
    return createJsonResponse({ success: false, message: err.toString() });
  }
}

// -------------------------------------------------------------
// Action: Create Ticket with Department Matching & Real Email Dispatch
// -------------------------------------------------------------
function handleCreateTicket(data, ss) {
  var description = (data.description || data.issueDescription || '').trim();
  if (!description) {
    return createJsonResponse({ success: false, message: 'Description is required.' });
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

  // 1. Authoritative Department & Category Resolution
  var resolvedDept = resolveDepartment(data, description, dirInfo);
  var department = resolvedDept.department;
  var category = resolvedDept.department;

  // 2. Priority Resolution
  var priority = resolvePriority(data, description);

  // 3. Authoritative Ticket ID
  var ticketId = (data.ticketId && String(data.ticketId).startsWith('FMC-'))
    ? data.ticketId
    : 'FMC-' + Utilities.getUuid().substring(0, 8).toUpperCase();

  var now = new Date().toISOString();
  var reporterName = data.isAnonymous ? 'Anonymous Faculty' : (data.facultyName || data.reporterName || 'Faculty');
  var isAnonymous = !!data.isAnonymous;
  var building = data.building || '';
  var roomNumber = data.roomNumber || '';
  var aiSummary = (data.aiSummary || description).substring(0, 150);
  var evidenceRef = data.photoUrl || data.evidenceReference || '';

  // 4. Save to Tickets sheet
  ticketsSheet.appendRow([
    ticketId,
    now,
    reporterName,
    isAnonymous,
    building,
    roomNumber,
    description,
    aiSummary,
    category,
    priority,
    department,
    'Open',
    data.duplicateOf || '',
    now, // AssignedAt
    '',  // ResolvedAt
    '',  // ClosedAt
    '',  // ResolutionNotes
    evidenceRef
  ]);

  // 5. Email Notification Dispatch
  var responsibleEmail = (resolvedDept.responsibleEmail || '').replace(/[
	]/g, '').trim();
  var headEmail = (resolvedDept.headEmail || '').replace(/[
	]/g, '').trim();
  var notifResult = { sent: false, status: 'SKIPPED', message: 'No responsible email configured' };

  if (responsibleEmail && isValidEmail(responsibleEmail)) {
    try {
      var subject = '[' + priority + ' Priority Alert] FixMyCampus: ' + (roomNumber ? roomNumber + ' (' + building + ')' : building) + ' - ' + department + ' (' + ticketId + ')';

      var plainBody = 
        'FixMyCampus 2.0 - Urgent Facility Incident Notification\n' +
        '=======================================================\n\n' +
        'Ticket ID:    ' + ticketId + '\n' +
        'Priority:     ' + priority + '\n' +
        'Department:   ' + department + '\n' +
        'Location:     ' + (roomNumber ? roomNumber + ' (' + building + ')' : building) + '\n' +
        'Reporter:     ' + (isAnonymous ? 'Anonymous Faculty Member' : reporterName + (data.facultyEmail ? ' (' + data.facultyEmail + ')' : '')) + '\n' +
        'Reported At:  ' + now + '\n\n' +
        'Issue Summary:\n' + aiSummary + '\n\n' +
        'Full Description:\n' + description + '\n' +
        (evidenceRef ? '\nPhoto Reference / Evidence:\n' + evidenceRef + '\n' : '') +
        '\nStatus: Assigned for Dispatch\n' +
        'Action Required: Please review this ticket and dispatch a qualified technician.\n\n' +
        '-- FixMyCampus Automated Dispatch System';

      var htmlBody = 
        '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">' +
          '<div style="background-color: ' + (priority === 'Critical' ? '#e11d48' : priority === 'High' ? '#ea580c' : '#2563eb') + '; color: #ffffff; padding: 16px 20px;">' +
            '<h2 style="margin: 0; font-size: 18px;">FixMyCampus 2.0 Dispatch Alert</h2>' +
            '<p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">Ticket ' + ticketId + ' &bull; ' + priority + ' Priority</p>' +
          '</div>' +
          '<div style="padding: 20px; background-color: #ffffff; color: #1e293b; font-size: 14px; line-height: 1.5;">' +
            '<table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">' +
              '<tr><td style="padding: 6px 0; color: #64748b; width: 130px;"><strong>Department:</strong></td><td>' + department + '</td></tr>' +
              '<tr><td style="padding: 6px 0; color: #64748b;"><strong>Location:</strong></td><td>' + (roomNumber ? roomNumber + ' (' + building + ')' : building) + '</td></tr>' +
              '<tr><td style="padding: 6px 0; color: #64748b;"><strong>Reporter:</strong></td><td>' + (isAnonymous ? 'Anonymous Faculty Member' : reporterName) + '</td></tr>' +
              '<tr><td style="padding: 6px 0; color: #64748b;"><strong>Reported At:</strong></td><td>' + now + '</td></tr>' +
            '</table>' +
            '<div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">' +
              '<p style="margin: 0 0 4px; font-weight: bold; color: #0f172a;">Issue Summary:</p>' +
              '<p style="margin: 0; color: #334155;">' + aiSummary + '</p>' +
            '</div>' +
            '<p style="margin: 0 0 6px; font-weight: bold; color: #0f172a;">Full Description:</p>' +
            '<p style="margin: 0 0 16px; color: #334155; white-space: pre-wrap;">' + description + '</p>' +
            (evidenceRef ? '<p style="margin: 0 0 6px; font-weight: bold; color: #0f172a;">Evidence Reference:</p><p style="margin: 0 0 16px; word-break: break-all; color: #2563eb;">' + evidenceRef + '</p>' : '') +
            '<p style="font-size: 12px; color: #94a3b8; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 12px;">' +
              'This is an automated dispatch from FixMyCampus. Technician response is required.' +
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

      notifResult = {
        sent: true,
        status: 'SENT',
        recipient: responsibleEmail,
        cc: mailOptions.cc || null,
        message: 'Email delivered to ' + responsibleEmail + (mailOptions.cc ? ' (CC: ' + mailOptions.cc + ')' : '')
      };

      notifSheet.appendRow([
        ticketId,
        now,
        department,
        responsibleEmail,
        mailOptions.cc || 'None',
        'SENT',
        notifResult.message
      ]);
    } catch (mailErr) {
      notifResult = {
        sent: false,
        status: 'FAILED',
        recipient: responsibleEmail,
        cc: headEmail || null,
        message: 'MailApp error: ' + mailErr.toString()
      };

      notifSheet.appendRow([
        ticketId,
        now,
        department,
        responsibleEmail,
        headEmail || 'None',
        'FAILED',
        mailErr.toString()
      ]);
    }
  } else {
    notifResult = {
      sent: false,
      status: 'SKIPPED',
      message: 'ResponsibleEmail is not configured in DepartmentDirectory.'
    };

    notifSheet.appendRow([
      ticketId,
      now,
      department,
      'N/A',
      'N/A',
      'SKIPPED',
      'ResponsibleEmail is not configured in DepartmentDirectory.'
    ]);
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
    auditDetails
  ]);

  return createJsonResponse({
    success: true,
    ticketId: ticketId,
    status: 'Open',
    category: category,
    priority: priority,
    department: department,
    requiresManualReview: !!resolvedDept.requiresManualReview,
    notification: notifResult
  });
}

// -------------------------------------------------------------
// Action: Update Ticket Status & Record Resolution Evidence
// -------------------------------------------------------------
function handleUpdateStatus(data, ss) {
  var ticketId = data.ticketId;
  var status = data.status;
  if (!ticketId || !status) {
    return createJsonResponse({ success: false, message: 'ticketId and status are required.' });
  }

  var ticketsSheet = ss.getSheetByName('Tickets');
  if (!ticketsSheet) {
    return createJsonResponse({ success: false, message: 'Tickets sheet not found.' });
  }

  var rows = ticketsSheet.getDataRange().getValues();
  var headers = rows[0].map(function(h) { return String(h).trim(); });
  var idCol = findCol(headers, ['ticketid', 'ticket id', 'id']);
  var statusCol = findCol(headers, ['status']);
  var resolvedAtCol = findCol(headers, ['resolvedat', 'resolved at']);
  var closedAtCol = findCol(headers, ['closedat', 'closed at']);
  var notesCol = findCol(headers, ['resolutionnotes', 'resolution notes', 'notes']);
  var evidenceCol = findCol(headers, ['evidencereference', 'evidence reference', 'photourl']);

  if (idCol === -1 || statusCol === -1) {
    return createJsonResponse({ success: false, message: 'Required columns not found in Tickets sheet.' });
  }

  var rowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]).trim().toUpperCase() === String(ticketId).trim().toUpperCase()) {
      rowIndex = i + 1; // 1-indexed for Sheets API
      break;
    }
  }

  if (rowIndex === -1) {
    return createJsonResponse({ success: false, message: 'Ticket ID ' + ticketId + ' not found in sheet.' });
  }

  var now = new Date().toISOString();
  ticketsSheet.getRange(rowIndex, statusCol + 1).setValue(status);

  if (status === 'Resolved' && resolvedAtCol !== -1) {
    ticketsSheet.getRange(rowIndex, resolvedAtCol + 1).setValue(now);
  }
  if (status === 'Closed' && closedAtCol !== -1) {
    ticketsSheet.getRange(rowIndex, closedAtCol + 1).setValue(now);
  }
  if (data.resolutionNotes && notesCol !== -1) {
    ticketsSheet.getRange(rowIndex, notesCol + 1).setValue(data.resolutionNotes);
  }
  if (data.evidenceReference && evidenceCol !== -1) {
    ticketsSheet.getRange(rowIndex, evidenceCol + 1).setValue(data.evidenceReference);
  }

  // Record evidence in ResolutionEvidence sheet using 7-column schema:
  // EvidenceID | TicketID | EvidenceType | EvidenceReference | Notes | SubmittedAt | SubmittedBy
  if (data.resolutionNotes || data.evidenceReference || status === 'Resolved' || status === 'Closed') {
    var evidenceSheet = ss.getSheetByName('ResolutionEvidence') || ss.insertSheet('ResolutionEvidence');
    ensureResolutionEvidenceHeaders(evidenceSheet);
    var evId = 'EVD-' + Utilities.getUuid().substring(0, 8).toUpperCase();
    var evType = data.evidenceReference ? 'Photo Verification' : 'Technician Resolution Note';
    var evRef = data.evidenceReference || 'N/A';
    var evNotes = data.resolutionNotes || ('Status transitioned to ' + status);
    var evBy = data.updatedBy || 'Technician / Staff';

    evidenceSheet.appendRow([
      evId,
      ticketId,
      evType,
      evRef,
      evNotes,
      now,
      evBy
    ]);
  }

  // Record Audit Log
  var auditSheet = ss.getSheetByName('AuditLogs');
  if (auditSheet) {
    auditSheet.appendRow([
      ticketId,
      now,
      'STATUS_CHANGE',
      data.updatedBy || 'Staff',
      status,
      'Ticket status changed to ' + status + (data.resolutionNotes ? ' - Notes: ' + data.resolutionNotes : '')
    ]);
  }

  return createJsonResponse({
    success: true,
    message: 'Ticket ' + ticketId + ' status updated to ' + status
  });
}

// -------------------------------------------------------------
// Action: Explicit Add Evidence
// -------------------------------------------------------------
function handleAddEvidence(data, ss) {
  var ticketId = data.ticketId;
  if (!ticketId) {
    return createJsonResponse({ success: false, message: 'ticketId is required.' });
  }

  var evidenceSheet = ss.getSheetByName('ResolutionEvidence') || ss.insertSheet('ResolutionEvidence');
  ensureResolutionEvidenceHeaders(evidenceSheet);

  var evidenceId = (data.evidenceId && String(data.evidenceId).startsWith('EVD-'))
    ? data.evidenceId
    : 'EVD-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  var now = new Date().toISOString();
  var evidenceType = data.evidenceType || (data.evidenceReference || data.photoUrl ? 'Photo Verification' : 'Resolution Note');
  var evidenceReference = data.evidenceReference || data.photoUrl || '';
  var notes = data.notes || data.resolutionNotes || data.note || '';
  var submittedAt = data.submittedAt || data.timestamp || now;
  var submittedBy = data.submittedBy || data.actor || data.updatedBy || 'Technician / Staff';

  // 7-column schema: EvidenceID | TicketID | EvidenceType | EvidenceReference | Notes | SubmittedAt | SubmittedBy
  evidenceSheet.appendRow([
    evidenceId,
    ticketId,
    evidenceType,
    evidenceReference,
    notes,
    submittedAt,
    submittedBy
  ]);

  var auditSheet = ss.getSheetByName('AuditLogs') || ss.insertSheet('AuditLogs');
  ensureAuditHeaders(auditSheet);
  auditSheet.appendRow([
    ticketId,
    now,
    'SUBMIT_EVIDENCE',
    submittedBy,
    evidenceType,
    'Evidence ' + evidenceId + ' recorded: ' + (notes ? notes.substring(0, 80) : 'Verification attached')
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

  var ticketsSheet = ss.getSheetByName('Tickets') || ss.insertSheet('Tickets');
  ensureTicketHeaders(ticketsSheet);

  var existingRows = ticketsSheet.getDataRange().getValues();
  var existingIds = {};
  if (existingRows.length > 1) {
    var headers = existingRows[0].map(function(h) { return String(h).trim(); });
    var idCol = findCol(headers, ['ticketid', 'ticket id', 'id']);
    if (idCol !== -1) {
      for (var i = 1; i < existingRows.length; i++) {
        existingIds[String(existingRows[i][idCol]).trim().toUpperCase()] = true;
      }
    }
  }

  var added = 0;
  for (var j = 0; j < tickets.length; j++) {
    var t = tickets[j];
    var tId = (t.id || t.ticketId || '').toUpperCase();
    if (!existingIds[tId]) {
      ticketsSheet.appendRow([
        t.id || t.ticketId,
        t.reportedAt || t.timestamp || new Date().toISOString(),
        t.isAnonymous ? 'Anonymous Faculty' : (t.facultyName || 'Faculty'),
        !!t.isAnonymous,
        t.building || '',
        t.roomNumber || t.room || '',
        t.description || '',
        t.aiSummary || t.summary || '',
        t.category || '',
        t.priority || 'Medium',
        t.recommendedDepartment || t.department || '',
        t.status || 'Open',
        t.isDuplicateOf || '',
        t.reportedAt || new Date().toISOString(),
        t.resolution ? t.resolution.resolvedAt : '',
        '',
        t.resolution ? t.resolution.notes : '',
        t.photoUrl || ''
      ]);
      added++;
    }
  }

  return createJsonResponse({
    success: true,
    message: 'Sync completed. Added ' + added + ' new tickets to Google Sheets.'
  });
}

// -------------------------------------------------------------
// Helper: Department Directory Loader & Sanitizer
// -------------------------------------------------------------
function sanitizeDirectoryHeaders(dirSheet) {
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
  var kwIdx = findCol(headers, ['keywords', 'keyword']);
  var respNameIdx = findCol(headers, ['responsiblename', 'responsible_name', 'contact_name']);
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

function findCol(headers, aliases) {
  var cleanHeaders = headers.map(function(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  });

  for (var i = 0; i < cleanHeaders.length; i++) {
    var h = cleanHeaders[i];
    for (var a = 0; a < aliases.length; a++) {
      var alias = aliases[a].toLowerCase().replace(/[^a-z0-9]/g, '');
      if (h === alias || h.indexOf(alias) !== -1 || alias.indexOf(h) !== -1) {
        return i;
      }
    }
  }
  return -1;
}

// -------------------------------------------------------------
// Helper: Department Matching & Fallback
// -------------------------------------------------------------
function resolveDepartment(data, description, dirList) {
  var descLower = description.toLowerCase();
  var reqDept = (data.department || data.category || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // 1. Direct department match from user / AI selection if present in directory
  if (reqDept) {
    for (var i = 0; i < dirList.length; i++) {
      var d = dirList[i];
      var cleanD = d.department.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanD === reqDept || cleanD.indexOf(reqDept) !== -1 || reqDept.indexOf(cleanD) !== -1) {
        return d;
      }
    }
  }

  // 2. High-priority specific keyword triage before broad terms
  // Supplies: markers, whiteboard, chalk, duster, eraser
  if (descLower.indexOf('marker') !== -1 || descLower.indexOf('whiteboard') !== -1 || descLower.indexOf('chalk') !== -1 || descLower.indexOf('duster') !== -1 || descLower.indexOf('stationery') !== -1) {
    var supplies = findInDir(dirList, 'Classroom Supplies');
    if (supplies) return supplies;
  }

  // IT / Audio-Visual: projector, hdmi, display, audio, speaker, mic
  if (descLower.indexOf('projector') !== -1 || descLower.indexOf('hdmi') !== -1 || descLower.indexOf('display') !== -1 || descLower.indexOf('speaker') !== -1 || descLower.indexOf('microphone') !== -1 || descLower.indexOf('audio') !== -1) {
    var it = findInDir(dirList, 'IT / Audio-Visual Support');
    if (it) return it;
  }

  // Electrical: spark, wire, socket, switch, breaker, electrical
  if (descLower.indexOf('electrical') !== -1 || descLower.indexOf('wire') !== -1 || descLower.indexOf('socket') !== -1 || descLower.indexOf('spark') !== -1 || descLower.indexOf('power outlet') !== -1) {
    var elec = findInDir(dirList, 'Electrical Maintenance');
    if (elec) return elec;
  }

  // Housekeeping: cleaning, dirty, trash, leak, washroom, toilet, restroom
  if (descLower.indexOf('clean') !== -1 || descLower.indexOf('dirty') !== -1 || descLower.indexOf('trash') !== -1 || descLower.indexOf('leak') !== -1 || descLower.indexOf('washroom') !== -1 || descLower.indexOf('toilet') !== -1 || descLower.indexOf('spill') !== -1) {
    var house = findInDir(dirList, 'Housekeeping');
    if (house) return house;
  }

  // Facilities / Maintenance: chair, table, desk, door, window, broken, furniture
  if (descLower.indexOf('chair') !== -1 || descLower.indexOf('door') !== -1 || descLower.indexOf('window') !== -1 || descLower.indexOf('broken') !== -1 || descLower.indexOf('table') !== -1 || descLower.indexOf('desk') !== -1 || descLower.indexOf('furniture') !== -1) {
    var fac = findInDir(dirList, 'Facilities / Maintenance');
    if (fac) return fac;
  }

  // 3. Scan directory keywords configured in DepartmentDirectory
  for (var j = 0; j < dirList.length; j++) {
    var entry = dirList[j];
    for (var k = 0; k < entry.keywords.length; k++) {
      var kw = entry.keywords[k];
      if (kw && descLower.indexOf(kw) !== -1) {
        return entry;
      }
    }
  }

  // 4. Fallback: Explicit Manual Review instead of silent arbitrary department assignment
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
    responsibleEmail: (dirList.length > 0 ? dirList[0].responsibleEmail : ''),
    headEmail: '',
    keywords: [],
    requiresManualReview: true
  };
}

function findInDir(dirList, name) {
  var target = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (var i = 0; i < dirList.length; i++) {
    var dName = dirList[i].department.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (dName === target || dName.indexOf(target) !== -1 || target.indexOf(dName) !== -1) {
      return dirList[i];
    }
  }
  return null;
}

// -------------------------------------------------------------
// Helper: Priority Resolution
// -------------------------------------------------------------
function resolvePriority(data, description) {
  if (data.priority && ['Low', 'Medium', 'High', 'Critical'].indexOf(data.priority) !== -1) {
    return data.priority;
  }

  var text = description.toLowerCase();
  if (text.indexOf('sharp') !== -1 || text.indexOf('spark') !== -1 || text.indexOf('smoke') !== -1 || text.indexOf('shock') !== -1 || text.indexOf('hazard') !== -1) {
    return 'Critical';
  }
  if (text.indexOf('flicker') !== -1 || text.indexOf('exam') !== -1 || text.indexOf('lecture') !== -1 || text.indexOf('leak') !== -1) {
    return 'High';
  }
  if (text.indexOf('marker') !== -1 || text.indexOf('whiteboard') !== -1 || text.indexOf('chalk') !== -1) {
    return 'Low';
  }
  return 'Medium';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readSheetAsJson(sheet) {
  if (!sheet) return [];
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
  }
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

function ensureResolutionEvidenceHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS.ResolutionEvidence);
  } else {
    validateSheetHeaders_(sheet, HEADERS.ResolutionEvidence, 'ResolutionEvidence');
  }
}

function ensureAuditHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS.AuditLogs);
  } else {
    validateSheetHeaders_(sheet, HEADERS.AuditLogs, 'AuditLogs');
  }
}

function populateDefaultDepartmentDirectory_(sheet) {
  sheet.appendRow(['IT / Audio-Visual Support', 'projector, hdmi, display, audio, mic, screen, sound', 'Pushpendra Singh', 'singhpushpendra092006@gmail.com', 'singhpushpendra092006@gmail.com', true]);
  sheet.appendRow(['Classroom Supplies', 'marker, whiteboard, eraser, chalk, duster, stationery, paper', 'Pushpendra Singh', 'singhpushpendra092006@gmail.com', 'singhpushpendra092006@gmail.com', true]);
  sheet.appendRow(['Facilities / Maintenance', 'chair, desk, door, window, table, furniture, ac, blinds', 'Pushpendra Singh', 'singhpushpendra092006@gmail.com', 'singhpushpendra092006@gmail.com', true]);
  sheet.appendRow(['Electrical Maintenance', 'electrical, spark, wire, socket, switch, power, breaker, light', 'Pushpendra Singh', 'singhpushpendra092006@gmail.com', 'singhpushpendra092006@gmail.com', true]);
  sheet.appendRow(['Housekeeping', 'clean, dirty, trash, leak, spill, washroom, toilet, restroom, floor', 'Pushpendra Singh', 'singhpushpendra092006@gmail.com', 'singhpushpendra092006@gmail.com', true]);
  sheet.appendRow(['General Administration', 'admin, policy, schedule, access, complaint, other, lost, found', 'Pushpendra Singh', 'singhpushpendra092006@gmail.com', 'singhpushpendra092006@gmail.com', true]);
}
