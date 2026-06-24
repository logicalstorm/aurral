import { getData, fetchInflightOnce, searchInflightRequests } from "../core.js";

export const searchUnified = async (
  query,
  { mode = "suggest", limit } = {},
) => {
  const params = { q: query, mode };
  if (limit != null) {
    params.limit = limit;
  }
  const key = `search-unified:${JSON.stringify(params)}`;
  const timeoutMs = mode === "full" ? 30000 : 12000;
  return fetchInflightOnce(searchInflightRequests, key, () =>
    getData("/search/unified", {
      params,
      timeout: timeoutMs,
    }),
  );
};

export const searchCatalog = async (
  query,
  scope = "artist",
  {
    limit = 24,
    offset = 0,
    releaseTypes = [],
    sort,
  } = {},
) => {
  const params = { q: query, scope, limit, offset };
  if (scope === "album") {
    if (Array.isArray(releaseTypes) && releaseTypes.length) {
      params.releaseTypes = releaseTypes.join(",");
    }
    if (sort) {
      params.sort = sort;
    }
  }
  const key = `search:${JSON.stringify(params)}`;
  return fetchInflightOnce(searchInflightRequests, key, () =>
    getData("/search", { params }),
  );
};
