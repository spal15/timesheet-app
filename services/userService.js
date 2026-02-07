const { getPool, sql } = require("../db/db");

async function getUserByEmail(email) {
  const pool = await getPool();
  const r = await pool.request()
    .input("Email", sql.NVarChar(256), email)
    .query(`
      SELECT TOP 1 UserId, Email, DisplayName, Role, IsActive
      FROM dbo.Users
      WHERE Email=@Email AND IsActive=1
    `);
  return r.recordset[0] || null;
}

module.exports = { getUserByEmail };
