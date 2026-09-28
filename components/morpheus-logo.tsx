"use client";

import { useState } from "react";

export default function MorpheusLogo({
  size = 38,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const [assetFailed, setAssetFailed] = useState(false);

  return (
    <div
      className={`morpheus-mark ${className}`}
      style={{ width: size, height: size }}
      aria-label="Morpheus"
    >
      {!assetFailed ? (
        <img
          src="/morpheus-logo.png"
          alt=""
          width={size}
          height={size}
          draggable={false}
          className="morpheus-mark-image"
          onError={() => setAssetFailed(true)}
        />
      ) : (
        <svg
          viewBox="0 0 64 64"
          width={size}
          height={size}
          role="img"
          aria-label="Morpheus"
          className="morpheus-mark-vector"
        >
          <path
            d="M13 49V18.5L30.8 31.3 50.5 15.5V48.7L40.6 42V35.2L31.2 42.7 22.7 36.6V49Z"
            fill="currentColor"
          />
          <path
            d="M13 18.5 22.7 12 31.3 18.1 40.8 10.5 50.5 15.5 30.8 31.3Z"
            fill="currentColor"
            opacity=".72"
          />
        </svg>
      )}
    </div>
  );
}
