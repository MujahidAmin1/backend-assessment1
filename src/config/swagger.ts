import swaggerJsDoc from "swagger-jsdoc";

const options: swaggerJsDoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Wallet API",
      version: "1.0.0",
      description:
        "API for retrieving wallet balances and processing deposit events.",
    },
    servers: [{ url: "/" }],
    components: {
      schemas: {
        CreateWalletInput: {
          type: "object",
          required: ["walletId", "customerId", "balanceKobo", "currency"],
          additionalProperties: false,
          properties: {
            walletId: { type: "string", example: "W001" },
            customerId: { type: "string", example: "C001" },
            balanceKobo: { type: "integer", minimum: 0, example: 0 },
            currency: {
              type: "string",
              enum: ["NGN"],
              example: "NGN",
            },
          },
        },
        EventStatus: {
          type: "string",
          enum: ["pending", "successful", "failed"],
        },
        Event: {
          type: "object",
          required: [
            "eventId",
            "transactionRef",
            "walletId",
            "amountKobo",
            "currency",
            "status",
          ],
          properties: {
            eventId: { type: "string", example: "E001" },
            transactionRef: { type: "string", example: "T001" },
            walletId: { type: "string", example: "W001" },
            amountKobo: { type: "integer", minimum: 1, example: 250000 },
            currency: { type: "string", enum: ["NGN"], example: "NGN" },
            status: { $ref: "#/components/schemas/EventStatus" },
            createdAt: {
              type: "string",
              format: "date-time",
              description: "Timestamp of event creation",
            },
          },
        },
        Wallet: {
          type: "object",
          required: ["walletId", "customerId", "balanceKobo", "currency"],
          properties: {
            walletId: { type: "string", example: "W001" },
            customerId: { type: "string", example: "C001" },
            balanceKobo: { type: "integer", example: 250000 },
            currency: { type: "string", example: "NGN" },
          },
        },
        WalletDetails: {
          type: "object",
          required: [
            "walletId",
            "customerId",
            "availableBalance",
            "currency",
            "transactions",
          ],
          properties: {
            walletId: { type: "string", example: "W001" },
            customerId: { type: "string", example: "C001" },
            availableBalance: { type: "integer", example: 250000 },
            currency: { type: "string", example: "NGN" },
            transactions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  reference: { type: "string", example: "T001" },
                  amount: { type: "integer", example: 250000 },
                  currency: { type: "string", example: "NGN" },
                  status: { $ref: "#/components/schemas/EventStatus" },
                },
              },
            },
          },
        },
        Error: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", example: "Wallet does not exist" },
          },
        },
      },
    },
  },
  apis: ["./src/modules/**/*.ts", "./dist/modules/**/*.js"],
};

export const swaggerSpec = swaggerJsDoc(options);
export default swaggerSpec;
