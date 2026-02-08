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
