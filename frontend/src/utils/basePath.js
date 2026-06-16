export const normalizeBasePath = (baseUrl) => {
  const raw = (baseUrl || "/").trim();
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withLeadingSlash === "/") return "/";
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
};

export const normalizeBasePathWithTrailingSlash = (baseUrl) => {
  const raw = (baseUrl || "/").trim();
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
};

export const stripBasePath = (href, basePath) => {
  if (basePath === "/") return href;
  if (href === basePath) return "/";
  if (href.startsWith(`${basePath}/`)) {
    return href.slice(basePath.length) || "/";
  }
  return href;
};

export const getAppBasePath = () =>
  normalizeBasePath(
    import.meta.env.VITE_BASE_PATH || import.meta.env.BASE_URL,
  );
