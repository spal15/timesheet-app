const express = require("express");
const router = express.Router();
const approvalController = require("../controllers/approvalController");
const { requireRole } = require("../middleware/ssoMiddleware");

router.get("/approvals", requireRole("Approver","Admin"), approvalController.listApprovals);
router.get("/approvals/:approvalId/view", requireRole("Approver","Admin"), approvalController.viewApproval);
router.post("/approvals/:approvalId/approve", requireRole("Approver","Admin"), approvalController.approve);
router.post("/approvals/:approvalId/reject", requireRole("Approver","Admin"), approvalController.reject);
router.get("/approvals/:id/review", approvalController.reviewPage);

module.exports = router;
