// services/approvalService.js
const { getPool, sql } = require("../db/db");

async function listRejectedProjectApprovals(timesheetId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT
        tpa.TimesheetProjectApprovalId,
        tpa.ProjectId,
        p.ProjectName,
        tpa.Comment,
        tpa.ActionAt
      FROM dbo.TimesheetProjectApprovals tpa
      LEFT JOIN dbo.Projects p ON p.ProjectId = tpa.ProjectId
      WHERE tpa.TimesheetId = @TimesheetId
        AND tpa.Status = 'Rejected'
        AND NULLIF(LTRIM(RTRIM(tpa.Comment)), '') IS NOT NULL
      ORDER BY tpa.ActionAt DESC, tpa.CreatedAt DESC;
    `);

  return r.recordset;
}
/**
 * Returns everything needed to render the review page for a given TimesheetId:
 * - Timesheet header/vendor/status
 * - Approvals/projects for this approver (or all if Admin)
 * - Days for each project (matched by ProjectName since TimesheetDays has no ProjectId)
 */
async function getTimesheetForReview(timesheetId, user) {
  const pool = await getPool();

  // 1) Header/vendor/status
  const headerR = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT
        t.TimesheetId,
        t.WeekEndingDate,
        t.Status AS TimesheetStatus,
        u.DisplayName AS VendorName,
        u.Email AS VendorEmail
      FROM dbo.Timesheets t
      JOIN dbo.Users u ON u.UserId = t.VendorUserId
      WHERE t.TimesheetId = @TimesheetId
    `);

  const header = headerR.recordset[0];
  if (!header) return null;

  // 2) Approvals for this timesheet (Admin sees all; Approver sees only theirs)
  const approvalsReq = pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .input("ApproverUserId", sql.Int, user.UserId);

  let approvalsQuery = `
    SELECT
      a.TimesheetProjectApprovalId,
      a.ProjectId,
      p.ProjectName,
      a.Status AS ApprovalStatus,
      a.Comment
    FROM dbo.TimesheetProjectApprovals a
    JOIN dbo.Projects p ON p.ProjectId = a.ProjectId
    WHERE a.TimesheetId = @TimesheetId
  `;

  if (user.Role !== "Admin") {
    approvalsQuery += ` AND a.ApproverUserId = @ApproverUserId `;
  }

  approvalsQuery += ` ORDER BY p.ProjectName `;

  const approvalsR = await approvalsReq.query(approvalsQuery);
  const approvals = approvalsR.recordset || [];

  if (user.Role !== "Admin" && approvals.length === 0) {
    return { forbidden: true };
  }

  // 3) Load day rows per approval (NO ProjectId in TimesheetDays)
  const projects = [];
  for (const a of approvals) {
    const days = await listProjectDaysForApproval(timesheetId, a.ProjectName);
    projects.push({
      approvalId: a.TimesheetProjectApprovalId,
      projectId: a.ProjectId,
      projectName: a.ProjectName,
      approvalStatus: a.ApprovalStatus,
      comment: a.Comment,
      days
    });
  }

  return {
    timesheetId: header.TimesheetId,
    weekEnding: header.WeekEndingDate.toISOString().slice(0, 10),
    timesheetStatus: header.TimesheetStatus,
    vendorName: header.VendorName,
    vendorEmail: header.VendorEmail,
    projects
  };
}

async function clearApprovalTasks(timesheetId) {
  const pool = await getPool();
  await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`DELETE FROM dbo.TimesheetProjectApprovals WHERE TimesheetId=@TimesheetId`);
}

async function createApprovalTask(timesheetId, projectId, approverUserId) {
  const pool = await getPool();
  await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .input("ProjectId", sql.Int, projectId)
    .input("ApproverUserId", sql.Int, approverUserId)
    .query(`
      INSERT INTO dbo.TimesheetProjectApprovals (TimesheetId, ProjectId, ApproverUserId, Status)
      VALUES (@TimesheetId, @ProjectId, @ApproverUserId, 'Pending')
    `);
}

/**
 * Pending approvals grid for approver
 */
async function listPendingApprovalsForApprover(approverUserId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("ApproverUserId", sql.Int, approverUserId)
    .query(`
      SELECT
        tpa.TimesheetProjectApprovalId AS ApprovalId,
        tpa.ProjectId AS ProjectId,
        tpa.Status AS ApprovalStatus,
        p.ProjectName,
        t.TimesheetId,
        t.WeekEndingDate,
        t.TotalHours,
        t.Status AS TimesheetStatus,
        u.DisplayName AS VendorName,
        u.Email AS VendorEmail
      FROM dbo.TimesheetProjectApprovals tpa
      JOIN dbo.Timesheets t ON t.TimesheetId = tpa.TimesheetId
      JOIN dbo.Projects p ON p.ProjectId = tpa.ProjectId
      JOIN dbo.Users u ON u.UserId = t.VendorUserId
      WHERE tpa.Status = 'Pending'
        AND t.Status = 'Submitted'
        AND tpa.ApproverUserId = @ApproverUserId
      ORDER BY t.WeekEndingDate DESC, u.DisplayName, p.ProjectName
    `);

  return r.recordset;
}

