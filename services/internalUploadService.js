const xlsx = require("xlsx");
const { getPool, sql } = require("../db/db");

function clean(value) {
  return String(value || "").trim();
}

function cleanLower(value) {
  return clean(value).toLowerCase();
}

function isBlank(value) {
  return clean(value) === "";
}

function readInternalSheet(buffer) {
  const workbook = xlsx.read(buffer, { type: "buffer" });

  const sheetName = workbook.SheetNames.find(
    name => cleanLower(name) === "internal"
  );

  if (!sheetName) {
    throw new Error("Excel file must contain a sheet named 'Internal'.");
  }

  const sheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false
  });
}

async function loadReferenceMaps(pool) {
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

  const teamsByName = new Map();
  const subTeamsByName = new Map();

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
    teamsByName,
    subTeamsByName
  };
}

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

async function insertInternalUser(pool, userData) {
  const request = pool.request();

  request.input("Email", sql.NVarChar(255), userData.Email);
  request.input("DisplayName", sql.NVarChar(255), userData.DisplayName);
  request.input("Role", sql.NVarChar(50), "Approver");
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
      NULL,
      @TeamId,
      @SubTeamId,
      @IsActive,
      GETDATE()
    )
  `);
}

function resolveSubTeam(subTeamsByName, subTeamName, teamId) {
  const matches = subTeamsByName.get(cleanLower(subTeamName)) || [];
  if (!matches.length) return null;
  return matches.find(x => x.TeamId === teamId) || null;
}

function mapRow(rawRow, index) {
  return {
    rowNumber: index + 2,
    Email: clean(rawRow["Email"]),
    DisplayName: clean(rawRow["Display Name"]),
    Team: clean(rawRow["Team"]),
    SubTeam: clean(rawRow["SubTeam"])
  };
}

function validateRequiredFields(row) {
  const errors = [];

  if (isBlank(row.Email)) errors.push("Email is required");
  if (isBlank(row.DisplayName)) errors.push("Display Name is required");
  if (isBlank(row.Team)) errors.push("Team is required");
  if (isBlank(row.SubTeam)) errors.push("SubTeam is required");

  return errors;
}

function validateEmailFormat(email) {
  const value = clean(email);
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(value);
}

async function processInternalUpload(buffer, options = {}) {
  const pool = await getPool();
  const rawRows = readInternalSheet(buffer);
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

      await insertInternalUser(pool, {
        Email: row.Email,
        DisplayName: row.DisplayName,
        TeamId: team.TeamId,
        SubTeamId: subTeam.SubTeamId
      });

      detail.status = "Inserted";
      detail.message = "Internal user added successfully";
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

async function getAllInternalUsers() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT
      u.UserId,
      u.DisplayName,
      u.Email,
      u.Role,
      u.IsActive,
      u.CreatedAt,
      t.TeamName,
      st.SubTeamName
    FROM dbo.Users u
    LEFT JOIN dbo.Teams t
      ON u.TeamId = t.TeamId
    LEFT JOIN dbo.SubTeams st
      ON u.SubTeamId = st.SubTeamId
    WHERE LOWER(LTRIM(RTRIM(u.Role))) = 'approver'
    ORDER BY u.DisplayName, u.Email
  `);

  return result.recordset;
}

module.exports = {
  processInternalUpload,
  getAllInternalUsers
};