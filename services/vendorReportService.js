const { getPool, sql } = require("../db/db");

async function getVendorMonthlyApprovedTime(vendorUserId, year, month) {
  const pool = await getPool();

  const result = await pool.request()
    .input("VendorUserId", sql.Int, vendorUserId)
    .input("Year", sql.Int, year)
    .input("Month", sql.Int, month)
    .query(`
      SELECT
        vendor.DisplayName AS VendorName,
        vendor.Email AS VendorEmail,
        t.TimesheetId,
        CONVERT(varchar(10), t.WeekEndingDate, 120) AS WeekEndingDate,
        CONVERT(varchar(10), td.WorkDate, 120) AS WorkDate,
        td.DayName,
        e.ProjectName,
        e.WorkSummary,
        e.ADOTickets,
        e.Hours
      FROM dbo.Timesheets t
      INNER JOIN dbo.Users vendor
        ON vendor.UserId = t.VendorUserId
      INNER JOIN dbo.TimesheetDays td
        ON td.TimesheetId = t.TimesheetId
      INNER JOIN dbo.TimesheetDayEntries e
        ON e.TimesheetDayId = td.TimesheetDayId
      WHERE t.VendorUserId = @VendorUserId
        AND t.Status = 'Approved'
        AND YEAR(td.WorkDate) = @Year
        AND MONTH(td.WorkDate) = @Month
      ORDER BY
        td.WorkDate,
        e.ProjectName,
        e.EntryOrder;
    `);

  return result.recordset;
}

module.exports = {
  getVendorMonthlyApprovedTime
};