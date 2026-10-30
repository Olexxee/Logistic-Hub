import { createGeographyAdminRepository } from "./geography.admin.repository.js";
function conflict(code, message) { const e = new Error(message); e.statusCode = 409; e.code = code; return e; }
export function createGeographyAdminService({ prismaClient }) {
 const r = createGeographyAdminRepository({ prismaClient });
 return {
  listCountries: () => r.listCountries(),
  createCountry: input => r.createCountry({ ...input, code: input.code.toUpperCase() }),
  async updateCountry(id,input) { if (!await r.findCountry(id)) return null; return r.updateCountry(id,{...input,...(input.code?{code:input.code.toUpperCase()}:{})}); },
  async setCountryActive(id,isActive) { const c=await r.findCountry(id); if(!c)return null; if(!isActive && await prismaClient.state.count({where:{countryId:id,isActive:true}})) throw conflict("ACTIVE_CHILD_STATES_EXIST","Deactivate all states before deactivating their country."); return r.updateCountry(id,{isActive}); },
  listStates: countryId => r.listStates(countryId?{countryId}:{}),
  async createState(input) { const c=await r.findCountry(input.countryId); if(!c)return null; if(!c.isActive)throw conflict("COUNTRY_INACTIVE","A state can only be created under an active country."); return r.createState({...input,code:input.code.toUpperCase()}); },
  async updateState(id,input) { if(!await r.findState(id))return null; return r.updateState(id,{...input,...(input.code?{code:input.code.toUpperCase()}:{})}); },
  async setStateActive(id,isActive) { const s=await r.findState(id); if(!s)return null; if(isActive&&!s.country.isActive)throw conflict("COUNTRY_INACTIVE","A state cannot be activated while its country is inactive."); if(!isActive&&await r.countActiveZonesForState(id))throw conflict("ACTIVE_SERVICE_ZONES_EXIST","Deactivate service zones before deactivating this state."); return r.updateState(id,{isActive}); },
  listLgas: stateId => r.listLgas(stateId?{stateId}:{}),
  async createLga(input) { const s=await r.findState(input.stateId); if(!s)return null; if(!s.isActive||!s.country.isActive)throw conflict("GEOGRAPHY_INACTIVE","An LGA can only be created under an active state and country."); return r.createLga({...input,...(input.code?{code:input.code.toUpperCase()}:{})}); },
  async updateLga(id,input) { if(!await r.findLga(id))return null; return r.updateLga(id,{...input,...(input.code?{code:input.code.toUpperCase()}:{})}); },
  async deleteLga(id) { const l=await r.findLga(id); if(!l)return null; if(l._count.zones)throw conflict("LGA_IN_USE","An LGA referenced by service zones cannot be deleted."); return r.deleteLga(id); }
 };
}