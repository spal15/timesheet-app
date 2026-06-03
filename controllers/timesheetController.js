// controllers/timesheetController.js
const timesheetService = require("../services/timesheetService");
const projectService = require("../services/projectService");
const approvalService = require("../services/approvalService");

/** ✅ Hour caps */
const MAX_HOURS_PER_DAY = 15;
const MAX_HOURS_PER_WEEK = 70;
const MAX_ENTRIES_PER_DAY = 5;

/** ✅ Projects that should NEVER create approvals */
const NON_APPROVABLE_PROJECTS = new Set([
  "non-working",
  "non working"
]);

const WEEKEND_DAY_NAMES = new Set(["Saturday", "Sunday"]);

function isValidISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function isWeekEndingAllowed(yyyyMmDd) {
  const REQUIRE_FRIDAY = true;
  const REQUIRE_SATURDAY = false;

  const d = new Date(yyyyMmDd + "T00:00:00");
  if (Number.isNaN(d.getTime())) return false;

  const dow = d.getDay();
  if (REQUIRE_FRIDAY) return dow === 5;
  if (REQUIRE_SATURDAY) return dow === 6;

  return true;
}

function normalizeProjectName(name) {
  return String(name || "").trim();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeAdo(value) {
  return String(value || "").trim();
}

function isNonApprovableProject(name) {
  const n = normalizeProjectName(name).toLowerCase();
  return NON_APPROVABLE_PROJECTS.has(n);
}

function isWeekendDayName(dayName) {
  return WEEKEND_DAY_NAMES.has(String(dayName || "").trim());
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function hasMeaningfulWeekendInput(entry) {
  const project = normalizeProjectName(entry?.projectName);
  const summary = normalizeText(entry?.workSummary);
  const ado = normalizeAdo(entry?.adoTickets);
  const rawHours = entry?.hours;
  const isNonWorking = isNonApprovableProject(project);

  if (!isNonWorking && project) return true;

  if (rawHours !== "" && rawHours != null) {
    const hours = toNumber(rawHours);
    if (Number.isFinite(hours) && hours > 0) return true;
  }

  if (!isNonWorking && summary && summary.toLowerCase() !== "weekend") return true;
  if (!isNonWorking && ado && ado.toLowerCase() !== "n/a") return true;

  return false;
}

/**
 * Payload shape expected:
 * days: [
 *   {
 *     timesheetDayId,
 *     dayName,
 *     entries: [
 *       { entryId?, projectName, workSummary, adoTickets, hours }
 *     ]
 *   }
 * ]
 */
function normalizeIncomingDays(rawDays, dbDays = []) {
  if (!Array.isArray(rawDays)) return [];

  const dayById = new Map(
    (dbDays || []).map(d => [Number(d.TimesheetDayId), d])
  );

  return rawDays.map((d) => {
    const timesheetDayId = Number(d.timesheetDayId);
    const dbDay = dayById.get(timesheetDayId);

    const dayName = String(d.dayName || dbDay?.DayName || "").trim();
    const entries = Array.isArray(d.entries) ? d.entries : [];

    return {
      timesheetDayId,
      dayName,
      entries: entries.map((e, idx) => ({
        entryId: e?.entryId ? Number(e.entryId) : null,
        entryOrder: Number(e?.entryOrder || idx + 1),
        projectName: normalizeProjectName(e?.projectName),
        workSummary: normalizeText(e?.workSummary),
        adoTickets: normalizeAdo(e?.adoTickets),
        hours: e?.hours === "" || e?.hours == null ? "" : e.hours
      }))
    };
  });
}

/**
 * ✅ Shared validation for BOTH Save Draft and Submit
 * - any day can use Non-Working with 0 hours
 * - any other project requires hours > 0
 */
function validateDayPayload(days, dayById, { submitMode = false } = {}) {
  const errors = [];
  let weekTotal = 0;

  if (!Array.isArray(days) || days.length !== 7) {
    errors.push("Exactly 7 days are required.");
    return errors;
  }

  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const d = days[dayIndex];
    const id = Number(d.timesheetDayId);
    const dbDay = dayById.get(id);

    if (!Number.isInteger(id) || !dbDay) {
      errors.push(`Day ${dayIndex + 1}: Invalid timesheetDayId.`);
      continue;
    }

    const dayName = String(d.dayName || dbDay.DayName || "").trim();
    const rowLabel = `${dayName || `Day ${dayIndex + 1}`}`;

    const entries = Array.isArray(d.entries) ? d.entries : [];

    if (entries.length === 0) {
      errors.push(`${rowLabel}: At least one entry is required.`);
      continue;
    }

    if (entries.length > MAX_ENTRIES_PER_DAY) {
      errors.push(`${rowLabel}: Maximum ${MAX_ENTRIES_PER_DAY} entries allowed.`);
    }

    let dayTotal = 0;

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const entryLabel = `${rowLabel} - Entry ${i + 1}`;

      const projectName = normalizeProjectName(e.projectName);
      const workSummary = normalizeText(e.workSummary);
      const adoTickets = normalizeAdo(e.adoTickets);
      const rawHours = e.hours;
      const isNonWorking = isNonApprovableProject(projectName);

      if (rawHours !== "" && rawHours != null) {
        const hours = toNumber(rawHours);
        if (!Number.isFinite(hours)) {
          errors.push(`${entryLabel}: Hours must be a number.`);
        } else if (hours < 0) {
          errors.push(`${entryLabel}: Hours cannot be negative.`);
        } else {
          dayTotal += hours;
        }
      }

      if (submitMode) {
        const hours = rawHours === "" || rawHours == null ? NaN : toNumber(rawHours);

        if (!projectName) {
          errors.push(`${entryLabel}: Project is required.`);
        }

        if (!workSummary) {
          errors.push(`${entryLabel}: Work Summary is required.`);
        }

        // if (!adoTickets) {
        //   errors.push(`${entryLabel}: ADO Ticket is required.`);
        // }

        if (!Number.isFinite(hours)) {
          errors.push(`${entryLabel}: Hours must be a number.`);
        } 
        else if (hours < 0) {
          errors.push(`${entryLabel}: Hours cannot be negative.`);
        } 
        else if (!isNonWorking && hours <= 0) {
          errors.push(`${entryLabel}: Hours must be greater than 0.`);
        }
      }
    }

    if (dayTotal > MAX_HOURS_PER_DAY) {
      errors.push(`${rowLabel}: Total hours cannot exceed ${MAX_HOURS_PER_DAY}.`);
    }

    weekTotal += dayTotal;
  }

  if (weekTotal > MAX_HOURS_PER_WEEK) {
    errors.push(`Total weekly hours (${weekTotal}) cannot exceed ${MAX_HOURS_PER_WEEK}.`);
  }

  return errors;
}

