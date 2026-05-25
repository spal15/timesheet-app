const { getPool, sql } = require("../db/db");

async function getAllVendors() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT VendorId, VendorName, IsActive, CreatedOn
    FROM dbo.Vendors
    ORDER BY IsActive DESC, VendorName
  `);

  return result.recordset;
}

async function addVendor(vendorName) {
  const name = (vendorName || "").trim();

  if (!name) {
    throw new Error("Vendor name is required.");
  }

  const pool = await getPool();

  await pool.request()
    .input("VendorName", sql.NVarChar(200), name)
    .query(`
      IF EXISTS (
        SELECT 1 FROM dbo.Vendors WHERE VendorName = @VendorName
      )
      BEGIN
        THROW 50001, 'Vendor already exists.', 1;
      END

      INSERT INTO dbo.Vendors (VendorName, IsActive, CreatedOn)
      VALUES (@VendorName, 1, SYSUTCDATETIME());
    `);
}

async function toggleVendor(vendorId) {
  const id = Number(vendorId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid vendor id.");
  }

  const pool = await getPool();

  await pool.request()
    .input("VendorId", sql.Int, id)
    .query(`
      UPDATE dbo.Vendors
      SET IsActive = CASE 
          WHEN IsActive = 1 THEN 0 
          ELSE 1 
        END
      WHERE VendorId = @VendorId;
    `);
}

module.exports = {
  getAllVendors,
  addVendor,
  toggleVendor
};