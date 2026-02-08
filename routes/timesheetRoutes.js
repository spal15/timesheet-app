const express = require("express");
const router = express.Router();
const timesheetController = require("../controllers/timesheetController");
const { requireRole } = require("../middleware/ssoMiddleware");
const { validateSubmitTimesheet } = require("../services/validationService");

function submitValidationMiddleware(req, res, next) {
  const { rows, errors } = validateSubmitTimesheet(req.body);

  req.validatedRows = rows;
  req.validationErrors = errors;

  return next();
}

router.get("/timesheets", requireRole("Vendor"), timesheetController.listMyTimesheets);
router.get("/timesheets/edit", requireRole("Vendor"), timesheetController.editTimesheet);

router.post("/timesheets/:id/save", requireRole("Vendor"), timesheetController.saveTimesheet);

// ✅ Submit-only validation
router.post("/timesheets/:id/submit", requireRole("Vendor"), timesheetController.submitTimesheet);

module.exports = router;

