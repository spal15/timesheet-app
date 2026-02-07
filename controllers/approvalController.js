const approvalService = require("../services/approvalService");
const timesheetService = require("../services/timesheetService");

async function listApprovals(req, res) {
  const rows = await approvalService.listPendingApprovalsForApprover(req.user.UserId);
  return res.render("approvals", { rows });
}

async function viewApproval(req, res) {
  const approvalId = Number(req.params.approvalId);

  const approval = await approvalService.getApprovalById(approvalId);
  if (!approval) return res.status(404).send("Approval not found");
  if (req.user.Role !== "Admin" && approval.ApproverUserId !== req.user.UserId) return res.status(403).send("Forbidden");

  const days = await approvalService.listProjectDaysForApproval(approval.TimesheetId, approval.ProjectName);

  return res.render("timesheet_edit", {
    timesheetId: approval.TimesheetId,
    weekEnding: approval.WeekEndingDate.toISOString().slice(0, 10),
    status: approval.TimesheetStatus,
    days,
    error: null,
    approvalView: true,
    approvalId,
    projectName: approval.ProjectName,
    vendorName: approval.VendorName,
    vendorEmail: approval.VendorEmail
  });
}

async function approve(req, res) {
  const approvalId = Number(req.params.approvalId);

  const approval = await approvalService.getApprovalById(approvalId);
  if (!approval) return res.status(404).send("Approval not found");
  if (req.user.Role !== "Admin" && approval.ApproverUserId !== req.user.UserId) return res.status(403).send("Forbidden");

  await approvalService.setApprovalStatus(approvalId, "Approved", null);
  await timesheetService.addAudit(approval.TimesheetId, req.user.UserId, "Approved", `Approved project: ${approval.ProjectName}`);
  await approvalService.recomputeTimesheetFinalStatus(approval.TimesheetId);

  return res.redirect("/approvals");
}

async function reject(req, res) {
  const approvalId = Number(req.params.approvalId);
  const comment = String(req.body.comment || "").trim();
  if (!comment) return res.status(400).send("Rejection comment required.");

  const approval = await approvalService.getApprovalById(approvalId);
  if (!approval) return res.status(404).send("Approval not found");
  if (req.user.Role !== "Admin" && approval.ApproverUserId !== req.user.UserId) return res.status(403).send("Forbidden");

  await approvalService.setApprovalStatus(approvalId, "Rejected", comment);
  await timesheetService.addAudit(approval.TimesheetId, req.user.UserId, "Rejected", comment);
  await approvalService.recomputeTimesheetFinalStatus(approval.TimesheetId);

  return res.redirect("/approvals");
}

module.exports = { listApprovals, viewApproval, approve, reject };
