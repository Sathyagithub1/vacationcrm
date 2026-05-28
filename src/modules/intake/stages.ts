/**
 * src/modules/intake/stages.ts
 *
 * Shared factory that builds the default IntakeStages object for use by all
 * three webhook route handlers (T32 universal, T33 Meta Lead Ads, T34 Google
 * Forms). Centralising the imports here prevents each route file from
 * duplicating the full 7-stage import block.
 *
 * Set up: no env vars required — each stage module handles its own deps.
 */

import { checkSpam } from "./spam";
import { normalize } from "./normalize";
import { dedupCheck } from "./dedup";
import { resolveDepartment } from "./department";
import { processTour } from "./tour";
import { dispatch } from "./dispatch";
import { assignLead } from "./assignment";
import type { IntakeStages } from "./types";

/**
 * Returns the default IntakeStages object wiring all 7 pipeline stages in
 * execution order.  The returned object is a plain value (no lazy init) so
 * TypeScript can statically verify the shape against IntakeStages.
 */
export function getDefaultStages(): IntakeStages {
  return {
    spam: checkSpam,
    normalize,
    dedup: dedupCheck,
    department: resolveDepartment,
    tour: processTour,
    dispatch,
    assignment: assignLead,
  };
}
