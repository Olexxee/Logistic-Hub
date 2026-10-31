-- Support ticket conversation messages with explicit public/internal visibility.
CREATE TYPE "SupportTicketMessageVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

CREATE TABLE "support_ticket_messages" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "visibility" "SupportTicketMessageVisibility" NOT NULL DEFAULT 'PUBLIC',
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_ticket_messages_ticketId_visibility_createdAt_id_idx"
  ON "support_ticket_messages"("ticketId", "visibility", "createdAt", "id");
CREATE INDEX "support_ticket_messages_authorId_createdAt_idx"
  ON "support_ticket_messages"("authorId", "createdAt");

ALTER TABLE "support_ticket_messages"
  ADD CONSTRAINT "support_ticket_messages_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_ticket_messages"
  ADD CONSTRAINT "support_ticket_messages_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
