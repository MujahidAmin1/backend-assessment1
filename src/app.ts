import express from "express";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./config/swagger";
import walletRouter from "./modules/wallet/walletRouter";
import providerRouter from "./modules/provider/providerRouter";
import { errorHandler } from "./middleware/errorHandler";
import morgan from "morgan";
import cors from "cors";

const app = express();

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes — match the assessment's required paths exactly
app.use("/wallets", walletRouter);
app.use("/provider", providerRouter);

app.get("/", (_req, res) => {
  res.json({ message: "Wallet API is running" });
});

// Global error handler — must come after all routes
app.use(errorHandler);

export default app;
