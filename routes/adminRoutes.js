const express = require("express");
const multer = require("multer");

const router = express.Router();
const adminController = require("../controllers/adminController");
const { requireRole } = require("../middleware/ssoMiddleware");

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

module.exports = router;
