import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    DATABASE_URL: z.string().regex(/^postgres(?:ql)?:\/\//),
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//)
      .optional(),
    REALTIME_SECRET: z.string().min(32),
    WEB_ORIGIN: z.url().transform((value) => new URL(value).origin),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.REDIS_URL)
        ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'required' });
      if (!env.WEB_ORIGIN.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'HTTPS required' });
      }
    }
  });

export function loadConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Report names only, never values or Zod's full input/error object.
    throw new Error(
      `Invalid realtime configuration: ${[...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
    );
  }
  return result.data;
}
