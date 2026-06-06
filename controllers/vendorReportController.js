const reportService = require("../services/vendorReportService");

async function reportPage(req, res, next) {
  try {
    const now = new Date();

    res.render("vendor/reports", {
      title: "My Reports",
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      error: null
    });
  } catch (err) {
    next(err);
  }
}

async function downloadMonthlyApprovedTime(req, res, next) {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!year || !month || month < 1 || month > 12) {
      return res.status(400).send("Invalid year/month");
    }

    const rows = await reportService.getVendorMonthlyApprovedTime(
    req.user.UserId,
    year,
    month
    );

    const headers = [
      "VendorResourceName",
      "VendorResourceEmail",
      "WeekEndingDate",
      "ProjectName",
      "WorkDate",
      "DayName",
      "WorkSummary",
      "ADOTickets",
      "Hours"
    ];

    const csvRows = [
      headers.join(","),
      ...rows.map(r =>
        headers.map(h => {
          const val = r[h] ?? "";
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(",")
      )
    ];

    const csv = csvRows.join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=approved-time-${year}-${String(month).padStart(2, "0")}.csv`
    );

    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  downloadMonthlyApprovedTime,
    reportPage
};