import test from "node:test";
import assert from "node:assert/strict";
import { createDriverDocumentsService } from "../src/modules/drivers/driver-documents.service.js";

const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]);
function fixture() {
  const state = { uploads: [], deletes: [], docs: [], audit: [], asset: null };
  const tx = {
    mediaAsset: { create: async ({data}) => { state.asset = {id:"asset-1",...data}; return state.asset; } },
    driverVerificationDocument: {
      create: async ({data,include}) => {
        const doc = {id:"doc-1",...data,createdAt:new Date("2026-11-04T12:00:00Z"),mediaAsset:{originalName:state.asset.originalName,mimeType:state.asset.mimeType,sizeBytes:state.asset.sizeBytes},vehicle:null};
        state.docs.push(doc); return doc;
      },
      findUnique: async () => state.docs[0] ?? null,
      update: async ({data}) => { Object.assign(state.docs[0],data); return state.docs[0]; },
      findMany: async () => state.docs,
      count: async () => state.docs.length,
    },
    operationalAuditEvent: { create: async ({data}) => {state.audit.push(data);return data;} },
  };
  const prismaClient = {
    driverProfile: { findUnique: async () => ({id:"driver-1",userId:"user-1"}) },
    vehicle: { findFirst: async ({where}) => where.id==="vehicle-1" ? {id:"vehicle-1"} : null },
    mediaAsset: { findUnique: async () => state.asset },
    $transaction: async callback => callback(tx),
  };
  const storage = {
    provider:"CLOUDINARY", bucket:"test-cloud",
    upload: async input => {state.uploads.push(input);return input.objectPath;},
    delete: async input => state.deletes.push(input),
    download: async () => png,
  };
  return {state,service:createDriverDocumentsService({prismaClient,storage,legacyStorage:storage})};
}

test("driver can upload a signature-validated identity document and audit metadata is recorded",async()=>{
  const {state,service}=fixture();
  const result=await service.uploadMine({user:{id:"user-1"},buffer:png,mimeType:"image/png",originalName:"../identity.png",documentType:"IDENTITY"});
  assert.equal(result.documentType,"IDENTITY");
  assert.equal(result.reviewStatus,"PENDING");
  assert.equal(result.originalName,"identity.png");
  assert.equal(state.uploads.length,1);
  assert.equal(state.audit[0].action,"DRIVER_VERIFICATION_DOCUMENT_UPLOADED");
});

test("vehicle documents must reference a vehicle owned by the driver",async()=>{
  const {state,service}=fixture();
  await assert.rejects(service.uploadMine({user:{id:"user-1"},buffer:png,mimeType:"image/png",originalName:"reg.png",documentType:"VEHICLE_REGISTRATION",vehicleId:"other-vehicle"}),error=>error.statusCode===404);
  assert.equal(state.uploads.length,0);
});

test("file signature validation rejects a fake image before storage upload",async()=>{
  const {state,service}=fixture();
  await assert.rejects(service.uploadMine({user:{id:"user-1"},buffer:Buffer.from("not png"),mimeType:"image/png",originalName:"fake.png",documentType:"IDENTITY"}),error=>error.statusCode===400);
  assert.equal(state.uploads.length,0);
});

test("admin document review records reviewer, decision and reason",async()=>{
  const {state,service}=fixture();
  await service.uploadMine({user:{id:"user-1"},buffer:png,mimeType:"image/png",originalName:"identity.png",documentType:"IDENTITY"});
  const result=await service.reviewDocument({documentId:"doc-1",reviewStatus:"APPROVED",reason:"Document is legible and matches applicant details.",actorUserId:"admin-1"});
  assert.equal(result.reviewStatus,"APPROVED");
  assert.equal(state.docs[0].reviewedById,"admin-1");
  assert.equal(state.audit.at(-1).action,"DRIVER_VERIFICATION_DOCUMENT_APPROVED");
});

test("a driver cannot attach a vehicle document to another driver's vehicle",async()=>{
  const {state,service}=fixture();
  await assert.rejects(service.uploadMine({user:{id:"user-1"},buffer:png,mimeType:"image/png",originalName:"registration.png",documentType:"VEHICLE_REGISTRATION",vehicleId:"vehicle-2"}),error=>error.statusCode===404);
  assert.equal(state.uploads.length,0);
});
