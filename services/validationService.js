// services/validationService.js

function normalizeRows(body) {
  const rows =
    body.rows ||
    body.entries ||
    body.timesheetRows ||
    [];

  return Array.isArray(rows) ? rows : [rows];
}

function validateSubmitTimesheet(body) {
  const rows = normalizeRows(body);
  const errors = [];

  rows.forEach((r, idx) => {
    const rowNum = idx + 1;

    const project = String(r.ProjectName ?? r.project ?? "").trim();
    const summary = String(r.WorkSummary ?? r.workSummary ?? r.summary ?? "").trim();
    const adoTicket = String(r.AdoTicket ?? r.adoTicket ?? r.ticket ?? "").trim();

    const hoursRaw = r.Hours ?? r.hours ?? "";
    const hours = Number(hoursRaw);

    if (!project) {
      errors.push(`Row ${rowNum}: Project is required.`);
    }

    if (!Number.isFinite(hours) || hours <= 0) {
      errors.push(`Row ${rowNum}: Hours must be greater than 0.`);
    }

    if (!summary) {
      errors.push(`Row ${rowNum}: Work Summary is required.`);
    }

   // if (!adoTicket) {
     // errors.push(`Row ${rowNum}: ADO Ticket is required.`);
    //}
  });

  return { rows, errors };
}

module.exports = {
  validateSubmitTimesheet
};
