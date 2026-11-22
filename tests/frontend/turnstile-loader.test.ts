import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  delete window.turnstile;
  document
    .querySelectorAll('script[src*="challenges.cloudflare.com"]')
    .forEach((node) => node.remove());
  vi.useRealTimers();
});

it("shares one official script load across callers", async () => {
  vi.resetModules();
  const { loadTurnstile } = await import("@/lib/auth/turnstile");
  const first = loadTurnstile();
  const second = loadTurnstile();
  expect(first).toBe(second);
  const scripts = document.querySelectorAll(
    'script[src*="challenges.cloudflare.com"]',
  );
  expect(scripts).toHaveLength(1);
  expect((scripts[0] as HTMLScriptElement).src).toBe(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  );
  const api = { render: vi.fn(), remove: vi.fn() };
  window.turnstile = api;
  scripts[0].dispatchEvent(new Event("load"));
  expect(await first).toBe(api);
  expect(await loadTurnstile()).toBe(api);
});

it("removes a failed script and allows a fresh retry", async () => {
  vi.resetModules();
  const { loadTurnstile } = await import("@/lib/auth/turnstile");
  const failed = loadTurnstile();
  const assertion = expect(failed).rejects.toThrow("could not load");
  document
    .querySelector('script[src*="challenges.cloudflare.com"]')!
    .dispatchEvent(new Event("error"));
  await assertion;
  expect(
    document.querySelector('script[src*="challenges.cloudflare.com"]'),
  ).toBeNull();
  const retry = loadTurnstile();
  window.turnstile = { render: vi.fn(), remove: vi.fn() };
  document
    .querySelector('script[src*="challenges.cloudflare.com"]')!
    .dispatchEvent(new Event("load"));
  expect(await retry).toBe(window.turnstile);
});

it("ends a stalled load with a recoverable failure", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const { loadTurnstile } = await import("@/lib/auth/turnstile");
  const result = loadTurnstile();
  const assertion = expect(result).rejects.toThrow("could not load");
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
  expect(
    document.querySelector('script[src*="challenges.cloudflare.com"]'),
  ).toBeNull();
});
