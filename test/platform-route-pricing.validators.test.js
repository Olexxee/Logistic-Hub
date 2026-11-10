import test from "node:test";
import assert from "node:assert/strict";
import { availabilitySchema, rateSchema } from "../src/modules/platform-route-pricing/platform-route-pricing.validators.js";

test("platform route rate requires independent customer and driver amounts in minor units",()=>{
 const base={originServiceZoneId:"zone-a",destinationServiceZoneId:"zone-b",parcelCategory:"STANDARD",customerTransportChargeMinor:"250000",driverPayoutMinor:"160000",platformChargeMinor:"30000",reason:"Approved commercial tariff"};
 assert.equal(rateSchema.safeParse(base).success,true);
 assert.equal(rateSchema.safeParse({...base,driverPayoutMinor:undefined}).success,false);
 assert.equal(rateSchema.safeParse({...base,customerTransportChargeMinor:"2500.50"}).success,false);
 assert.equal(rateSchema.safeParse({...base,destinationServiceZoneId:"zone-a"}).success,false);
});

test("route availability requires explicit directed route and valid effective window",()=>{
 const base={originServiceZoneId:"zone-a",destinationServiceZoneId:"zone-b",isEnabled:true,reason:"Operations approved this corridor"};
 assert.equal(availabilitySchema.safeParse(base).success,true);
 assert.equal(availabilitySchema.safeParse({...base,destinationServiceZoneId:"zone-a"}).success,false);
 assert.equal(availabilitySchema.safeParse({...base,startsAt:"2026-11-12T00:00:00Z",endsAt:"2026-11-11T00:00:00Z"}).success,false);
});
