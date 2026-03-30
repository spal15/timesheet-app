const projectService = require("../services/projectService");
const vendorUploadService = require("../services/vendorUploadService");
const internalUploadService = require("../services/internalUploadService");
const projectApproverMappingService = require("../services/projectApproverMappingService");


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

async function getVendorUploadPage(req, res, next) {
  try {
    res.render("admin/vendor-upload", {
      title: "Vendor Upload",
      result: null,
      errorMessage: null
    });
  } catch (err) {
    next(err);
  }
}

async function uploadVendorUsers(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).render("admin/vendor-upload", {
        title: "Vendor Upload",
        result: null,
        errorMessage: "Please select an Excel file to upload."
      });
    }

    const result = await vendorUploadService.processVendorUpload(req.file.buffer, {
      uploadedBy: req.user?.Email || req.user?.email || null
    });

    res.render("admin/vendor-upload", {
      title: "Vendor Upload",
      result,
      errorMessage: null
    });
  } catch (err) {
    res.status(500).render("admin/vendor-upload", {
      title: "Vendor Upload",
      result: null,
      errorMessage: err.message || "Unexpected error occurred while processing the upload."
    });
  }
}

async function getVendorUsersPage(req, res, next) {
  try {
    const users = await vendorUploadService.getAllVendorUsers();

    res.render("admin/vendor-users", {
      title: "Vendor Users",
      users
    });
  } catch (err) {
    next(err);
  }
}

async function getInternalUploadPage(req, res, next) {
  try {
    res.render("admin/internal-upload", {
      title: "Internal User Upload",
      result: null,
      errorMessage: null
    });
  } catch (err) {
    next(err);
  }
}

async function uploadInternalUsers(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).render("admin/internal-upload", {
        title: "Internal User Upload",
        result: null,
        errorMessage: "Please select an Excel file to upload."
      });
    }

    const result = await internalUploadService.processInternalUpload(req.file.buffer, {
      uploadedBy: req.user?.Email || req.user?.email || null
    });

    res.render("admin/internal-upload", {
      title: "Internal User Upload",
      result,
      errorMessage: null
    });
  } catch (err) {
    res.status(500).render("admin/internal-upload", {
      title: "Internal User Upload",
      result: null,
      errorMessage: err.message || "Unexpected error occurred while processing the upload."
    });
  }
}

async function getInternalUsersPage(req, res, next) {
  try {
    const users = await internalUploadService.getAllInternalUsers();

    res.render("admin/internal-users", {
      title: "Internal Users",
      users
    });
  } catch (err) {
    next(err);
  }
}

async function getProjectApproverMappingPage(req, res, next) {
  try {
    const [projects, teams, mappings] = await Promise.all([
      projectApproverMappingService.getProjects(),
      projectApproverMappingService.getTeams(),
      projectApproverMappingService.getCurrentMappings()
    ]);

    res.render("admin/project-approver-mapping", {
      title: "Project Approver Mapping",
      projects,
      teams,
      mappings,
      errorMessage: null,
      successMessage: null
    });
  } catch (err) {
    next(err);
  }
}

async function addProjectApproverMapping(req, res, next) {
  try {
    const { projectId, teamId, subTeamId, approverEmail, isPrimary } = req.body;

    await projectApproverMappingService.addMapping({
      projectId,
      teamId,
      subTeamId,
      approverEmail,
      isPrimary
    });

    const [projects, teams, mappings] = await Promise.all([
      projectApproverMappingService.getProjects(),
      projectApproverMappingService.getTeams(),
      projectApproverMappingService.getCurrentMappings()
    ]);

    res.render("admin/project-approver-mapping", {
      title: "Project Approver Mapping",
      projects,
      teams,
      mappings,
      errorMessage: null,
      successMessage: "Mapping added successfully."
    });
  } catch (err) {
    const [projects, teams, mappings] = await Promise.all([
      projectApproverMappingService.getProjects(),
      projectApproverMappingService.getTeams(),
      projectApproverMappingService.getCurrentMappings()
    ]);

    res.status(400).render("admin/project-approver-mapping", {
      title: "Project Approver Mapping",
      projects,
      teams,
      mappings,
      errorMessage: err.message || "Unable to add mapping.",
      successMessage: null
    });
  }
}

async function getSubTeamsByTeam(req, res, next) {
  try {
    const teamId = Number(req.params.teamId);
    const subTeams = await projectApproverMappingService.getSubTeamsByTeam(teamId);
    res.json(subTeams);
  } catch (err) {
    next(err);
  }
}

async function getApproversBySubTeam(req, res, next) {
  try {
    const subTeamId = Number(req.params.subTeamId);
    const users = await projectApproverMappingService.getApproversBySubTeam(subTeamId);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

async function deleteProjectApproverMapping(req, res, next) {
  try {
    const { mappingId } = req.body;
    await projectApproverMappingService.deleteMapping(mappingId);
    res.redirect("/admin/project-approver-mapping");
  } catch (err) {
    next(err);
  }
}

async function adminHomePage(req, res, next) {
  try {
    res.render("admin/index", {
      title: "Admin Dashboard"
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { 
  projectsPage, upsertProject, getVendorUploadPage, uploadVendorUsers, getVendorUsersPage,
  getInternalUploadPage, uploadInternalUsers, getInternalUsersPage, getProjectApproverMappingPage, 
  addProjectApproverMapping, getSubTeamsByTeam, getApproversBySubTeam, deleteProjectApproverMapping,
  adminHomePage
};
