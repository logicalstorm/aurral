import { useState, useEffect } from "react";
import { Music, Loader } from "lucide-react";
import { getArtistCover } from "../utils/api";

const queue = [];
let active = 0;
const MAX_CONCURRENT = 4;

const processQueue = () => {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  const next = queue.shift();
  active++;
  next().finally(() => {
    active--;
    processQueue();
  });
};

const scheduleFetch = (fn) => {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const res = await fn();
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
    processQueue();
  });
};

const ArtistImage = ({
  mbid,
  src,
  alt,
  className = "",
  showLoading = true,
}) => {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setCurrentSrc(src || null);
    if (src) {
      setHasError(false);
      setIsLoading(true);
    }
  }, [src, mbid]);

  useEffect(() => {
    if (src) {
      setIsLoading(true);
      setHasError(false);
    } else if (mbid) {
      fetchBackendCover();
    } else {
      setIsLoading(false);
      setHasError(true);
    }
  }, [src, mbid]);

  const fetchBackendCover = async () => {
    if (!mbid) {
      setHasError(true);
      setIsLoading(false);
      return;
    }

    if (currentSrc) return;

    try {
      setIsLoading(true);
      setHasError(false);

      const data = await scheduleFetch(() => 
        Promise.race([
          getArtistCover(mbid),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), 10000)
          )
        ])
      );
      if (data?.images && data.images.length > 0) {
        const front = data.images.find((img) => img.front) || data.images[0];
        const url = front.image;
        if (url) {
          setCurrentSrc(url);
          setHasError(false);
        } else {
          setHasError(true);
          setIsLoading(false);
        }
      } else {
        setHasError(true);
        setIsLoading(false);
      }
    } catch (err) {
      setHasError(true);
      setIsLoading(false);
    }
  };

  const handleLoad = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    setHasError(true);
    setIsLoading(false);
  };

  if (hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-600 ${className}`}
      >
        <Music className="w-1/3 h-1/3" />
      </div>
    );
  }

  if (!currentSrc && !isLoading && !hasError) {
    return (
      <div
        className={`relative overflow-hidden bg-gray-200 dark:bg-gray-800 ${className}`}
      >
        {showLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-200 dark:bg-gray-800">
            <Loader className="w-6 h-6 text-primary-500 animate-spin" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden bg-gray-200 dark:bg-gray-800 ${className}`}
    >
      {isLoading && showLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-200 dark:bg-gray-800">
          <Loader className="w-6 h-6 text-primary-500 animate-spin" />
        </div>
      )}
      {currentSrc && (
        <img
          src={currentSrc}
          alt={alt || "Artist cover"}
          className={`w-full h-full object-cover transition-opacity duration-100 ${
            isLoading ? "opacity-0" : "opacity-100"
          }`}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
          decoding="async"
          fetchpriority={showLoading ? "high" : "auto"}
          style={{ contentVisibility: "auto" }}
        />
      )}
    </div>
  );
};

export default ArtistImage;
