// Heart of Texas Organics — Coming Soon Signup
// Deploy this in Google Apps Script as a Web App:
//   1. Go to script.google.com → New Project
//   2. Paste this code, replacing SHEET_ID with your Google Sheet ID
//   3. Click Deploy → New Deployment → Web App
//      Execute as: Me
//      Who has access: Anyone
//   4. Copy the Web App URL and paste it into coming-soon.html
//      where it says YOUR_GOOGLE_APPS_SCRIPT_URL_HERE

const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';

function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Name', 'Email']);
    }

    sheet.appendRow([new Date().toISOString(), data.name || '', data.email || '']);

    return ContentService
      .createTextOutput(JSON.stringify({ result: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService
    .createTextOutput('Heart of Texas Organics signup endpoint is live.')
    .setMimeType(ContentService.MimeType.TEXT);
}
