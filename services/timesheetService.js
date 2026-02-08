const { getPool, sql } = require("../db/db");
const { computeWeekDays } = require("../utils/dateUtils");

async function listTimesheetsForVendor(vendorUserId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("VendorUserId", sql.Int, vendorUserId)
    .query(`
      SELECT TimesheetId, WeekEndingDate, Status, TotalHours, SubmittedAt, ApprovedAt, RejectedAt
      FROM dbo.Timesheets
      WHERE VendorUserId=@VendorUserId
      ORDER BY WeekEndingDate DESC
    `);
  return r.recordset;
}

/**
 * Reliable upsert:
 * - MERGE OUTPUT can return empty recordset in some cases.
 * - Use SELECT -> INSERT -> SELECT
 * - Handles race conditions with unique constraint.
 */
async function upsertTimesheetHeader(vendorUserId, weekEndingDate) {
  const pool = await getPool();

  // 1) Try read existing
  const existing = await pool.request()
    .input("VendorUserId", sql.Int, vendorUserId)
    .input("WeekEndingDate", sql.Date, weekEndingDate)
    .query(`
      SELECT TOP 1 TimesheetId
      FROM dbo.Timesheets
      WHERE VendorUserId=@VendorUserId AND WeekEndingDate=@WeekEndingDate
    `);

  if (existing.recordset.length > 0) {
    return Number(existing.recordset[0].TimesheetId);
  }

  // 2) Insert new (may throw on race due to unique constraint)
  try {
    await pool.request()
      .input("VendorUserId", sql.Int, vendorUserId)
      .input("WeekEndingDate", sql.Date, weekEndingDate)
      .query(`
        INSERT INTO dbo.Timesheets (VendorUserId, WeekEndingDate, Status)
        VALUES (@VendorUserId, @WeekEndingDate, 'Draft')
      `);
  } catch (err) {
    // If someone inserted same record concurrently, just re-read
    // SQL Server duplicate key often contains "Cannot insert duplicate key" or error numbers 2601/2627
    const msg = String(err?.message || "");
    const code = err?.number;

    const isDup =
      msg.includes("Cannot insert duplicate key") ||
      msg.includes("Violation of UNIQUE KEY constraint") ||
      code === 2601 ||
      code === 2627;

    if (!isDup) throw err;
  }

  // 3) Re-read created/existing
  const created = await pool.request()
    .input("VendorUserId", sql.Int, vendorUserId)
    .input("WeekEndingDate", sql.Date, weekEndingDate)
    .query(`
      SELECT TOP 1 TimesheetId
      FROM dbo.Timesheets
      WHERE VendorUserId=@VendorUserId AND WeekEndingDate=@WeekEndingDate
    `);

  if (created.recordset.length === 0) {
    throw new Error("Failed to create or find timesheet header.");
  }

  return Number(created.recordset[0].TimesheetId);
}

async function getTimesheetHeader(timesheetId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`SELECT TOP 1 * FROM dbo.Timesheets WHERE TimesheetId=@TimesheetId`);
  return r.recordset[0] || null;
}

async function ensure7Days(timesheetId, weekEndingISO) {
  const pool = await getPool();
  const days = computeWeekDays(weekEndingISO);

  for (const d of days) {
    await pool.request()
      .input("TimesheetId", sql.Int, timesheetId)
      .input("WorkDate", sql.Date, d.workDate)
      .input("DayName", sql.NVarChar(10), d.dayName)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.TimesheetDays WHERE TimesheetId=@TimesheetId AND WorkDate=@WorkDate)
        BEGIN
          INSERT INTO dbo.TimesheetDays (TimesheetId, WorkDate, DayName, Hours)
          VALUES (@TimesheetId, @WorkDate, @DayName, 0)
        END
      `);
  }
}

async function listTimesheetDays(timesheetId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT TimesheetDayId, WorkDate, DayName, ProjectName, WorkSummary, ADOTickets, Hours
      FROM dbo.TimesheetDays
      WHERE TimesheetId=@TimesheetId
      ORDER BY WorkDate
    `);
  return r.recordset;
}

async function updateTimesheetDaysEditable(timesheetId, rows) {
  const hdr = await getTimesheetHeader(timesheetId);
  if (!hdr) throw new Error("Timesheet not found");
  if (!["Draft", "Rejected"].includes(hdr.Status)) throw new Error("Timesheet is not editable.");

  const pool = await getPool();

  for (const row of rows) {
    const hours = Number(row.hours ?? 0);
    if (!Number.isFinite(Number(row.timesheetDayId))) continue;

    await pool.request()
      .input("TimesheetDayId", sql.Int, Number(row.timesheetDayId))
      .input("ProjectName", sql.NVarChar(200), (row.projectName || "").trim() || null)
      .input("WorkSummary", sql.NVarChar(2000), (row.workSummary || "").trim() || null)
      .input("ADOTickets", sql.NVarChar(500), (row.adoTickets || "").trim() || null)
      .input("Hours", sql.Decimal(5, 2), Number.isFinite(hours) ? hours : 0)
      .query(`
        UPDATE dbo.TimesheetDays
        SET ProjectName=@ProjectName,
            WorkSummary=@WorkSummary,
            ADOTickets=@ADOTickets,
            Hours=@Hours,
            UpdatedAt=SYSUTCDATETIME()
        WHERE TimesheetDayId=@TimesheetDayId
      `);
  }

  await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      UPDATE t
      SET TotalHours = ISNULL(x.SumHours,0),
          UpdatedAt = SYSUTCDATETIME()
      FROM dbo.Timesheets t
      OUTER APPLY (SELECT SUM(Hours) AS SumHours FROM dbo.TimesheetDays d WHERE d.TimesheetId=t.TimesheetId) x
      WHERE t.TimesheetId=@TimesheetId
    `);
}

async function addAudit(timesheetId, actorUserId, action, details = null) {
  const pool = await getPool();
  await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .input("ActorUserId", sql.Int, actorUserId)
    .input("Action", sql.NVarChar(50), action)
    .input("Details", sql.NVarChar(2000), details)
    .query(`
      INSERT INTO dbo.TimesheetAudit (TimesheetId, ActorUserId, Action, Details)
      VALUES (@TimesheetId,@ActorUserId,@Action,@Details)
    `);
}

async function markSubmitted(timesheetId) {
  const pool = await getPool();
  await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      UPDATE dbo.Timesheets
      SET Status='Submitted',
          SubmittedAt=SYSUTCDATETIME(),
          ApprovedAt=NULL,
          RejectedAt=NULL,
          UpdatedAt=SYSUTCDATETIME()
      WHERE TimesheetId=@TimesheetId
    `);
}

async function getDistinctUsedProjectNames(timesheetId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT DISTINCT LTRIM(RTRIM(ProjectName)) AS ProjectName
      FROM dbo.TimesheetDays
      WHERE TimesheetId=@TimesheetId
        AND ISNULL(ProjectName,'') <> ''
        AND Hours > 0
    `);
  return r.recordset.map(x => x.ProjectName);
}

module.exports = {
  listTimesheetsForVendor,
  upsertTimesheetHeader,
  getTimesheetHeader,
  ensure7Days,
  listTimesheetDays,
  updateTimesheetDaysEditable,
  addAudit,
  markSubmitted,
  getDistinctUsedProjectNames
};
