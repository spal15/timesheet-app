const xlsx = require("xlsx");
const { getPool, sql } = require("../db/db");
/**
 * Normalize string for comparisons
 */
function clean(value) {
  return String(value || "").trim();
}

function cleanLower(value) {
  return clean(value).toLowerCase();
}

function isBlank(value) {
  return clean(value) === "";
}

/**
 * Reads the Vendor sheet and converts to row objects.
 */
function readVendorSheet(buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer" });

  const vendorSheetName = workbook.SheetNames.find(
    name => cleanLower(name) === "vendor"
  );

  if (!vendorSheetName) {
    throw new Error("Excel file must contain a sheet named 'Vendor'.");
  }

  const sheet = workbook.Sheets[vendorSheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false
  });

  return rows;
}

/**
 * Loads master reference data from DB
 */
async function loadReferenceMaps(pool) {
  const vendorResult = await pool.request().query(`
    SELECT VendorId, VendorName
    FROM dbo.Vendors
    WHERE ISNULL(IsActive, 1) = 1
  `);

  const teamResult = await pool.request().query(`
    SELECT TeamId, TeamName
    FROM dbo.Teams
    WHERE ISNULL(IsActive, 1) = 1
  `);

  const subTeamResult = await pool.request().query(`
    SELECT SubTeamId, SubTeamName, TeamId
    FROM dbo.SubTeams
    WHERE ISNULL(IsActive, 1) = 1
  `);

  const vendorsByName = new Map();
  const teamsByName = new Map();
  const subTeamsByName = new Map();

  for (const row of vendorResult.recordset) {
    vendorsByName.set(cleanLower(row.VendorName), {
      VendorId: row.VendorId,
      VendorName: row.VendorName
    });
  }

  for (const row of teamResult.recordset) {
    teamsByName.set(cleanLower(row.TeamName), {
      TeamId: row.TeamId,
      TeamName: row.TeamName
    });
  }

  for (const row of subTeamResult.recordset) {
    const key = cleanLower(row.SubTeamName);
    if (!subTeamsByName.has(key)) {
      subTeamsByName.set(key, []);
    }

    subTeamsByName.get(key).push({
      SubTeamId: row.SubTeamId,
      SubTeamName: row.SubTeamName,
      TeamId: row.TeamId
    });
  }

  return {
    vendorsByName,
    teamsByName,
    subTeamsByName
  };
}

/**
 * Checks whether user already exists
 */
async function userExists(pool, email) {
  const result = await pool.request()
    .input("Email", sql.NVarChar(255), email)
    .query(`
      SELECT TOP 1 UserId
      FROM dbo.Users
      WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@Email)))
    `);

  return result.recordset.length > 0;
}

/**
 * Insert user row
 */
async function insertUser(pool, userData) {
  const request = pool.request();

  request.input("Email", sql.NVarChar(255), userData.Email);
  request.input("DisplayName", sql.NVarChar(255), userData.DisplayName);
  request.input("Role", sql.NVarChar(50), "Vendor");
  request.input("VendorId", sql.Int, userData.VendorId);
  request.input("TeamId", sql.Int, userData.TeamId);
  request.input("SubTeamId", sql.Int, userData.SubTeamId);
  request.input("IsActive", sql.Bit, true);

  await request.query(`
    INSERT INTO dbo.Users
    (
      Email,
      DisplayName,
      Role,
      VendorId,
      TeamId,
      SubTeamId,
      IsActive,
      CreatedAt
    )
    VALUES
    (
      @Email,
      @DisplayName,
      @Role,
      @VendorId,
      @TeamId,
      @SubTeamId,
      @IsActive,
      GETDATE()
    )
  `);
}

/**
 * Resolve subteam by name and optionally validate that it belongs to the selected team
 */
function resolveSubTeam(subTeamsByName, subTeamName, teamId) {
  const matches = subTeamsByName.get(cleanLower(subTeamName)) || [];

  if (!matches.length) return null;

  const teamMatched = matches.find(x => x.TeamId === teamId);
  if (teamMatched) return teamMatched;

  return null;
}

