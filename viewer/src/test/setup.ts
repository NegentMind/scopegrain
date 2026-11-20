import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Without vitest globals, RTL auto-cleanup is not registered.
afterEach(cleanup);
