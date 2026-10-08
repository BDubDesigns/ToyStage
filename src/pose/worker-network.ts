interface NetworkScope {
  location: { href: string; origin: string };
  fetch: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
}

// Pinned MediaPipe includes delayed usage/performance telemetry. Restrict the
// worker BEFORE its runtime imports execute; do not patch vendor bytes or allow
// POSTs, remote models, or redirects. Only local static asset GETs are needed.
export function restrictWorkerNetwork(scope: NetworkScope): () => number {
  let blocked = 0;
  function permit(method: string, url: string): void {
    if (method.toUpperCase() !== "GET" || new URL(url, scope.location.href).origin !== scope.location.origin) {
      blocked++;
      throw new Error("Pose worker permits same-origin asset GETs only.");
    }
  }
  const nativeFetch = scope.fetch.bind(scope);
  scope.fetch = async (input, init) => {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
    permit(init?.method ?? request?.method ?? "GET", request?.url ?? String(input));
    return nativeFetch(input, { ...init, redirect: "error" });
  };
  if (scope.XMLHttpRequest) {
    const nativeOpen = scope.XMLHttpRequest.prototype.open;
    scope.XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async: boolean = true, user?: string | null, password?: string | null): void {
      permit(method, String(url));
      nativeOpen.call(this, method, url, async, user, password);
    };
  }
  return () => blocked;
}
