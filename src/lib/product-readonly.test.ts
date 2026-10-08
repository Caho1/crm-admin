import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import type { SessionUser } from "./types";

test("product name and view action open read-only attachments for users while admin editing retains writes", async () => {
  // Simulated DOM only: all fetches are fixture responses, no browser or HTTP server.
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "http://127.0.0.1/products?create=1" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = { window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, SVGElement: window.SVGElement, Element: window.Element, Node: window.Node, ShadowRoot: window.ShadowRoot, ResizeObserver: window.ResizeObserver, getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window), IS_REACT_ACT_ENVIRONMENT: true };
  // React's async act fallback creates Node MessagePorts; close these after unmount.
  const channels: MessageChannel[] = [];
  globals.MessageChannel = class extends MessageChannel {
    constructor() { super(); channels.push(this); }
  };
  const requests: Array<{ url: string; method: string }> = [];
  const product = { id: 1, className: "PP", grade: "Synthetic Grade", brand: "Synthetic Brand", supplier: "Synthetic Supplier", status: "active", application: "Synthetic use", notes: "Synthetic notes", competitors: [{ id: 1, grade: "Competitor", manufacturer: "Synthetic Manufacturer" }] };
  globals.fetch = async (input: string, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method || "GET" });
    if (String(input) === "/api/lookups") return Response.json({ data: { users: [], customers: [], products: [], industries: [], dicts: {} } });
    if (String(input) === "/api/products/1/attachments") return Response.json({ data: [{ id: 7, fileName: "synthetic.txt", mimeType: "text/plain", fileSize: 24, createdAt: "2026-10-01" }] });
    if (String(input).startsWith("/api/products?")) return Response.json({ data: [product], meta: { page: 1, pageSize: 10, total: 1 } });
    throw new Error(`Unexpected fixture request: ${input}`);
  };
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const localRequire = createRequire(join(process.cwd(), "package.json"));
  const originalCssLoader = localRequire.extensions[".css"];
  localRequire.extensions[".css"] = (module) => { module.exports = new Proxy({}, { get: (_target, key) => key === "__esModule" ? false : String(key) }); };
  const { createElement: h, act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { Providers } = await import("../components/providers");
  const { UserProvider } = await import("../components/user-context");
  const { ResourcePage } = await import("../components/resource-page");
  const router = { back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
  const host = window.document.createElement("div");
  window.document.body.appendChild(host);
  const root = createRoot(host as unknown as HTMLElement);
  const user: SessionUser = { id: 3, username: "synthetic", name: "Synthetic", role: "user", status: "active" };
  const buttons = () => Array.from(window.document.querySelectorAll("button"));
  const click = async (button: ReturnType<typeof buttons>[number]) => act(async () => { button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); });
  const render = async (session: SessionUser) => act(async () => {
    root.render(h(AppRouterContext.Provider, { value: router }, h(Providers, null, h(UserProvider, { user: session, children: h(ResourcePage, { resource: "products", key: session.role }) }))));
  });
  try {
    await render(user);
    assert.equal(window.document.querySelector(".ant-modal"), null, "create=1 must not open an ordinary user's product form");
    assert.equal(buttons().some((button) => button.textContent?.includes("新建产品") || button.getAttribute("aria-label") === "编辑" || button.getAttribute("aria-label") === "删除"), false);
    await click(buttons().find((button) => button.textContent === "Synthetic Grade")!);
    assert.match(window.document.body.textContent || "", /产品详情/);
    assert.match(window.document.body.textContent || "", /Synthetic notes/);
    assert.match(window.document.body.textContent || "", /synthetic.txt/);
    assert.ok(window.document.querySelector('a[href="/api/products/1/attachments/7"][download]'));
    assert.equal(buttons().some((button) => button.textContent?.includes("上传附件") || button.textContent?.replace(/\s/g, "") === "保存" || button.getAttribute("aria-label") === "删除"), false);
    await click(buttons().find((button) => button.textContent?.includes("synthetic.txt"))!);
    assert.match(window.document.body.textContent || "", /该文件类型暂不支持预览/);
    assert.ok(window.document.querySelector('a[href="/api/products/1/attachments/7"][download]'));
    // Unmount modal state, then exercise the dedicated view action.
    await act(async () => root.render(null));
    await render(user);
    await click(buttons().find((button) => button.getAttribute("aria-label") === "查看")!);
    assert.match(window.document.body.textContent || "", /synthetic.txt/);
    assert.ok(requests.every((request) => request.method === "GET"));
    await act(async () => root.render(null));
    await render({ ...user, role: "admin" });
    await click(buttons().find((button) => button.getAttribute("aria-label") === "编辑")!);
    assert.ok(buttons().some((button) => button.textContent?.includes("上传附件")));
    assert.ok(buttons().some((button) => button.getAttribute("aria-label") === "删除"));
    assert.ok(buttons().some((button) => button.textContent?.replace(/\s/g, "") === "保存"));
  } finally {
    await act(async () => root.unmount());
    localRequire.extensions[".css"] = originalCssLoader;
    await window.happyDOM.close();
    for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
