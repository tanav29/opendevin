ALTER TABLE "ProjectSession" ADD COLUMN "checkpointError" TEXT;
ALTER TABLE "ProjectSession" ADD COLUMN "workspaceOperation" TEXT;
ALTER TABLE "ProjectSession" ADD COLUMN "workspaceOperationAt" TIMESTAMP(3);

CREATE TABLE "WorkspaceCheckpoint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "sourceCommit" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "exclusions" TEXT NOT NULL DEFAULT '[]',
    "payload" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkspaceCheckpoint_sessionId_createdAt_idx" ON "WorkspaceCheckpoint"("sessionId", "createdAt");
ALTER TABLE "WorkspaceCheckpoint" ADD CONSTRAINT "WorkspaceCheckpoint_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "ProjectSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