function mapRow(rawRow, index) {
  return {
    rowNumber: index + 2, // Excel row number, assuming row 1 is header
    Email: clean(rawRow["Email"]),
    DisplayName: clean(rawRow["Display Name"]),
    Team: clean(rawRow["Team"]),
    SubTeam: clean(rawRow["SubTeam"]),
    VendorName: clean(rawRow["Vendor Name"])
  };
}

function validateRequiredFields(row) {
  const errors = [];

  if (isBlank(row.Email)) errors.push("Email is required");
  if (isBlank(row.DisplayName)) errors.push("Display Name is required");
  if (isBlank(row.Team)) errors.push("Team is required");
  if (isBlank(row.SubTeam)) errors.push("SubTeam is required");
  if (isBlank(row.VendorName)) errors.push("Vendor Name is required");

  return errors;
}

function validateEmailFormat(email) {
  const value = clean(email);
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(value);
}

async function processVendorUpload(buffer, options = {}) {
  const pool = await getPool();

  const rawRows = readVendorSheet(buffer);
  const rows = rawRows.map(mapRow);

  const refs = await loadReferenceMaps(pool);

  const result = {
    totalRows: rows.length,
    inserted: 0,
    skipped: 0,
    failed: 0,
    uploadedBy: options.uploadedBy || null,
    details: []
  };

  for (const row of rows) {
    const detail = {
      rowNumber: row.rowNumber,
      email: row.Email,
      displayName: row.DisplayName,
      vendorName: row.VendorName,
      team: row.Team,
      subTeam: row.SubTeam,
      status: "",
      message: ""
    };

    try {
      const requiredErrors = validateRequiredFields(row);
      if (requiredErrors.length) {
        detail.status = "Failed";
        detail.message = requiredErrors.join("; ");
        result.failed++;
        result.details.push(detail);
        continue;
      }

      if (!validateEmailFormat(row.Email)) {
        detail.status = "Failed";
        detail.message = "Invalid email format";
        result.failed++;
        result.details.push(detail);
        continue;
      }

      const vendor = refs.vendorsByName.get(cleanLower(row.VendorName));
      if (!vendor) {
        detail.status = "Failed";
        detail.message = `Vendor not found: ${row.VendorName}`;
        result.failed++;
        result.details.push(detail);
        continue;
      }

      const team = refs.teamsByName.get(cleanLower(row.Team));
      if (!team) {
        detail.status = "Failed";
        detail.message = `Team not found: ${row.Team}`;
        result.failed++;
        result.details.push(detail);
        continue;
      }

      const subTeam = resolveSubTeam(refs.subTeamsByName, row.SubTeam, team.TeamId);
      if (!subTeam) {
        detail.status = "Failed";
        detail.message = `SubTeam not found for Team '${row.Team}': ${row.SubTeam}`;
        result.failed++;
        result.details.push(detail);
        continue;
      }

      const exists = await userExists(pool, row.Email);
      if (exists) {
        detail.status = "Skipped";
        detail.message = "User already exists";
        result.skipped++;
        result.details.push(detail);
        continue;
      }

      await insertUser(pool, {
        Email: row.Email,
        DisplayName: row.DisplayName,
        VendorId: vendor.VendorId,
        TeamId: team.TeamId,
        SubTeamId: subTeam.SubTeamId
      });

      detail.status = "Inserted";
      detail.message = "User added successfully";
      result.inserted++;
      result.details.push(detail);
    } catch (err) {
      detail.status = "Failed";
      detail.message = err.message || "Unexpected error";
      result.failed++;
      result.details.push(detail);
    }
  }

  return result;
}

async function getAllVendorUsers() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT
      u.UserId,
      u.DisplayName,
      u.Email,
      u.Role,
      u.IsActive,
      u.CreatedAt,
      v.VendorName,
      t.TeamName,
      st.SubTeamName
    FROM dbo.Users u
    LEFT JOIN dbo.Vendors v
      ON u.VendorId = v.VendorId
    LEFT JOIN dbo.Teams t
      ON u.TeamId = t.TeamId
    LEFT JOIN dbo.SubTeams st
      ON u.SubTeamId = st.SubTeamId
    WHERE LOWER(LTRIM(RTRIM(u.Role))) = 'vendor'
    ORDER BY u.DisplayName, u.Email
  `);

  return result.recordset;
}

module.exports = {
  processVendorUpload,
  getAllVendorUsers
};