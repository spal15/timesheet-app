const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { requireRole } = require("../middleware/ssoMiddleware");

router.get("/admin/projects", requireRole("Admin"), adminController.projectsPage);
router.post("/admin/projects", requireRole("Admin"), adminController.upsertProject);

module.exports = router;
