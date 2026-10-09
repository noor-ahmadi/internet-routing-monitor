import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/syne/latin-700.css';
import '@fontsource/syne/latin-800.css';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import { LazyMotion, MotionConfig } from 'motion/react';
import App from './App';
import './styles.css';

const loadMotion = () => import('./motion-features').then(module => module.default);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><LazyMotion features={loadMotion} strict><MotionConfig reducedMotion="user"><App /></MotionConfig></LazyMotion></React.StrictMode>,
);
