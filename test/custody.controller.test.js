import test from "node:test";
import assert from "node:assert/strict";
import { createCustodyController } from "../src/modules/custody/custody.controller.js";

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("replayed active hub exception returns HTTP 200 and the existing case", async () => {
  const controller = createCustodyController({
    reportHubException: async () => ({
      replay: true,
      operationalCase: { id: "case-existing", publicReference: "CASE-EXISTING", status: "IN_PROGRESS" },
    }),
  });
  const res = responseRecorder();
  await controller.reportHubException({ body: {}, user: { id: "hub-user-1" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.replay, true);
  assert.equal(res.body.data.operationalCase.id, "case-existing");
});

test("new hub exception returns HTTP 201", async () => {
  const controller = createCustodyController({
    reportHubException: async () => ({
      replay: false,
      operationalCase: { id: "case-new", publicReference: "CASE-NEW", status: "OPEN" },
    }),
  });
  const res = responseRecorder();
  await controller.reportHubException({ body: {}, user: { id: "hub-user-1" } }, res);
  assert.equal(res.statusCode, 201);
});
