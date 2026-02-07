const { getPool, sql } = require("../db/db");

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
  recomputeTimesheetFinalStatus
};