function applyWeekendDefaults(days) {
  return days.map((d) => {
    const weekend = isWeekendDayName(d.dayName);
    if (!weekend) return d;

    const entries = (Array.isArray(d.entries) ? d.entries : []).map((e, idx) => {
      const hasWork = hasMeaningfulWeekendInput(e);

      if (hasWork) {
        return {
          ...e,
          entryId: e?.entryId || null,
          entryOrder: e?.entryOrder || idx + 1,
          projectName: normalizeProjectName(e.projectName),
          workSummary: normalizeText(e.workSummary),
          adoTickets: normalizeAdo(e.adoTickets),
          hours: e?.hours === "" || e?.hours == null ? "" : e.hours
        };
      }

      return {
        entryId: e?.entryId || null,
        entryOrder: e?.entryOrder || idx + 1,
        projectName: normalizeProjectName(e.projectName) || "Non-Working",
        workSummary: normalizeText(e.workSummary) || "Weekend",
        adoTickets: normalizeAdo(e.adoTickets) || "N/A",
        hours: e?.hours === "" || e?.hours == null ? 0 : e.hours
      };
    });

    return {
      ...d,
      entries: entries.length ? entries : [{
        entryId: null,
        entryOrder: 1,
        projectName: "Non-Working",
        workSummary: "Weekend",
        adoTickets: "N/A",
        hours: 0
      }]
    };
  });
}

