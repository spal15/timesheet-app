const approvalService = require("../services/approvalService");
const timesheetService = require("../services/timesheetService");

async function listApprovals(req, res) {
  const rows = await approvalService.listPendingApprovalsForApprover(req.user.UserId);
  return res.render("approvals", { rows });
}

async function viewApproval(req, res) {
  const approvalId = Number(req.params.approvalId);
  if (!Number.isInteger(approvalId) || approvalId <= 0) return res.status(400).send("Invalid ApprovalId.");

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
  if (!Number.isInteger(approvalId) || approvalId <= 0) return res.status(400).send("Invalid ApprovalId.");

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
  if (!Number.isInteger(approvalId) || approvalId <= 0) return res.status(400).send("Invalid ApprovalId.");

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

/**
 * Review a submitted timesheet by TimesheetId (from grid "Review" button)
 * Route: GET /approvals/:id/review
 */
async function reviewPage(req, res) {
  const timesheetId = Number(req.params.id);

  console.log("reviewPage param id:", req.params.id, "parsed:", timesheetId);

  if (!Number.isInteger(timesheetId) || timesheetId <= 0) {
    return res.status(400).send("Invalid TimesheetId.");
  }

  // IMPORTANT: use approvalService (not approvalsService)
  // This service method should return whatever your review page needs:
  // header, vendor, projects, days, approvals, etc.
  const data = await approvalService.getTimesheetForReview(timesheetId, req.user);

  // Optional authorization check inside controller (or inside service):
  // If your approvers should only see timesheets where they have pending approvals.
  // If you already enforce in the service, you can remove this.
  if (data?.forbidden) return res.status(403).send("Forbidden");
  if (!data) return res.status(404).send("Timesheet not found");

  return res.render("timesheet_edit", {
    timesheetId: data.timesheetId,
    weekEnding: data.weekEnding,
    status: data.timesheetStatus,
    days: data.projects?.[0]?.days || [],      // simplest: show first project
    error: null,
    approvalView: true,
    approvalId: data.projects?.[0]?.approvalId || null,
    projectName: data.projects?.[0]?.projectName || "",
    vendorName: data.vendorName,
    vendorEmail: data.vendorEmail
  });

}

module.exports = {
  listApprovals,
  viewApproval,
  approve,
  reject,
  reviewPage
};
