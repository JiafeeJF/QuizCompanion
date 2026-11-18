import React, { useEffect, useRef } from 'react';
import { mountComputeBackground } from '../../public/compute-background.js';
import '../../public/compute-background.css';

export default function ComputeBackground() {
  const host = useRef(null);
  useEffect(() => {
    return mountComputeBackground(host.current);
  }, []);
  return <div ref={host} className="compute-background" aria-hidden="true" />;
}
