import { describe, expect, it } from "vitest";
import { createPtyOwnerRegistry } from "./pty-owner.js";

describe("PTY owner registry", () => {
  it("keeps the first client as controller and later clients as observers", () => {
    const registry = createPtyOwnerRegistry();
    const desktop = {};
    const browser = {};

    expect(registry.register(desktop, "desktop-tab")).toBe("controller");
    expect(registry.register(browser, "browser-tab")).toBe("observer");
    expect(registry.isController(desktop)).toBe(true);
    expect(registry.isController(browser)).toBe(false);
    expect(registry.controllerId()).toBe("desktop-tab");
  });

  it("allows the same client identity to regain control after reconnect", () => {
    const registry = createPtyOwnerRegistry();
    const desktop = {};
    const browser = {};
    const reconnectedDesktop = {};

    registry.register(desktop, "desktop-tab");
    registry.register(browser, "browser-tab");
    registry.unregister(desktop);

    expect(registry.register(reconnectedDesktop, "desktop-tab")).toBe("controller");
    expect(registry.isController(browser)).toBe(false);
    expect(registry.isController(reconnectedDesktop)).toBe(true);
  });

  it("does not transfer control when the controller disconnects", () => {
    const registry = createPtyOwnerRegistry();
    const desktop = {};
    const browser = {};
    const replacement = {};

    registry.register(desktop, "desktop-tab");
    registry.unregister(desktop);

    expect(registry.register(browser, "browser-tab")).toBe("observer");
    expect(registry.register(replacement, "replacement-tab")).toBe("observer");
    expect(registry.controllerId()).toBe("desktop-tab");
  });
});
