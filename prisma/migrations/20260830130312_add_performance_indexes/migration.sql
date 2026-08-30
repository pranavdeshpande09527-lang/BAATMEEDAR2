-- CreateIndex
CREATE INDEX "ApiUsageLog_checkId_idx" ON "ApiUsageLog"("checkId");

-- CreateIndex
CREATE INDEX "ApiUsageLog_provider_idx" ON "ApiUsageLog"("provider");

-- CreateIndex
CREATE INDEX "ApiUsageLog_createdAt_idx" ON "ApiUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "CacheEntry_expiresAt_idx" ON "CacheEntry"("expiresAt");

-- CreateIndex
CREATE INDEX "CacheEntry_cacheType_idx" ON "CacheEntry"("cacheType");

-- CreateIndex
CREATE INDEX "Check_status_idx" ON "Check"("status");

-- CreateIndex
CREATE INDEX "Check_createdAt_idx" ON "Check"("createdAt");

-- CreateIndex
CREATE INDEX "Claim_checkId_idx" ON "Claim"("checkId");

-- CreateIndex
CREATE INDEX "Claim_checkId_status_idx" ON "Claim"("checkId", "status");

-- CreateIndex
CREATE INDEX "Claim_claimOrder_idx" ON "Claim"("claimOrder");
