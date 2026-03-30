const projectService = require("../services/projectService");
const vendorUploadService = require("../services/vendorUploadService");

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


module.exports = { 
  projectsPage, upsertProject, getVendorUploadPage, uploadVendorUsers, getVendorUsersPage
 };
