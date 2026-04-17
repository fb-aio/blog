const preactGlobal = window.preact;
const hooksGlobal = window.preactHooks;
const h = preactGlobal.h;

export const html = window.htm.bind(h);
export const render = preactGlobal.render;
export const useEffect = hooksGlobal.useEffect;
export const useMemo = hooksGlobal.useMemo;
export const useRef = hooksGlobal.useRef;
export const useState = hooksGlobal.useState;
