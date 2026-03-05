// controllers/approvalcontroller.js
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

  const approvalTimesheetId = Number(approval.TimesheetId);
  if (!Number.isInteger(approvalTimesheetId) || approvalTimesheetId <= 0) {
    console.log("DEBUG invalid approval.TimesheetId raw:", approval.TimesheetId);
    return res.status(500).send("Approval has invalid TimesheetId.");
  }

  const days = await approvalService.listProjectDaysForApproval(approvalTimesheetId, approval.ProjectName);

  return res.render("timesheet_edit", {
    timesheetId: approvalTimesheetId,
    weekEnding: approval.WeekEndingDate.toISOString().slice(0, 10),
    status: approval.TimesheetStatus,
    days,
    error: null,
    approvalView: true,
    approvalId, // from URL
    projectName: approval.ProjectName,
    vendorName: approval.VendorName,
    vendorEmail: approval.VendorEmail,
     // ✅ NEW: show rejection + vendor response on approver view
    comment: approval.Comment,
    vendorReply: approval.VendorReply,
    vendorReplyAt: approval.VendorReplyAt
  });

  
}

async function approve(req, res) {
  const approvalId = Number(req.params.approvalId);
  if (!Number.isInteger(approvalId) || approvalId <= 0) return res.status(400).send("Invalid ApprovalId.");

  const approval = await approvalService.getApprovalById(approvalId);
  if (!approval) return res.status(404).send("Approval not found");
  if (req.user.Role !== "Admin" && approval.ApproverUserId !== req.user.UserId) return res.status(403).send("Forbidden");

  await approvalService.setApprovalStatus(approvalId, "Approved", null);
  await timesheetService.addAudit(
    approval.TimesheetId,
    req.user.UserId,
    "Approved",
    `Approved project: ${approval.ProjectName}`
  );
  await approvalService.recomputeTimesheetFinalStatus(approval.TimesheetId);

  return res.redirect("/approvals");
}

async function reject(req, res) {
  try {
    const approvalId = Number(req.params.approvalId);
    if (!Number.isInteger(approvalId) || approvalId <= 0) {
      return res.status(400).json({ error: "Invalid ApprovalId." });
    }

    const comment = String(req.body?.comment || "").trim();
    if (!comment) {
      return res.status(400).json({ error: "Rejection comment required." });
    }

    const approval = await approvalService.getApprovalById(approvalId);
    if (!approval) return res.status(404).json({ error: "Approval not found" });

    if (req.user.Role !== "Admin" && approval.ApproverUserId !== req.user.UserId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await approvalService.setApprovalStatus(approvalId, "Rejected", comment);
    await timesheetService.addAudit(approval.TimesheetId, req.user.UserId, "Rejected", comment);
    await approvalService.recomputeTimesheetFinalStatus(approval.TimesheetId);

    return res.json({ ok: true, redirect: "/approvals" });
  } catch (e) {
    console.error("reject error", e);
    return res.status(500).json({ error: "Server error rejecting approval." });
  }
}

/**
 * Review a submitted timesheet for a SPECIFIC project approval (Option A)
 * Route: GET /approvals/:id/review?approvalId=123&projectId=45
 *
 * NOTE: TimesheetDays has NO ProjectId column.
 * We only use projectId here to validate the URL against the approval record (anti-tamper).
 * We do NOT pass projectId into any SQL calls.
 */
async function reviewPage(req, res) {
  const routeTimesheetId = Number(req.params.id);
  const approvalId = Number(req.query.approvalId);
  const routeProjectId = Number(req.query.projectId);

  console.log(
    "reviewPage timesheetId:", req.params.id, "parsed:", routeTimesheetId,
    "approvalId:", req.query.approvalId, "parsed:", approvalId,
    "projectId:", req.query.projectId, "parsed:", routeProjectId
  );

  if (!Number.isInteger(routeTimesheetId) || routeTimesheetId <= 0) {
    return res.status(400).send("Invalid TimesheetId.");
  }
  if (!Number.isInteger(approvalId) || approvalId <= 0) {
    return res.status(400).send("Invalid approvalId.");
  }
  if (!Number.isInteger(routeProjectId) || routeProjectId <= 0) {
    return res.status(400).send("Invalid projectId.");
  }

  const approval = await approvalService.getApprovalById(approvalId);
  if (!approval) return res.status(404).send("Approval not found");

  if (req.user.Role !== "Admin" && approval.ApproverUserId !== req.user.UserId) {
    return res.status(403).send("Forbidden");
  }

  // Coerce DB values
  const approvalTimesheetId = Number(approval.TimesheetId);
  const approvalProjectId = Number(approval.ProjectId);

  if (!Number.isInteger(approvalTimesheetId) || approvalTimesheetId <= 0) {
    console.log("DEBUG invalid approval.TimesheetId raw:", approval.TimesheetId);
    return res.status(500).send("Approval has invalid TimesheetId.");
  }
  if (!Number.isInteger(approvalProjectId) || approvalProjectId <= 0) {
    console.log("DEBUG invalid approval.ProjectId raw:", approval.ProjectId);
    return res.status(500).send("Approval has invalid ProjectId.");
  }

  // Anti-tamper checks
  if (approvalTimesheetId !== routeTimesheetId) {
    // canonical redirect
    return res.redirect(`/approvals/${approvalTimesheetId}/review?approvalId=${approvalId}&projectId=${routeProjectId}`);
  }
  if (approvalProjectId !== routeProjectId) {
    return res.status(400).send("Approval does not match ProjectId.");
  }

  // ✅ ONLY TimesheetId + ProjectName for TimesheetDays lookup
  const days = await approvalService.listProjectDaysForApproval(approvalTimesheetId, approval.ProjectName);

  return res.render("timesheet_edit", {
    timesheetId: approvalTimesheetId,
    weekEnding: approval.WeekEndingDate.toISOString().slice(0, 10),
    status: approval.TimesheetStatus,
    days,
    error: null,
    approvalView: true,
    approvalId: approval.TimesheetProjectApprovalId,
    projectName: approval.ProjectName,
    vendorName: approval.VendorName,
    vendorEmail: approval.VendorEmail,
     // ✅ NEW: show rejection + vendor response on approver view
    comment: approval.Comment,
    vendorReply: approval.VendorReply,
    vendorReplyAt: approval.VendorReplyAt
  });
}

module.exports = {
  listApprovals,
  viewApproval,
  approve,
  reject,
  reviewPage
};
