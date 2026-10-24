import { useEffect } from 'react';
import { installGlobalErrorReporter } from '@/lib/errorReporter';
export function GlobalErrorReporter() { useEffect(() => installGlobalErrorReporter(), []); return null; }
