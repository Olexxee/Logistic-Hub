export function createOperationsControlController(service) {
  return {
    overview: async (_req, res) => {
      const overview = await service.getOverview();
      return res.status(200).json({ success: true, data: overview });
    },
  };
}
