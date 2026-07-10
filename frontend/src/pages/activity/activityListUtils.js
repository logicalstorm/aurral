const getRequestIdentity = (request) =>
  String(
    request?.id ||
      [
        request?.source,
        request?.kind,
        request?.type,
        request?.jobId,
        request?.albumId,
        request?.mbid,
        request?.title,
        request?.name,
      ]
        .filter(Boolean)
        .join(":"),
  );

const buildRequestChangeSignature = (request) =>
  JSON.stringify({
    source: request?.source || null,
    kind: request?.kind || null,
    type: request?.type || null,
    title: request?.title || null,
    subtitle: request?.subtitle || null,
    name: request?.name || null,
    albumName: request?.albumName || null,
    artistName: request?.artistName || null,
    status: request?.status || null,
    statusLabel: request?.statusLabel || null,
    sourceFilename: request?.sourceFilename || null,
    href: request?.href || null,
    inQueue: request?.inQueue === true,
    canReSearch: request?.canReSearch === true,
  });

export const mergeActivityRequests = (previousRequests, nextRequests) => {
  const incoming = Array.isArray(nextRequests) ? nextRequests : [];
  if (!Array.isArray(previousRequests) || previousRequests.length === 0) {
    return incoming;
  }

  const previousById = new Map(
    previousRequests.map((request) => [getRequestIdentity(request), request]),
  );

  return incoming.map((request) => {
    const previous = previousById.get(getRequestIdentity(request));
    if (!previous) return request;
    if (buildRequestChangeSignature(previous) !== buildRequestChangeSignature(request)) {
      return request;
    }
    return {
      ...request,
      requestedAt: previous.requestedAt || request.requestedAt,
    };
  });
};

export const formatTimelineTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatDateGroupLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
};

const groupRequestsByDate = (requests) => {
  const groups = [];
  let currentLabel = null;
  for (const request of requests) {
    const label = formatDateGroupLabel(request.requestedAt);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ type: "date", label, key: `date-${label}` });
    }
    groups.push({ type: "item", request, key: request.id || request.mbid });
  }
  return groups;
};

export const compareActivityRequests = (a, b) => {
  const aReSearchable = a?.canReSearch === true ? 1 : 0;
  const bReSearchable = b?.canReSearch === true ? 1 : 0;
  if (aReSearchable !== bReSearchable) {
    return bReSearchable - aReSearchable;
  }
  return (
    new Date(b.requestedAt) - new Date(a.requestedAt) ||
    String(b.id || "").localeCompare(String(a.id || ""))
  );
};

export const buildHistoryListEntries = (requests) => {
  const reSearchable = [];
  const rest = [];
  for (const request of requests) {
    if (request?.canReSearch === true) {
      reSearchable.push(request);
    } else {
      rest.push(request);
    }
  }
  const entries = reSearchable.map((request) => ({
    type: "item",
    request,
    key: request.id || request.mbid,
  }));
  return [...entries, ...groupRequestsByDate(rest)];
};
