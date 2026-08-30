-- CreateTable
CREATE TABLE "Check" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inputType" TEXT NOT NULL,
    "originalInput" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "canonicalUrl" TEXT,
    "videoId" TEXT,
    "publisher" TEXT,
    "sourceTitle" TEXT,
    "retrievalTime" DATETIME,
    "extractedText" TEXT,
    "extractionStatus" TEXT,
    "language" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checkId" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "originalWording" TEXT NOT NULL,
    "domain" TEXT,
    "namedEntities" TEXT NOT NULL DEFAULT '[]',
    "location" TEXT,
    "timeReference" TEXT,
    "timeSensitivity" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "materialContext" TEXT,
    "ambiguityNotes" TEXT,
    "importance" TEXT NOT NULL DEFAULT 'MEDIUM',
    "isVerifiable" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "claimOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Claim_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "publisher" TEXT,
    "author" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'NEWS',
    "searchSnippet" TEXT,
    "relevantExcerpt" TEXT,
    "stance" TEXT,
    "relevance" TEXT,
    "authorityRationale" TEXT,
    "credibilityNotes" TEXT,
    "publicationDate" TEXT,
    "retrievalDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wasInspected" BOOLEAN NOT NULL DEFAULT false,
    "inspectionFailed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Source_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvidenceReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "reviewer" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "missingContext" TEXT,
    "logicalIssues" TEXT,
    "counterevidence" TEXT,
    "unansweredQuestions" TEXT,
    "materialTerms" TEXT,
    "ambiguityFlags" TEXT,
    "scopeJudgement" TEXT,
    "sourceIdsReviewed" TEXT NOT NULL DEFAULT '[]',
    "tokensUsed" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceReview_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelVerification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "claimId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "verdict" TEXT,
    "confidence" REAL,
    "reasoning" TEXT,
    "evidenceIdsUsed" TEXT NOT NULL DEFAULT '[]',
    "limitations" TEXT,
    "unresolvedQuestions" TEXT,
    "promptHash" TEXT,
    "rawResponse" TEXT,
    "tokensUsed" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModelVerification_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CacheEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "cacheType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "checkId" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "CacheEntry_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiUsageLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checkId" TEXT,
    "claimId" TEXT,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "stage" INTEGER,
    "tokensUsed" INTEGER,
    "costEstimate" REAL,
    "latencyMs" INTEGER,
    "wasFromCache" BOOLEAN NOT NULL DEFAULT false,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiUsageLog_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_EvidenceReviewToSource" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_EvidenceReviewToSource_A_fkey" FOREIGN KEY ("A") REFERENCES "EvidenceReview" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_EvidenceReviewToSource_B_fkey" FOREIGN KEY ("B") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelVerification_claimId_modelName_key" ON "ModelVerification"("claimId", "modelName");

-- CreateIndex
CREATE UNIQUE INDEX "CacheEntry_cacheKey_key" ON "CacheEntry"("cacheKey");

-- CreateIndex
CREATE UNIQUE INDEX "_EvidenceReviewToSource_AB_unique" ON "_EvidenceReviewToSource"("A", "B");

-- CreateIndex
CREATE INDEX "_EvidenceReviewToSource_B_index" ON "_EvidenceReviewToSource"("B");
