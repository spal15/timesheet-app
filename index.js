require("dotenv").config();

const path = require("path");
const express = require("express");
const expressLayouts = require("express-ejs-layouts");

const timesheetRoutes = require("./routes/timesheetRoutes");
const approvalRoutes = require("./routes/approvalRoutes");
const adminRoutes = require("./routes/adminRoutes");

const { requireUser } = require("./middleware/ssoMiddleware");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(expressLayouts);
app.set("layout", "layout");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/**
 * Static files (CSS/JS/images)
 * Use absolute path so it works reliably in Azure and local.
 */
app.use(express.static(path.join(__dirname, "public")));

// Optional: prevent aggressive caching during development
app.use((req, res, next) => {
  if (req.path.endsWith(".css")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

/**
 * SSO middleware:
 * - reads user email from EasyAuth headers (or DEV_EMAIL in local)
 * - loads user record (role) from dbo.Users
 */
app.use(requireUser);

// Debug route to verify CSS is served
app.get("/debug-static", (req, res) => {
  res.send(`
    <html>
      <head>
        <link rel="stylesheet" href="/styles.css?v=${Date.now()}">
        <style>
          /* Inline hard-proof fallback */
          .inline-proof { border: 5px solid #6a0dad; padding: 12px; border-radius: 12px; background:#fff; }
        </style>
      </head>
      <body>
        <h2>Styles Test</h2>

        <div class="inline-proof">
          If this box has a PURPLE border, HTML is fine.
        </div>

        <br/>

        <div class="entity">
          <div class="entity-name">Violet Card Test</div>
          <div class="key-value">
            <div class="field-content">
              <div class="field-label">Path</div>
              <div class="field-value">/styles.css</div>
            </div>
          </div>
        </div>

        <br/>
        <div class="navbar">
          <a href="#">Navbar style test</a>
        </div>
      </body>
    </html>
  `);
});

// Home
app.get("/", (req, res) => res.redirect("/home"));
app.get("/home", (req, res) => res.render("home"));

// Feature routes
app.use(timesheetRoutes);
app.use(approvalRoutes);
app.use(adminRoutes);

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Running on http://localhost:${port}`);
});
