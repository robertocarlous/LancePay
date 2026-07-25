-- CreateTable
CREATE TABLE "PortalDomain" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "verificationToken" VARCHAR(64) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalDomain_domain_key" ON "PortalDomain"("domain");
CREATE INDEX "PortalDomain_userId_idx" ON "PortalDomain"("userId");
CREATE INDEX "PortalDomain_status_idx" ON "PortalDomain"("status");

-- AddForeignKey
ALTER TABLE "PortalDomain" ADD CONSTRAINT "PortalDomain_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
