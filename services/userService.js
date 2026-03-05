const { getPool, sql } = require("../db/db");

async function getUserByEmail(email) {
  const pool = await getPool();
  const r = await pool.request()
    .input("Email", sql.NVarChar(256), email)
    .query(`
     SELECT TOP 1
        u.UserId, u.Email, u.DisplayName, u.Role, u.IsActive,
        u.VendorId, u.TeamId, u.SubTeamId,
        v.VendorName,
        t.TeamName,
        st.SubTeamName
      FROM dbo.Users u
      LEFT JOIN dbo.Vendors  v ON v.VendorId = u.VendorId
      LEFT JOIN dbo.Teams    t ON t.TeamId   = u.TeamId
      LEFT JOIN dbo.SubTeams st ON st.SubTeamId = u.SubTeamId
      WHERE u.Email=@Email AND u.IsActive=1
    `);
  return r.recordset[0] || null;
}

module.exports = { getUserByEmail };
