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

module.exports = {
  listProjectsWithApprovers,
  listApproverUsers,
  upsertProjectAndApprover,
  getProjectMappingByName,
  listActiveProjects
};
