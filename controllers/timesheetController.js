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

  // ✅ Load saved rows + projects once (needed for validation + re-render)
  const days = await timesheetService.listTimesheetDays(timesheetId);
  const projects = await projectService.listActiveProjects();

  // ✅ STRICT validation: all days must have Project/Summary/ADO.
  // ✅ Hours: weekdays > 0, weekends allow 0.
  const errors = [];

  function isWeekendDay(d) {
    const dn = String(d.DayName || "").toLowerCase();
    if (dn) return dn.startsWith("sat") || dn.startsWith("sun");

    // fallback: compute from date if DayName missing
    const wd = d.WorkDate instanceof Date ? d.WorkDate : new Date(d.WorkDate);
    const dow = wd.getUTCDay(); // 0=Sun,6=Sat
    return dow === 0 || dow === 6;
  }

  for (const d of days) {
    const dateLabel =
      (d.WorkDate instanceof Date
        ? d.WorkDate.toISOString().slice(0, 10)
        : String(d.WorkDate || ""));

    const project = String(d.ProjectName || "").trim();
    const summary = String(d.WorkSummary || "").trim();
    const ado = String(d.ADOTickets || "").trim();
    const hours = Number(d.Hours);

    if (!project) errors.push(`${dateLabel}: Project is required.`);
    if (!summary) errors.push(`${dateLabel}: Work Summary is required.`);
    if (!ado) errors.push(`${dateLabel}: ADO Ticket is required.`);

    const weekend = isWeekendDay(d);

    if (!Number.isFinite(hours)) {
      errors.push(`${dateLabel}: Hours must be a number.`);
    } else if (weekend) {
      // weekends: allow 0 or more
      if (hours < 0) errors.push(`${dateLabel}: Hours cannot be negative.`);
    } else {
      // weekdays: must be > 0
      if (hours <= 0) errors.push(`${dateLabel}: Hours must be greater than 0 (weekdays).`);
    }
  }

  if (errors.length) {
    const msg =
      "Please complete all fields for every day before submitting:\n" +
      errors.map(e => `• ${e}`).join("\n");

    return res.render("timesheet_edit", {
      timesheetId,
      weekEnding,
      status: header.Status,
      days,
      projects,
      error: msg
    });
  }

  // ✅ Continue with your existing mapping + approval creation logic
  const usedProjectNames = await timesheetService.getDistinctUsedProjectNames(timesheetId);

  // With strict validation, this will normally never be empty, but keeping it is fine.
  if (!usedProjectNames.length) {
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
