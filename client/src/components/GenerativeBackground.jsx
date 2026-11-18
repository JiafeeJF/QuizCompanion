import { useEffect, useRef } from 'react';
import { mountGenerativeBackground } from '../../public/generative-background.js';
import '../../public/generative-background.css';

export default function GenerativeBackground({ startup = false }) {
  const host = useRef(null);
  useEffect(() => mountGenerativeBackground(host.current), []);
  return <div ref={host} className="generative-background" data-render-mode={startup ? 'startup' : 'default'} aria-hidden="true" />;
}
