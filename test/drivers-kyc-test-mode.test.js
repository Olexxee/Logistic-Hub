import test from "node:test";
import assert from "node:assert/strict";
import { createDriversService } from "../src/modules/drivers/drivers.service.js";

test("TEST_LIMITED drivers cannot go online using passenger-only coverage",async()=>{
  const profile={
    id:"driver-1",verificationStatus:"VERIFIED",kycTier:"TEST_LIMITED",suspendedAt:null,
    vehicles:[{isActive:true,verificationStatus:"VERIFIED"}],
    coverage:[{serviceType:"PASSENGER_RIDE",serviceZone:{isActive:true,state:{isActive:true,country:{isActive:true}},availability:[{serviceType:"PASSENGER_RIDE",isEnabled:true,startsAt:null,endsAt:null}]}}],
  };
  const service=createDriversService({prismaClient:{
    driverProfile:{findUnique:async()=>profile,update:async({data})=>({id:"driver-1",...data})},
  }});
  await assert.rejects(service.setAvailability({userId:"driver-user",input:{isOnline:true,isAvailable:true}}),error=>error.code==="DRIVER_NOT_READY");
});

test("TEST_LIMITED drivers can publish location only after going online in test mode",async()=>{
  const profile={id:"driver-1",verificationStatus:"VERIFIED",kycTier:"TEST_LIMITED",suspendedAt:null,isOnline:true};
  let recorded=false;
  const service=createDriversService({prismaClient:{
    driverProfile:{findUnique:async()=>profile},
    $transaction:async callback=>callback({
      driverLocation:{create:async({data})=>{recorded=true;return{id:"loc-1",...data,latitude:{toString:()=>String(data.latitude)},longitude:{toString:()=>String(data.longitude)},accuracyMeters:null};}},
      driverProfile:{update:async()=>({})},
    }),
  }});
  const result=await service.recordLocation({userId:"driver-user",input:{latitude:6.5,longitude:3.4}});
  assert.equal(recorded,true);
  assert.equal(result.id,"loc-1");
});

test("UNASSESSED legacy profiles cannot go online even in TEST mode",async()=>{
  const profile={
    id:"legacy-driver",verificationStatus:"VERIFIED",kycTier:"UNASSESSED",suspendedAt:null,
    vehicles:[{isActive:true,verificationStatus:"VERIFIED"}],
    coverage:[{serviceType:"PARCEL_DELIVERY",serviceZone:{isActive:true,state:{isActive:true,country:{isActive:true}},availability:[{serviceType:"PARCEL_DELIVERY",isEnabled:true,startsAt:null,endsAt:null}]}}],
  };
  const service=createDriversService({prismaClient:{driverProfile:{findUnique:async()=>profile}}});
  await assert.rejects(service.setAvailability({userId:"legacy-driver-user",input:{isOnline:true,isAvailable:true}}),error=>error.statusCode===403);
});
