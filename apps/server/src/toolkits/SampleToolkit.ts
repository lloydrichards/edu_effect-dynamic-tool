import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

/**
 * Calculator Tool - Safely evaluates mathematical expressions
 */
const calculatorTool = Tool.make("calculate", {
  description:
    "Evaluate a mathematical expression safely. Supports basic arithmetic operations (+, -, *, /), exponentiation (^), and common functions (sin, cos, sqrt, etc). Example: calculate(expression: '2 + 2 * 10')",
  parameters: Schema.Struct({
    expression: Schema.String,
  }),
  success: Schema.String,
});

/**
 * Echo Tool - Simple echo for testing
 */
const echoTool = Tool.make("echo", {
  description:
    "Echo back a message. Useful for testing tool calling. Example: echo(message: 'Hello, World!')",
  parameters: Schema.Struct({
    message: Schema.String,
  }),
  success: Schema.String,
});

/**
 * Get Current Time Tool - Returns current UTC time
 */
const getCurrentTimeTool = Tool.make("getCurrentTime", {
  description:
    "Get the current date and time in a given timezone. Example: getCurrentTime(timezone: 'UTC')",
  parameters: Schema.Struct({
    timezone: Schema.String.annotate({
      description: "IANA timezone identifier (e.g. 'UTC', 'America/New_York')",
    }),
  }),
  success: Schema.String,
});

/**
 * Random Number Tool - Generates a random number in range
 */
const randomNumberTool = Tool.make("randomNumber", {
  description:
    "Generate a random integer between min (inclusive) and max (inclusive). Example: randomNumber(min: 1, max: 100)",
  parameters: Schema.Struct({
    min: Schema.Number,
    max: Schema.Number,
  }),
  success: Schema.String,
});

export const SampleToolkit = Toolkit.make(
  calculatorTool,
  echoTool,
  getCurrentTimeTool,
  randomNumberTool,
);

export const SampleToolkitLive = SampleToolkit.toLayer(
  Effect.gen(function* () {
    return {
      calculate: (params) =>
        Effect.gen(function* () {
          yield* Effect.log(`Calculating: ${params.expression}`);

          // Simple safe evaluation for basic math
          // Whitelist allowed characters
          const sanitized = params.expression.replace(/[^0-9+\-*/().\s]/g, "");

          if (sanitized !== params.expression) {
            return yield* Effect.succeed(
              `Error: Expression contains invalid characters. Only numbers and basic operators (+, -, *, /, parentheses) are allowed.`,
            );
          }

          return yield* Effect.try({
            try: () => {
              const value = Function(`"use strict"; return (${sanitized})`)();
              if (typeof value !== "number" || Number.isNaN(value)) {
                throw new Error("Result is not a valid number");
              }
              return `${params.expression} = ${value}`;
            },
            catch: (error) =>
              new Error(
                `Invalid expression: ${error instanceof Error ? error.message : String(error)}`,
              ),
          }).pipe(
            Effect.catch((error) => Effect.succeed(`Error: ${error.message}`)),
          );
        }),

      echo: (params) =>
        Effect.gen(function* () {
          yield* Effect.log(`Echo: ${params.message}`);
          return yield* Effect.succeed(`Echo: ${params.message}`);
        }),

      getCurrentTime: (params) =>
        Effect.gen(function* () {
          const now = new Date();
          const timeString = now.toLocaleString("en-US", {
            timeZone: params.timezone,
          });
          yield* Effect.log(`Current time (${params.timezone}): ${timeString}`);
          return yield* Effect.succeed(
            `Current time in ${params.timezone}: ${timeString} (ISO: ${now.toISOString()})`,
          );
        }),

      randomNumber: (params) =>
        Effect.gen(function* () {
          const { min, max } = params;

          if (min > max) {
            return yield* Effect.succeed(
              `Error: min (${min}) must be less than or equal to max (${max})`,
            );
          }

          const random = Math.floor(Math.random() * (max - min + 1)) + min;
          yield* Effect.log(
            `Generated random number: ${random} (${min}-${max})`,
          );
          return yield* Effect.succeed(
            `Random number between ${min} and ${max}: ${random}`,
          );
        }),
    };
  }),
);
