ALTER TABLE "support_tickets" ADD COLUMN "operationalCaseId" TEXT;

CREATE UNIQUE INDEX "support_tickets_operationalCaseId_key"
ON "support_tickets"("operationalCaseId");

ALTER TABLE "support_tickets"
ADD CONSTRAINT "support_tickets_operationalCaseId_fkey"
FOREIGN KEY ("operationalCaseId") REFERENCES "operational_cases"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
