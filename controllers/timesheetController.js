const timesheetService = require("../services/timesheetService");
const projectService = require("../services/projectService");
const approvalService = require("../services/approvalService");

function isValidISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function isWeekEndingAllowed(yyyyMmDd) {
  // Toggle this depending on your definition of week-ending:
  // Friday = 5, Saturday = 6
  const REQUIRE_FRIDAY = true; // <-- set true if week ending must be Friday
  const REQUIRE_SATURDAY = false; // <-- set true if week ending must be Saturday

  const d = new Date(yyyyMmDd + "T00:00:00");
  if (Number.isNaN(d.getTime())) return false;

  const dow = d.getDay(); // local day
  if (REQUIRE_FRIDAY) return dow === 5;
  if (REQUIRE_SATURDAY) return dow === 6;

  return true; // if no strict weekday requirement
}

async function listMyTimesheets(req, res) {
  const rows = await timesheetService.listTimesheetsForVendor(req.user.UserId);
  const weekEnding = String(req.query.weekEnding || "").trim(); // optional prefill

  return res.render("timesheets", { rows, weekEnding, error: null, errors: [] });
}

async function editTimesheet(req, res) {
  const weekEnding = String(req.query.weekEnding || "").trim();

  if (!weekEnding) return res.redirect("/timesheets");

  // ✅ Server-side validation for date picker input
  if (!isValidISODate(weekEnding) || !isWeekEndingAllowed(weekEnding)) {
    const rows = await timesheetService.listTimesheetsForVendor(req.user.UserId);

    const msg = !isValidISODate(weekEnding)
      ? "Invalid week ending date format. Please select a date."
      : "Selected week ending date is not allowed. Please select the correct week ending day.";

    return res.status(400).render("timesheets", {
      rows,
      weekEnding,
      error: msg,
      errors: []
    });
  }

  const timesheetId = await timesheetService.upsertTimesheetHeader(req.user.UserId, weekEnding);
  const header = await timesheetService.getTimesheetHeader(timesheetId);

  await timesheetService.ensure7Days(timesheetId, weekEnding);
  const days = await timesheetService.listTimesheetDays(timesheetId);

  const projects = await projectService.listActiveProjects();

  // ✅ NEW: load rejection comments (project-level) if rejected
  let rejectedProjects = [];
  if (String(header.Status) === "Rejected") {
    rejectedProjects = await approvalService.listRejectedProjectApprovals(timesheetId);
  }

  return res.render("timesheet_edit", {
    timesheetId,
    weekEnding,
    status: header.Status,
    days,
    projects,
    rejectedProjects, // ✅ pass to EJS
    error: null
  });
}

