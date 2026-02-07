require("dotenv").config();

const express = require("express");
const expressLayouts = require("express-ejs-layouts");

const timesheetRoutes = require("./routes/timesheetRoutes");
const approvalRoutes = require("./routes/approvalRoutes");
const adminRoutes = require("./routes/adminRoutes");

const { requireUser } = require("./middleware/ssoMiddleware");

const app = express();

app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

/**
 * SSO middleware:
 * - reads user email from EasyAuth headers
 * - loads user record (role) from dbo.Users
 */
app.use(requireUser);

// Home
app.get("/", (req, res) => res.redirect("/home"));
app.get("/home", (req, res) => res.render("home"));

// Feature routes
app.use(timesheetRoutes);
app.use(approvalRoutes);
app.use(adminRoutes);

// Simple health check
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => {
  console.log(`Running on http://localhost:${process.env.PORT || 3000}`);
});
