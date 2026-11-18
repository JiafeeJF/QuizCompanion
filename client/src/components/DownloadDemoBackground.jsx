import { useEffect, useRef } from 'react';
import { mountDownloadDemo } from '../../public/download-demo.js';
import '../../public/download-demo.css';

export default function DownloadDemoBackground() {
  const host = useRef(null);
  useEffect(() => mountDownloadDemo(host.current), []);
  return <div ref={host} className="wlbd-download-demo wd-react" aria-hidden="true" />;
}
