const { getPool, sql } = require("../db/db");
const { computeWeekDays } = require("../utils/dateUtils");

const WEEKEND_DAY_NAMES = new Set(["Saturday", "Sunday"]);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeProjectName(value) {
  return normalizeText(value);
}

function normalizeAdo(value) {
  return normalizeText(value);
}

function isWeekendDayName(dayName) {
  return WEEKEND_DAY_NAMES.has(String(dayName || "").trim());
}

function toHours(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

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

async function upsertTimesheetHeader(vendorUserId, weekEndingDate) {
  const pool = await getPool();

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

  try {
    await pool.request()
      .input("VendorUserId", sql.Int, vendorUserId)
      .input("WeekEndingDate", sql.Date, weekEndingDate)
      .query(`
        INSERT INTO dbo.Timesheets (VendorUserId, WeekEndingDate, Status)
        VALUES (@VendorUserId, @WeekEndingDate, 'Draft')
      `);
  } catch (err) {
    const msg = String(err?.message || "");
    const code = err?.number;

    const isDup =
      msg.includes("Cannot insert duplicate key") ||
      msg.includes("Violation of UNIQUE KEY constraint") ||
      code === 2601 ||
      code === 2627;

    if (!isDup) throw err;
  }

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
          INSERT INTO dbo.TimesheetDays (TimesheetId, WorkDate, DayName)
          VALUES (@TimesheetId, @WorkDate, @DayName)
        END
      `);
  }
}

async function listTimesheetDays(timesheetId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT TimesheetDayId, WorkDate, DayName
      FROM dbo.TimesheetDays
      WHERE TimesheetId=@TimesheetId
      ORDER BY WorkDate
    `);
  return r.recordset;
}

async function listTimesheetDaysWithEntries(timesheetId) {
  const pool = await getPool();

  const daysResult = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT TimesheetDayId, WorkDate, DayName
      FROM dbo.TimesheetDays
      WHERE TimesheetId=@TimesheetId
      ORDER BY WorkDate
    `);

  const entriesResult = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT
          td.TimesheetDayId,
          e.EntryId,
          e.EntryOrder,
          e.ProjectId,
          e.ProjectName,
          e.WorkSummary,
          e.ADOTickets,
          e.Hours
      FROM dbo.TimesheetDays td
      LEFT JOIN dbo.TimesheetDayEntries e
          ON e.TimesheetDayId = td.TimesheetDayId
      WHERE td.TimesheetId = @TimesheetId
      ORDER BY td.WorkDate, e.EntryOrder
    `);

  const entriesByDayId = new Map();

  for (const row of entriesResult.recordset) {
    const key = Number(row.TimesheetDayId);
    if (!entriesByDayId.has(key)) entriesByDayId.set(key, []);
    if (row.EntryId != null) {
      entriesByDayId.get(key).push({
        entryId: row.EntryId,
        entryOrder: row.EntryOrder,
        projectId: row.ProjectId ?? null,
        projectName: row.ProjectName || "",
        workSummary: row.WorkSummary || "",
        adoTickets: row.ADOTickets || "",
        hours: row.Hours == null ? "" : Number(row.Hours)
      });
    }
  }

  return daysResult.recordset.map((d) => {
    const timesheetDayId = Number(d.TimesheetDayId);
    let entries = entriesByDayId.get(timesheetDayId) || [];

    if (entries.length === 0) {
      if (isWeekendDayName(d.DayName)) {
        entries = [{
          entryId: null,
          entryOrder: 1,
          projectId: null,
          projectName: "Non-Working",
          workSummary: "Weekend",
          adoTickets: "N/A",
          hours: 0
        }];
      } else {
        entries = [{
          entryId: null,
          entryOrder: 1,
          projectId: null,
          projectName: "",
          workSummary: "",
          adoTickets: "",
          hours: ""
        }];
      }
    }

    return {
      TimesheetDayId: timesheetDayId,
      WorkDate: d.WorkDate,
      DayName: d.DayName,
      entries
    };
  });
}

async function updateTimesheetDaysEditable(timesheetId, rows) {
  const days = (rows || []).map((row) => ({
    timesheetDayId: Number(row.timesheetDayId),
    dayName: row.dayName || "",
    entries: [{
      projectName: normalizeProjectName(row.projectName),
      workSummary: normalizeText(row.workSummary),
      adoTickets: normalizeAdo(row.adoTickets),
      hours: row.hours
    }]
  }));

  return updateTimesheetDayEntriesEditable(timesheetId, days);
}

