/* Project-based approvals, one row per day */

IF OBJECT_ID('dbo.TimesheetAudit','U') IS NOT NULL DROP TABLE dbo.TimesheetAudit;
IF OBJECT_ID('dbo.TimesheetProjectApprovals','U') IS NOT NULL DROP TABLE dbo.TimesheetProjectApprovals;
IF OBJECT_ID('dbo.TimesheetDays','U') IS NOT NULL DROP TABLE dbo.TimesheetDays;
IF OBJECT_ID('dbo.Timesheets','U') IS NOT NULL DROP TABLE dbo.Timesheets;
IF OBJECT_ID('dbo.ProjectApprovers','U') IS NOT NULL DROP TABLE dbo.ProjectApprovers;
IF OBJECT_ID('dbo.Projects','U') IS NOT NULL DROP TABLE dbo.Projects;
IF OBJECT_ID('dbo.Users','U') IS NOT NULL DROP TABLE dbo.Users;

CREATE TABLE dbo.Users (
  UserId      INT IDENTITY(1,1) PRIMARY KEY,
  Email       NVARCHAR(256) NOT NULL UNIQUE,
  DisplayName NVARCHAR(200) NOT NULL,
  Role        NVARCHAR(50)  NOT NULL,  -- Vendor, Approver, Admin
  IsActive    BIT NOT NULL DEFAULT 1,
  CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.Projects (
  ProjectId    INT IDENTITY(1,1) PRIMARY KEY,
  ProjectName  NVARCHAR(200) NOT NULL UNIQUE,
  IsActive     BIT NOT NULL DEFAULT 1,
  CreatedAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.ProjectApprovers (
  ProjectId       INT NOT NULL PRIMARY KEY,
  ApproverUserId  INT NOT NULL,
  IsActive        BIT NOT NULL DEFAULT 1,
  UpdatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_ProjectApprovers_Project FOREIGN KEY (ProjectId) REFERENCES dbo.Projects(ProjectId),
  CONSTRAINT FK_ProjectApprovers_User    FOREIGN KEY (ApproverUserId) REFERENCES dbo.Users(UserId)
);

CREATE TABLE dbo.Timesheets (
  TimesheetId     INT IDENTITY(1,1) PRIMARY KEY,
  VendorUserId    INT NOT NULL,
  WeekEndingDate  DATE NOT NULL,
  Status          NVARCHAR(20) NOT NULL DEFAULT 'Draft', -- Draft/Submitted/Approved/Rejected
  TotalHours      DECIMAL(6,2) NOT NULL DEFAULT 0,
  SubmittedAt     DATETIME2 NULL,
  ApprovedAt      DATETIME2 NULL,
  RejectedAt      DATETIME2 NULL,
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_Timesheets_Vendor FOREIGN KEY (VendorUserId) REFERENCES dbo.Users(UserId),
  CONSTRAINT UQ_Timesheets UNIQUE (VendorUserId, WeekEndingDate)
);

CREATE TABLE dbo.TimesheetDays (
  TimesheetDayId  INT IDENTITY(1,1) PRIMARY KEY,
  TimesheetId     INT NOT NULL,
  WorkDate        DATE NOT NULL,
  DayName         NVARCHAR(10) NOT NULL,
  ProjectName     NVARCHAR(200) NULL,
  WorkSummary     NVARCHAR(2000) NULL,
  ADOTickets      NVARCHAR(500) NULL,
  Hours           DECIMAL(5,2) NOT NULL DEFAULT 0,
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_TimesheetDays_Timesheet FOREIGN KEY (TimesheetId) REFERENCES dbo.Timesheets(TimesheetId),
  CONSTRAINT UQ_TimesheetDays UNIQUE (TimesheetId, WorkDate)
);

CREATE TABLE dbo.TimesheetProjectApprovals (
  TimesheetProjectApprovalId INT IDENTITY(1,1) PRIMARY KEY,
  TimesheetId     INT NOT NULL,
  ProjectId       INT NOT NULL,
  ApproverUserId  INT NOT NULL,
  Status          NVARCHAR(20) NOT NULL DEFAULT 'Pending', -- Pending/Approved/Rejected
  Comment         NVARCHAR(2000) NULL,
  ActionAt        DATETIME2 NULL,
  CreatedAt       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_TPA_Timesheet FOREIGN KEY (TimesheetId) REFERENCES dbo.Timesheets(TimesheetId),
  CONSTRAINT FK_TPA_Project   FOREIGN KEY (ProjectId) REFERENCES dbo.Projects(ProjectId),
  CONSTRAINT FK_TPA_Approver  FOREIGN KEY (ApproverUserId) REFERENCES dbo.Users(UserId),
  CONSTRAINT UQ_TPA UNIQUE (TimesheetId, ProjectId)
);

CREATE TABLE dbo.TimesheetAudit (
  AuditId     INT IDENTITY(1,1) PRIMARY KEY,
  TimesheetId INT NOT NULL,
  ActorUserId INT NOT NULL,
  Action      NVARCHAR(50) NOT NULL,
  Details     NVARCHAR(2000) NULL,
  ActionAt    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_Audit_Timesheet FOREIGN KEY (TimesheetId) REFERENCES dbo.Timesheets(TimesheetId),
  CONSTRAINT FK_Audit_User      FOREIGN KEY (ActorUserId) REFERENCES dbo.Users(UserId)
);

-- Seed sample users/projects (replace with real)
INSERT INTO dbo.Users (Email, DisplayName, Role) VALUES
('admin@local',   'Admin User',   'Admin'),
('lead1@local',   'Lead One',     'Approver'),
('lead2@local',   'Lead Two',     'Approver'),
('vendor1@local', 'Vendor One',   'Vendor');

INSERT INTO dbo.Projects (ProjectName) VALUES
('Violet Support'),
('NY_NJ Rollout'),
('Non-Working');

INSERT INTO dbo.ProjectApprovers (ProjectId, ApproverUserId)
SELECT p.ProjectId, u.UserId
FROM dbo.Projects p
JOIN dbo.Users u ON u.Email =
  CASE p.ProjectName
    WHEN 'Violet Support' THEN 'lead1@local'
    WHEN 'NY_NJ Rollout'  THEN 'lead1@local'
    WHEN 'Non-Working'        THEN 'lead2@local'
  END;


/* =========================
   1) Master tables
   ========================= */

IF OBJECT_ID('dbo.Vendors','U') IS NULL
BEGIN
    CREATE TABLE dbo.Vendors (
        VendorId   INT IDENTITY(1,1) CONSTRAINT PK_Vendors PRIMARY KEY,
        VendorName NVARCHAR(200) NOT NULL,
        IsActive   BIT NOT NULL CONSTRAINT DF_Vendors_IsActive DEFAULT 1,
        CreatedOn  DATETIME2(0) NOT NULL CONSTRAINT DF_Vendors_CreatedOn DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX UX_Vendors_VendorName ON dbo.Vendors(VendorName);
END
GO

IF OBJECT_ID('dbo.Teams','U') IS NULL
BEGIN
    CREATE TABLE dbo.Teams (
        TeamId   INT IDENTITY(1,1) CONSTRAINT PK_Teams PRIMARY KEY,
        TeamName NVARCHAR(100) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Teams_IsActive DEFAULT 1
    );

    CREATE UNIQUE INDEX UX_Teams_TeamName ON dbo.Teams(TeamName);
END
GO

IF OBJECT_ID('dbo.SubTeams','U') IS NULL
BEGIN
    CREATE TABLE dbo.SubTeams (
        SubTeamId   INT IDENTITY(1,1) CONSTRAINT PK_SubTeams PRIMARY KEY,
        TeamId      INT NOT NULL,
        SubTeamName NVARCHAR(100) NOT NULL,
        IsActive    BIT NOT NULL CONSTRAINT DF_SubTeams_IsActive DEFAULT 1,

        CONSTRAINT FK_SubTeams_Teams
            FOREIGN KEY (TeamId) REFERENCES dbo.Teams(TeamId)
    );

    -- Unique per Team (same subteam name can exist in another team if you ever want, but usually won’t)
    CREATE UNIQUE INDEX UX_SubTeams_Team_SubTeamName ON dbo.SubTeams(TeamId, SubTeamName);
END
GO


/* =========================
   2) Seed baseline Vendors/Teams/SubTeams
   Edit as needed
   ========================= */

-- Vendors
MERGE dbo.Vendors AS tgt
USING (VALUES
    (N'LTM'),
    (N'ValueMomemtum'),
    (N'JBK'),
	(N'Invenger'),
	(N'EY'),
	(N'DuckCreek'),
	(N'Optimetech')
) AS src(VendorName)
ON tgt.VendorName = src.VendorName
WHEN NOT MATCHED THEN
    INSERT (VendorName) VALUES (src.VendorName);

-- Teams
MERGE dbo.Teams AS tgt
USING (VALUES
    (N'SlideWire'),
    (N'Violet'),
    (N'Digital'),
    (N'Infrastructure')
) AS src(TeamName)
ON tgt.TeamName = src.TeamName
WHEN NOT MATCHED THEN
    INSERT (TeamName) VALUES (src.TeamName);

-- SubTeams: BA / QA / Dev for each team you care about
DECLARE @PolicyTeamId INT = (SELECT TeamId FROM dbo.Teams WHERE TeamName = N'Violet');
DECLARE @ClaimsTeamId INT = (SELECT TeamId FROM dbo.Teams WHERE TeamName = N'SlideWire');

IF @PolicyTeamId IS NOT NULL
BEGIN
    MERGE dbo.SubTeams AS tgt
    USING (VALUES
        (@PolicyTeamId, N'BA'),
        (@PolicyTeamId, N'QA'),
        (@PolicyTeamId, N'Dev')
    ) AS src(TeamId, SubTeamName)
    ON tgt.TeamId = src.TeamId AND tgt.SubTeamName = src.SubTeamName
    WHEN NOT MATCHED THEN
        INSERT (TeamId, SubTeamName) VALUES (src.TeamId, src.SubTeamName);
END

IF @ClaimsTeamId IS NOT NULL
BEGIN
    MERGE dbo.SubTeams AS tgt
    USING (VALUES
        (@ClaimsTeamId, N'BA'),
        (@ClaimsTeamId, N'QA'),
        (@ClaimsTeamId, N'Dev')
    ) AS src(TeamId, SubTeamName)
    ON tgt.TeamId = src.TeamId AND tgt.SubTeamName = src.SubTeamName
    WHEN NOT MATCHED THEN
        INSERT (TeamId, SubTeamName) VALUES (src.TeamId, src.SubTeamName);
END
GO

/* =========================
   3) Users table enhancement
   ========================= */

-- Add columns (nullable for safe rollout)
IF COL_LENGTH('dbo.Users','VendorId') IS NULL
    ALTER TABLE dbo.Users ADD VendorId INT NULL;

IF COL_LENGTH('dbo.Users','TeamId') IS NULL
    ALTER TABLE dbo.Users ADD TeamId INT NULL;

IF COL_LENGTH('dbo.Users','SubTeamId') IS NULL
    ALTER TABLE dbo.Users ADD SubTeamId INT NULL;
GO

-- Add foreign keys (only if not exists)
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_Vendors')
BEGIN
    ALTER TABLE dbo.Users
    ADD CONSTRAINT FK_Users_Vendors
        FOREIGN KEY (VendorId) REFERENCES dbo.Vendors(VendorId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_Teams')
BEGIN
    ALTER TABLE dbo.Users
    ADD CONSTRAINT FK_Users_Teams
        FOREIGN KEY (TeamId) REFERENCES dbo.Teams(TeamId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_SubTeams')
BEGIN
    ALTER TABLE dbo.Users
    ADD CONSTRAINT FK_Users_SubTeams
        FOREIGN KEY (SubTeamId) REFERENCES dbo.SubTeams(SubTeamId);
END
GO

-- Helpful indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_VendorId' AND object_id = OBJECT_ID('dbo.Users'))
    CREATE INDEX IX_Users_VendorId ON dbo.Users(VendorId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_TeamId' AND object_id = OBJECT_ID('dbo.Users'))
    CREATE INDEX IX_Users_TeamId ON dbo.Users(TeamId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_SubTeamId' AND object_id = OBJECT_ID('dbo.Users'))
    CREATE INDEX IX_Users_SubTeamId ON dbo.Users(SubTeamId);
GO


/* =========================
   4) Project + SubTeam approver mapping
   ========================= */

IF OBJECT_ID('dbo.ProjectSubTeamApprovers','U') IS NULL
BEGIN
    CREATE TABLE dbo.ProjectSubTeamApprovers (
        ProjectSubTeamApproverId INT IDENTITY(1,1) CONSTRAINT PK_ProjectSubTeamApprovers PRIMARY KEY,
        ProjectId    INT NOT NULL,
        SubTeamId    INT NOT NULL,
        ApproverEmail NVARCHAR(320) NOT NULL,     -- keep simple + resilient
        IsActive     BIT NOT NULL CONSTRAINT DF_PSTA_IsActive DEFAULT 1,
        IsPrimary    BIT NOT NULL CONSTRAINT DF_PSTA_IsPrimary DEFAULT 0,
        ApprovalOrder INT NULL,                   -- optional: sequential approvals
        CreatedOn    DATETIME2(0) NOT NULL CONSTRAINT DF_PSTA_CreatedOn DEFAULT SYSDATETIME(),

        -- If you have dbo.Projects with ProjectId PK
        CONSTRAINT FK_PSTA_Projects FOREIGN KEY (ProjectId) REFERENCES dbo.Projects(ProjectId),

        CONSTRAINT FK_PSTA_SubTeams FOREIGN KEY (SubTeamId) REFERENCES dbo.SubTeams(SubTeamId)
    );

    -- prevent duplicate approver rows for same project/subteam
    CREATE UNIQUE INDEX UX_PSTA_Project_SubTeam_Approver
        ON dbo.ProjectSubTeamApprovers(ProjectId, SubTeamId, ApproverEmail);

    CREATE INDEX IX_PSTA_Project_SubTeam
        ON dbo.ProjectSubTeamApprovers(ProjectId, SubTeamId)
        INCLUDE (ApproverEmail, IsPrimary, ApprovalOrder, IsActive);
END
GO

-- Frequent Select
-- Check users with new attributes
SELECT TOP 100
  u.Email, u.DisplayName, u.Role,
  v.VendorName, t.TeamName, st.SubTeamName
FROM dbo.Users u
LEFT JOIN dbo.Vendors v ON u.VendorId = v.VendorId
LEFT JOIN dbo.Teams t ON u.TeamId = t.TeamId
LEFT JOIN dbo.SubTeams st ON u.SubTeamId = st.SubTeamId;

-- Check approver mapping for Projects
SELECT
  p.ProjectName,
  tm.TeamName,
  st.SubTeamName,
  psta.ApproverEmail,
  psta.IsPrimary,
  psta.ApprovalOrder,
  psta.IsActive
FROM dbo.ProjectSubTeamApprovers psta
JOIN dbo.Projects p ON p.ProjectId = psta.ProjectId
JOIN dbo.SubTeams st ON st.SubTeamId = psta.SubTeamId
JOIN dbo.Teams tm ON tm.TeamId = st.TeamId
ORDER BY p.ProjectName, tm.TeamName, st.SubTeamName, psta.ApprovalOrder;

ALTER TABLE dbo.TimesheetProjectApprovals
ADD VendorReply NVARCHAR(2000) NULL,
    VendorReplyAt DATETIME2(0) NULL;



 delete from TimesheetAudit
 delete from TimesheetProjectApprovals
 delete from TimesheetDayEntries
 delete from TimesheetDays
 delete from Timesheets