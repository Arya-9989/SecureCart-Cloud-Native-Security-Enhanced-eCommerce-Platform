import { z } from "zod";

/*
 * Zod v4 probes for JIT support with `new Function("")`. Our CSP (script-src 'self', no
 * 'unsafe-eval') rightly blocks that, and Chrome reports every blocked probe as a CSP issue.
 * Jitless mode skips the probe and validates without generated code.
 */
z.config({ jitless: true });
