const sql = require("mssql");

let pool;

function config() {
  return {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: String(process.env.DB_ENCRYPT || "true").toLowerCase() === "true",
      enableArithAbort: true
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  };
}

async function getPool() {
  if (pool) return pool;
  pool = await sql.connect(config());
  return pool;
}

module.exports = { sql, getPool };
