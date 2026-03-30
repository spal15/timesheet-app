const { getPool, sql } = require("../db/db");

async function getProjects() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT ProjectId, ProjectName
    FROM dbo.Projects
    WHERE ISNULL(IsActive, 1) = 1
    ORDER BY ProjectName
  `);

  return result.recordset;
}

async function getTeams() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT TeamId, TeamName
    FROM dbo.Teams
    WHERE ISNULL(IsActive, 1) = 1
    ORDER BY TeamName
  `);

  return result.recordset;
}

async function getSubTeamsByTeam(teamId) {
  const pool = await getPool();

  const result = await pool.request()
    .input("TeamId", sql.Int, teamId)
    .query(`
      SELECT SubTeamId, SubTeamName
      FROM dbo.SubTeams
      WHERE TeamId = @TeamId
        AND ISNULL(IsActive, 1) = 1
      ORDER BY SubTeamName
    `);

  return result.recordset;
}

async function getApproversBySubTeam(subTeamId) {
  const pool = await getPool();

  const result = await pool.request()
    .input("SubTeamId", sql.Int, subTeamId)
    .query(`
      SELECT
        Email,
        DisplayName
      FROM dbo.Users
      WHERE LOWER(LTRIM(RTRIM(Role))) = 'approver'
        AND SubTeamId = @SubTeamId
        AND ISNULL(IsActive, 1) = 1
      ORDER BY DisplayName, Email
    `);

  return result.recordset;
}

async function addMapping({ projectId, teamId, subTeamId, approverEmail, isPrimary }) {
  if (!projectId || !teamId || !subTeamId || !approverEmail) {
    throw new Error("Project, Team, SubTeam, and Approver are required.");
  }

  const pool = await getPool();
  const cleanEmail = String(approverEmail).trim().toLowerCase();
  const primaryFlag = isPrimary === "1" || isPrimary === "true" || isPrimary === true ? 1 : 0;

  const validation = await pool.request()
    .input("SubTeamId", sql.Int, Number(subTeamId))
    .input("TeamId", sql.Int, Number(teamId))
    .input("ApproverEmail", sql.NVarChar(255), cleanEmail)
    .query(`
      SELECT TOP 1 SubTeamId
      FROM dbo.SubTeams
      WHERE SubTeamId = @SubTeamId
        AND TeamId = @TeamId;

      SELECT TOP 1 Email
      FROM dbo.Users
      WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@ApproverEmail)))
        AND LOWER(LTRIM(RTRIM(Role))) = 'approver'
        AND SubTeamId = @SubTeamId
        AND ISNULL(IsActive, 1) = 1;
    `);

  const subTeamCheck = validation.recordsets[0] || [];
  const approverCheck = validation.recordsets[1] || [];

  if (!subTeamCheck.length) {
    throw new Error("Selected SubTeam does not belong to selected Team.");
  }

  if (!approverCheck.length) {
    throw new Error("Selected approver does not belong to selected SubTeam.");
  }

  const exists = await pool.request()
    .input("ProjectId", sql.Int, Number(projectId))
    .input("SubTeamId", sql.Int, Number(subTeamId))
    .input("ApproverEmail", sql.NVarChar(255), cleanEmail)
    .query(`
      SELECT TOP 1 ProjectSubTeamApproverId
      FROM dbo.ProjectSubTeamApprovers
      WHERE ProjectId = @ProjectId
        AND SubTeamId = @SubTeamId
        AND LOWER(LTRIM(RTRIM(ApproverEmail))) = LOWER(LTRIM(RTRIM(@ApproverEmail)))
        AND ISNULL(IsActive, 1) = 1
    `);

  if (exists.recordset.length) {
    throw new Error("This mapping already exists.");
  }

  if (primaryFlag === 1) {
    await pool.request()
      .input("ProjectId", sql.Int, Number(projectId))
      .input("SubTeamId", sql.Int, Number(subTeamId))
      .query(`
        UPDATE dbo.ProjectSubTeamApprovers
        SET IsPrimary = 0
        WHERE ProjectId = @ProjectId
          AND SubTeamId = @SubTeamId
          AND ISNULL(IsActive, 1) = 1
      `);
  }

  await pool.request()
    .input("ProjectId", sql.Int, Number(projectId))
    .input("SubTeamId", sql.Int, Number(subTeamId))
    .input("ApproverEmail", sql.NVarChar(255), cleanEmail)
    .input("IsPrimary", sql.Bit, primaryFlag)
    .query(`
      INSERT INTO dbo.ProjectSubTeamApprovers
      (
        ProjectId,
        SubTeamId,
        ApproverEmail,
        IsActive,
        IsPrimary,
        CreatedOn
      )
      VALUES
      (
        @ProjectId,
        @SubTeamId,
        @ApproverEmail,
        1,
        @IsPrimary,
        GETDATE()
      )
    `);
}

async function getCurrentMappings() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT
      psa.ProjectSubTeamApproverId,
      p.ProjectName,
      t.TeamName,
      st.SubTeamName,
      psa.ApproverEmail,
      u.DisplayName,
      psa.IsPrimary,
      psa.IsActive,
      psa.CreatedOn
    FROM dbo.ProjectSubTeamApprovers psa
    INNER JOIN dbo.Projects p
      ON psa.ProjectId = p.ProjectId
    INNER JOIN dbo.SubTeams st
      ON psa.SubTeamId = st.SubTeamId
    INNER JOIN dbo.Teams t
      ON st.TeamId = t.TeamId
    LEFT JOIN dbo.Users u
      ON LOWER(LTRIM(RTRIM(u.Email))) = LOWER(LTRIM(RTRIM(psa.ApproverEmail)))
    WHERE ISNULL(psa.IsActive, 1) = 1
    ORDER BY p.ProjectName, t.TeamName, st.SubTeamName, psa.IsPrimary DESC, psa.ApproverEmail
  `);

  return result.recordset;
}

async function deleteMapping(mappingId) {
  const pool = await getPool();

  await pool.request()
    .input("MappingId", sql.Int, Number(mappingId))
    .query(`
      UPDATE dbo.ProjectSubTeamApprovers
      SET IsActive = 0
      WHERE ProjectSubTeamApproverId = @MappingId
    `);
}

module.exports = {
  getProjects,
  getTeams,
  getSubTeamsByTeam,
  getApproversBySubTeam,
  addMapping,
  getCurrentMappings,
  deleteMapping
};