function collectUsedProjectNames(days) {
  const hoursByProject = new Map();

  for (const d of days) {
    for (const e of d.entries || []) {
      const projectName = normalizeProjectName(e.projectName);
      const hours = toNumber(e.hours);

      if (!projectName) continue;
      if (isNonApprovableProject(projectName)) continue;
      if (!Number.isFinite(hours)) continue;
      if (hours <= 0) continue;

      hoursByProject.set(projectName, (hoursByProject.get(projectName) || 0) + hours);
    }
  }

  return [...hoursByProject.entries()]
    .filter(([_, totalHours]) => Number(totalHours) > 0)
    .map(([projectName]) => projectName);
}

async function listMyTimesheets(req, res) {
  const rows = await timesheetService.listTimesheetsForVendor(req.user.UserId);
  const weekEnding = String(req.query.weekEnding || "").trim();

  return res.render("timesheets", { rows, weekEnding, error: null, errors: [] });
}

async function editTimesheet(req, res) {
  const weekEnding = String(req.query.weekEnding || "").trim();

  if (!weekEnding) return res.redirect("/timesheets");

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

  const days = await timesheetService.listTimesheetDaysWithEntries(timesheetId);
  const projects = await projectService.listActiveProjects();

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
    rejectedProjects,
    maxEntriesPerDay: MAX_ENTRIES_PER_DAY,
    error: null
  });
}

async function saveTimesheet(req, res) {
  const timesheetId = Number(req.params.id);
  if (!Number.isInteger(timesheetId) || timesheetId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid timesheet id" });
  }

  const incomingDays = req.body?.days || [];
  if (!Array.isArray(incomingDays)) {
    return res.status(400).json({ ok: false, message: "days must be an array" });
  }

  try {
    const dbDays = await timesheetService.listTimesheetDays(timesheetId);
    const dayById = new Map(
      (dbDays || []).map(d => [Number(d.TimesheetDayId), { DayName: d.DayName, WorkDate: d.WorkDate }])
    );

    const days = normalizeIncomingDays(incomingDays, dbDays);

    const badId = days.find(d => !Number.isFinite(Number(d.timesheetDayId)) || !dayById.has(Number(d.timesheetDayId)));
    if (badId) {
      return res.status(400).json({
        ok: false,
        message: "Save payload is missing a valid timesheetDayId for one or more days. Please refresh the page and try again."
      });
    }

    const capErrors = validateDayPayload(days, dayById, { submitMode: false });
    if (capErrors.length) {
      const msg = "Please fix hours before saving:\n" + capErrors.map(e => `• ${e}`).join("\n");
      return res.status(400).json({ ok: false, message: msg, errors: capErrors });
    }

    const normalizedForSave = applyWeekendDefaults(days);

    await timesheetService.updateTimesheetDayEntriesEditable(timesheetId, normalizedForSave);
    await timesheetService.addAudit(timesheetId, req.user.UserId, "Saved");

    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ ok: false, message: err?.message || "Save failed" });
  }
}

