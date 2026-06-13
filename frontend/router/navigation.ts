interface NavigateOptions {
  replace?: boolean;
}

function currentPathAndSearch(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function navigateTo(pathAndSearch: string, onNavigate: () => void, options: NavigateOptions = {}): void {
  if (currentPathAndSearch() === pathAndSearch) return;
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method](null, "", pathAndSearch);
  onNavigate();
}

export function installLinkInterceptor(
  onNavigate: () => void,
  canHandlePath: (pathname: string) => boolean,
): void {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    if (!(event.target instanceof Element)) return;

    const anchor = event.target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;

    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (!canHandlePath(url.pathname)) return;

    event.preventDefault();
    navigateTo(`${url.pathname}${url.search}`, onNavigate);
  });
}
