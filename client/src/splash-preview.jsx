import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import BrandSplash from './components/BrandSplash.jsx';
function Preview() {
  const [take, setTake] = useState(0);
  return <><BrandSplash key={take} /><button onClick={() => setTake(n => n + 1)}>重播开屏动画</button></>;
}
createRoot(document.getElementById('root')).render(<Preview />);
