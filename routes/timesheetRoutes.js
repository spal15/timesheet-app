const express = require("express");
const router = express.Router();
const timesheetController = require("../controllers/timesheetController");
const { requireRole } = require("../middleware/ssoMiddleware");

router.get("/timesheets", requireRole("Vendor"), timesheetController.listMyTimesheets);
router.get("/timesheets/edit", requireRole("Vendor"), timesheetController.editTimesheet);
router.post("/timesheets/:id/save", requireRole("Vendor"), timesheetController.saveTimesheet);
router.post("/timesheets/:id/submit", requireRole("Vendor"), timesheetController.submitTimesheet);

module.exports = router;
