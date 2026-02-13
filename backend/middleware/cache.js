export const cacheMiddleware = (maxAge, options = {}) => {
  const {
    staleWhileRevalidate = false,
    mustRevalidate = false,
    private: isPrivate = false,
  } = options;

  return (req, res, next) => {
    if (req.method !== "GET") {
      return next();
    }

    const cacheControl = [];
    
    if (isPrivate) {
      cacheControl.push("private");
    } else {
      cacheControl.push("public");
    }

    cacheControl.push(`max-age=${maxAge}`);

    if (staleWhileRevalidate) {
      cacheControl.push("stale-while-revalidate=60");
    }

    if (mustRevalidate) {
      cacheControl.push("must-revalidate");
    }

    res.set("Cache-Control", cacheControl.join(", "));
    res.set("Vary", "Accept");

    if (maxAge > 0) {
      const expires = new Date(Date.now() + maxAge * 1000);
      res.set("Expires", expires.toUTCString());
    }

    next();
  };
};

export const noCache = (req, res, next) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
};
