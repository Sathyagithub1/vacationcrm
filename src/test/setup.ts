/**
 * src/test/setup.ts
 *
 * Global test setup for jsdom / UI environment tests.
 *
 * Loaded via vitest.ui.config.ts setupFiles.
 * Extends vitest's expect with @testing-library/jest-dom matchers so that
 * assertions like `expect(el).toBeInTheDocument()` work in component tests.
 */

import "@testing-library/jest-dom";
