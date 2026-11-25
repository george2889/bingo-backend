import test from "node:test";
import assert from "node:assert/strict";
import { app, db } from "../src/server.js";

test("health endpoint is available", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");
  await new Promise((resolve) => server.close(resolve));
});

test("CORS allows local development and the Netlify frontend", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  for (const origin of [
    "http://localhost:5173",
    "https://bingotesting238.netlify.app",
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { origin },
    });
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
  await new Promise((resolve) => server.close(resolve));
});

test("locations and lookup work", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  const locations = await fetch(`http://127.0.0.1:${port}/api/locations`);
  assert.equal(locations.status, 200);
  assert.ok((await locations.json()).locations.length >= 6);

  const lookup = await fetch(`http://127.0.0.1:${port}/api/lookup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemClass: "plastic bottle", city: "Lafayette, California" }),
  });
  assert.equal(lookup.status, 200);
  assert.equal((await lookup.json()).rule.bin, "recycling");
  await new Promise((resolve) => server.close(resolve));
});

test("scanner resolves Teachable Machine predictions to local sorting rules", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  const config = await fetch(`http://127.0.0.1:${port}/api/scanner/config`);
  assert.equal(config.status, 200);
  assert.equal((await config.json()).modelUrl, "https://teachablemachine.withgoogle.com/models/Ih-oYuk1i/");

  const scan = await fetch(`http://127.0.0.1:${port}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      className: "bread_pasta",
      probability: 0.94,
      city: "Lafayette, California",
    }),
  });
  assert.equal(scan.status, 201);
  const result = await scan.json();
  assert.equal(result.item.example, "Bread and pasta");
  assert.equal(result.prediction.probability, 0.94);
  assert.equal(result.rule.bin, "compost");
  await new Promise((resolve) => server.close(resolve));
});

test("scanner rejects unsupported model classes instead of guessing an item", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/scans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ className: "unknown", city: "Lafayette, California" }),
  });
  assert.equal(response.status, 422);
  await new Promise((resolve) => server.close(resolve));
});

test("registration, profile, and logout work", async () => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const suffix = `${Date.now()}${Math.random()}`;

  const register = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      firstName: "Test",
      username: `tester${suffix}`,
      email: `tester${suffix}@example.com`,
      password: "password123",
      city: "Lafayette, California",
    }),
  });
  assert.equal(register.status, 201);
  const auth = await register.json();

  const me = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(me.status, 200);

  const logout = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.token}` },
  });
  assert.equal(logout.status, 204);
  await new Promise((resolve) => server.close(resolve));
});

test.after(() => db.close());
