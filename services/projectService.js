const { getPool, sql } = require("../db/db");

async function listProjectsWithApprovers() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT p.ProjectId, p.ProjectName, p.IsActive,
           u.UserId AS ApproverUserId, u.DisplayName AS ApproverName, u.Email AS ApproverEmail
    FROM dbo.Projects p
    LEFT JOIN dbo.ProjectApprovers pa ON pa.ProjectId=p.ProjectId AND pa.IsActive=1
    LEFT JOIN dbo.Users u ON u.UserId=pa.ApproverUserId
    ORDER BY p.ProjectName
  `);
  return r.recordset;
}

async function listApproverUsers() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT UserId, DisplayName, Email
    FROM dbo.Users
    WHERE Role IN ('Approver','Admin') AND IsActive=1
    ORDER BY DisplayName
  `);
  return r.recordset;
}

async function upsertProjectAndApprover(projectName, approverUserId) {
  const pool = await getPool();

  const pr = await pool.request()
    .input("ProjectName", sql.NVarChar(200), projectName)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.Projects WHERE ProjectName=@ProjectName)
        SELECT ProjectId FROM dbo.Projects WHERE ProjectName=@ProjectName
      ELSE
      BEGIN
        INSERT INTO dbo.Projects (ProjectName) VALUES (@ProjectName);
        SELECT SCOPE_IDENTITY() AS ProjectId;
      END
    `);

  const projectId = Number(pr.recordset[0].ProjectId);

  await pool.request()
    .input("ProjectId", sql.Int, projectId)
    .input("ApproverUserId", sql.Int, approverUserId)
    .query(`
      MERGE dbo.ProjectApprovers AS pa
      USING (SELECT @ProjectId AS ProjectId) AS s
      ON (pa.ProjectId = s.ProjectId)
      WHEN MATCHED THEN
        UPDATE SET ApproverUserId=@ApproverUserId, IsActive=1, UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (ProjectId, ApproverUserId, IsActive) VALUES (@ProjectId, @ApproverUserId, 1);
    `);

  return projectId;
}

async function getProjectMappingByName(projectName) {
  const pool = await getPool();
  const r = await pool.request()
    .input("ProjectName", sql.NVarChar(200), projectName)
    .query(`
      SELECT TOP 1 pr.ProjectId, pa.ApproverUserId
      FROM dbo.Projects pr
      JOIN dbo.ProjectApprovers pa ON pa.ProjectId=pr.ProjectId AND pa.IsActive=1
      WHERE pr.ProjectName=@ProjectName AND pr.IsActive=1
    `);
  return r.recordset[0] || null;
}

async function listActiveProjects() {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT ProjectId, ProjectName
    FROM dbo.Projects
    WHERE IsActive=1
    ORDER BY ProjectName
  `);
  return r.recordset;
}

async function getProjectByName(projectName) {
  const pool = await getPool();
  const r = await pool.request()
    .input("ProjectName", sql.NVarChar(200), projectName)
    .query(`
      SELECT TOP 1 ProjectId, ProjectName
      FROM dbo.Projects
      WHERE ProjectName=@ProjectName AND IsActive=1
    `);
  return r.recordset[0] || null;
}

async function getApproversForProjectAndSubTeam(projectId, subTeamId) {
  const pool = await getPool();
  const r = await pool.request()
    .input("ProjectId", sql.Int, projectId)
    .input("SubTeamId", sql.Int, subTeamId)
    .query(`
      SELECT
        u.UserId,
        u.Email,
        u.DisplayName,
        psta.IsPrimary,
        psta.ApprovalOrder
      FROM dbo.ProjectSubTeamApprovers psta
      JOIN dbo.Users u
        ON LOWER(u.Email) = LOWER(psta.ApproverEmail)
       AND u.IsActive = 1
      WHERE psta.ProjectId = @ProjectId
        AND psta.SubTeamId = @SubTeamId
        AND psta.IsActive = 1
      ORDER BY COALESCE(psta.ApprovalOrder, 999999),
               psta.IsPrimary DESC,
               u.DisplayName;
    `);
  return r.recordset || [];
}


async function getAllProjects() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT ProjectId, ProjectName, IsActive, CreatedAt
    FROM dbo.Projects
    ORDER BY IsActive DESC, ProjectName
  `);

  return result.recordset;
}

async function addProject(projectName) {
  const name = (projectName || "").trim();

  if (!name) {
    throw new Error("Project name is required.");
  }

  const pool = await getPool();

  await pool.request()
    .input("ProjectName", sql.NVarChar(200), name)
    .query(`
      IF EXISTS (
        SELECT 1 FROM dbo.Projects WHERE ProjectName = @ProjectName
      )
      BEGIN
        THROW 50001, 'Project already exists.', 1;
      END

      INSERT INTO dbo.Projects (ProjectName, IsActive, CreatedAt)
      VALUES (@ProjectName, 1, SYSUTCDATETIME());
    `);
}

async function toggleProject(projectId) {
  const id = Number(projectId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid project id.");
  }

  const pool = await getPool();

  await pool.request()
    .input("ProjectId", sql.Int, id)
    .query(`
      UPDATE dbo.Projects
      SET IsActive = CASE 
          WHEN IsActive = 1 THEN 0 
          ELSE 1 
        END
      WHERE ProjectId = @ProjectId;
    `);
}


module.exports = {
  listProjectsWithApprovers,
  listApproverUsers,
  upsertProjectAndApprover,
  getProjectMappingByName,
  listActiveProjects,
  getProjectByName,
  getApproversForProjectAndSubTeam,
  getAllProjects,
  addProject,
  toggleProject
};
