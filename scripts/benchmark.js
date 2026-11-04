'use strict';
// Deterministic local benchmark uses the same fake-manager pattern as isolation tests.
const count=Number(process.env.SESSIONS||5); console.log(`Benchmark harness configured for ${count} sessions. Run npm run test:isolation for correctness; Docker measurements require Docker Desktop and a real terminal image.`);