async function submitTimesheet(req, res) {
  const timesheetId = Number(req.params.id);
  const weekEnding = String(req.body?.weekEnding || "").trim();
  const incomingDays = req.body?.days || [];

  /**
   * Submit is called by fetch/JavaScript, so keep this endpoint JSON-only.
   * This avoids Azure/iisnode returning generic HTML "Bad Request" pages
   * and keeps local/Azure behavior consistent.
   */
  const fail = (status, message, extra = {}) => {
    return res.status(status).json({
      ok: false,
      message,
      ...extra
    });
  };

  try {
    const subTeamId = Number(req.user?.SubTeamId || 0);
    if (!subTeamId) {
      return fail(400, "Your SubTeam is not configured in dbo.Users. Ask admin to update your profile.");
    }

    if (!Number.isInteger(timesheetId) || timesheetId <= 0) {
      return fail(400, "Invalid timesheet id");
    }

    if (!weekEnding) {
      return fail(400, "weekEnding is required");
    }

    if (!isValidISODate(weekEnding) || !isWeekEndingAllowed(weekEnding)) {
      return fail(400, "Invalid weekEnding date. Please select a valid week ending date.");
    }

    if (!Array.isArray(incomingDays) || incomingDays.length !== 7) {
      return fail(400, "Submit must include 7 day objects.");
    }

    const header = await timesheetService.getTimesheetHeader(timesheetId);
    if (!header) {
      return fail(404, "Timesheet not found");
    }

    if (!["Draft", "Rejected"].includes(header.Status)) {
      return fail(400, "Timesheet cannot be submitted.");
    }

    await timesheetService.ensure7Days(timesheetId, weekEnding);

    const dbDays = await timesheetService.listTimesheetDays(timesheetId);
    const projects = await projectService.listActiveProjects();

    const dayById = new Map(
      dbDays.map(d => [Number(d.TimesheetDayId), { DayName: d.DayName, WorkDate: d.WorkDate }])
    );

    const days = normalizeIncomingDays(incomingDays, dbDays);

    const badId = days.find(d => !Number.isFinite(Number(d.timesheetDayId)) || !dayById.has(Number(d.timesheetDayId)));
    if (badId) {
      return fail(
        400,
        "Submit payload is missing a valid timesheetDayId for one or more days. Please refresh the page and try again."
      );
    }

    const normalizedForSubmit = applyWeekendDefaults(days);
    const errors = validateDayPayload(normalizedForSubmit, dayById, { submitMode: true });

    if (errors.length) {
      const msg =
        "Please complete all fields correctly before submitting:\n" +
        errors.map(e => `• ${e}`).join("\n");

      return fail(400, msg, { errors });
    }

    await timesheetService.updateTimesheetDayEntriesEditable(timesheetId, normalizedForSubmit);

    const usedProjectNames = collectUsedProjectNames(normalizedForSubmit);
    const projectByName = new Map(
      (projects || []).map(p => [String(p.ProjectName || "").trim().toLowerCase(), p])
    );

    for (const projectName of usedProjectNames) {
      const p = projectByName.get(String(projectName).trim().toLowerCase());
      if (!p?.ProjectId) {
        return fail(400, `Project "${projectName}" is not a valid active project.`);
      }

      /*const approvers = await projectService.getApproversForProjectAndSubTeam(
        Number(p.ProjectId),
        subTeamId
      );

      if (!approvers || approvers.length === 0) {
        const msg =
          `Project "${projectName}" is not mapped to approvers for your SubTeam. ` +
          "Ask admin to configure ProjectSubTeamApprovers.";

        return fail(400, msg);
      }*/
    }

    if (String(header.Status) !== "Rejected") {
      await approvalService.clearApprovalTasks(timesheetId);
    }

   // for (const projectName of usedProjectNames) {
   //   const p = projectByName.get(String(projectName).trim().toLowerCase());
   //   if (!p?.ProjectId) continue;
   // const approvers = await projectService.getApproversForProjectAndSubTeam(
   //     Number(p.ProjectId),
   //     subTeamId
   //   );

   //   for (const a of approvers) {
       // await approvalService.ensureApprovalTask(timesheetId, Number(p.ProjectId), Number(a.UserId));
   // } }
    // For simplicity, assign all approvals to the default approver on submission.}

    const defaultApprover = await approvalService.getDefaultApprover();

    for (const projectName of usedProjectNames) {
      const p = projectByName.get(String(projectName).trim().toLowerCase());
      if (!p?.ProjectId) continue;
      await approvalService.ensureApprovalTask(
        timesheetId,
        Number(p.ProjectId),
        Number(defaultApprover.UserId)
      );
    }

    if (String(header.Status) === "Rejected") {
      await approvalService.reopenApprovalsForResubmission(timesheetId);
    }

    await timesheetService.markSubmitted(timesheetId);
    await timesheetService.addAudit(timesheetId, req.user.UserId, "Submitted");

    return res.json({ ok: true });
  } catch (err) {
    console.error("submitTimesheet failed:", err);
    return fail(500, err?.message || "Submit failed");
  }
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

  const approval = await approvalService.getRejectedApprovalForVendor(approvalId, req.user.UserId);
  if (!approval || Number(approval.TimesheetId) !== timesheetId) {
    return res.status(404).json({ ok: false, message: "Rejected approval not found for this timesheet." });
  }

  await approvalService.setVendorReply(approvalId, req.user.UserId, reply);
  await timesheetService.addAudit(
    timesheetId,
    req.user.UserId,
    `Vendor replied to rejection (ApprovalId=${approvalId})`
  );

  return res.json({ ok: true });
}

module.exports = {
  listMyTimesheets,
  editTimesheet,
  saveTimesheet,
  submitTimesheet,
  replyToRejection
};