async function saveTimesheet(req, res) {
  const timesheetId = Number(req.params.id);
  if (!Number.isInteger(timesheetId) || timesheetId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid timesheet id" });
  }

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
  const weekEnding = String(req.body?.weekEnding || "").trim();
  const rows = req.body?.rows || [];

  const wantsJson =
    req.xhr ||
    (req.headers.accept || "").includes("application/json") ||
    (req.headers["content-type"] || "").includes("application/json");

  const fail = (status, message, extra = {}) => {
    return wantsJson
      ? res.status(status).json({ ok: false, message, ...extra })
      : res.status(status).send(message);
  };

  if (!Number.isInteger(timesheetId) || timesheetId <= 0) return fail(400, "Invalid timesheet id");
  if (!weekEnding) return fail(400, "weekEnding is required");

  // ✅ Server-side validation for date picker input
  if (!isValidISODate(weekEnding) || !isWeekEndingAllowed(weekEnding)) {
    return fail(400, "Invalid weekEnding date. Please select a valid week ending date.");
  }

  if (!Array.isArray(rows) || rows.length !== 7) {
    return fail(400, "Submit must include 7 rows (one per day).");
  }

  const header = await timesheetService.getTimesheetHeader(timesheetId);
  if (!header) return fail(404, "Timesheet not found");
  if (!["Draft", "Rejected"].includes(header.Status)) return fail(400, "Timesheet cannot be submitted.");

  await timesheetService.ensure7Days(timesheetId, weekEnding);

  // Load DB days to ensure timesheetDayIds are valid and to infer dayName/weekend
  const days = await timesheetService.listTimesheetDays(timesheetId);

  // Needed for non-JSON re-render
  const projects = await projectService.listActiveProjects();

  // Build lookup for TimesheetDayId -> { DayName, WorkDate }
  const dayById = new Map(
    days.map(d => [Number(d.TimesheetDayId), { DayName: d.DayName, WorkDate: d.WorkDate }])
  );

  const badId = rows.find(r => !Number.isFinite(Number(r.timesheetDayId)) || !dayById.has(Number(r.timesheetDayId)));
  if (badId) {
    const msg = "Submit payload is missing a valid timesheetDayId for one or more rows. Please refresh the page and try again.";
    if (wantsJson) return res.status(400).json({ ok: false, message: msg });
    return res.render("timesheet_edit", {
      timesheetId,
      weekEnding,
      status: header.Status,
      days,
      projects,
      error: msg
    });
  }

  function isWeekendFromDayName(dayName) {
    const dn = String(dayName || "").toLowerCase();
    return dn.startsWith("sat") || dn.startsWith("sun");
  }

  function isWeekendFromDate(workDate) {
    const wd = workDate instanceof Date ? workDate : new Date(workDate);
    const dow = wd.getUTCDay();
    return dow === 0 || dow === 6;
  }

  function autofillWeekendDefaults(r) {
    r.projectName = String(r.projectName || "").trim() || "Non-Working";
    r.workSummary = String(r.workSummary || "").trim() || "Weekend";
    if (r.hours === "" || r.hours == null) r.hours = "0";
    r.adoTickets = String(r.adoTickets || "").trim() || "N/A";
  }

  const errors = [];

  rows.forEach((r, idx) => {
    const id = Number(r.timesheetDayId);
    const dayInfo = dayById.get(id);

    const dayName = String(r.dayName || dayInfo?.DayName || "");
    const weekend = isWeekendFromDayName(dayName) || isWeekendFromDate(dayInfo?.WorkDate);

    if (weekend) autofillWeekendDefaults(r);

    const rowLabel = `Row ${idx + 1}${dayName ? ` (${dayName})` : ""}`;

    const project = String(r.projectName || "").trim();
    const summary = String(r.workSummary || "").trim();
    const ado = String(r.adoTickets || "").trim();
    const hours = Number(r.hours);

    if (!project) errors.push(`${rowLabel}: Project is required.`);
    if (!summary) errors.push(`${rowLabel}: Work Summary is required.`);
    if (!ado) errors.push(`${rowLabel}: ADO Ticket is required.`);

    if (!Number.isFinite(hours)) {
      errors.push(`${rowLabel}: Hours must be a number.`);
    } else if (weekend) {
      if (hours < 0) errors.push(`${rowLabel}: Hours cannot be negative.`);
    } else {
      if (hours <= 0) errors.push(`${rowLabel}: Hours must be greater than 0 (weekdays).`);
    }
  });

  if (errors.length) {
    const msg =
      "Please complete all fields for every day before submitting:\n" +
      errors.map(e => `• ${e}`).join("\n");

    if (wantsJson) return res.status(400).json({ ok: false, message: msg, errors });

    return res.render("timesheet_edit", {
      timesheetId,
      weekEnding,
      status: header.Status,
      days,
      projects,
      error: msg
    });
  }

  await timesheetService.updateTimesheetDaysEditable(timesheetId, rows);

  const usedProjectNames = [...new Set(rows.map(r => String(r.projectName || "").trim()).filter(Boolean))];

  for (const projectName of usedProjectNames) {
    const mapping = await projectService.getProjectMappingByName(projectName);
    if (!mapping) {
      const msg = `Project "${projectName}" is not mapped to an approver. Ask admin to add mapping.`;
      if (wantsJson) return res.status(400).json({ ok: false, message: msg });

      return res.render("timesheet_edit", {
        timesheetId,
        weekEnding,
        status: header.Status,
        days,
        projects,
        error: msg
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

  if (wantsJson) return res.json({ ok: true });
  return res.redirect("/timesheets");
}

module.exports = { listMyTimesheets, editTimesheet, saveTimesheet, submitTimesheet };
