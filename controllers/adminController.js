const projectService = require("../services/projectService");

async function projectsPage(req, res) {
  const projects = await projectService.listProjectsWithApprovers();
  const approvers = await projectService.listApproverUsers();
  return res.render("admin_projects", { projects, approvers, error: null });
}

async function upsertProject(req, res) {
  const projectName = String(req.body.projectName || "").trim();
  const approverUserId = Number(req.body.approverUserId || 0);

  if (!projectName) return res.status(400).send("Project name required");
  if (!approverUserId) return res.status(400).send("Approver required");

  await projectService.upsertProjectAndApprover(projectName, approverUserId);
  return res.redirect("/admin/projects");
}

module.exports = { projectsPage, upsertProject };
