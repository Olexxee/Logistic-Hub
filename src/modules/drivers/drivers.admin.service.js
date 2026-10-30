import { createDriversAdminRepository } from "./drivers.admin.repository.js";
export function createDriversAdminService({ prismaClient }) {
  const repository = createDriversAdminRepository({ prismaClient });
  return {
    listDrivers: input => repository.listDrivers(input),
    listVehicles: input => repository.listVehicles(input),
  };
}
