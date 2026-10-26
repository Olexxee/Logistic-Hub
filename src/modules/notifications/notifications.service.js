import { emailService } from "../../shared/email/email.service.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function serializeNotification(item) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    data: item.data,
    readAt: item.readAt,
    emailStatus: item.emailStatus,
    createdAt: item.createdAt,
  };
}

export function createNotificationsService({ prismaClient, email = emailService, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
    async createAndDeliver({
      userId,
      type,
      title,
      body,
      data,
      deliveryKey,
      emailSubject,
    }) {
      const wantsEmail = Boolean(emailSubject);
      let notification = deliveryKey
        ? await prismaClient.notification.findUnique({ where: { deliveryKey } })
        : null;

      if (notification && (
        notification.userId !== userId
        || notification.type !== type
        || notification.title !== title
        || notification.body !== body
      )) {
        const error = new Error("The notification delivery key was reused for a different message.");
        error.code = "DELIVERY_KEY_CONFLICT";
        throw error;
      }

      if (notification && ["SENT", "NOT_REQUESTED"].includes(notification.emailStatus)) {
        return { notification: serializeNotification(notification), emailStatus: notification.emailStatus, replay: true };
      }

      if (!notification) {
        notification = await prismaClient.notification.create({
          data: {
            userId,
            type,
            title,
            body,
            ...(data === undefined ? {} : { data }),
            ...(deliveryKey ? { deliveryKey } : {}),
            emailStatus: wantsEmail ? "PENDING" : "NOT_REQUESTED",
          },
        });
      } else if (wantsEmail) {
        notification = await prismaClient.notification.update({
          where: { id: notification.id },
          data: { emailStatus: "PENDING", emailErrorCode: null },
        });
      }

      if (!wantsEmail) {
        return { notification: serializeNotification(notification), emailStatus: "NOT_REQUESTED", replay: false };
      }

      const user = await prismaClient.user.findUnique({
        where: { id: userId },
        select: { email: true, status: true, emailVerifiedAt: true },
      });
      if (!user?.email || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
        const updated = await prismaClient.notification.update({
          where: { id: notification.id },
          data: { emailStatus: "FAILED", emailErrorCode: "RECIPIENT_EMAIL_UNAVAILABLE" },
        });
        return { notification: serializeNotification(updated), emailStatus: "FAILED", replay: false };
      }

      try {
        const result = await email.send({
          to: user.email,
          subject: emailSubject,
          text: body,
          html: `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>`,
          ...(deliveryKey ? { idempotencyKey: deliveryKey } : {}),
          tags: [{ name: "category", value: "transactional-notification" }],
        });
        const updated = await prismaClient.notification.update({
          where: { id: notification.id },
          data: {
            emailStatus: "SENT",
            emailSentAt: clock(),
            emailProviderId: result.id,
            emailErrorCode: null,
          },
        });
        return { notification: serializeNotification(updated), emailStatus: "SENT", replay: false };
      } catch (error) {
        const safeCodes = new Set(["EMAIL_NOT_CONFIGURED", "EMAIL_DELIVERY_FAILED", "EMAIL_PROVIDER_UNAVAILABLE"]);
        const updated = await prismaClient.notification.update({
          where: { id: notification.id },
          data: {
            emailStatus: "FAILED",
            emailErrorCode: safeCodes.has(error.code) ? error.code : "EMAIL_DELIVERY_FAILED",
          },
        });
        return { notification: serializeNotification(updated), emailStatus: "FAILED", replay: false };
      }
    },

    async listForUser({ userId, cursor, limit }) {
      const items = await prismaClient.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      return {
        data: page.map(serializeNotification),
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        unreadCount: await prismaClient.notification.count({ where: { userId, readAt: null } }),
      };
    },

    async markRead({ userId, notificationId }) {
      const notification = await prismaClient.notification.findFirst({
        where: { id: notificationId, userId },
      });
      if (!notification) return null;
      if (notification.readAt) return serializeNotification(notification);

      await prismaClient.notification.updateMany({
        where: { id: notificationId, userId, readAt: null },
        data: { readAt: clock() },
      });
      const updated = await prismaClient.notification.findFirst({
        where: { id: notificationId, userId },
      });
      return updated ? serializeNotification(updated) : null;
    },

    async markAllRead({ userId }) {
      const readAt = clock();
      const result = await prismaClient.notification.updateMany({
        where: { userId, readAt: null },
        data: { readAt },
      });
      return { updatedCount: result.count, readAt };
    },
  };
}
