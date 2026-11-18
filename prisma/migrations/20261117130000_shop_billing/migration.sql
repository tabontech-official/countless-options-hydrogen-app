-- CreateTable
CREATE TABLE "ShopBilling" (
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effectivePlan" TEXT NOT NULL DEFAULT 'FREE',
    "subscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "downgradeDate" TIMESTAMP(3),
    "chosenProductIds" JSONB NOT NULL DEFAULT '[]',
    "test" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBilling_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE INDEX "ShopBilling_shop_idx" ON "ShopBilling"("shop");
