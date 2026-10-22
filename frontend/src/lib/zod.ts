import { z } from "zod";

/*
 * Zod v4 probes for JIT support with `new Function("")`. Our CSP (script-src 'self', no
 * 'unsafe-eval') rightly blocks that, and Chrome reports every blocked probe as a CSP issue.
 * Jitless mode skips the probe and validates without generated code.
 *
 * Every schema imports `z` from here, so the setting is applied before any schema exists and
 * zod is only downloaded by the pages that validate forms (it is not in the entry bundle).
 */
z.config({ jitless: true });

export { z };
