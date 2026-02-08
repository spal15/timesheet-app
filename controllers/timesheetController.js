const timesheetService = require("../services/timesheetService");
const projectService = require("../services/projectService");
const approvalService = require("../services/approvalService");

async function listMyTimesheets(req, res) {
  const rows = await timesheetService.listTimesheetsForVendor(req.user.UserId);
  return res.render("timesheets", { rows, error: null, errors: [] });
}


async function editTimesheet(req, res) {
  const weekEnding = String(req.query.weekEnding || "").trim();
  if (!weekEnding) return res.redirect("/timesheets");

  const timesheetId = await timesheetService.upsertTimesheetHeader(req.user.UserId, weekEnding);
  const header = await timesheetService.getTimesheetHeader(timesheetId);

  await timesheetService.ensure7Days(timesheetId, weekEnding);
  const days = await timesheetService.listTimesheetDays(timesheetId);

  const projects = await projectService.listActiveProjects();

  return res.render("timesheet_edit", {
    timesheetId,
    weekEnding,
    status: header.Status,
    days,
    projects,     // ✅ NEW
    error: null
  });
}

async function saveTimesheet(req, res) {
  const timesheetId = Number(req.params.id);
  if (!Number.isFinite(timesheetId)) return res.status(400).json({ ok: false, message: "Invalid timesheet id" });

  const rows = req.body?.rows || [];
  if (!Array.isArray(rows)) return res.status(400).json({ ok: false, message: "rows must be an array" });

  try {
    await timesheetService.updateTimesheetDaysEditable(timesheetId, rows);
    await timesheetService.addAudit(timesheetId, req.user.UserId, "Saved");
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ ok: false, message: err?.message || "Save failed" });
  }
}

async function submitTimesheet(req, res) {
  const timesheetId = Number(req.params.id);
  const weekEnding = String(req.body.weekEnding || "").trim();

  if (!Number.isFinite(timesheetId)) return res.status(400).send("Invalid timesheet id");
  if (!weekEnding) return res.status(400).send("weekEnding is required");

  const header = await timesheetService.getTimesheetHeader(timesheetId);
  if (!header) return res.status(404).send("Timesheet not found");
  if (!["Draft", "Rejected"].includes(header.Status)) return res.status(400).send("Timesheet cannot be submitted.");

  await timesheetService.ensure7Days(timesheetId, weekEnding);

  // ✅ NEW: submit-time field validation (from middleware)
  // middleware sets: req.validationErrors, req.validatedRows
  if (req.validationErrors?.length) {
    const days = await timesheetService.listTimesheetDays(timesheetId);

    // Combine errors into one message (your view currently supports `error` string)
    const msg =
      "Please fix the following before submitting:\n" +
      req.validationErrors.map(e => `• ${e}`).join("\n");

    return res.render("timesheet_edit", {
      timesheetId,
      weekEnding,
      status: header.Status,
      days,
      projects,
      error: msg
    });
  }

  const usedProjectNames = await timesheetService.getDistinctUsedProjectNames(timesheetId);

  if (!usedProjectNames.length) {
    const days = await timesheetService.listTimesheetDays(timesheetId);
    return res.render("timesheet_edit", {
      timesheetId,
      weekEnding,
      status: header.Status,
      days,
      projects,
      error: "Nothing to submit. Please enter hours and a Project for at least one day."
    });
  }

  for (const projectName of usedProjectNames) {
    const mapping = await projectService.getProjectMappingByName(projectName);
    if (!mapping) {
      const days = await timesheetService.listTimesheetDays(timesheetId);
      return res.render("timesheet_edit", {
        timesheetId,
        weekEnding,
        status: header.Status,
        days,
        projects,
        error: `Project "${projectName}" is not mapped to an approver. Ask admin to add mapping.`
      });
    }
  }

  await approvalService.clearApprovalTasks(timesheetId);

  for (const projectName of usedProjectNames) {
    const mapping = await projectService.getProjectMappingByName(projectName);
    await approvalService.createApprovalTask(timesheetId, mapping.ProjectId, mapping.ApproverUserId);
  }

  await timesheetService.markSubmitted(timesheetId);
  await timesheetService.addAudit(timesheetId, req.user.UserId, "Submitted");

  return res.redirect("/timesheets");
}

module.exports = { listMyTimesheets, editTimesheet, saveTimesheet, submitTimesheet };
