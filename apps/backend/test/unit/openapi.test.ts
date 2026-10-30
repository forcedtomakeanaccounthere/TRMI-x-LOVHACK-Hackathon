import { describe, expect, it } from "vitest";
import { apiRouters, createApp } from "../../src/app";
import { openApiDocument } from "../../src/openapi";

type RouteLayer = { route?: { path: string; methods: Record<string, boolean> } };

function serverRoutes() {
  return Object.entries(apiRouters).flatMap(([mount, router]) =>
    (router.stack as RouteLayer[]).flatMap(({ route }) => {
      if (!route) return [];
      const path = `${mount}${route.path === "/" ? "" : route.path}`.replace(/:(\w+)/g, "{$1}");
      return Object.keys(route.methods).map((method) => `${method} ${path}`);
    }),
  );
}

function documentedRoutes() {
  return Object.entries(openApiDocument.paths ?? {}).flatMap(([path, item]) =>
    Object.keys(item ?? {}).map((method) => `${method} ${path}`),
  );
}

describe("OpenAPI document", () => {
  it("documents exactly the routes the server has", () => {
    expect(documentedRoutes().sort()).toEqual(serverRoutes().sort());
  });

  it("knows about every router mounted on the app", () => {
    const stack = createApp().router.stack as { name: string }[];
    expect(stack.filter((layer) => layer.name === "router")).toHaveLength(Object.keys(apiRouters).length);
  });
});