async function updateTimesheetDayEntriesEditable(timesheetId, days) {
  const hdr = await getTimesheetHeader(timesheetId);
  if (!hdr) throw new Error("Timesheet not found");
  if (!["Draft", "Rejected"].includes(hdr.Status)) throw new Error("Timesheet is not editable.");

  const pool = await getPool();
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin();

    const dayRows = await tx.request()
      .input("TimesheetId", sql.Int, timesheetId)
      .query(`
        SELECT TimesheetDayId, DayName
        FROM dbo.TimesheetDays
        WHERE TimesheetId=@TimesheetId
      `);

    const validDayIds = new Set(dayRows.recordset.map(r => Number(r.TimesheetDayId)));

    for (const day of days) {
      const timesheetDayId = Number(day.timesheetDayId);
      if (!validDayIds.has(timesheetDayId)) {
        throw new Error(`Invalid TimesheetDayId ${day.timesheetDayId}`);
      }

      const entries = Array.isArray(day.entries) ? day.entries : [];

      await tx.request()
        .input("TimesheetDayId", sql.Int, timesheetDayId)
        .query(`
          DELETE FROM dbo.TimesheetDayEntries
          WHERE TimesheetDayId=@TimesheetDayId
        `);

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const hours = toHours(e.hours);
        const cleanHours = Number.isFinite(hours) ? hours : 0;

        await tx.request()
          .input("TimesheetDayId", sql.Int, timesheetDayId)
          .input("EntryOrder", sql.TinyInt, i + 1)
          .input("ProjectId", sql.Int, e?.projectId ? Number(e.projectId) : null)
          .input("ProjectName", sql.NVarChar(200), normalizeProjectName(e.projectName))
          .input("WorkSummary", sql.NVarChar(2000), normalizeText(e.workSummary))
          .input("ADOTickets", sql.NVarChar(500), normalizeAdo(e.adoTickets))
          .input("Hours", sql.Decimal(5, 2), cleanHours)
          .query(`
            INSERT INTO dbo.TimesheetDayEntries
            (
              TimesheetDayId,
              EntryOrder,
              ProjectId,
              ProjectName,
              WorkSummary,
              ADOTickets,
              Hours,
              CreatedAt,
              UpdatedAt
            )
            VALUES
            (
              @TimesheetDayId,
              @EntryOrder,
              @ProjectId,
              @ProjectName,
              @WorkSummary,
              @ADOTickets,
              @Hours,
              SYSUTCDATETIME(),
              SYSUTCDATETIME()
            )
          `);
      }
    }

    await tx.request()
      .input("TimesheetId", sql.Int, timesheetId)
      .query(`
        UPDATE t
        SET TotalHours = ISNULL(x.SumHours,0),
            UpdatedAt = SYSUTCDATETIME()
        FROM dbo.Timesheets t
        OUTER APPLY (
          SELECT SUM(ISNULL(e.Hours,0)) AS SumHours
          FROM dbo.TimesheetDays d
          LEFT JOIN dbo.TimesheetDayEntries e
            ON e.TimesheetDayId = d.TimesheetDayId
          WHERE d.TimesheetId = t.TimesheetId
        ) x
        WHERE t.TimesheetId=@TimesheetId
      `);

    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch (_) {
      // ignore rollback error
    }
    throw err;
  }
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
      SELECT DISTINCT LTRIM(RTRIM(e.ProjectName)) AS ProjectName
      FROM dbo.TimesheetDays d
      INNER JOIN dbo.TimesheetDayEntries e
        ON e.TimesheetDayId = d.TimesheetDayId
      WHERE d.TimesheetId=@TimesheetId
        AND ISNULL(e.ProjectName,'') <> ''
        AND ISNULL(e.Hours,0) > 0
    `);
  return r.recordset.map(x => x.ProjectName);
}

module.exports = {
  listTimesheetsForVendor,
  upsertTimesheetHeader,
  getTimesheetHeader,
  ensure7Days,
  listTimesheetDays,
  listTimesheetDaysWithEntries,
  updateTimesheetDaysEditable,
  updateTimesheetDayEntriesEditable,
  addAudit,
  markSubmitted,
  getDistinctUsedProjectNames
};
