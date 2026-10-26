function serializeNotification(item) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    data: item.data,
    readAt: item.readAt,
    createdAt: item.createdAt,
  };
}

export function createNotificationsService({ prismaClient, clock = () => new Date() }) {
  if (!prismaClient) throw new Error("A Prisma client is required.");

  return {
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
