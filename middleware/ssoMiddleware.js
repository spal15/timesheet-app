const { getUserByEmail } = require("../services/userService");

function parseClientPrincipal(req) {
  const b64 = req.header("X-MS-CLIENT-PRINCIPAL");
  if (!b64) return null;

  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getEmailFromPrincipal(principal) {
  if (!principal || !Array.isArray(principal.claims)) return null;

  const preferredClaimTypes = [
    "preferred_username",
    "emailaddress",
    "emails",
    "upn",
    "email"
  ];

  for (const key of preferredClaimTypes) {
    const c = principal.claims.find(x =>
      String(x.typ || "").toLowerCase().includes(key)
    );
    if (c && c.val) return String(c.val).toLowerCase();
  }

  if (principal.userDetails) return String(principal.userDetails).toLowerCase();
  return null;
}

function getEmailFromHeaders(req) {
  const direct = req.header("X-MS-CLIENT-PRINCIPAL-NAME");
  if (direct) return String(direct).toLowerCase();

  const principal = parseClientPrincipal(req);
  return getEmailFromPrincipal(principal);
}

async function requireUser(req, res, next) {
  try {
    let email = getEmailFromHeaders(req);

    // Allow DEV_EMAIL only outside production
    if (!email && process.env.NODE_ENV !== "production") {
      const devEmail = String(process.env.DEV_EMAIL || "").trim().toLowerCase();
      if (devEmail) {
        email = devEmail;
      }
    }

    if (!email) {
      return res.status(401).send(
        "Not authenticated. Enable App Service Authentication (EasyAuth) or set DEV_EMAIL in .env for local testing."
      );
    }

    const user = await getUserByEmail(email);

    if (!user) {
      return res.status(403).send(`User ${email} is not authorized. Add them to dbo.Users.`);
    }

    user.DisplayTitle = [
      user.DisplayName,
      user.TeamName,
      user.SubTeamName
    ].filter(Boolean).join(" • ");

    req.user = user;
    res.locals.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).send("Not authenticated");

    const userRole = String(req.user.Role || "").toLowerCase();
    const allowedRoles = roles.map(r => String(r).toLowerCase());

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).send("Forbidden");
    }

    next();
  };
}

module.exports = { requireUser, requireRole };