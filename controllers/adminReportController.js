const adminReportService = require("../services/adminReportService");

function csvValue(value) {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildCsv(headers, rows) {
  return [
    headers.join(","),
    ...rows.map(row => headers.map(h => csvValue(row[h])).join(","))
  ].join("\n");
}

function validateYearMonth(req, res) {
  const year = Number(req.query.year);
  const month = Number(req.query.month);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    res.status(400).send("Invalid year/month");
    return null;
  }

  return { year, month };
}

async function reportPage(req, res, next) {
  try {
    const now = new Date();

    res.render("admin/reports", {
      title: "Admin Reports",
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      error: null
    });
  } catch (err) {
    next(err);
  }
}

async function downloadMonthlyVendorHours(req, res, next) {
  try {
    const params = validateYearMonth(req, res);
    if (!params) return;

    const { year, month } = params;

    const rows = await adminReportService.getMonthlyVendorHours(year, month);

    const headers = [
      "VendorName",
      "ReportYear",
      "ReportMonth",
      "ApprovedHours"
    ];

    const csv = buildCsv(headers, rows);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vendor-monthly-approved-hours-${year}-${String(month).padStart(2, "0")}.csv"`
    );

    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

async function downloadMonthlyResourceHours(req, res, next) {
  try {
    const params = validateYearMonth(req, res);
    if (!params) return;

    const { year, month } = params;

    const rows = await adminReportService.getMonthlyResourceHours(year, month);

    const headers = [
      "VendorName",
      "ResourceName",
      "ResourceEmail",
      "ReportYear",
      "ReportMonth",
      "ApprovedHours"
    ];

    const csv = buildCsv(headers, rows);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="resource-monthly-approved-hours-${year}-${String(month).padStart(2, "0")}.csv"`
    );

    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

async function downloadWeeklyVendorTimeReport(req, res, next) {
  try {
    const params = validateYearMonth(req, res);
    if (!params) return;

    const { year, month } = params;

    const rows = await adminReportService.getWeeklyVendorTimeReport(year, month);

    const headers = [
      "VendorName",
      "ResourceName",
      "ResourceEmail",
      "TimesheetId",
      "WeekEndingDate",
      "WorkDate",
      "ProjectName",
      "Hours",
      "Status",
      "SubmittedAt"
    ];

    const csv = buildCsv(headers, rows);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="weekly-vendor-time-report-${year}-${String(month).padStart(2, "0")}.csv"`
    );

    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  reportPage,
  downloadMonthlyVendorHours,
  downloadMonthlyResourceHours,
  downloadWeeklyVendorTimeReport
};