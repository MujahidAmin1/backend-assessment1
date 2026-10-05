import app from "./app";
import { seedDatabase } from "./config/seed";

const PORT = process.env.PORT || 3000;

async function main() {
  await seedDatabase();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Swagger docs: http://localhost:${PORT}/api-docs`);
  });
}

main().catch(console.error);