async function getApprovalById(approvalId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("ApprovalId", sql.Int, approvalId)
    .query(`
      SELECT TOP 1
        tpa.TimesheetProjectApprovalId,
        tpa.TimesheetId       AS TimesheetId,
        tpa.ProjectId         AS ProjectId,
        tpa.ApproverUserId    AS ApproverUserId,
        tpa.Status            AS ApprovalStatus,
        tpa.Comment           AS Comment,

        p.ProjectName         AS ProjectName,
        t.WeekEndingDate      AS WeekEndingDate,
        t.Status              AS TimesheetStatus,

        u.DisplayName         AS VendorName,
        u.Email               AS VendorEmail
      FROM dbo.TimesheetProjectApprovals tpa
      JOIN dbo.Projects  p ON p.ProjectId   = tpa.ProjectId
      JOIN dbo.Timesheets t ON t.TimesheetId = tpa.TimesheetId
      JOIN dbo.Users     u ON u.UserId      = t.VendorUserId
      WHERE tpa.TimesheetProjectApprovalId = @ApprovalId
    `);

  return r.recordset[0] || null;
}

/**
 * TimesheetDays has NO ProjectId column.
 * Match ONLY by ProjectName (normalized) and show all rows for that project.
 *
 * NOTE: No Hours filter so approver sees all rows.
 */
async function listProjectDaysForApproval(timesheetId, projectName) {
  const pool = await getPool();
  const r = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .input("ProjectName", sql.NVarChar(200), projectName)
    .query(`
      SELECT
        WorkDate,
        DayName,
        ProjectName,
        WorkSummary,
        ADOTickets,
        Hours
      FROM dbo.TimesheetDays
      WHERE TimesheetId = @TimesheetId
        AND UPPER(
              REPLACE(
                REPLACE(
                  REPLACE(LTRIM(RTRIM(ProjectName)), CHAR(9), ''),   -- tabs
                CHAR(160), ''),                                     -- nbsp
              ' ', '')                                              -- spaces
            ) = UPPER(
              REPLACE(
                REPLACE(
                  REPLACE(LTRIM(RTRIM(@ProjectName)), CHAR(9), ''),
                CHAR(160), ''),
              ' ', '')
            )
      ORDER BY WorkDate
    `);

  return r.recordset;
}

async function setApprovalStatus(approvalId, status, comment) {
  const pool = await getPool();
  await pool.request()
    .input("ApprovalId", sql.Int, approvalId)
    .input("Status", sql.NVarChar(20), status)
    .input("Comment", sql.NVarChar(2000), comment || null)
    .query(`
      UPDATE dbo.TimesheetProjectApprovals
      SET Status=@Status, Comment=@Comment, ActionAt=SYSUTCDATETIME()
      WHERE TimesheetProjectApprovalId=@ApprovalId
    `);
}

async function recomputeTimesheetFinalStatus(timesheetId) {
  const pool = await getPool();

  const anyRejected = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT COUNT(1) AS Cnt
      FROM dbo.TimesheetProjectApprovals
      WHERE TimesheetId=@TimesheetId AND Status='Rejected'
    `);

  if (anyRejected.recordset[0].Cnt > 0) {
    await pool.request()
      .input("TimesheetId", sql.Int, timesheetId)
      .query(`
        UPDATE dbo.Timesheets
        SET Status='Rejected', RejectedAt=SYSUTCDATETIME(), UpdatedAt=SYSUTCDATETIME()
        WHERE TimesheetId=@TimesheetId
      `);
    return;
  }

  const pending = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT COUNT(1) AS Cnt
      FROM dbo.TimesheetProjectApprovals
      WHERE TimesheetId=@TimesheetId AND Status='Pending'
    `);

  const total = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`
      SELECT COUNT(1) AS Cnt
      FROM dbo.TimesheetProjectApprovals
      WHERE TimesheetId=@TimesheetId
    `);

  if (total.recordset[0].Cnt > 0 && pending.recordset[0].Cnt === 0) {
    await pool.request()
      .input("TimesheetId", sql.Int, timesheetId)
      .query(`
        UPDATE dbo.Timesheets
        SET Status='Approved', ApprovedAt=SYSUTCDATETIME(), UpdatedAt=SYSUTCDATETIME()
        WHERE TimesheetId=@TimesheetId
      `);
  }
}

module.exports = {
  clearApprovalTasks,
  createApprovalTask,
  listPendingApprovalsForApprover,
  getApprovalById,
  listProjectDaysForApproval,
  setApprovalStatus,
  recomputeTimesheetFinalStatus,
  getTimesheetForReview,
  listRejectedProjectApprovals
};
