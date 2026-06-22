process.argv[1] = new URL("../../backend/server.ts", import.meta.url).pathname;

await import("../../backend/loadEnv.ts");

console.log("Discovery cache needs update. Starting...");
console.log("Server running on port 3001");
console.debug("debug detail");
console.error("Unhandled Rejection: probe failure");
