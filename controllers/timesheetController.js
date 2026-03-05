// controllers/timesheetController.js
const timesheetService = require("../services/timesheetService");
const projectService = require("../services/projectService");
const approvalService = require("../services/approvalService");

/** ✅ Hour caps */
const MAX_HOURS_PER_DAY = 15;
const MAX_HOURS_PER_WEEK = 70;

/** ✅ Projects that should NEVER create approvals */
const NON_APPROVABLE_PROJECTS = new Set([
  "non-working",
  "non working"
]);

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

function normalizeProjectName(name) {
  return String(name || "").trim();
}

function isNonApprovableProject(name) {
  const n = normalizeProjectName(name).toLowerCase();
  return NON_APPROVABLE_PROJECTS.has(n);
}

/**
 * ✅ Shared hour cap validator for BOTH Save Draft and Submit
 * - Enforces: hours <= 15/day and total week <= 70
 * - Draft: allows blanks, but if hours provided => must be numeric, >=0, within caps
 */
function validateHourCaps(rows, dayById) {
  const errors = [];
  let weekTotal = 0;

  rows.forEach((r, idx) => {
    const id = Number(r.timesheetDayId);
    const dayInfo = dayById?.get?.(id);
    const dayName = String(r.dayName || dayInfo?.DayName || "");
    const rowLabel = `Row ${idx + 1}${dayName ? ` (${dayName})` : ""}`;

    const raw = r.hours;
    if (raw === "" || raw == null) return; // Draft can keep blank; Submit will already send numbers

    const hours = Number(raw);
    if (!Number.isFinite(hours)) {
      errors.push(`${rowLabel}: Hours must be a number.`);
      return;
    }

    if (hours < 0) {
      errors.push(`${rowLabel}: Hours cannot be negative.`);
      return;
    }

    if (hours > MAX_HOURS_PER_DAY) {
      errors.push(`${rowLabel}: Hours cannot exceed ${MAX_HOURS_PER_DAY} in a day.`);
    }

    weekTotal += hours;
  });

  if (weekTotal > MAX_HOURS_PER_WEEK) {
    errors.push(`Total weekly hours (${weekTotal}) cannot exceed ${MAX_HOURS_PER_WEEK}.`);
  }

  return errors;
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
    // ✅ Ensure day ids are valid + build dayById for labels
    const days = await timesheetService.listTimesheetDays(timesheetId);
    const dayById = new Map(
      (days || []).map(d => [Number(d.TimesheetDayId), { DayName: d.DayName, WorkDate: d.WorkDate }])
    );

    const badId = rows.find(r => !Number.isFinite(Number(r.timesheetDayId)) || !dayById.has(Number(r.timesheetDayId)));
    if (badId) {
      return res.status(400).json({
        ok: false,
        message:
          "Save payload is missing a valid timesheetDayId for one or more rows. Please refresh the page and try again."
      });
    }

    // ✅ Apply hour caps in Save Draft
    const capErrors = validateHourCaps(rows, dayById);
    if (capErrors.length) {
      const msg = "Please fix hours before saving:\n" + capErrors.map(e => `• ${e}`).join("\n");
      return res.status(400).json({ ok: false, message: msg, errors: capErrors });
    }

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

  // ✅ SubTeam required for new approval routing
  const subTeamId = Number(req.user?.SubTeamId || 0);
  if (!subTeamId) {
    return fail(400, "Your SubTeam is not configured in dbo.Users. Ask admin to update your profile.");
  }

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

  // Needed for non-JSON re-render + project name validation
  const projects = await projectService.listActiveProjects();

  // Build lookup for TimesheetDayId -> { DayName, WorkDate }
  const dayById = new Map(
    days.map(d => [Number(d.TimesheetDayId), { DayName: d.DayName, WorkDate: d.WorkDate }])
  );

  const badId = rows.find(r => !Number.isFinite(Number(r.timesheetDayId)) || !dayById.has(Number(r.timesheetDayId)));
  if (badId) {
    const msg =
      "Submit payload is missing a valid timesheetDayId for one or more rows. Please refresh the page and try again.";
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
    r.projectName = normalizeProjectName(r.projectName) || "Non-Working";
    r.workSummary = String(r.workSummary || "").trim() || "Weekend";
    r.adoTickets = String(r.adoTickets || "").trim() || "N/A";

    // ✅ Lock Non-Working weekends to 0 so it never becomes approvable work
    if (isNonApprovableProject(r.projectName)) {
      r.hours = "0";
      return;
    }

    if (r.hours === "" || r.hours == null) r.hours = "0";
  }

  const errors = [];

  rows.forEach((r, idx) => {
    const id = Number(r.timesheetDayId);
    const dayInfo = dayById.get(id);

    const dayName = String(r.dayName || dayInfo?.DayName || "");
    const weekend = isWeekendFromDayName(dayName) || isWeekendFromDate(dayInfo?.WorkDate);

    if (weekend) autofillWeekendDefaults(r);

    const rowLabel = `Row ${idx + 1}${dayName ? ` (${dayName})` : ""}`;

    const project = normalizeProjectName(r.projectName);
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
      // If Non-Working, hours should be 0 (autofill already enforces) - no extra validation needed
    } else {
      if (hours <= 0) errors.push(`${rowLabel}: Hours must be greater than 0 (weekdays).`);
    }
  });

  // ✅ Apply hour caps in Submit (15/day, 70/week)
  errors.push(...validateHourCaps(rows, dayById));

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

  // Save days first (so DB is consistent with what was submitted)
  await timesheetService.updateTimesheetDaysEditable(timesheetId, rows);

  // ✅ approvals only for projects with >0 TOTAL hours across the week
  // ✅ EXCLUDE Non-Working from approval routing (weekend default)
  const hoursByProject = new Map();
  for (const r of rows) {
    const projectName = normalizeProjectName(r.projectName);
    const hours = Number(r.hours);

    if (!projectName) continue;
    if (isNonApprovableProject(projectName)) continue; // ✅ key fix
    if (!Number.isFinite(hours)) continue;

    hoursByProject.set(projectName, (hoursByProject.get(projectName) || 0) + hours);
  }

  const usedProjectNames = [...hoursByProject.entries()]
    .filter(([_, totalHours]) => Number(totalHours) > 0)
    .map(([projectName]) => projectName);

  // Build a case-insensitive ProjectName -> Project row map (from active projects list)
  const projectByName = new Map(
    (projects || []).map(p => [String(p.ProjectName || "").trim().toLowerCase(), p])
  );

  // ✅ Validate mapping for each used project based on submitter subteam
  for (const projectName of usedProjectNames) {
    const p = projectByName.get(String(projectName).trim().toLowerCase());
    if (!p?.ProjectId) {
      const msg = `Project "${projectName}" is not a valid active project.`;
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

    const approvers = await projectService.getApproversForProjectAndSubTeam(Number(p.ProjectId), subTeamId);
    if (!approvers || approvers.length === 0) {
      const msg =
        `Project "${projectName}" is not mapped to approvers for your SubTeam. ` +
        `Ask admin to configure ProjectSubTeamApprovers.`;
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

 // ✅ If resubmitting a rejected timesheet, DO NOT clear approvals (it wipes comments/replies).
 // Just ensure required approvals exist (upsert-style).
  if (String(header.Status) !== "Rejected") {
    await approvalService.clearApprovalTasks(timesheetId);
  }

  // ✅ Ensure approvals exist for each project + each approver
  for (const projectName of usedProjectNames) {
    const p = projectByName.get(String(projectName).trim().toLowerCase());
    if (!p?.ProjectId) continue;

    const approvers = await projectService.getApproversForProjectAndSubTeam(Number(p.ProjectId), subTeamId);

    for (const a of approvers) {
      // ✅ Use an UPSERT method instead of blind insert
      await approvalService.ensureApprovalTask(timesheetId, Number(p.ProjectId), Number(a.UserId));
    }
  }

// ✅ For rejected resubmission, set approvals back to Pending but KEEP comment/vendor reply history
  if (String(header.Status) === "Rejected") {
    await approvalService.reopenApprovalsForResubmission(timesheetId);
  }

  await timesheetService.markSubmitted(timesheetId);
  await timesheetService.addAudit(timesheetId, req.user.UserId, "Submitted");

  if (wantsJson) return res.json({ ok: true });
  return res.redirect("/timesheets");
}

async function replyToRejection(req, res) {
  const timesheetId = Number(req.params.id);
  const approvalId = Number(req.params.approvalId);
  const reply = String(req.body?.reply || "").trim();

  if (!Number.isInteger(timesheetId) || timesheetId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid timesheet id" });
  }
  if (!Number.isInteger(approvalId) || approvalId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid approval id" });
  }
  if (!reply) {
    return res.status(400).json({ ok: false, message: "Reply is required" });
  }
  if (reply.length > 2000) {
    return res.status(400).json({ ok: false, message: "Reply is too long (max 2000 chars)." });
  }

  // Ensure this approval belongs to this vendor + is rejected
  const approval = await approvalService.getRejectedApprovalForVendor(approvalId, req.user.UserId);
  if (!approval || Number(approval.TimesheetId) !== timesheetId) {
    return res.status(404).json({ ok: false, message: "Rejected approval not found for this timesheet." });
  }

  await approvalService.setVendorReply(approvalId, req.user.UserId, reply);
  await timesheetService.addAudit(timesheetId, req.user.UserId, `Vendor replied to rejection (ApprovalId=${approvalId})`);

  return res.json({ ok: true });
}

module.exports = { listMyTimesheets, editTimesheet, saveTimesheet, submitTimesheet, replyToRejection };