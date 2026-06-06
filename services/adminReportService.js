const { getPool, sql } = require("../db/db");

async function getMonthlyVendorHours(year, month) {
  const pool = await getPool();

  const result = await pool.request()
    .input("Year", sql.Int, year)
    .input("Month", sql.Int, month)
    .query(`
      SELECT
        v.VendorName,
        @Year AS ReportYear,
        @Month AS ReportMonth,
        SUM(ISNULL(e.Hours, 0)) AS ApprovedHours
      FROM dbo.Timesheets t
      INNER JOIN dbo.Users u
        ON u.UserId = t.VendorUserId
      LEFT JOIN dbo.Vendors v
        ON v.VendorId = u.VendorId
      INNER JOIN dbo.TimesheetDays td
        ON td.TimesheetId = t.TimesheetId
      INNER JOIN dbo.TimesheetDayEntries e
        ON e.TimesheetDayId = td.TimesheetDayId
      WHERE t.Status = 'Approved'
        AND YEAR(td.WorkDate) = @Year
        AND MONTH(td.WorkDate) = @Month
      GROUP BY
        v.VendorName
      ORDER BY
        v.VendorName;
    `);

  return result.recordset;
}

async function getMonthlyResourceHours(year, month) {
  const pool = await getPool();

  const result = await pool.request()
    .input("Year", sql.Int, year)
    .input("Month", sql.Int, month)
    .query(`
      SELECT
        v.VendorName,
        u.DisplayName AS ResourceName,
        u.Email AS ResourceEmail,
        @Year AS ReportYear,
        @Month AS ReportMonth,
        SUM(ISNULL(e.Hours, 0)) AS ApprovedHours
      FROM dbo.Timesheets t
      INNER JOIN dbo.Users u
        ON u.UserId = t.VendorUserId
      LEFT JOIN dbo.Vendors v
        ON v.VendorId = u.VendorId
      INNER JOIN dbo.TimesheetDays td
        ON td.TimesheetId = t.TimesheetId
      INNER JOIN dbo.TimesheetDayEntries e
        ON e.TimesheetDayId = td.TimesheetDayId
      WHERE t.Status = 'Approved'
        AND YEAR(td.WorkDate) = @Year
        AND MONTH(td.WorkDate) = @Month
      GROUP BY
        v.VendorName,
        u.DisplayName,
        u.Email
      ORDER BY
        v.VendorName,
        u.DisplayName;
    `);

  return result.recordset;
}

module.exports = {
  getMonthlyVendorHours,
  getMonthlyResourceHours
};