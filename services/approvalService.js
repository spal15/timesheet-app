const { getPool, sql } = require("../db/db");


/**
 * Returns everything needed to render the review page for a given TimesheetId:
 * - Timesheet header/vendor/status
 * - Approvals/projects for this approver (or all if Admin)
 * - Days for each project (re-uses your existing listProjectDaysForApproval)
 */
async function getTimesheetForReview(timesheetId, user) {
  const pool = await getPool();

  // 1) Load header/vendor/status (adjust column names to your schema)
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

  // 2) Load approvals/projects for this timesheet
  // If Admin, show all approvals; else only approvals assigned to this approver.
  const approvalsR = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .input("ApproverUserId", sql.Int, user.UserId)
    .query(`
      SELECT
        a.TimesheetProjectApprovalId,
        a.ProjectId,
        p.ProjectName AS ProjectName,
        a.Status AS ApprovalStatus,
        a.Comment
      FROM dbo.TimesheetProjectApprovals a
      JOIN dbo.Projects p ON p.ProjectId = a.ProjectId
      WHERE a.TimesheetId = @TimesheetId
        AND (${user.Role === "Admin" ? "1=1" : "a.ApproverUserId = @ApproverUserId"})
      ORDER BY p.ProjectName
    `);

  const approvals = approvalsR.recordset || [];

  // If not admin and no approvals found, forbid
  if (user.Role !== "Admin" && approvals.length === 0) {
    return { forbidden: true };
  }

  // 3) For each project approval, get day rows using your existing method
  // (This uses listProjectDaysForApproval(timesheetId, projectName) already in your service)
  const projects = [];
  for (const a of approvals) {
    const days = await listProjectDaysForApproval(timesheetId, a.ProjectName);
    projects.push({
      approvalId: a.TimesheetProjectApprovalId,
      projectName: a.ProjectName,
      approvalStatus: a.ApprovalStatus,
      comment: a.Comment,
      days
    });
  }

  // 4) Shape model for EJS
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

async function listPendingApprovalsForApprover(approverUserId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("ApproverUserId", sql.Int, approverUserId)
    .query(`
      SELECT tpa.TimesheetProjectApprovalId, tpa.Status AS ApprovalStatus,
             p.ProjectName, t.TimesheetId, t.WeekEndingDate, t.TotalHours, t.Status AS TimesheetStatus,
             u.DisplayName AS VendorName, u.Email AS VendorEmail
      FROM dbo.TimesheetProjectApprovals tpa
      JOIN dbo.Timesheets t ON t.TimesheetId=tpa.TimesheetId
      JOIN dbo.Projects p ON p.ProjectId=tpa.ProjectId
      JOIN dbo.Users u ON u.UserId=t.VendorUserId
      WHERE tpa.Status='Pending'
        AND t.Status='Submitted'
        AND tpa.ApproverUserId=@ApproverUserId
      ORDER BY t.WeekEndingDate DESC
    `);
  return r.recordset;
}

async function getApprovalById(approvalId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("ApprovalId", sql.Int, approvalId)
    .query(`
      SELECT TOP 1 tpa.*, p.ProjectName, t.WeekEndingDate, t.Status AS TimesheetStatus,
             t.TimesheetId,
             u.DisplayName AS VendorName, u.Email AS VendorEmail
      FROM dbo.TimesheetProjectApprovals tpa
      JOIN dbo.Projects p ON p.ProjectId=tpa.ProjectId
      JOIN dbo.Timesheets t ON t.TimesheetId=tpa.TimesheetId
      JOIN dbo.Users u ON u.UserId=t.VendorUserId
      WHERE tpa.TimesheetProjectApprovalId=@ApprovalId
    `);
  return r.recordset[0] || null;
}

async function listProjectDaysForApproval(timesheetId, projectName) {
  const pool = await getPool();
  const r = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .input("ProjectName", sql.NVarChar(200), projectName)
    .query(`
      SELECT WorkDate, DayName, ProjectName, WorkSummary, ADOTickets, Hours
      FROM dbo.TimesheetDays
      WHERE TimesheetId=@TimesheetId
        AND LTRIM(RTRIM(ProjectName)) = LTRIM(RTRIM(@ProjectName))
        AND Hours > 0
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
    .query(`SELECT COUNT(1) AS Cnt FROM dbo.TimesheetProjectApprovals WHERE TimesheetId=@TimesheetId AND Status='Rejected'`);

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
    .query(`SELECT COUNT(1) AS Cnt FROM dbo.TimesheetProjectApprovals WHERE TimesheetId=@TimesheetId AND Status='Pending'`);

  const total = await pool.request()
    .input("TimesheetId", sql.Int, timesheetId)
    .query(`SELECT COUNT(1) AS Cnt FROM dbo.TimesheetProjectApprovals WHERE TimesheetId=@TimesheetId`);

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
  getTimesheetForReview
};



