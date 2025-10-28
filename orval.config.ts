import { defineConfig } from "orval";

export default defineConfig({
  pjBanking: {
    input: "./docs/openapi/pj-banking.yaml",
    output: {
      target: "./client/sdk/src/pjBanking.gen.ts",
      schemas: "./client/sdk/src/model",
      client: "axios",
      useDataOnly: true,
      override: {
        mutator: {
          path: "./client/sdk/src/httpClient.ts",
          name: "sdkClient",
          returnType: "data",
        },
      },
    },
  },
});
