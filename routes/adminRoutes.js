const express = require("express");
const multer = require("multer");

const router = express.Router();
const adminController = require("../controllers/adminController");
const { requireRole } = require("../middleware/ssoMiddleware");
const adminReportController = require("../controllers/adminReportController");


const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB
  }
});

router.get("/admin/projects", requireRole("Admin"), adminController.projectsPage);
router.post("/admin/projects", requireRole("Admin"), adminController.upsertProject);

router.get("/admin/vendor-upload", requireRole("Admin"), adminController.getVendorUploadPage);
router.post(
  "/admin/vendor-upload",
  requireRole("Admin"),
  upload.single("vendorFile"),
  adminController.uploadVendorUsers
);

router.get("/admin/vendor-users", requireRole("Admin"), adminController.getVendorUsersPage);

router.get("/admin/internal-upload", requireRole("Admin"), adminController.getInternalUploadPage);
router.post(
  "/admin/internal-upload",
  requireRole("Admin"),
  upload.single("internalFile"),
  adminController.uploadInternalUsers
);

router.get("/admin/internal-users", requireRole("Admin"), adminController.getInternalUsersPage);

router.get("/admin/project-approver-mapping", requireRole("Admin"), adminController.getProjectApproverMappingPage);

router.post("/admin/project-approver-mapping", requireRole("Admin"), adminController.addProjectApproverMapping);

router.get("/admin/subteams-by-team/:teamId", requireRole("Admin"), adminController.getSubTeamsByTeam);

router.get("/admin/approvers-by-subteam/:subTeamId", requireRole("Admin"), adminController.getApproversBySubTeam);

router.post("/admin/project-approver-mapping/delete", requireRole("Admin"), adminController.deleteProjectApproverMapping);

router.get("/admin", requireRole("Admin"), adminController.adminHomePage);

router.get('/admin/projects', requireRole("Admin"), adminController.projectPage);

router.post('/admin/projects/add', requireRole("Admin"), adminController.addProject);

router.post('/admin/projects/:projectId/toggle', requireRole("Admin"), adminController.toggleProject);

router.get('/admin/vendors/manage', requireRole("Admin"), adminController.vendorsPage);

router.post('/admin/vendors/add', requireRole("Admin"), adminController.addVendor);

router.post('/admin/vendors/:vendorId/toggle', requireRole("Admin"), adminController.toggleVendor);

router.get(
  "/admin/reports",
  requireRole("Admin"),
  adminReportController.reportPage
);

router.get(
  "/admin/reports/monthly-vendor-hours",
  requireRole("Admin"),
  adminReportController.downloadMonthlyVendorHours
);

router.get(
  "/admin/reports/monthly-resource-hours",
  requireRole("Admin"),
  adminReportController.downloadMonthlyResourceHours
);

router.get(
  "/admin/reports/weekly-vendor-time-report",
  requireRole("Admin"),
  adminReportController.downloadWeeklyVendorTimeReport
);

module.exports = router;
