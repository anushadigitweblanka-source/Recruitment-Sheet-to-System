// Applied to every frontend test file. Testing Library waits only 1 second for
// something to appear and Vitest allows 5 seconds per test; on a busy computer
// (for example several suites running at once) that was occasionally too short
// and produced "Unable to find an element" failures that passed on a rerun.
// Longer limits make slow runs pass; a test that is really wrong still fails.
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5000 });
